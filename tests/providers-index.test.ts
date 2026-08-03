import { describe, it, expect, afterEach } from 'vitest';
import { providerFor, isModelAvailable } from '@/lib/providers';

describe('providerFor', () => {
  it('returns the same google provider instance for both Gemini models', () => {
    const flash = providerFor('gemini-3.1-flash-image-preview');
    const pro = providerFor('gemini-3-pro-image-preview');
    expect(flash.name).toBe('google');
    expect(flash.envVar).toBe('GEMINI_API_KEY');
    expect(pro).toBe(flash);
  });

  it('throws a clear error for gpt-image-2 (no adapter registered yet)', () => {
    expect(() => providerFor('gpt-image-2')).toThrow(/openai/i);
  });
});

describe('isModelAvailable', () => {
  const originalGemini = process.env.GEMINI_API_KEY;
  afterEach(() => {
    if (originalGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalGemini;
  });

  it('Gemini models are available when GEMINI_API_KEY is set', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    expect(isModelAvailable('gemini-3.1-flash-image-preview')).toEqual({ available: true });
  });

  it('Gemini models are unavailable with a reason when GEMINI_API_KEY is unset', () => {
    delete process.env.GEMINI_API_KEY;
    const result = isModelAvailable('gemini-3.1-flash-image-preview');
    expect(result.available).toBe(false);
    expect(result.reason).toContain('GEMINI_API_KEY');
  });

  it('gpt-image-2 is unavailable with a reason (no OpenAI adapter yet)', () => {
    const result = isModelAvailable('gpt-image-2');
    expect(result.available).toBe(false);
    expect(result.reason).toBe('OpenAI adapter not implemented yet');
  });
});
