import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { selectRefs } from '@/lib/select-refs';
import { assemblePrompt } from '@/lib/prompt';
import { entitiesWithRefs, defaultTokens, latestRevisionId } from '@/lib/queries';
import { providerFor, isModelAvailable } from '@/lib/providers';
import { saveImageFile, readImage } from '@/lib/store';
import { MODELS, type ModelId } from '@/lib/models';

export interface CreateGenInput {
  entityIds: number[]; scene: string; model: ModelId;
  aspectRatio: string; resolution: string;
  quality?: string; budget?: number; promptOverride?: string;
}

export function createGeneration(input: CreateGenInput): number {
  const availability = isModelAvailable(input.model);
  if (!availability.available) throw new Error(availability.reason ?? 'model unavailable');

  const info = MODELS[input.model];
  const ents = entitiesWithRefs(input.entityIds);
  const { picks } = selectRefs(ents, input.model, { budget: input.budget });
  const tokens = defaultTokens(); // M1: defaults only; M2 adds per-shot selection
  const promptFinal = input.promptOverride ?? assemblePrompt({
    tokens: tokens.map(t => ({ category: t.category, value: t.value })),
    entities: ents.filter(e => picks.some(p => p.entityId === e.id)).map(e => ({ name: e.name, type: e.type })),
    scene: input.scene, aspectRatio: input.aspectRatio, resolution: input.resolution,
  });

  // .all() is required — drizzle-orm 0.45's .returning() is a QueryPromise, not iterable.
  const [gen] = db.insert(tables.generations).values({
    promptUser: input.scene, promptFinal, model: input.model, provider: info.provider,
    aspectRatio: input.aspectRatio, resolution: input.resolution,
    quality: input.quality ?? info.defaultQuality ?? null, status: 'pending',
  }).returning().all();

  for (const p of picks)
    db.insert(tables.generationInputs).values({ generationId: gen.id, imageId: p.imageId, entityId: p.entityId, slot: p.slot }).run();
  for (const t of tokens)
    db.insert(tables.generationTokens).values({ generationId: gen.id, tokenId: t.id, tokenRevisionId: latestRevisionId(t.id) }).run();
  return gen.id;
}

let chain: Promise<unknown> = Promise.resolve(); // serial queue — one provider call at a time

export function enqueue(genId: number): void {
  chain = chain.then(() => runPending(genId)).catch(() => {});
}

export async function runPending(genId: number): Promise<void> {
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
  if (!gen || gen.status !== 'pending') return;
  const started = Date.now();
  try {
    const inputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all();
    const refs = inputs.map(i => {
      const img = db.select().from(tables.images).where(eq(tables.images.id, i.imageId)).all()[0];
      return { data: readImage(img.path), mimeType: `image/${img.format === 'jpg' ? 'jpeg' : img.format}` };
    });
    const results = await providerFor(gen.model as ModelId).generate({
      model: gen.model as ModelId, prompt: gen.promptFinal, refs,
      aspectRatio: gen.aspectRatio, resolution: gen.resolution, quality: gen.quality ?? undefined,
    });
    let seq = 1;
    for (const r of results) {
      const ext = r.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      const f = await saveImageFile(r.data, ext, 'generated', genId, seq++);
      db.insert(tables.images).values({ ...f, source: 'generated', generationId: genId }).run();
    }
    db.update(tables.generations).set({ status: 'done', durationMs: Date.now() - started }).where(eq(tables.generations.id, genId)).run();
  } catch (err) {
    db.update(tables.generations).set({
      status: 'failed', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started,
    }).where(eq(tables.generations.id, genId)).run();
  }
}

export function sweepStalePending(): void {
  db.update(tables.generations).set({ status: 'failed', error: 'interrupted — retry' })
    .where(eq(tables.generations.status, 'pending')).run();
}

export function retryGeneration(genId: number): number {
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
  if (!gen) throw new Error('generation not found');
  const [fresh] = db.insert(tables.generations).values({
    promptUser: gen.promptUser, promptFinal: gen.promptFinal, model: gen.model, provider: gen.provider,
    aspectRatio: gen.aspectRatio, resolution: gen.resolution, quality: gen.quality, status: 'pending',
  }).returning().all();
  for (const i of db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all())
    db.insert(tables.generationInputs).values({ generationId: fresh.id, imageId: i.imageId, entityId: i.entityId, slot: i.slot }).run();
  for (const t of db.select().from(tables.generationTokens).where(eq(tables.generationTokens.generationId, genId)).all())
    db.insert(tables.generationTokens).values({ generationId: fresh.id, tokenId: t.tokenId, tokenRevisionId: t.tokenRevisionId }).run();
  return fresh.id;
}
