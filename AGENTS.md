<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Film Design System (`film-design-system`)

Local-first app that manages a film's visual world like a design system and generates
imagery against it. Entities (characters, props, settings) own curated **reference images**;
you compose a shot, the app allocates references within the model's caps, calls the
provider, and records complete lineage. Good outputs get **promoted** back into the
reference set — that's what keeps a character consistent across hundreds of generations.

Read [README.md](./README.md) for the full loop; it's accurate and current.

## Commands

```bash
npm run dev
npm run build
npm run lint          # eslint
npm test              # vitest run — 83 tests, all offline
npm run db:push       # drizzle-kit push
npm run seed          # tsx scripts/seed.ts
```

The live check **costs one real generation** and is opt-in:

```bash
SMOKE_GEMINI=1 npx vitest run tests/smoke-gemini.test.ts
```

**Never run the smoke test without Nick's explicit go.** Everything else is free and offline.

`.claude/launch.json` is configured — prefer `preview_start` for the dev server. The app is
reachable from other devices on the tailnet at `http://100.75.213.56:3000` (Mac Studio).

## Architecture

```
library/          images + library.db — THE ACTUAL FILM ARCHIVE, git-ignored
src/lib/          models, select-refs, prompt, output-spec, store, generate, providers/
src/db/           drizzle schema + client
src/app/          screens, server actions, API routes
docs/superpowers/ design spec, multi-provider addendum, implementation plan
```

- **Images are written to disk exactly once.** References are DB rows pointing at them, so
  promoting a result never copies a file and there is no sync drift. Don't "fix" promotion
  by copying.
- **`selectRefs` is strategy-aware and must stay that way.** The two providers have opposite
  reference philosophies and the app encodes the difference rather than averaging it:
  Gemini has hard per-category caps and you **fill** them; OpenAI has one shared pool of 16
  and you **under-fill** (3–5 curated refs beat 16, because references compete for
  influence). A "unified" allocation strategy would silently degrade both.
- Every generation records its exact final prompt, the references actually sent, the model,
  and the style-token revision in force. Preserve that — it's how drift gets diagnosed.

## Gotchas

- **`gpt-image-2` is registered but shows as unavailable.** It needs `OPENAI_API_KEY` plus an
  adapter at `src/lib/providers/openai.ts` implementing the existing `ImageProvider`
  interface. The registry, pooled allocation, and pixel-size mapping are already built and
  tested — that adapter is the only missing piece. Google Gemini works and is verified live.
- **HEIC/HEIF images cannot be imported.** `sharp` here has no HEVC decoder and iPhone photos
  are HEIC by default. The dropzone rejects them upfront on purpose — don't "fix" it by
  accepting the file and failing deep. Export as JPEG first.
- Warnings appear when a character is squeezed below 3 references; that's where consistency
  degrades. Treat it as a real signal, not noise.
- **The local directory name has a trailing space** — `~/ClaudeCode Projects/Image Generation Pipeline `.
  Quote paths. The package is `film-design-system` and the remote is
  `Image-Generation-Pipeline-`; all three names differ.
- Never push to `main` — branch per task, PR.
