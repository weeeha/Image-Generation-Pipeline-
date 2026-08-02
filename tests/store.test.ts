import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

process.env.LIBRARY_ROOT = `/tmp/fds-store-${process.pid}`;

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('store', () => {
  it('saves a generated image with thumb, atomic paths, correct meta', async () => {
    const { saveImageFile } = await import('@/lib/store');
    const saved = await saveImageFile(PNG_1x1, 'png', 'generated', 42);
    expect(saved.path).toMatch(/^generations\/\d{4}\/\d{2}\/42\/1\.png$/);
    expect(saved.thumbPath).toBe(saved.path.replace(/\.png$/, '.thumb.webp'));
    expect(saved.width).toBe(1);
    expect(saved.sha256).toHaveLength(64);
    const abs = path.join(process.env.LIBRARY_ROOT!, saved.path);
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.existsSync(path.join(process.env.LIBRARY_ROOT!, saved.thumbPath))).toBe(true);
  });
  it('saves imports under sha prefix and is idempotent on content', async () => {
    const { saveImageFile } = await import('@/lib/store');
    const a = await saveImageFile(PNG_1x1, 'png', 'imported');
    const b = await saveImageFile(PNG_1x1, 'png', 'imported');
    expect(a.sha256).toBe(b.sha256);
    expect(a.path).toMatch(/^imports\//);
  });
});
