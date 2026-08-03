import { NextResponse } from 'next/server';
import { db, tables } from '@/db';
import { saveImageFile } from '@/lib/store';
import { eq } from 'drizzle-orm';

const OK_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  const ext = OK_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: `unsupported type ${file.type}` }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'file exceeds 50 MB API limit' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  try {
    // sharp/libheif on this machine can parse HEIC/HEIF containers but may lack the
    // (patent-encumbered) HEVC decoder plugin needed to actually decode pixels — verified:
    // it throws here on a real HEIC. Catch broadly so any decode failure (or a stray DB
    // error) becomes a clean 400, never an unhandled 500.
    const saved = await saveImageFile(buf, ext, 'imported');
    const existing = db.select().from(tables.images).where(eq(tables.images.sha256, saved.sha256)).all()[0];
    const img = existing ?? db.insert(tables.images).values({ ...saved, source: 'imported' }).returning().all()[0];
    return NextResponse.json({ imageId: img.id, deduped: Boolean(existing) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed to process image' }, { status: 400 });
  }
}
