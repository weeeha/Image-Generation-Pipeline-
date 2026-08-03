import { describe, it, expect, beforeAll } from 'vitest';

process.env.LIBRARY_ROOT = `/tmp/fds-test-${process.pid}`;

describe('db', () => {
  it('creates schema and inserts an entity', async () => {
    const { db, tables } = await import('@/db');
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit push --force', { env: { ...process.env }, stdio: 'ignore' });
    const [e] = db.insert(tables.entities).values({ slug: 'mara', name: 'Mara', type: 'character' }).returning().all();
    expect(e.id).toBeGreaterThan(0);
    expect(db.select().from(tables.entities).all()).toHaveLength(1);
  });
});
