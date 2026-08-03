import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { LIBRARY_ROOT } from '@/db';

export interface SavedFile {
  path: string; thumbPath: string; width: number; height: number;
  format: string; bytes: number; sha256: string;
}

function writeAtomic(absPath: string, data: Buffer) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, absPath);
}

export async function saveImageFile(
  data: Buffer, format: string, source: 'generated' | 'imported', generationId?: number, seq = 1
): Promise<SavedFile> {
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const meta = await sharp(data).metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;

  let rel: string;
  if (source === 'generated') {
    const d = new Date();
    const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0');
    rel = `generations/${yyyy}/${mm}/${generationId}/${seq}.${format}`;
  } else {
    rel = `imports/${sha256.slice(0, 2)}/${sha256}.${format}`;
  }
  const abs = path.join(LIBRARY_ROOT, rel);
  if (!fs.existsSync(abs)) writeAtomic(abs, data);

  const thumbRel = rel.replace(new RegExp(`\\.${format}$`), '.thumb.webp');
  const thumbAbs = path.join(LIBRARY_ROOT, thumbRel);
  if (!fs.existsSync(thumbAbs)) {
    const thumb = await sharp(data).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    writeAtomic(thumbAbs, thumb);
  }
  return { path: rel, thumbPath: thumbRel, width, height, format, bytes: data.length, sha256 };
}

export function readImage(relPath: string): Buffer {
  return fs.readFileSync(path.join(LIBRARY_ROOT, relPath));
}
