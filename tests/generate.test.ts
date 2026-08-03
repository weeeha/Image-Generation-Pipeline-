import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

process.env.LIBRARY_ROOT = `/tmp/fds-gen-${process.pid}`;
process.env.GEMINI_API_KEY = 'test-key'; // isModelAvailable checks env presence

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// The `images.sha256` column is UNIQUE, and this file inserts many "generated" and
// "imported" rows across shared-DB tests. PNG_1x1 (used once, below, for the happy-path
// ref image) can't be reused for every mocked provider output or every test would collide
// on sha256. This synthesizes a fresh, valid, distinctly-colored 1x1 PNG per call so every
// images-table insert in this file has unique content.
let pixelSeq = 0;
async function uniquePngBuffer(): Promise<Buffer> {
  pixelSeq += 1;
  const r = (pixelSeq * 37) % 256;
  const g = (pixelSeq * 59) % 256;
  const b = (pixelSeq * 83) % 256;
  return sharp({ create: { width: 1, height: 1, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
}

// Only `providerFor` is mocked — `isModelAvailable` stays real so the "unavailable model"
// test exercises actual availability logic, and so createGeneration's own availability
// gate is exercised authentically everywhere else too.
vi.mock('@/lib/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers')>();
  return { ...actual, providerFor: vi.fn() };
});

describe('generation service', () => {
  it('runs the full loop: create -> run -> outputs linked, status done', async () => {
    // IMPORT @/db FIRST: its client mkdir's LIBRARY_ROOT. drizzle-kit push does NOT
    // create the parent dir and exits 0 anyway, so pushing before this silently no-ops.
    const { db, tables } = await import('@/db');
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit push --force', { env: { ...process.env }, stdio: 'ignore' });
    const { saveImageFile } = await import('@/lib/store');
    const { createGeneration, runPending } = await import('@/lib/generate');
    const { providerFor } = await import('@/lib/providers');
    const { eq } = await import('drizzle-orm');

    vi.mocked(providerFor).mockReturnValue({
      name: 'google', envVar: 'GEMINI_API_KEY',
      generate: vi.fn().mockImplementation(async () => [{ data: await uniquePngBuffer(), mimeType: 'image/png' }]),
    });

    // Seed a default style token + revision so this test also exercises
    // queries.ts's defaultTokens()/latestRevisionId() and the generationTokens lineage
    // write in createGeneration — otherwise nothing in this file would ever touch them.
    const tokenValue = 'Cinematic still, muted warm palette, soft key light.';
    const [tok] = db.insert(tables.styleTokens)
      .values({ slug: 'base-style', name: 'Base style', category: 'custom', value: tokenValue, isDefault: true })
      .returning().all();
    db.insert(tables.tokenRevisions).values({ tokenId: tok.id, value: tokenValue }).run();

    const [e] = db.insert(tables.entities).values({ slug: 'mara', name: 'Mara', type: 'character' }).returning().all();
    const f = await saveImageFile(PNG_1x1, 'png', 'imported');
    const [img] = db.insert(tables.images).values({ ...f, source: 'imported' }).returning().all();
    db.insert(tables.refs).values({ entityId: e.id, imageId: img.id, role: 'front', priority: 1 }).run();

    const genId = createGeneration({
      entityIds: [e.id], scene: 'Mara at night', model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9', resolution: '1K',
    });
    await runPending(genId);

    const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
    expect(gen.status).toBe('done');
    expect(gen.provider).toBe('google');
    expect(gen.promptFinal).toContain('Character reference: Mara');
    expect(gen.promptFinal).toContain(tokenValue);

    const inputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all();
    expect(inputs).toHaveLength(1);
    expect(inputs[0].imageId).toBe(img.id);

    const genTokens = db.select().from(tables.generationTokens).where(eq(tables.generationTokens.generationId, genId)).all();
    expect(genTokens).toHaveLength(1);
    expect(genTokens[0].tokenId).toBe(tok.id);

    const outputs = db.select().from(tables.images).where(eq(tables.images.generationId, genId)).all();
    expect(outputs).toHaveLength(1);
  });

  it('marks the generation failed with the error recorded, and creates no image rows, when the provider rejects', async () => {
    const { db, tables } = await import('@/db');
    const { createGeneration, runPending } = await import('@/lib/generate');
    const { providerFor } = await import('@/lib/providers');
    const { eq } = await import('drizzle-orm');

    vi.mocked(providerFor).mockReturnValue({
      name: 'google', envVar: 'GEMINI_API_KEY',
      generate: vi.fn().mockRejectedValue(new Error('provider exploded')),
    });

    // No refs needed: a zero-ref entity is excluded by selectRefs (with a warning) but
    // does not prevent createGeneration from proceeding — irrelevant to what's tested here.
    const [e] = db.insert(tables.entities).values({ slug: 'kade-failure', name: 'Kade', type: 'character' }).returning().all();

    const genId = createGeneration({
      entityIds: [e.id], scene: 'Kade at dawn', model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9', resolution: '1K',
    });
    await runPending(genId);

    const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
    expect(gen.status).toBe('failed');
    expect(gen.error).toBe('provider exploded');
    expect(typeof gen.durationMs).toBe('number');

    const outputs = db.select().from(tables.images).where(eq(tables.images.generationId, genId)).all();
    expect(outputs).toHaveLength(0);
  });

  it('retryGeneration creates a new pending generation carrying over the same inputs, prompt, and provider', async () => {
    const { db, tables } = await import('@/db');
    const { saveImageFile } = await import('@/lib/store');
    const { createGeneration, runPending, retryGeneration } = await import('@/lib/generate');
    const { providerFor } = await import('@/lib/providers');
    const { eq } = await import('drizzle-orm');

    vi.mocked(providerFor).mockReturnValue({
      name: 'google', envVar: 'GEMINI_API_KEY',
      generate: vi.fn().mockRejectedValue(new Error('transient failure')),
    });

    const [e] = db.insert(tables.entities).values({ slug: 'rin-retry', name: 'Rin', type: 'character' }).returning().all();
    const f = await saveImageFile(await uniquePngBuffer(), 'png', 'imported');
    const [img] = db.insert(tables.images).values({ ...f, source: 'imported' }).returning().all();
    db.insert(tables.refs).values({ entityId: e.id, imageId: img.id, role: 'front', priority: 1 }).run();

    const genId = createGeneration({
      entityIds: [e.id], scene: 'Rin in the rain', model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9', resolution: '1K',
    });
    await runPending(genId);
    const failed = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
    expect(failed.status).toBe('failed');

    const freshId = retryGeneration(genId);
    expect(freshId).not.toBe(genId);

    const fresh = db.select().from(tables.generations).where(eq(tables.generations.id, freshId)).all()[0];
    expect(fresh.status).toBe('pending');
    expect(fresh.promptFinal).toBe(failed.promptFinal);
    expect(fresh.provider).toBe(failed.provider);
    expect(fresh.model).toBe(failed.model);
    expect(fresh.aspectRatio).toBe(failed.aspectRatio);

    const origInputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all();
    const freshInputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, freshId)).all();
    expect(origInputs.length).toBeGreaterThan(0);
    expect(freshInputs.map(i => ({ imageId: i.imageId, slot: i.slot }))).toEqual(
      origInputs.map(i => ({ imageId: i.imageId, slot: i.slot }))
    );

    const origTokens = db.select().from(tables.generationTokens).where(eq(tables.generationTokens.generationId, genId)).all();
    const freshTokens = db.select().from(tables.generationTokens).where(eq(tables.generationTokens.generationId, freshId)).all();
    expect(freshTokens.map(t => ({ tokenId: t.tokenId, tokenRevisionId: t.tokenRevisionId }))).toEqual(
      origTokens.map(t => ({ tokenId: t.tokenId, tokenRevisionId: t.tokenRevisionId }))
    );
  });

  it('enqueue() serializes runs — two enqueued generations never execute concurrently', async () => {
    const { db, tables } = await import('@/db');
    const { createGeneration, enqueue } = await import('@/lib/generate');
    const { providerFor } = await import('@/lib/providers');
    const { eq } = await import('drizzle-orm');

    let concurrent = 0;
    let maxConcurrent = 0;
    vi.mocked(providerFor).mockReturnValue({
      name: 'google', envVar: 'GEMINI_API_KEY',
      generate: vi.fn().mockImplementation(async () => {
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise(resolve => setTimeout(resolve, 30));
        concurrent -= 1;
        return [{ data: await uniquePngBuffer(), mimeType: 'image/png' }];
      }),
    });

    const makeGen = (slug: string) => {
      const [e] = db.insert(tables.entities).values({ slug, name: slug, type: 'character' }).returning().all();
      return createGeneration({
        entityIds: [e.id], scene: `${slug} scene`, model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '16:9', resolution: '1K',
      });
    };

    const id1 = makeGen('queue-a');
    const id2 = makeGen('queue-b');

    enqueue(id1);
    enqueue(id2);

    const bothSettled = () => {
      const g1 = db.select().from(tables.generations).where(eq(tables.generations.id, id1)).all()[0];
      const g2 = db.select().from(tables.generations).where(eq(tables.generations.id, id2)).all()[0];
      return g1.status !== 'pending' && g2.status !== 'pending';
    };
    const start = Date.now();
    while (!bothSettled()) {
      if (Date.now() - start > 3000) throw new Error('timed out waiting for the queue to drain');
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    expect(maxConcurrent).toBe(1);
    const g1 = db.select().from(tables.generations).where(eq(tables.generations.id, id1)).all()[0];
    const g2 = db.select().from(tables.generations).where(eq(tables.generations.id, id2)).all()[0];
    expect(g1.status).toBe('done');
    expect(g2.status).toBe('done');
  });

  it('createGeneration throws for an unavailable model (no OpenAI adapter) and writes no generation row', async () => {
    const { db, tables } = await import('@/db');
    const { createGeneration } = await import('@/lib/generate');
    const { eq } = await import('drizzle-orm');

    const [e] = db.insert(tables.entities).values({ slug: 'unused-prop', name: 'Unused', type: 'prop' }).returning().all();

    const before = db.select().from(tables.generations).where(eq(tables.generations.model, 'gpt-image-2')).all().length;

    expect(() => createGeneration({
      entityIds: [e.id], scene: 'irrelevant', model: 'gpt-image-2',
      aspectRatio: '1:1', resolution: '1K',
    })).toThrow(/OpenAI adapter not implemented yet/);

    const after = db.select().from(tables.generations).where(eq(tables.generations.model, 'gpt-image-2')).all().length;
    expect(after).toBe(before);
    expect(after).toBe(0);
  });

  it('sweepStalePending flips pending rows to failed with the interrupted message', async () => {
    const { db, tables } = await import('@/db');
    const { sweepStalePending } = await import('@/lib/generate');
    const { eq } = await import('drizzle-orm');

    const [gen] = db.insert(tables.generations).values({
      promptUser: 'stale scene', promptFinal: 'stale scene final', model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '1:1', resolution: '1K', status: 'pending',
    }).returning().all();

    sweepStalePending();

    const swept = db.select().from(tables.generations).where(eq(tables.generations.id, gen.id)).all()[0];
    expect(swept.status).toBe('failed');
    expect(swept.error).toBe('interrupted — retry');
  });
});
