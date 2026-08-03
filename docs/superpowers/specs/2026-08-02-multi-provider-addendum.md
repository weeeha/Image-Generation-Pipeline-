# Addendum: Multi-provider support (Google + OpenAI)

**Date:** 2026-08-02 · **Status:** Approved · Amends `2026-08-02-film-design-system-design.md`

## Why

The pipeline must support OpenAI's GPT Image 2 alongside Google's Gemini image models. The two providers have **opposite reference-image philosophies**, so this is a behavioral difference, not a config value.

| | Gemini (Nano Banana 2 / Pro) | GPT Image 2 |
|---|---|---|
| Reference caps | Hard per-category: Flash 14 = ≤10 object + ≤4 character; Pro 11 = ≤6 object + ≤5 character | 16 max, **single undifferentiated pool** |
| Optimal usage | Fill the categorized slots | **3–5 curated refs beat 16** — references compete for influence |
| Consistency | Dedicated character-consistency slots | No slots; pattern-matches inputs; prompt wording carries more weight |
| Size control | `aspectRatio` string + `imageSize` token (`1K`/`2K`/`4K`) | Explicit pixels: multiples of 16, max edge 3840, 655,360–8,294,400 px, ≤3:1 |
| Quality knob | none | `low`/`medium`/`high`/`auto` (35× price range) |
| Masking | semantic (text) | real alpha-channel masks |
| Output | inline base64 parts | png/jpeg/webp + `output_compression` |

**Unchanged by this addendum:** storage layout, filesystem store, `images`/`refs`/`entities` tables, lineage model, promote flow, history. Both providers consume raw local bytes — the local-first design is already provider-agnostic.

## Decisions

1. **Reference policy is per-model, and strategy-aware.** `split` (Google) fills categorized caps. `pooled` (OpenAI) allocates a **soft `recommended` budget**, not the hard cap — deliberately under-filling because over-filling degrades OpenAI output.
2. **Pooled mode allocates characters before objects** (stable within group). Identity drift is worse than prop drift, and it removes the caller-ordering burden. Split mode already separates by construction, so both modes now behave consistently.
3. **`Pick.slot` keeps the entity-derived `'character' | 'object'` value in both modes** — lineage and UI meters stay accurate even when the pool is shared.
4. **Resolution stays an intent token in the UI** (`1K`/`2K`/`4K`); each provider maps it. Google passes the token through; OpenAI computes concrete pixel dimensions under its constraints.
5. **Adapters are registered per provider.** A model whose adapter is missing (or whose API key is absent) is reported **unavailable** and the UI disables it — rather than being hidden or failing at call time.
6. **OpenAI adapter is deferred** until `OPENAI_API_KEY` exists (it is not currently in the environment). Everything else — registry, policy, size mapping, dispatcher, availability — is built and tested now. No untested adapter is shipped.

## Registry shape (`src/lib/models.ts`)

```ts
export type Provider = 'google' | 'openai';
export type Slot = 'character' | 'object';

export type RefPolicy =
  | { mode: 'split'; caps: { character: number; object: number } }
  | { mode: 'pooled'; cap: number; recommended: number };

export interface ModelInfo {
  id: ModelId;
  provider: Provider;
  label: string;
  refPolicy: RefPolicy;
  resolutions: string[];      // intent tokens
  aspectRatios: string[];
  qualities?: string[];       // OpenAI only
  defaultQuality?: string;
}
```

Models:

| id | provider | policy | resolutions | qualities |
|---|---|---|---|---|
| `gemini-3.1-flash-image-preview` | google | split, `{character:4, object:10}` | 0.5K,1K,2K,4K | — |
| `gemini-3-pro-image-preview` | google | split, `{character:5, object:6}` | 1K,2K,4K | — |
| `gpt-image-2` | openai | pooled, `cap:16, recommended:5` | 1K,2K,4K | low,medium,high,auto (default `auto`) |

Aspect ratios offered: 1:1, 3:2, 2:3, 3:4, 4:3, 16:9, 9:16, 21:9 (all ≤3:1, valid for both).
`0.5K` is Google-only — below OpenAI's 655,360-pixel floor at every offered ratio.

## Output spec mapping (`src/lib/output-spec.ts`, pure)

```ts
resolveOutputSpec(model: ModelId, aspectRatio: string, resolution: string, quality?: string):
  | { provider: 'google'; aspectRatio: string; imageSize: string }
  | { provider: 'openai'; size: string; quality: string }
```

OpenAI computation: target long edge (`1K`→1024, `2K`→2048, `4K`→3840); derive the short edge from the ratio; round both to multiples of 16; clamp any edge to ≤3840; scale up if total pixels < 655,360; scale down if > 8,294,400; re-round after scaling.

**Invariants (property-test across every offered ratio × resolution):** both edges are positive multiples of 16; both ≤3840; total pixels within [655,360, 8,294,400]; realized ratio within 6% of requested.

## selectRefs (`src/lib/select-refs.ts`)

Signature becomes `selectRefs(entities, model, opts?: { budget?: number })`.

- **split mode** — unchanged from M1: per-category cap, even split across entities in that category, remainder to earlier entities, role round-robin within each entity, warn when a character gets fewer than 3.
- **pooled mode** — one shared budget = `opts.budget ?? policy.recommended`, clamped to `[0, policy.cap]`. Entities sorted characters-first (stable), then the same even-split + remainder-to-earlier + role round-robin. Same sub-3-character warning.
- Zero-ref entities are excluded with a warning in both modes.
- Unused allowance is still **not** redistributed when an entity has fewer refs than its share (documented M1 behavior, unchanged).

## Provider layer (`src/lib/providers/`)

```
providers/types.ts   GenerateRequest, GeneratedImage, RefPayload, ImageProvider
providers/google.ts  moved from src/lib/gemini.ts, unchanged behavior
providers/index.ts   PROVIDERS registry, providerFor(model), isModelAvailable(model)
```

`src/lib/gemini.ts` is deleted; its test moves with it. `isModelAvailable` = adapter registered AND the provider's API key env var is set.

## Schema change

`generations` gains two nullable columns: `provider` (text) and `quality` (text). Everything else unchanged. Applied with `drizzle-kit push` (the dev DB has no production data to preserve).

## Impact on the M1 plan

- **New Task R1** (registry + output spec) and **R2** (pooled selection + provider layer + schema) run before Task 8.
- **Task 8** (`generate.ts`) calls `providerFor(model).generate(...)` instead of importing `generateImages` directly, and records `provider`/`quality` on the generation row.
- **Task 13** (Generate screen) shows a provider-grouped model picker, disables unavailable models with the reason, renders a quality select only when `qualities` exists, and shows a cap meter that reads "5 / 16 (5 recommended)" in pooled mode versus separate character/object meters in split mode.
- M1 exit criteria still only require the Gemini path to work end-to-end live.
