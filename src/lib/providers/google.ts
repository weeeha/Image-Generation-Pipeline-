import { GoogleGenAI } from '@google/genai';
import { resolveOutputSpec } from '@/lib/output-spec';
import type { ImageProvider, GenerateRequest, GeneratedImage } from './types';

const g = globalThis as unknown as { __fdsAi?: GoogleGenAI };
function client() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (.env.local)');
  return (g.__fdsAi ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

async function generate(req: GenerateRequest): Promise<GeneratedImage[]> {
  const spec = resolveOutputSpec(req.model, req.aspectRatio, req.resolution, req.quality);
  if (spec.provider !== 'google') {
    throw new Error(`googleProvider.generate got a non-google output spec for model "${req.model}"`);
  }

  const parts = [
    ...req.refs.map(r => ({ inlineData: { mimeType: r.mimeType, data: r.data.toString('base64') } })),
    { text: req.prompt },
  ];
  const res = await client().models.generateContent({
    model: req.model,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: spec.aspectRatio, imageSize: spec.imageSize },
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

export const googleProvider: ImageProvider = {
  name: 'google',
  envVar: 'GEMINI_API_KEY',
  generate,
};
