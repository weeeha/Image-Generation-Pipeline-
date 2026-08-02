// Pure mapper from a model's (aspectRatio, resolution, quality) inputs to the concrete
// output spec each provider's API expects. No fs/node/env/db imports — this gets
// imported into a browser bundle.
import { MODELS, type ModelId } from './models';

export type OutputSpec =
  | { provider: 'google'; aspectRatio: string; imageSize: string }
  | { provider: 'openai'; size: string; quality: string };

// OpenAI's real constraints (from their docs): every edge a multiple of 16, max edge
// 3840, total pixels in [655360, 8294400], aspect ratio no more extreme than 3:1.
const OPENAI_RESOLUTION_LONG_EDGE: Record<string, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 3840,
};
const MIN_EDGE = 16;
const MAX_EDGE = 3840;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;

function parseAspectRatio(aspectRatio: string): { w: number; h: number } {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspectRatio.trim());
  if (!match) {
    throw new Error(`Cannot parse aspect ratio "${aspectRatio}" — expected "w:h" (e.g. "16:9")`);
  }
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!(w > 0) || !(h > 0)) {
    throw new Error(`Cannot parse aspect ratio "${aspectRatio}" — both sides must be positive`);
  }
  return { w, h };
}

const roundNearest16 = (n: number) => Math.max(MIN_EDGE, Math.round(n / 16) * 16);
const ceilTo16 = (n: number) => Math.max(MIN_EDGE, Math.ceil(n / 16) * 16);
const floorTo16 = (n: number) => Math.max(MIN_EDGE, Math.floor(n / 16) * 16);

function computeOpenAiSize(aspectRatio: string, resolution: string): string {
  const targetLongEdge = OPENAI_RESOLUTION_LONG_EDGE[resolution];
  if (targetLongEdge === undefined) {
    throw new Error(
      `Unknown resolution token "${resolution}" for gpt-image-2 — expected one of ${Object.keys(OPENAI_RESOLUTION_LONG_EDGE).join(', ')}`
    );
  }
  const { w: ratioW, h: ratioH } = parseAspectRatio(aspectRatio);

  // Steps 2-3: assign the target long edge to whichever side the ratio makes longer,
  // and derive the short edge from the ratio.
  let w: number;
  let h: number;
  if (ratioW >= ratioH) {
    w = targetLongEdge;
    h = targetLongEdge * (ratioH / ratioW);
  } else {
    h = targetLongEdge;
    w = targetLongEdge * (ratioW / ratioH);
  }

  // Step 4: round both edges to the nearest multiple of 16 (minimum 16).
  w = roundNearest16(w);
  h = roundNearest16(h);

  // Step 5: clamp any edge above the max, re-deriving the other edge from the ratio.
  if (w > MAX_EDGE) {
    w = MAX_EDGE;
    h = roundNearest16(w * (ratioH / ratioW));
  }
  if (h > MAX_EDGE) {
    h = MAX_EDGE;
    w = roundNearest16(h * (ratioW / ratioH));
  }

  // Step 6: under the pixel floor — scale both edges up until they satisfy it.
  // Rounding UP (never down) here means the post-round total can only be >= the
  // exact scaled target, so the floor invariant holds without needing to iterate.
  let total = w * h;
  if (total < MIN_PIXELS) {
    const scale = Math.sqrt(MIN_PIXELS / total);
    w = ceilTo16(w * scale);
    h = ceilTo16(h * scale);
  }

  // Step 7: over the pixel ceiling — scale both edges down until they satisfy it.
  // Rounding DOWN (never up) here means the post-round total can only be <= the
  // exact scaled target, so the ceiling invariant holds without needing to iterate.
  total = w * h;
  if (total > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / total);
    w = floorTo16(w * scale);
    h = floorTo16(h * scale);
  }

  return `${w}x${h}`;
}

export function resolveOutputSpec(
  model: ModelId,
  aspectRatio: string,
  resolution: string,
  quality?: string
): OutputSpec {
  const info = MODELS[model];

  if (info.provider === 'google') {
    return { provider: 'google', aspectRatio, imageSize: resolution };
  }

  const size = computeOpenAiSize(aspectRatio, resolution);
  return { provider: 'openai', size, quality: quality ?? info.defaultQuality ?? 'auto' };
}
