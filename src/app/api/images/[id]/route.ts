import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { readImage } from '@/lib/store';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = db.select().from(tables.images).where(eq(tables.images.id, Number(id))).all()[0];
  if (!img) return new Response('not found', { status: 404 });
  const thumb = new URL(req.url).searchParams.get('thumb') === '1';
  const data = readImage(thumb ? img.thumbPath : img.path);
  const type = thumb ? 'image/webp' : `image/${img.format === 'jpg' ? 'jpeg' : img.format}`;
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
