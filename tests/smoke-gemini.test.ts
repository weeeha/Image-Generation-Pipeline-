import { describe, it, expect } from 'vitest';

// Opt-in live smoke test — hits the real Gemini API and costs one real Flash generation.
// Skipped by default; run explicitly with:
//   SMOKE_GEMINI=1 npx vitest run tests/smoke-gemini.test.ts
// Requires GEMINI_API_KEY in .env.local (vitest doesn't load .env files itself, so export
// it in the shell or otherwise get it into process.env before running).
describe.skipIf(process.env.SMOKE_GEMINI !== '1')('gemini live smoke', () => {
  it('generates one image from a text-only prompt', async () => {
    // The provider is an ImageProvider object (googleProvider.generate(...)), not a
    // standalone generateImages export — see src/lib/providers/google.ts.
    const { googleProvider } = await import('@/lib/providers/google');
    const out = await googleProvider.generate({
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'A brass lantern on a wooden table, cinematic still.',
      refs: [],
      aspectRatio: '1:1',
      resolution: '1K',
    });
    expect(out[0].data.length).toBeGreaterThan(10_000);
  }, 120_000);
});
