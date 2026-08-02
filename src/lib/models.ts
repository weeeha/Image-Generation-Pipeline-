export type Provider = 'google' | 'openai';
export type Slot = 'character' | 'object';
export type ModelId = 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview' | 'gpt-image-2';

// Google Gemini enforces hard per-category caps: you fill discrete character/object
// slots. OpenAI GPT Image 2 accepts one undifferentiated pool of up to `cap` refs, but
// `recommended` is deliberately lower — extra refs compete for influence and hurt output.
export type RefPolicy =
  | { mode: 'split'; caps: { character: number; object: number } }
  | { mode: 'pooled'; cap: number; recommended: number };

export interface ModelInfo {
  id: ModelId;
  provider: Provider;
  label: string;
  refPolicy: RefPolicy;
  resolutions: string[];
  aspectRatios: string[];
  qualities?: string[];
  defaultQuality?: string;
}

const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16', '21:9'];

export const MODELS: Record<ModelId, ModelInfo> = {
  'gemini-3.1-flash-image-preview': {
    id: 'gemini-3.1-flash-image-preview',
    provider: 'google',
    label: 'Nano Banana 2 (Flash) — iterations',
    refPolicy: { mode: 'split', caps: { character: 4, object: 10 } },
    resolutions: ['0.5K', '1K', '2K', '4K'],
    aspectRatios: ASPECTS,
  },
  'gemini-3-pro-image-preview': {
    id: 'gemini-3-pro-image-preview',
    provider: 'google',
    label: 'Nano Banana Pro — hero frames',
    refPolicy: { mode: 'split', caps: { character: 5, object: 6 } },
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ASPECTS,
  },
  // 0.5K is deliberately absent: it falls below OpenAI's 655,360px floor at every
  // ratio we offer, so it's never a valid choice for this model.
  'gpt-image-2': {
    id: 'gpt-image-2',
    provider: 'openai',
    label: 'GPT Image 2 — OpenAI',
    refPolicy: { mode: 'pooled', cap: 16, recommended: 5 },
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ASPECTS,
    qualities: ['low', 'medium', 'high', 'auto'],
    defaultQuality: 'auto',
  },
};

export const DEFAULT_MODEL: ModelId = 'gemini-3.1-flash-image-preview';
