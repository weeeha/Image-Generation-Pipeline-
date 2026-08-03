import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { entitiesWithRefs, defaultTokens } from '@/lib/queries';
import { isModelAvailable } from '@/lib/providers';
import { MODELS, type ModelId } from '@/lib/models';
import { ShotComposer, type ModelAvailability, type ShotComposerInitial } from '@/components/shot-composer';

export const dynamic = 'force-dynamic';

// Backs the History screen's "Use as starting point" link (/generate?from=<id>). Reuses
// the past generation's *scene* (promptUser) rather than its promptFinal — promptFinal
// already has tokens/entity descriptions/aspect baked in, so reusing it verbatim as the
// editable scene field would double all of that up on the next generation. Byte-for-byte
// replay of a past generation is what Retry (POST /api/generations/[id]) already does; this
// is deliberately the "edit and regenerate" path instead, so only the composer's own
// settings are carried over, not a fixed/pinned set of reference picks.
function loadInitialFromGeneration(id: number): ShotComposerInitial | undefined {
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, id)).all()[0];
  if (!gen) return undefined;
  const inputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, id)).all();
  const entityIds = [...new Set(inputs.map((i) => i.entityId).filter((eid): eid is number => eid !== null))];
  return {
    scene: gen.promptUser,
    model: gen.model as ModelId,
    aspectRatio: gen.aspectRatio,
    resolution: gen.resolution,
    quality: gen.quality ?? undefined,
    entityIds,
  };
}

export default async function GeneratePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  const fromId = from && /^\d+$/.test(from) ? Number(from) : undefined;
  const initial = fromId !== undefined ? loadInitialFromGeneration(fromId) : undefined;

  const entities = [...entitiesWithRefs()].sort((a, b) => a.name.localeCompare(b.name));
  const tokens = defaultTokens().map((t) => ({ id: t.id, name: t.name, value: t.value }));

  // isModelAvailable reads process.env — server-only. Resolved once here and passed down
  // as plain data so the client composer never needs to know how availability is decided.
  const availability = Object.fromEntries(
    (Object.keys(MODELS) as ModelId[]).map((id) => [id, isModelAvailable(id)])
  ) as ModelAvailability;

  return <ShotComposer entities={entities} tokens={tokens} availability={availability} initial={initial} />;
}
