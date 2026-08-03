import Link from "next/link";
import { notFound } from "next/navigation";
import { db, tables } from "@/db";
import { eq, inArray, desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { RefCard } from "@/components/ref-card";
import { ImportDropzone } from "@/components/import-dropzone";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/select-refs";

export const dynamic = "force-dynamic";

type EntityType = "character" | "prop" | "setting";
type GenerationStatus = "pending" | "done" | "failed";

const TYPE_STYLES: Record<EntityType, string> = {
  character: "border-sky-800/40 bg-sky-950/40 text-sky-300",
  prop: "border-amber-800/40 bg-amber-950/40 text-amber-300",
  setting: "border-emerald-800/40 bg-emerald-950/40 text-emerald-300",
};

const STATUS_STYLES: Record<GenerationStatus, string> = {
  pending: "border-amber-800/40 bg-amber-950/40 text-amber-300",
  done: "border-emerald-800/40 bg-emerald-950/40 text-emerald-300",
  failed: "border-red-900/40 bg-red-950/40 text-red-300",
};

export default async function EntityDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entity = db.select().from(tables.entities).where(eq(tables.entities.slug, slug)).all()[0];
  if (!entity) notFound();

  const refRows = db
    .select()
    .from(tables.refs)
    .where(eq(tables.refs.entityId, entity.id))
    .all()
    .map((r) => ({ ...r, role: r.role as Role }))
    .sort((a, b) => a.priority - b.priority);

  // No join helper exists for this in src/lib/queries.ts (out of scope to add one there),
  // so this reads generationInputs directly and does the entity -> generations fan-out
  // in two simple queries, matching the un-joined query style already used elsewhere
  // in this codebase (e.g. entitiesWithRefs in src/lib/queries.ts).
  const inputRows = db
    .select()
    .from(tables.generationInputs)
    .where(eq(tables.generationInputs.entityId, entity.id))
    .all();
  const generationIds = [...new Set(inputRows.map((r) => r.generationId))];
  const usedIn = generationIds.length
    ? db
        .select()
        .from(tables.generations)
        .where(inArray(tables.generations.id, generationIds))
        .orderBy(desc(tables.generations.createdAt))
        .all()
    : [];

  return (
    <div className="mx-auto max-w-5xl space-y-10">
      <div>
        <Link
          href="/library"
          className="text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Library
        </Link>
        <header className="mt-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-medium text-foreground">{entity.name}</h1>
            <Badge variant="outline" className={cn("font-normal", TYPE_STYLES[entity.type])}>
              {entity.type}
            </Badge>
          </div>
          {entity.description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{entity.description}</p>
          )}
        </header>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Canon references · {refRows.length}
        </h2>
        {refRows.length > 0 && (
          <div className="mb-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {refRows.map((r) => (
              <RefCard key={r.id} refRow={r} />
            ))}
          </div>
        )}
        <ImportDropzone entityId={entity.id} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Used in generations · {usedIn.length}
        </h2>
        {usedIn.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not used in any generation yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {usedIn.map((g) => (
              <li key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Badge
                  variant="outline"
                  className={cn("shrink-0 font-normal", STATUS_STYLES[g.status])}
                >
                  {g.status}
                </Badge>
                <span className="truncate text-foreground">{g.promptUser}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
