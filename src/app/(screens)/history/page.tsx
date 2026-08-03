import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import { MODELS, type ModelId } from "@/lib/models";
import { HistoryFilters, type FilterEntity, type FilterModel } from "@/components/history-filters";
import {
  HistoryRow,
  type HistoryEntry,
  type HistoryRefGroup,
  type HistoryToken,
} from "@/components/history-row";
import type { PromoteControlEntity } from "@/components/promote-control";

export const dynamic = "force-dynamic";

const MAX_ROWS = 100;
const STATUSES = ["pending", "done", "failed"] as const;
type GenerationStatus = (typeof STATUSES)[number];

function isStatus(v: string | undefined): v is GenerationStatus {
  return v !== undefined && (STATUSES as readonly string[]).includes(v);
}

function isKnownModel(id: string): id is ModelId {
  return id in MODELS;
}

const PROVIDER_LABELS: Record<string, string> = { google: "Google", openai: "OpenAI" };

function providerLabelFor(provider: string | null, model: string): string {
  const p = provider ?? (isKnownModel(model) ? MODELS[model].provider : null);
  if (!p) return "Unknown";
  return PROVIDER_LABELS[p] ?? p;
}

function modelLabelFor(model: string): string {
  return isKnownModel(model) ? MODELS[model].label : model;
}

// Bucketed relative time computed once, server-side, at request time. This page is
// force-dynamic (no static shell), so there's no server/client render-time gap that could
// desync a live client-side clock — a plain string is simpler and avoids any hydration risk.
function relativeTime(unixSeconds: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000 - unixSeconds));
  if (diffSec < 60) return "just now";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

