import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createGeneration, enqueue } from '@/lib/generate';
import { MODELS } from '@/lib/models';

const bodyIn = z.object({
  entityIds: z.array(z.number().int().positive()).min(0).max(12),
  scene: z.string().min(1).max(4000),
  model: z.enum(['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gpt-image-2']),
  aspectRatio: z.string(),
  resolution: z.string(),
  quality: z.string().optional(),
  budget: z.number().int().min(1).max(16).optional(),
  promptOverride: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const parsed = bodyIn.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const m = MODELS[parsed.data.model];
  if (!m.aspectRatios.includes(parsed.data.aspectRatio) || !m.resolutions.includes(parsed.data.resolution))
    return NextResponse.json({ error: 'aspect/resolution not supported by model' }, { status: 400 });
  if (parsed.data.quality && !(m.qualities ?? []).includes(parsed.data.quality))
    return NextResponse.json({ error: 'quality not supported by model' }, { status: 400 });
  try {
    const id = createGeneration(parsed.data);
    enqueue(id);
    return NextResponse.json({ id });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed to create generation' }, { status: 400 });
  }
}
