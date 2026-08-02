import { describe, it, expect, vi, beforeAll } from 'vitest';
import sharp from 'sharp';

process.env.LIBRARY_ROOT = `/tmp/fds-api-${process.pid}`;
process.env.GEMINI_API_KEY = 'test-key'; // isModelAvailable checks env presence

// The `images.sha256` column is UNIQUE and this file inserts many rows across shared-DB
// tests, so every fixture image needs genuinely distinct bytes (mirrors the helper in
// tests/generate.test.ts) rather than reusing one constant.
let pixelSeq = 0;
async function uniquePngBuffer(): Promise<Buffer> {
  pixelSeq += 1;
  const r = (pixelSeq * 41) % 256;
  const g = (pixelSeq * 61) % 256;
  const b = (pixelSeq * 89) % 256;
  return sharp({ create: { width: 2, height: 2, channels: 4, background: { r, g, b, alpha: 1 } } }).png().toBuffer();
}

// A real, tiny (8x8) HEVC-coded HEIC file — generated once via macOS's `sips -s format
// heic` and embedded as base64 so this test never depends on `sips` or a HEVC decoder
// being present at test-run time. It exists purely to prove POST /api/import degrades to
// a clean 400 (not a 500) when sharp/libheif on this machine can't decode the pixels —
// verified empirically: this build can parse the HEIC container (format/metadata) but
// lacks the HEVC decode plugin, so saveImageFile's thumbnail step throws.
const HEIC_8X8_HEVC_BASE64 =
  'AAAAJGZ0eXBoZWljAAAAAG1pZjFNaVBybWlhZk1pSEJoZWljAAABw21ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAHBpY3QAAAAAAAAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAAADnBpdG0AAAAAAAEAAAA4aWluZgAAAAAAAgAAABVpbmZlAgAAAAABAABodmMxAAAAABVpbmZlAgAAAQACAABFeGlmAAAAABppcmVmAAAAAAAAAA5jZHNjAAIAAQABAAAA5mlwcnAAAADFaXBjbwAAABNjb2xybmNseAACAAIABoAAAAAMY2xsaQDLAEAAAAAUaXNwZQAAAAAAAAAIAAAACAAAAAlpcm90AAAAABBwaXhpAAAAAAMICAgAAABxaHZjQwEDcAAAALAAAAAAAB7wAPz9+PgAAAsDoAABABdAAQwB//8DcAAAAwCwAAADAAADAB5wJKEAAQAjQgEBA3AAAAMAsAAAAwAAAwAeoBQgQcCbDuIe5FlU3AgIGAKiAAEACUQBwGFyyERTZAAAABlpcG1hAAAAAAAAAAEAAQaBAgMFhoQAAAAsaWxvYwAAAABEAAACAAEAAAABAAACQwAAAD4AAgAAAAEAAAH3AAAATAAAAAFtZGF0AAAAAAAAAJoAAAAGRXhpZgAATU0AKgAAAAgAAwEaAAUAAAABAAAAMgEbAAUAAAABAAAAOgEoAAMAAAABAAIAAAAAAAAAAAAZAAAAAQAAABkAAAABAAAAOigBr6L6RoF8//ylx//vl+y+0N71X/4mHyPSuy/3JI90yyZ/oCD5wjnLKNDRT7/GvQi9hX4K3CEmyK4=';

// Only `providerFor` is mocked — no real provider API calls happen anywhere in this file.
vi.mock('@/lib/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providers')>();
  return { ...actual, providerFor: vi.fn() };
});

