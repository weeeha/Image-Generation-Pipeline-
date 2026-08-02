import { NextResponse } from 'next/server';
import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { retryGeneration, enqueue } from '@/lib/generate';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, Number(id))).all()[0];
  if (!gen) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const outputs = db.select().from(tables.images).where(eq(tables.images.generationId, gen.id)).all();
  return NextResponse.json({ ...gen, outputs: outputs.map(o => ({ id: o.id, width: o.width, height: o.height })) });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const freshId = retryGeneration(Number(id));
    enqueue(freshId);
    return NextResponse.json({ id: freshId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'retry failed' }, { status: 400 });
  }
}