function formatDuration(ms: number | null): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remS = Math.round(s % 60);
  return `${m}m ${remS}s`;
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ entity?: string; model?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const entityFilter = sp.entity && /^\d+$/.test(sp.entity) ? Number(sp.entity) : undefined;
  const modelFilter = sp.model && isKnownModel(sp.model) ? sp.model : undefined;
  const statusFilter = isStatus(sp.status) ? sp.status : undefined;

  // Every query below is a plain, un-joined drizzle call resolved and grouped in JS — the
  // same style already used by src/app/(screens)/library/[slug]/page.tsx (no join helper
  // exists in src/lib/queries.ts for this, and adding one there is out of scope for this
  // screen).
  const allEntities = db
    .select()
    .from(tables.entities)
    .all()
    .sort((a, b) => a.name.localeCompare(b.name));
  const entityNameById = new Map(allEntities.map((e) => [e.id, e.name] as const));

  // The entity filter operates on generationInputs (a related table), so it's resolved to a
  // concrete list of matching generation ids up front, then combined with the other filters
  // as a normal `inArray`. A sentinel (`[-1]`) stands in for "matched nothing" so the
  // `inArray` call is never given a literal empty array.
  let candidateIds: number[] | undefined;
  if (entityFilter !== undefined) {
    const rows = db
      .select({ generationId: tables.generationInputs.generationId })
      .from(tables.generationInputs)
      .where(eq(tables.generationInputs.entityId, entityFilter))
      .all();
    const ids = [...new Set(rows.map((r) => r.generationId))];
    candidateIds = ids.length > 0 ? ids : [-1];
  }

  const whereClause = and(
    modelFilter ? eq(tables.generations.model, modelFilter) : undefined,
    statusFilter ? eq(tables.generations.status, statusFilter) : undefined,
    candidateIds ? inArray(tables.generations.id, candidateIds) : undefined
  );

  const allMatching = db
    .select()
    .from(tables.generations)
    .where(whereClause)
    .orderBy(desc(tables.generations.createdAt), desc(tables.generations.id))
    .all();

  const totalMatching = allMatching.length;
  const gens = allMatching.slice(0, MAX_ROWS);
  const ids = gens.map((g) => g.id);

  const outputs = ids.length
    ? db.select().from(tables.images).where(inArray(tables.images.generationId, ids)).all()
    : [];
  const inputs = ids.length
    ? db.select().from(tables.generationInputs).where(inArray(tables.generationInputs.generationId, ids)).all()
    : [];
  const genTokenRows = ids.length
    ? db.select().from(tables.generationTokens).where(inArray(tables.generationTokens.generationId, ids)).all()
    : [];

  const tokenIds = [...new Set(genTokenRows.map((t) => t.tokenId))];
  const revisionIds = [...new Set(genTokenRows.map((t) => t.tokenRevisionId))];
  const tokenNameById = new Map(
    (tokenIds.length
      ? db.select().from(tables.styleTokens).where(inArray(tables.styleTokens.id, tokenIds)).all()
      : []
    ).map((t) => [t.id, t.name] as const)
  );
  // The revision's value at the time it was used — not the token's current value — since
  // that's the entire point of revision tracking (see generationTokens in the schema).
  const revisionValueById = new Map(
    (revisionIds.length
      ? db.select().from(tables.tokenRevisions).where(inArray(tables.tokenRevisions.id, revisionIds)).all()
      : []
    ).map((r) => [r.id, r.value] as const)
  );

  const outputsByGen = new Map<number, typeof outputs>();
  for (const o of outputs) {
    if (o.generationId == null) continue;
    const list = outputsByGen.get(o.generationId);
    if (list) list.push(o);
    else outputsByGen.set(o.generationId, [o]);
  }

  const inputsByGen = new Map<number, typeof inputs>();
  for (const i of inputs) {
    const list = inputsByGen.get(i.generationId);
    if (list) list.push(i);
    else inputsByGen.set(i.generationId, [i]);
  }

  const tokensByGen = new Map<number, typeof genTokenRows>();
  for (const t of genTokenRows) {
    const list = tokensByGen.get(t.generationId);
    if (list) list.push(t);
    else tokensByGen.set(t.generationId, [t]);
  }

  const entries: HistoryEntry[] = gens.map((g) => {
    const gInputs = inputsByGen.get(g.id) ?? [];

    // Group the exact reference images sent by (entityId, slot) — almost always one group
    // per entity, since a given entity is only ever sent under its one natural slot, but
    // keying on both keeps this correct even if that ever changes.
    const groupMap = new Map<string, HistoryRefGroup>();
    for (const inp of gInputs) {
      const key = `${inp.entityId}:${inp.slot}`;
      let group = groupMap.get(key);
      if (!group) {
        group = {
          entityId: inp.entityId,
          entityName: inp.entityId !== null ? (entityNameById.get(inp.entityId) ?? `Entity #${inp.entityId}`) : "Unknown entity",
          slot: inp.slot,
          imageIds: [],
        };
        groupMap.set(key, group);
      }
      group.imageIds.push(inp.imageId);
    }

    const tokens: HistoryToken[] = (tokensByGen.get(g.id) ?? []).map((t) => ({
      tokenId: t.tokenId,
      name: tokenNameById.get(t.tokenId) ?? `Token #${t.tokenId}`,
      value: revisionValueById.get(t.tokenRevisionId) ?? "",
    }));

    return {
      id: g.id,
      status: g.status,
      promptUser: g.promptUser,
      promptFinal: g.promptFinal,
      modelLabel: modelLabelFor(g.model),
      providerLabel: providerLabelFor(g.provider, g.model),
      quality: g.quality,
      aspectRatio: g.aspectRatio,
      resolution: g.resolution,
      durationLabel: formatDuration(g.durationMs),
      error: g.error,
      createdAtRelative: relativeTime(g.createdAt),
      createdAtAbsolute: new Date(g.createdAt * 1000).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      outputs: (outputsByGen.get(g.id) ?? []).map((o) => ({ id: o.id, width: o.width, height: o.height })),
      referenceGroups: [...groupMap.values()],
      tokens,
    };
  });

  const entityOptions: PromoteControlEntity[] = allEntities.map((e) => ({ id: e.id, name: e.name }));
  const filterEntities: FilterEntity[] = allEntities.map((e) => ({ id: e.id, name: e.name, type: e.type }));
  const filterModels: FilterModel[] = (Object.keys(MODELS) as ModelId[]).map((id) => ({
    id,
    label: MODELS[id].label,
  }));

  const anyFilterActive = entityFilter !== undefined || modelFilter !== undefined || statusFilter !== undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-medium text-foreground">History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every generation, in reverse-chronological order — the exact references, prompt, and style tokens
          that produced each result.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <HistoryFilters
          entities={filterEntities}
          models={filterModels}
          current={{
            entity: entityFilter?.toString(),
            model: modelFilter,
            status: statusFilter,
          }}
        />
        {totalMatching > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">
            Showing the latest {MAX_ROWS} of {totalMatching} generations.
          </p>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
          <p className="text-sm text-muted-foreground">
            {anyFilterActive ? "No generations match these filters." : "No generations yet."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {anyFilterActive ? (
              <Link href="/history" className="underline underline-offset-4 hover:text-foreground">
                Clear filters
              </Link>
            ) : (
              <>
                Head to{" "}
                <Link href="/generate" className="underline underline-offset-4 hover:text-foreground">
                  Generate
                </Link>{" "}
                to create the first one.
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} entities={entityOptions} />
          ))}
        </div>
      )}
    </div>
  );
}
