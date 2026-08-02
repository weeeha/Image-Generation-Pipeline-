import { GoogleGenAI } from '@google/genai';
import type { ModelId } from '@/lib/models';

export interface RefPayload { data: Buffer; mimeType: string; }
export interface GeneratedImage { data: Buffer; mimeType: string; }

const g = globalThis as unknown as { __fdsAi?: GoogleGenAI };
function client() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (.env.local)');
  return (g.__fdsAi ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

export async function generateImages(input: {
  model: ModelId; prompt: string; refs: RefPayload[];
  aspectRatio: string; resolution: string;
}): Promise<GeneratedImage[]> {
  const parts = [
    ...input.refs.map(r => ({ inlineData: { mimeType: r.mimeType, data: r.data.toString('base64') } })),
    { text: input.prompt },
  ];
  const res = await client().models.generateContent({
    model: input.model,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.resolution },
    },
  });
  const out: GeneratedImage[] = [];
  for (const p of res.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) out.push({ data: Buffer.from(p.inlineData.data, 'base64'), mimeType: p.inlineData.mimeType ?? 'image/png' });
  }
  if (out.length === 0) {
    const text = res.candidates?.[0]?.content?.parts?.find(p => 'text' in p && p.text)?.text;
    throw new Error(text ? `Model returned no image: ${text.slice(0, 300)}` : 'Model returned no image (possibly safety-blocked).');
  }
  return out;
}
