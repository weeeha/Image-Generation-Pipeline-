# Film Design System — Design Spec

**Date:** 2026-08-02 · **Status:** Approved (brainstormed + approved in session) · **Owner:** Nick

## 1. Overview

A local-first web app that manages a film's visual world the way a design system manages a product UI, and generates images through Google Gemini with enforced consistency.

The mapping that defines the product:

| Design system concept | This app |
|---|---|
| Tokens | **Style tokens** — named prompt fragments (palette, lighting, lens, film stock, mood, era) applied per shot |
| Components | **Entities** — characters, props, settings, each with a curated reference-image set (the canon) |
| Variants | Out of scope for v1 (schema leaves a seam) |
| Composing a page | **Composing a shot** — entities + tokens + scene prompt → Gemini call within reference caps |
| Publishing a component | **Promoting** a generated/imported image to reference |

Generated images are reused as *inputs* (reference images) for later generations — the core loop is generate → curate → promote → reference → generate.

## 2. Goals / Non-goals

**Goals (v1 = M1 + M2):**
- Entity library with role-labeled, priority-ordered reference sets
- Generation through Gemini with cap-aware reference selection and full lineage
- Style tokens with categories, revisions, defaults, per-shot toggling
- History that can answer "how was this image made" exactly, forever
- Runs on the Mac Studio; reachable over Tailscale from iPad (bind `0.0.0.0`)

**Non-goals (v1):**
- Cloud storage or public URLs (design keeps an additive seam: a sync target can mirror curated assets to Vercel Blob/R2 later; nothing in the core loop depends on URLs)
- Entity variants (costumes/states), scene/shot boards, sequences
- Multi-user, auth, deployment
- Video generation (later consumer of this library, e.g. Seedance reference-to-video)

## 3. Stack

- **Next.js (App Router) + TypeScript**, shadcn/ui + Tailwind, dark theme default
- **SQLite** via Drizzle ORM + better-sqlite3; DB file lives inside the library
- **Gemini** via `@google/genai`, server-side only; `GEMINI_API_KEY` in `.env.local`
- **sharp** for thumbnails; **npm**; Node ≥ 22
- Dev server on `:3000`

### Model registry (code constant, single source of truth for caps)

| Model ID | Name | Object refs | Character refs | Total | Resolutions |
|---|---|---|---|---|---|
| `gemini-3.1-flash-image-preview` | Nano Banana 2 | ≤ 10 | ≤ 4 | 14 | 0.5K/1K/2K/4K |
| `gemini-3-pro-image-preview` | Nano Banana Pro | ≤ 6 | ≤ 5 | 11 | 1K/2K/4K |

Aspect ratios offered in UI: 1:1, 3:2, 2:3, 3:4, 4:3, 16:9, 9:16, 21:9 (registry-driven; both models accept these).

## 4. Storage

Files on disk under `library/` (git-ignored), metadata in SQLite. **Files are written once, organized by origin; canon is expressed only as DB pointers.** Promoting never copies a file.

```
library/
  library.db
  generations/YYYY/MM/<generation-id>/<n>.png       # + <n>.thumb.webp
  imports/<sha256-prefix>/<original-name>.<ext>      # + .thumb.webp
```

- Atomic writes (tmp file + rename). sha256 dedupe on import (re-importing the same file returns the existing image row).
- Thumbnails: webp, 512px long edge, generated on ingest.
- Durability: Time Machine covers the project folder. Cloud mirror is a later, additive feature.
- Paths stored relative to `LIBRARY_ROOT` (env, default `./library`) so the library can move.

## 5. Schema

```
entities            id, slug (unique), name, type ('character'|'prop'|'setting'),
                    description, notes, created_at
style_tokens        id, slug (unique), name,
                    category ('palette'|'lighting'|'lens'|'film_stock'|'mood'|'era'|'custom'),
                    value (prompt fragment), is_default (bool), sort, created_at, updated_at
token_revisions     id, token_id, value, created_at        -- appended on every edit
images              id, path, thumb_path, width, height, format, bytes, sha256 (unique),
                    source ('generated'|'imported'), generation_id (nullable), created_at
refs                id, entity_id, image_id, role, priority, added_at
                    role: 'front'|'three_quarter'|'full_body'|'expression'|'detail'|'environment'
                    unique (entity_id, image_id)
generations         id, prompt_user, prompt_final (assembled, verbatim), model,
                    aspect_ratio, resolution, status ('pending'|'done'|'failed'),
                    error, duration_ms, created_at
generation_inputs   generation_id, image_id, entity_id (nullable — seam for future
                    style-image refs; always set in v1), slot ('character'|'object')
generation_tokens   generation_id, token_id, token_revision_id
```

