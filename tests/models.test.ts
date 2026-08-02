import { describe, it, expect } from 'vitest';
import { MODELS } from '@/lib/models';

describe('model registry', () => {
  it('both Gemini models use split-mode ref policy with the exact caps', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].refPolicy).toEqual({
      mode: 'split',
      caps: { character: 4, object: 10 },
    });
    expect(MODELS['gemini-3-pro-image-preview'].refPolicy).toEqual({
      mode: 'split',
      caps: { character: 5, object: 6 },
    });
  });

  it('gpt-image-2 uses pooled-mode ref policy with cap 16 and recommended 5', () => {
    expect(MODELS['gpt-image-2'].refPolicy).toEqual({ mode: 'pooled', cap: 16, recommended: 5 });
  });

  it('flash offers 0.5K; neither pro nor gpt-image-2 do', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].resolutions).toContain('0.5K');
    expect(MODELS['gemini-3-pro-image-preview'].resolutions).not.toContain('0.5K');
    expect(MODELS['gpt-image-2'].resolutions).not.toContain('0.5K');
  });

  it('gpt-image-2 has qualities with default auto; the Gemini models have none', () => {
    expect(MODELS['gpt-image-2'].qualities).toEqual(['low', 'medium', 'high', 'auto']);
    expect(MODELS['gpt-image-2'].defaultQuality).toBe('auto');
    expect(MODELS['gemini-3.1-flash-image-preview'].qualities).toBeUndefined();
    expect(MODELS['gemini-3-pro-image-preview'].qualities).toBeUndefined();
  });

  it('every model reports the correct provider', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].provider).toBe('google');
    expect(MODELS['gemini-3-pro-image-preview'].provider).toBe('google');
    expect(MODELS['gpt-image-2'].provider).toBe('openai');
  });
});
