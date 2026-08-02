import { describe, it, expect, vi } from 'vitest';

process.env.GEMINI_API_KEY = 'test-key';

const generateContent = vi.fn().mockResolvedValue({
  candidates: [{ content: { parts: [
    { text: 'here you go' },
    { inlineData: { mimeType: 'image/png', data: Buffer.from('fakepng').toString('base64') } },
  ] } }],
});
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent }; constructor(_: unknown) {} },
}));

describe('generateImages', () => {
  it('passes refs as inlineData parts before the prompt and extracts image buffers', async () => {
    const { generateImages } = await import('@/lib/gemini');
    const out = await generateImages({
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'a lantern',
      refs: [{ data: Buffer.from('img1'), mimeType: 'image/png' }],
      aspectRatio: '16:9', resolution: '1K',
    });
    expect(out).toHaveLength(1);
    expect(out[0].data.toString()).toBe('fakepng');
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-flash-image-preview');
    const parts = call.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('image/png');
    expect(parts.at(-1).text).toBe('a lantern');
    expect(call.config.responseModalities).toEqual(['TEXT', 'IMAGE']);
  });
});