Entity type → Gemini slot mapping: `character` → character-consistency slots; `prop` and `setting` → object-fidelity slots.

## 6. Reference selection (core rule)

A pure function `selectRefs(entities, model) → { payload, warnings }`:

1. Look up caps from the model registry.
2. Partition entities into character vs object groups by type.
3. Split each category's cap evenly across its entities (remainder to earlier selections); per entity take refs by ascending `priority`, but **spread roles** — round-robin across role groups so one front + one three-quarter + one detail beats three fronts.
4. Emit warnings: any character allocated < 3 refs ("consistency degrades — use Pro or fewer characters per shot"); any entity with zero refs; payload truncation.

The Generate screen renders the exact payload as thumbnail chips with per-category cap meters **before** the call. Users can pin/remove individual refs (manual override wins over the heuristic).

Default role taxonomy and the spread heuristic are Nick's to tune (art-direction call); ship the defaults above, revise from real use.

## 7. Prompt assembly

Fixed order, stored verbatim in `generations.prompt_final`:

```
[token values, grouped by category in fixed category order]
[per-entity relationship line, e.g. "Character reference: Mara — keep face, hair and
 costume exactly as shown in the reference images."]
[scene description (user prompt)]
[output spec: aspect ratio / resolution intent]
```

Editable preview before send (escape hatch); edits affect only that generation, `prompt_final` records what was actually sent. Exact wording reuse is what makes tokens behave like tokens.

## 8. Screens (sidebar nav, 4 items)

1. **Library** — entity grid filtered by type; entity detail: role-labeled canon refs (reorder priority, change role, demote), the entity's generation history, drag-drop import (imported sketches/photos become refs like anything else).
2. **Generate** — entity chips, token toggles grouped by category (defaults pre-toggled), scene prompt, model/aspect/resolution selects, payload preview with cap meters, results panel: promote-to-ref (choose entity + role), regenerate, download, delete.
3. **Tokens** — grouped by category; inline edit (writes a revision), revision history view, toggle `is_default`, create/archive.
4. **History** — all generations, filter by entity/token/model/status; detail view shows exact refs + exact prompt + token revisions; "reuse as starting point" pre-fills Generate.

## 9. Server surface

- Mutations via server actions (entity/token/ref CRUD, promote/demote).
- `POST /api/generate` — validates, creates `pending` generation, enqueues; **serial in-process queue** (one Gemini call at a time). Client polls `GET /api/generations/[id]`. SSE only if polling itches.
- `GET /api/images/[id]?thumb=1` — streams bytes from disk with long-lived cache headers.

## 10. Error handling

- Gemini errors and safety blocks → `status='failed'` + human-readable `error`, visible in History, one-click retry re-sends identical inputs (same refs, same prompt_final).
- No parallel generations (single user, serial queue) — avoids rate-limit handling in v1.
- Import rejects non-image files; oversize (> 50 MB, API limit) rejected with message.
- Server restart with a generation in flight: on boot, stale `pending` rows are marked `failed` ("interrupted — retry"); retry is lossless because all inputs are recorded.

## 11. Testing & verification

- **Unit (highest value):** `selectRefs` (caps, multi-character splits, role spread, warnings) and prompt assembly (snapshots).
- **DB:** promote/demote/import flows against a temp SQLite file.
- **API:** mocked `@google/genai` client; one live-API smoke test behind `SMOKE_GEMINI=1`.
- **Done means verified:** in the running app — generate → promote → compose second shot using that ref → confirm the request payload actually contained the ref images; checked in Chrome and Safari.

## 12. Milestones

- **M1 — the loop:** schema + migrations, library FS module, entity CRUD, import, generate with cap-aware selection (one pre-seeded default style token), history, promote. Exit: a character generated, promoted, and reused as a reference in a second consistent generation.
- **M2 — tokens:** token CRUD UI, categories, revisions, per-shot toggling, `generation_tokens` lineage, defaults.

## 13. Decisions log

- Local-first storage over Vercel Blob / R2 / GCS — the Gemini API consumes inline bytes; no core-loop benefit from URLs; Tailscale covers iPad review; cloud mirror stays an additive seam.
- Refs are DB pointers, not file copies — single source of truth, no sync drift.
- Store assembled prompt + token revision ids per generation — consistency drift is diffable.
- Working title "Film Design System"; package name `image-generation-pipeline` (matches repo).
