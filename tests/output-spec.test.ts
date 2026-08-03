import { describe, it, expect } from 'vitest';
import { resolveOutputSpec } from '@/lib/output-spec';
import { MODELS } from '@/lib/models';

const FLASH = 'gemini-3.1-flash-image-preview' as const;
const GPT = 'gpt-image-2' as const;

const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_EDGE = 3840;

describe('resolveOutputSpec — google', () => {
  it('passes aspectRatio and resolution through unchanged as imageSize', () => {
    expect(resolveOutputSpec(FLASH, '16:9', '2K')).toEqual({
      provider: 'google',
      aspectRatio: '16:9',
      imageSize: '2K',
    });
  });

  it('passes through even resolutions/ratios not otherwise validated (dumb passthrough)', () => {
    expect(resolveOutputSpec(FLASH, '1:1', '0.5K')).toEqual({
      provider: 'google',
      aspectRatio: '1:1',
      imageSize: '0.5K',
    });
  });
});

describe('resolveOutputSpec — openai', () => {
  it('1:1 @ 1K resolves to 1024x1024 (satisfies the pixel floor: 1,048,576)', () => {
    const spec = resolveOutputSpec(GPT, '1:1', '1K');
    expect(spec).toEqual({ provider: 'openai', size: '1024x1024', quality: 'auto' });
    if (spec.provider === 'openai') {
      const [w, h] = spec.size.split('x').map(Number);
      expect(w * h).toBeGreaterThanOrEqual(MIN_PIXELS);
    }
  });

  it('defaults quality to "auto" when not supplied', () => {
    const spec = resolveOutputSpec(GPT, '1:1', '1K');
    expect(spec).toMatchObject({ quality: 'auto' });
  });

  it('respects an explicit quality', () => {
    const spec = resolveOutputSpec(GPT, '1:1', '1K', 'high');
    expect(spec).toMatchObject({ quality: 'high' });
  });

  it('throws a clear error on an unknown resolution token', () => {
    expect(() => resolveOutputSpec(GPT, '1:1', '8K')).toThrow();
    expect(() => resolveOutputSpec(GPT, '1:1', '0.5K')).toThrow();
  });

  it('throws a clear error on a malformed aspect ratio', () => {
    expect(() => resolveOutputSpec(GPT, 'square', '1K')).toThrow();
    expect(() => resolveOutputSpec(GPT, '16-9', '1K')).toThrow();
    expect(() => resolveOutputSpec(GPT, '16:0', '1K')).toThrow();
  });

  describe('property: every offered aspect ratio x resolution satisfies all invariants', () => {
    const info = MODELS[GPT];

    for (const aspectRatio of info.aspectRatios) {
      for (const resolution of info.resolutions) {
        it(`${aspectRatio} @ ${resolution}`, () => {
          const spec = resolveOutputSpec(GPT, aspectRatio, resolution);
          if (spec.provider !== 'openai') throw new Error('expected an openai spec');

          const [wStr, hStr] = spec.size.split('x');
          const w = Number(wStr);
          const h = Number(hStr);

          // both edges are positive multiples of 16
          expect(w).toBeGreaterThan(0);
          expect(h).toBeGreaterThan(0);
          expect(w % 16).toBe(0);
          expect(h % 16).toBe(0);

          // both edges <= 3840
          expect(w).toBeLessThanOrEqual(MAX_EDGE);
          expect(h).toBeLessThanOrEqual(MAX_EDGE);

          // total pixels within [655360, 8294400]
          const total = w * h;
          expect(total).toBeGreaterThanOrEqual(MIN_PIXELS);
          expect(total).toBeLessThanOrEqual(MAX_PIXELS);

          // realized ratio within 6% of the requested ratio
          const [rw, rh] = aspectRatio.split(':').map(Number);
          const requested = rw / rh;
          const realized = w / h;
          const relError = Math.abs(realized - requested) / requested;
          expect(relError).toBeLessThanOrEqual(0.06);
        });
      }
    }
  });
});
