import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';

process.env.LIBRARY_ROOT = `/tmp/fds-actions-${process.pid}`;

// Server Actions that call revalidatePath() need Next's request-scoped "static generation
// store" (AsyncLocalStorage), which only exists while the real Next.js runtime is handling
// a request. Calling the action directly in a plain vitest test — with no Next runtime —
// throws "Invariant: static generation store missing in revalidatePath". Route Handlers
// don't have this problem (see tests/api.test.ts, called directly with no mocking), but
// Server Actions using cache APIs do; mocking the cache call is the standard way to unit
// test the surrounding logic in isolation.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// The `images.sha256` column is UNIQUE, so every fixture image used across tests in this
// file needs genuinely distinct bytes.
let pixelSeq = 0;
async function uniquePngBuffer(): Promise<Buffer> {
  pixelSeq += 1;
  const r = (pixelSeq * 53) % 256;
  const g = (pixelSeq * 97) % 256;
  const b = (pixelSeq * 131) % 256;
  return sharp({ create: { width: 2, height: 2, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
}

describe('server actions', () => {
  it('createEntity creates an entity, slugifies the name, and defaults description to ""', async () => {
    // IMPORT @/db FIRST: its client mkdir's LIBRARY_ROOT. drizzle-kit push does NOT
    // create the parent dir and exits 0 anyway, so pushing before this silently no-ops.
    const { db, tables } = await import('@/db');
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit push --force', { env: { ...process.env }, stdio: 'ignore' });
    const { createEntity } = await import('@/app/actions');

    // `description` is intentionally omitted here — this is the exact call site the
    // z.input<> parameter-type fix exists for; if createEntity's parameter type is wrong,
    // this line fails to typecheck (see `npx tsc --noEmit`), not just at runtime.
    const result = await createEntity({ name: 'Mara', type: 'character' });
    expect(result.slug).toBe('mara');

    const row = db.select().from(tables.entities).all().find(e => e.id === result.id);
    expect(row?.name).toBe('Mara');
    expect(row?.description).toBe('');
  });

  it('createEntity rejects a duplicate name with a clear, user-facing message (not a raw SQLite error)', async () => {
    const { createEntity } = await import('@/app/actions');

    await createEntity({ name: 'Kade', type: 'character', description: 'first' });
    await expect(createEntity({ name: 'Kade', type: 'character' }))
      .rejects.toThrow('An entity named "Kade" already exists');
  });

  it('createEntity treats names that slugify to the same value as duplicates too', async () => {
    const { createEntity } = await import('@/app/actions');

    await createEntity({ name: 'Neon Alley', type: 'setting' });
    await expect(createEntity({ name: 'neon-alley', type: 'setting' }))
      .rejects.toThrow(/already exists/);
  });

  it('promoteToRef inserts a ref, setRefPriority updates it, and demoteRef removes it', async () => {
    const { db, tables } = await import('@/db');
    const { createEntity, promoteToRef, demoteRef, setRefPriority } = await import('@/app/actions');
    const { saveImageFile } = await import('@/lib/store');

    const ent = await createEntity({ name: 'Rin', type: 'character' });
    const saved = await saveImageFile(await uniquePngBuffer(), 'png', 'imported');
    const [img] = db.insert(tables.images).values({ ...saved, source: 'imported' }).returning().all();

    await promoteToRef({ imageId: img.id, entityId: ent.id, role: 'front' });
    let refs = db.select().from(tables.refs).all().filter(r => r.entityId === ent.id);
    expect(refs).toHaveLength(1);
    expect(refs[0].role).toBe('front');
    expect(refs[0].priority).toBe(100);

    // promoting the same image again updates the role instead of duplicating the row
    // (onConflictDoUpdate on the entityId+imageId unique index).
    await promoteToRef({ imageId: img.id, entityId: ent.id, role: 'detail' });
    refs = db.select().from(tables.refs).all().filter(r => r.entityId === ent.id);
    expect(refs).toHaveLength(1);
    expect(refs[0].role).toBe('detail');

    await setRefPriority(refs[0].id, 5);
    refs = db.select().from(tables.refs).all().filter(r => r.entityId === ent.id);
    expect(refs[0].priority).toBe(5);

    await demoteRef(ent.id, img.id);
    refs = db.select().from(tables.refs).all().filter(r => r.entityId === ent.id);
    expect(refs).toHaveLength(0);
  });
});