describe('api routes', () => {
  beforeAll(async () => {
    // IMPORT @/db FIRST: its client mkdir's LIBRARY_ROOT. drizzle-kit push does NOT
    // create the parent dir and exits 0 anyway, so pushing before this silently no-ops.
    await import('@/db');
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit push --force', { env: { ...process.env }, stdio: 'ignore' });
  });

  describe('POST /api/generate', () => {
    it('valid body -> 200 with {id}; a pending/completed row exists and eventually completes', async () => {
      const { db, tables } = await import('@/db');
      const { POST } = await import('@/app/api/generate/route');
      const { providerFor } = await import('@/lib/providers');
      const { eq } = await import('drizzle-orm');

      vi.mocked(providerFor).mockReturnValue({
        name: 'google', envVar: 'GEMINI_API_KEY',
        generate: vi.fn().mockImplementation(async () => [{ data: await uniquePngBuffer(), mimeType: 'image/png' }]),
      });

      const req = new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: [], scene: 'An empty room at dusk', model: 'gemini-3.1-flash-image-preview',
          aspectRatio: '16:9', resolution: '1K',
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(typeof json.id).toBe('number');

      let row = db.select().from(tables.generations).where(eq(tables.generations.id, json.id)).all()[0];
      expect(row).toBeDefined();
      expect(['pending', 'done']).toContain(row.status);

      const start = Date.now();
      while (row.status === 'pending' && Date.now() - start < 3000) {
        await new Promise(r => setTimeout(r, 10));
        row = db.select().from(tables.generations).where(eq(tables.generations.id, json.id)).all()[0];
      }
      expect(row.status).toBe('done');
    });

    it('invalid body (empty scene) -> 400', async () => {
      const { POST } = await import('@/app/api/generate/route');
      const req = new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: [], scene: '', model: 'gemini-3.1-flash-image-preview',
          aspectRatio: '16:9', resolution: '1K',
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    it('unsupported aspect/resolution for the chosen model -> 400', async () => {
      const { POST } = await import('@/app/api/generate/route');
      const req = new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: [], scene: 'valid scene', model: 'gemini-3.1-flash-image-preview',
          aspectRatio: '16:9', resolution: '9K',
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/aspect\/resolution/);
    });

    it('model: gpt-image-2 -> 400 carrying the "not implemented" reason (createGeneration throw handled, not a 500)', async () => {
      const { POST } = await import('@/app/api/generate/route');
      const req = new Request('http://localhost/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          entityIds: [], scene: 'valid scene', model: 'gpt-image-2',
          aspectRatio: '1:1', resolution: '1K',
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/OpenAI adapter not implemented yet/);
    });
  });

  describe('/api/generations/[id]', () => {
    it('GET shape includes status and outputs', async () => {
      const { db, tables } = await import('@/db');
      const { GET } = await import('@/app/api/generations/[id]/route');
      const { saveImageFile } = await import('@/lib/store');

      const [gen] = db.insert(tables.generations).values({
        promptUser: 'a scene', promptFinal: 'a scene final', model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '1:1', resolution: '1K', status: 'done',
      }).returning().all();
      const saved = await saveImageFile(await uniquePngBuffer(), 'png', 'generated', gen.id, 1);
      db.insert(tables.images).values({ ...saved, source: 'generated', generationId: gen.id }).run();

      const res = await GET(new Request(`http://localhost/api/generations/${gen.id}`), {
        params: Promise.resolve({ id: String(gen.id) }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('done');
      expect(json.outputs).toHaveLength(1);
      expect(json.outputs[0]).toMatchObject({ width: saved.width, height: saved.height });
    });

    it('GET unknown id -> 404', async () => {
      const { GET } = await import('@/app/api/generations/[id]/route');
      const res = await GET(new Request('http://localhost/api/generations/999999'), {
        params: Promise.resolve({ id: '999999' }),
      });
      expect(res.status).toBe(404);
    });

    it('POST retries a failed generation into a fresh pending generation', async () => {
      const { db, tables } = await import('@/db');
      const { POST } = await import('@/app/api/generations/[id]/route');
      const { eq } = await import('drizzle-orm');

      const [gen] = db.insert(tables.generations).values({
        promptUser: 'stale', promptFinal: 'stale final', model: 'gemini-3.1-flash-image-preview',
        aspectRatio: '1:1', resolution: '1K', status: 'failed', error: 'boom',
      }).returning().all();

      const res = await POST(new Request(`http://localhost/api/generations/${gen.id}`, { method: 'POST' }), {
        params: Promise.resolve({ id: String(gen.id) }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).not.toBe(gen.id);

      const fresh = db.select().from(tables.generations).where(eq(tables.generations.id, json.id)).all()[0];
      expect(fresh).toBeDefined();
      expect(fresh.model).toBe(gen.model);
    });

    it('POST retry on an unknown id -> 400, not a 500', async () => {
      const { POST } = await import('@/app/api/generations/[id]/route');
      const res = await POST(new Request('http://localhost/api/generations/999999', { method: 'POST' }), {
        params: Promise.resolve({ id: '999999' }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/images/[id]', () => {
    it('?thumb=1 -> 200 with image/webp', async () => {
      const { db, tables } = await import('@/db');
      const { GET } = await import('@/app/api/images/[id]/route');
      const { saveImageFile } = await import('@/lib/store');

      const saved = await saveImageFile(await uniquePngBuffer(), 'png', 'imported');
      const [img] = db.insert(tables.images).values({ ...saved, source: 'imported' }).returning().all();

      const res = await GET(new Request(`http://localhost/api/images/${img.id}?thumb=1`), {
        params: Promise.resolve({ id: String(img.id) }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/webp');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(0);
    });

    it('full-size (no thumb) -> 200 with image/png', async () => {
      const { db, tables } = await import('@/db');
      const { GET } = await import('@/app/api/images/[id]/route');
      const { saveImageFile } = await import('@/lib/store');

      const saved = await saveImageFile(await uniquePngBuffer(), 'png', 'imported');
      const [img] = db.insert(tables.images).values({ ...saved, source: 'imported' }).returning().all();

      const res = await GET(new Request(`http://localhost/api/images/${img.id}`), {
        params: Promise.resolve({ id: String(img.id) }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
    });

    it('unknown id -> 404', async () => {
      const { GET } = await import('@/app/api/images/[id]/route');
      const res = await GET(new Request('http://localhost/api/images/999999'), {
        params: Promise.resolve({ id: '999999' }),
      });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/import', () => {
    it('a PNG -> {imageId, deduped:false}; the same bytes again -> {deduped:true} with the SAME imageId', async () => {
      const { POST } = await import('@/app/api/import/route');
      const bytes = await uniquePngBuffer();
      const makeForm = () => {
        const fd = new FormData();
        fd.set('file', new File([new Uint8Array(bytes)], 'x.png', { type: 'image/png' }));
        return fd;
      };

      const res1 = await POST(new Request('http://localhost/api/import', { method: 'POST', body: makeForm() }));
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.deduped).toBe(false);
      expect(typeof json1.imageId).toBe('number');

      const res2 = await POST(new Request('http://localhost/api/import', { method: 'POST', body: makeForm() }));
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.deduped).toBe(true);
      expect(json2.imageId).toBe(json1.imageId);
    });

    it('an unsupported type -> 400', async () => {
      const { POST } = await import('@/app/api/import/route');
      const fd = new FormData();
      fd.set('file', new File([new Uint8Array([1, 2, 3, 4])], 'x.gif', { type: 'image/gif' }));
      const res = await POST(new Request('http://localhost/api/import', { method: 'POST', body: fd }));
      expect(res.status).toBe(400);
    });

    it('missing file field -> 400', async () => {
      const { POST } = await import('@/app/api/import/route');
      const fd = new FormData();
      const res = await POST(new Request('http://localhost/api/import', { method: 'POST', body: fd }));
      expect(res.status).toBe(400);
    });

    it('a real HEIC file sharp cannot decode on this machine -> clean 400, not a 500', async () => {
      const { POST } = await import('@/app/api/import/route');
      const heicBytes = Buffer.from(HEIC_8X8_HEVC_BASE64, 'base64');
      const fd = new FormData();
      fd.set('file', new File([new Uint8Array(heicBytes)], 'x.heic', { type: 'image/heic' }));
      const res = await POST(new Request('http://localhost/api/import', { method: 'POST', body: fd }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(typeof json.error).toBe('string');
    });
  });
});
