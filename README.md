# Film Design System

A local-first app that manages a film's visual world the way a design system manages a product UI, and generates imagery against it.

**Entities** — characters, props, settings — each own a curated set of **reference images** (the "canon"), labelled by role and ordered by priority. You compose a shot by picking entities and describing the scene; the app allocates their references within the image model's caps, assembles an exact prompt, calls the provider, and records complete lineage. Good outputs get **promoted** back into the reference set, so a character looks like the same character across hundreds of generations.

The loop: **generate → curate → promote → reference → generate.**

## Quickstart

```bash
npm i
cp .env.local.example .env.local     # then add your GEMINI_API_KEY
mkdir -p library && npm run db:push -- --force && npm run seed
npm run dev
```

`mkdir -p library` matters: `drizzle-kit push` does not create the parent directory and **exits 0 anyway**, so without it the push silently no-ops and every query fails with "no such table" later.

Open http://localhost:3000.

### From the iPad

The dev server binds all interfaces by default, so it's already on the tailnet — no extra flag needed:

```
http://100.75.213.56:3000
```

(That's the Mac Studio's Tailscale address. Both devices need Tailscale up.)

## How the loop works

1. **Library** — create an entity, then import reference images (drag and drop). Each ref gets a **role** (front, three-quarter, full body, expression, detail, environment) and a **priority** (lower = preferred).
2. **Generate** — select entities, write the scene. The **payload preview** shows exactly which references will be sent and how they fill the model's slots, *before* you spend a generation. Warnings appear when a character is squeezed below 3 references, which is where consistency starts degrading.
3. **Promote** — a result you like becomes a reference on an entity, with a role. It's a pointer, not a copy.
4. **History** — every generation keeps its exact final prompt, the references actually sent, the model, and the style-token revision in force. When a character drifts, diff two generations instead of guessing.

## Providers

The two providers have **opposite reference philosophies**, and the app encodes that difference rather than averaging it away.

| | Google Gemini | OpenAI GPT Image 2 |
|---|---|---|
| Caps | Hard per-category — Flash: ≤10 object + ≤4 character; Pro: ≤6 object + ≤5 character | 16, one shared pool |
| Optimal use | **Fill** the slots | **Under-fill** — 3–5 curated refs beat 16; references compete for influence |
| Sizing | aspect ratio + `1K`/`2K`/`4K` token | Explicit pixels (multiples of 16, ≤3840/edge, 655k–8.29M px) |
| Quality | — | `low`/`medium`/`high`/`auto` (35× price range) |

So `selectRefs` is strategy-aware: split mode fills caps, pooled mode allocates a soft recommended budget (5, raisable to 16) and puts characters first.

**Google works and is verified live.** `gpt-image-2` is registered but shows as **unavailable** in the model picker — it needs `OPENAI_API_KEY` plus an adapter in `src/lib/providers/openai.ts` implementing the existing `ImageProvider` interface. That's the only missing piece; the registry, pooled allocation, and pixel-size mapping are already built and tested.

## Where things live

```
library/            images + library.db  (git-ignored — this is your actual film archive)
src/lib/            core: models, select-refs, prompt, output-spec, store, generate, providers/
src/db/             drizzle schema + client
src/app/            screens, server actions, API routes
docs/superpowers/   design spec, multi-provider addendum, implementation plan
```

Images are written to disk **once**. References are DB rows pointing at them — promoting never copies a file, so there's no sync drift.

## Testing

```bash
npm test
```

83 tests, all offline. The live check costs one real generation and is opt-in:

```bash
SMOKE_GEMINI=1 npx vitest run tests/smoke-gemini.test.ts
```

## Known limitations

- **HEIC/HEIF images can't be imported.** sharp here has no HEVC decoder, and iPhone photos are HEIC by default — export as JPEG first. The dropzone rejects them upfront rather than failing deep.
- **Style tokens are M2.** One seeded default token applies to every generation; the Tokens screen is a stub.
- **Safari:** prompt textareas don't auto-grow (`field-sizing` is unsupported there). Cosmetic — they stay usable at their minimum height and scroll.
- **Single user.** Generations run through one in-process serial queue; there's no auth, no multi-writer safety, and no cloud sync. A server restart marks any in-flight generation `failed` with "interrupted — retry".
