export type ModelId = 'gemini-3.1-flash-image-preview' | 'gemini-3-pro-image-preview';
export type Slot = 'character' | 'object';

export interface ModelInfo {
  id: ModelId;
  label: string;
  caps: Record<Slot, number>;
  resolutions: string[];
  aspectRatios: string[];
}

const ASPECTS = ['1:1', '3:2', '2:3', '3:4', '4:3', '16:9', '9:16', '21:9'];

export const MODELS: Record<ModelId, ModelInfo> = {
  'gemini-3.1-flash-image-preview': {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Nano Banana 2 (Flash) — iterations',
    caps: { object: 10, character: 4 },
    resolutions: ['0.5K', '1K', '2K', '4K'],
    aspectRatios: ASPECTS,
  },
  'gemini-3-pro-image-preview': {
    id: 'gemini-3-pro-image-preview',
    label: 'Nano Banana Pro — hero frames',
    caps: { object: 6, character: 5 },
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ASPECTS,
  },
};
export const DEFAULT_MODEL: ModelId = 'gemini-3.1-flash-image-preview';
