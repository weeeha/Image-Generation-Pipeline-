import type { ModelId, Provider } from '@/lib/models';

export interface RefPayload { data: Buffer; mimeType: string; }
export interface GeneratedImage { data: Buffer; mimeType: string; }
export interface GenerateRequest {
  model: ModelId; prompt: string; refs: RefPayload[];
  aspectRatio: string; resolution: string; quality?: string;
}
export interface ImageProvider {
  readonly name: Provider;
  readonly envVar: string;              // e.g. 'GEMINI_API_KEY'
  generate(req: GenerateRequest): Promise<GeneratedImage[]>;
}
