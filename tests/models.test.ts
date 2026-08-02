import { describe, it, expect } from 'vitest';
import { MODELS, type ModelId } from '@/lib/models';

describe('model registry', () => {
  it('has both models with spec caps', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].caps).toEqual({ object: 10, character: 4 });
    expect(MODELS['gemini-3-pro-image-preview'].caps).toEqual({ object: 6, character: 5 });
  });
  it('flash offers 0.5K, pro does not', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].resolutions).toContain('0.5K');
    expect(MODELS['gemini-3-pro-image-preview'].resolutions).not.toContain('0.5K');
  });
});
