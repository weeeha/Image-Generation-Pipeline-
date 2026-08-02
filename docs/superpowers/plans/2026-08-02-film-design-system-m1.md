# Film Design System — M1 (The Loop) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Next.js app where Nick creates entities (characters/props/settings), imports or generates images via Gemini with cap-aware reference selection, promotes winners to canon references, and reuses them for consistent generations — with full lineage.

**Architecture:** Local-first: files under `library/` written once, SQLite (Drizzle + better-sqlite3) as single source of truth, canon = DB pointers. Pure-function core (`selectRefs`, `assemblePrompt`) with heavy unit tests; thin server actions/routes; serial in-process generation queue calling `@google/genai` server-side.

**Tech Stack:** Next.js App Router + TypeScript, shadcn/ui + Tailwind (dark), Drizzle ORM + better-sqlite3, @google/genai, sharp, zod, vitest, npm, Node ≥ 22.

**Spec:** `docs/superpowers/specs/2026-08-02-film-design-system-design.md` (M2 tokens UI is a separate follow-up plan.)

---

## File structure (locked)

```
src/
  db/schema.ts            # Drizzle tables (all tables incl. style_tokens — M1 seeds one default)
  db/index.ts             # singleton better-sqlite3 + drizzle client
  lib/models.ts           # model registry: caps, resolutions, aspect ratios
  lib/store.ts            # library filesystem: atomic writes, sha256, thumbs, save/load
  lib/select-refs.ts      # PURE: cap-aware reference selection + warnings
  lib/prompt.ts           # PURE: prompt assembly
  lib/gemini.ts           # @google/genai wrapper: parts in, image buffers out
  lib/generate.ts         # generation service + serial queue + stale-pending sweep
  lib/queries.ts          # shared read queries (entities with refs, generations with detail)
  app/layout.tsx          # dark shell + sidebar nav
  app/(screens)/library/page.tsx
  app/(screens)/library/[slug]/page.tsx
  app/(screens)/generate/page.tsx
  app/(screens)/history/page.tsx
  app/(screens)/tokens/page.tsx        # M1: stub ("coming in M2")
  app/actions.ts          # server actions: entity CRUD, promote/demote, reorder
  app/api/generate/route.ts
  app/api/generations/[id]/route.ts
  app/api/images/[id]/route.ts
  app/api/import/route.ts
  components/*.tsx        # client components per screen (listed in UI tasks)
scripts/seed.ts           # default style token
instrumentation.ts        # boot: sweep stale pending generations
tests/                    # vitest specs mirroring src/lib + src/db
```

---

### Task 1: Scaffold

**Files:** Create: Next app in repo root (non-empty dir — scaffold in temp, merge), `vitest.config.ts`, `drizzle.config.ts`, `.env.local.example`; Modify: `.gitignore`, `package.json`, `next.config.ts`.

- [ ] **Step 1: Scaffold Next.js into the existing repo**

```bash
cd "/Users/nickv/ClaudeCode Projects/Image Generation Pipeline "
npx create-next-app@latest fds-tmp --ts --tailwind --eslint --app --src-dir --use-npm --no-import-alias --turbopack --yes
rsync -a fds-tmp/ ./ --exclude README.md && rm -rf fds-tmp
```

- [ ] **Step 2: Install deps**

```bash
npm i drizzle-orm better-sqlite3 @google/genai sharp zod
npm i -D drizzle-kit vitest @types/better-sqlite3 tsx
npx shadcn@latest init -d
npx shadcn@latest add button card dialog input select badge textarea label sonner
```

- [ ] **Step 3: Config files**

`next.config.ts`:
```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3', 'sharp'],
};
export default nextConfig;
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
});
```

`drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: { url: process.env.LIBRARY_ROOT ? `${process.env.LIBRARY_ROOT}/library.db` : './library/library.db' },
});
```

`.env.local.example`:
```
GEMINI_API_KEY=
# LIBRARY_ROOT=./library
```

Append to `.gitignore`:
```
library/
```

Add to `package.json` scripts: `"test": "vitest run", "db:push": "drizzle-kit push", "seed": "tsx scripts/seed.ts"`.

- [ ] **Step 4: Verify**

Run: `cp .env.local.example .env.local && npm run dev` → http://localhost:3000 renders. `npm test` → "no test files found" exit 0 (or 1 — fine, no tests yet). Stop server.

If `GEMINI_API_KEY` is already exported in the shell, populate without printing it: `python3 -c "import os;open('.env.local','a').write(f\"GEMINI_API_KEY={os.environ.get('GEMINI_API_KEY','')}\n\")"`

- [ ] **Step 5: Commit** — `git add -A && git commit -m "chore: scaffold Next.js app with drizzle/vitest/shadcn"`

---

### Task 2: Model registry

**Files:** Create: `src/lib/models.ts`, `tests/models.test.ts`.

- [ ] **Step 1: Write failing test**

```ts
// tests/models.test.ts
import { describe, it, expect } from 'vitest';
import { MODELS, type ModelId } from '@/lib/models';

describe('model registry', () => {
  it('has both models with spec caps', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].caps).toEqual({ object: 10, character: 4 });
    expect(MODELS['gemini-3-pro-image-preview'].caps).toEqual({ object: 6, character: 5 });
  });
  it('flash offers 0.5K, pro does not', () => {
    expect(MODELS['gemini-3.1-flash-image-preview'].resolutions).toContain('0.5K');
    expect(MODELS['gemini-3-pro-image-preview'].resolutions).not.toContain('0.5K');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/models.test.ts` → FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
// src/lib/models.ts
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
```

- [ ] **Step 4: Run** same command → PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: model registry with reference caps"`

---

### Task 3: Schema + DB client + seed

**Files:** Create: `src/db/schema.ts`, `src/db/index.ts`, `scripts/seed.ts`, `tests/db.test.ts`.

- [ ] **Step 1: Schema**

```ts
// src/db/schema.ts
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const now = () => sql`(unixepoch())`;

export const entities = sqliteTable('entities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  type: text('type', { enum: ['character', 'prop', 'setting'] }).notNull(),
  description: text('description').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdAt: integer('created_at').notNull().default(now()),
});

export const styleTokens = sqliteTable('style_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  category: text('category', { enum: ['palette', 'lighting', 'lens', 'film_stock', 'mood', 'era', 'custom'] }).notNull(),
  value: text('value').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  sort: integer('sort').notNull().default(0),
  createdAt: integer('created_at').notNull().default(now()),
  updatedAt: integer('updated_at').notNull().default(now()),
});

export const tokenRevisions = sqliteTable('token_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenId: integer('token_id').notNull().references(() => styleTokens.id),
  value: text('value').notNull(),
  createdAt: integer('created_at').notNull().default(now()),
});

export const images = sqliteTable('images', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  path: text('path').notNull(),
  thumbPath: text('thumb_path').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  format: text('format').notNull(),
  bytes: integer('bytes').notNull(),
  sha256: text('sha256').notNull().unique(),
  source: text('source', { enum: ['generated', 'imported'] }).notNull(),
  generationId: integer('generation_id'),
  createdAt: integer('created_at').notNull().default(now()),
});

export const refs = sqliteTable('refs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entityId: integer('entity_id').notNull().references(() => entities.id),
  imageId: integer('image_id').notNull().references(() => images.id),
  role: text('role', { enum: ['front', 'three_quarter', 'full_body', 'expression', 'detail', 'environment'] }).notNull(),
  priority: integer('priority').notNull().default(100),
  addedAt: integer('added_at').notNull().default(now()),
}, (t) => [uniqueIndex('refs_entity_image').on(t.entityId, t.imageId)]);

export const generations = sqliteTable('generations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  promptUser: text('prompt_user').notNull(),
  promptFinal: text('prompt_final').notNull(),
  model: text('model').notNull(),
  aspectRatio: text('aspect_ratio').notNull(),
  resolution: text('resolution').notNull(),
  status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull().default('pending'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at').notNull().default(now()),
});

export const generationInputs = sqliteTable('generation_inputs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationId: integer('generation_id').notNull().references(() => generations.id),
  imageId: integer('image_id').notNull().references(() => images.id),
  entityId: integer('entity_id'), // nullable seam for future style-image refs; always set in M1
  slot: text('slot', { enum: ['character', 'object'] }).notNull(),
});

export const generationTokens = sqliteTable('generation_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  generationId: integer('generation_id').notNull().references(() => generations.id),
  tokenId: integer('token_id').notNull().references(() => styleTokens.id),
  tokenRevisionId: integer('token_revision_id').notNull().references(() => tokenRevisions.id),
});
```

- [ ] **Step 2: DB client (HMR-safe singleton, library dir auto-created)**

```ts
// src/db/index.ts
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import fs from 'node:fs';
import path from 'node:path';

export const LIBRARY_ROOT = path.resolve(process.env.LIBRARY_ROOT ?? './library');

function create() {
  fs.mkdirSync(LIBRARY_ROOT, { recursive: true });
  const sqlite = new Database(path.join(LIBRARY_ROOT, 'library.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return drizzle(sqlite, { schema });
}

const g = globalThis as unknown as { __fdsDb?: ReturnType<typeof create> };
export const db = (g.__fdsDb ??= create());
export * as tables from './schema';
```

- [ ] **Step 3: Seed script**

```ts
// scripts/seed.ts
import { db, tables } from '../src/db';

const existing = db.select().from(tables.styleTokens).all();
if (existing.length === 0) {
  const value =
    'Cinematic still, painterly realism, muted warm palette, soft directional key light, shallow depth of field, 35mm film grain.';
  const [tok] = db.insert(tables.styleTokens)
    .values({ slug: 'base-style', name: 'Base style', category: 'custom', value, isDefault: true })
    .returning();
  db.insert(tables.tokenRevisions).values({ tokenId: tok.id, value }).run();
  console.log('Seeded default style token.');
} else {
  console.log('Tokens exist, skipping.');
}
```

- [ ] **Step 4: Failing test, then push + seed**

```ts
// tests/db.test.ts
import { describe, it, expect, beforeAll } from 'vitest';

process.env.LIBRARY_ROOT = `/tmp/fds-test-${process.pid}`;

describe('db', () => {
  it('creates schema and inserts an entity', async () => {
    const { db, tables } = await import('@/db');
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit push --force', { env: { ...process.env }, stdio: 'ignore' });
    const [e] = db.insert(tables.entities).values({ slug: 'mara', name: 'Mara', type: 'character' }).returning();
    expect(e.id).toBeGreaterThan(0);
    expect(db.select().from(tables.entities).all()).toHaveLength(1);
  });
});
```

Run: `npx vitest run tests/db.test.ts` → FAIL first (no schema module), then after implementing → PASS.
Then initialize the real dev DB: `npm run db:push -- --force && npm run seed` → "Seeded default style token."

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: drizzle schema, db client, seed"`

---

### Task 4: Library filesystem store

**Files:** Create: `src/lib/store.ts`, `tests/store.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
// tests/store.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

process.env.LIBRARY_ROOT = `/tmp/fds-store-${process.pid}`;

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

describe('store', () => {
  it('saves a generated image with thumb, atomic paths, correct meta', async () => {
    const { saveImageFile } = await import('@/lib/store');
    const saved = await saveImageFile(PNG_1x1, 'png', 'generated', 42);
    expect(saved.path).toMatch(/^generations\/\d{4}\/\d{2}\/42\/1\.png$/);
    expect(saved.thumbPath).toBe(saved.path.replace(/\.png$/, '.thumb.webp'));
    expect(saved.width).toBe(1);
    expect(saved.sha256).toHaveLength(64);
    const abs = path.join(process.env.LIBRARY_ROOT!, saved.path);
    expect(fs.existsSync(abs)).toBe(true);
    expect(fs.existsSync(path.join(process.env.LIBRARY_ROOT!, saved.thumbPath))).toBe(true);
  });
  it('saves imports under sha prefix and is idempotent on content', async () => {
    const { saveImageFile } = await import('@/lib/store');
    const a = await saveImageFile(PNG_1x1, 'png', 'imported');
    const b = await saveImageFile(PNG_1x1, 'png', 'imported');
    expect(a.sha256).toBe(b.sha256);
    expect(a.path).toMatch(/^imports\//);
  });
});
```

Run: `npx vitest run tests/store.test.ts` → FAIL

- [ ] **Step 2: Implement**

```ts
// src/lib/store.ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { LIBRARY_ROOT } from '@/db';

export interface SavedFile {
  path: string; thumbPath: string; width: number; height: number;
  format: string; bytes: number; sha256: string;
}

function writeAtomic(absPath: string, data: Buffer) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, absPath);
}

export async function saveImageFile(
  data: Buffer, format: string, source: 'generated' | 'imported', generationId?: number, seq = 1
): Promise<SavedFile> {
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const meta = await sharp(data).metadata();
  const width = meta.width ?? 0, height = meta.height ?? 0;

  let rel: string;
  if (source === 'generated') {
    const d = new Date();
    const yyyy = d.getFullYear(), mm = String(d.getMonth() + 1).padStart(2, '0');
    rel = `generations/${yyyy}/${mm}/${generationId}/${seq}.${format}`;
  } else {
    rel = `imports/${sha256.slice(0, 2)}/${sha256}.${format}`;
  }
  const abs = path.join(LIBRARY_ROOT, rel);
  if (!fs.existsSync(abs)) writeAtomic(abs, data);

  const thumbRel = rel.replace(new RegExp(`\\.${format}$`), '.thumb.webp');
  const thumbAbs = path.join(LIBRARY_ROOT, thumbRel);
  if (!fs.existsSync(thumbAbs)) {
    const thumb = await sharp(data).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    writeAtomic(thumbAbs, thumb);
  }
  return { path: rel, thumbPath: thumbRel, width, height, format, bytes: data.length, sha256 };
}

export function readImage(relPath: string): Buffer {
  return fs.readFileSync(path.join(LIBRARY_ROOT, relPath));
}
```

- [ ] **Step 3: Run** → PASS  ·  **Step 4: Commit** — `git commit -am "feat: library filesystem store (atomic writes, sha256, thumbs)"`

---

### Task 5: selectRefs (the core rule)

**Files:** Create: `src/lib/select-refs.ts`, `tests/select-refs.test.ts`.

- [ ] **Step 1: Failing tests (behavioral spec)**

```ts
// tests/select-refs.test.ts
import { describe, it, expect } from 'vitest';
import { selectRefs, type EntityWithRefs } from '@/lib/select-refs';

const ref = (imageId: number, role: string, priority: number) =>
  ({ imageId, role: role as never, priority });

const mara: EntityWithRefs = {
  id: 1, slug: 'mara', name: 'Mara', type: 'character',
  refs: [ref(1, 'front', 1), ref(2, 'front', 2), ref(3, 'three_quarter', 3), ref(4, 'detail', 4), ref(5, 'expression', 5)],
};
const kade: EntityWithRefs = {
  id: 2, slug: 'kade', name: 'Kade', type: 'character',
  refs: [ref(11, 'front', 1), ref(12, 'three_quarter', 2), ref(13, 'full_body', 3)],
};
const lantern: EntityWithRefs = {
  id: 3, slug: 'lantern', name: 'Lantern', type: 'prop',
  refs: [ref(21, 'front', 1), ref(22, 'detail', 2)],
};
const tavern: EntityWithRefs = {
  id: 4, slug: 'tavern', name: 'Tavern', type: 'setting',
  refs: [ref(31, 'environment', 1), ref(32, 'detail', 2), ref(33, 'front', 3)],
};

describe('selectRefs', () => {
  it('respects character cap on flash (4) for a single character', () => {
    const { picks } = selectRefs([mara], 'gemini-3.1-flash-image-preview');
    expect(picks.filter(p => p.slot === 'character')).toHaveLength(4);
  });
  it('spreads roles instead of taking two fronts first', () => {
    const { picks } = selectRefs([mara], 'gemini-3.1-flash-image-preview');
    const ids = picks.map(p => p.imageId);
    expect(ids.slice(0, 3)).toEqual([1, 3, 5]); // front, three_quarter, expression — not 1,2
  });
  it('splits character cap across two characters (2+2 on flash)', () => {
    const { picks, warnings } = selectRefs([mara, kade], 'gemini-3.1-flash-image-preview');
    expect(picks.filter(p => p.entityId === 1)).toHaveLength(2);
    expect(picks.filter(p => p.entityId === 2)).toHaveLength(2);
    expect(warnings.some(w => w.includes('Mara') && w.includes('consistency'))).toBe(true);
  });
  it('gives remainder to earlier entities (3+2 on pro)', () => {
    const { picks } = selectRefs([mara, kade], 'gemini-3-pro-image-preview');
    expect(picks.filter(p => p.entityId === 1)).toHaveLength(3);
    expect(picks.filter(p => p.entityId === 2)).toHaveLength(2);
  });
  it('props and settings share the object pool', () => {
    const { picks } = selectRefs([lantern, tavern], 'gemini-3-pro-image-preview');
    expect(picks.every(p => p.slot === 'object')).toBe(true);
    expect(picks.filter(p => p.entityId === 3)).toHaveLength(2); // lantern only has 2
    expect(picks.filter(p => p.entityId === 4)).toHaveLength(3);
  });
  it('warns on entity with zero refs and excludes it', () => {
    const empty: EntityWithRefs = { id: 9, slug: 'ghost', name: 'Ghost', type: 'prop', refs: [] };
    const { picks, warnings } = selectRefs([empty], 'gemini-3.1-flash-image-preview');
    expect(picks).toHaveLength(0);
    expect(warnings.some(w => w.includes('Ghost') && w.includes('no references'))).toBe(true);
  });
});
```

Run: `npx vitest run tests/select-refs.test.ts` → FAIL

- [ ] **Step 2: Implement**

```ts
// src/lib/select-refs.ts
import { MODELS, type ModelId, type Slot } from '@/lib/models';

export type Role = 'front' | 'three_quarter' | 'full_body' | 'expression' | 'detail' | 'environment';
const ROLE_ORDER: Role[] = ['front', 'three_quarter', 'full_body', 'expression', 'detail', 'environment'];

export interface RefInput { imageId: number; role: Role; priority: number; }
export interface EntityWithRefs {
  id: number; slug: string; name: string;
  type: 'character' | 'prop' | 'setting';
  refs: RefInput[];
}
export interface Pick { imageId: number; entityId: number; slot: Slot; }

export function selectRefs(entities: EntityWithRefs[], model: ModelId): { picks: Pick[]; warnings: string[] } {
  const caps = MODELS[model].caps;
  const warnings: string[] = [];
  const picks: Pick[] = [];

  const groups: Record<Slot, EntityWithRefs[]> = { character: [], object: [] };
  for (const e of entities) {
    if (e.refs.length === 0) {
      warnings.push(`${e.name} has no references — it will not be sent. Import or promote refs first.`);
      continue;
    }
    groups[e.type === 'character' ? 'character' : 'object'].push(e);
  }

  for (const slot of ['character', 'object'] as Slot[]) {
    const group = groups[slot];
    if (group.length === 0) continue;
    const cap = caps[slot];
    const base = Math.floor(cap / group.length);
    const remainder = cap % group.length;

    group.forEach((e, i) => {
      const allowance = Math.min(base + (i < remainder ? 1 : 0), e.refs.length);
      const chosen = roleSpread(e.refs, allowance);
      chosen.forEach(r => picks.push({ imageId: r.imageId, entityId: e.id, slot }));
      if (slot === 'character' && allowance < 3) {
        warnings.push(
          `${e.name} gets only ${allowance} reference${allowance === 1 ? '' : 's'} — consistency degrades below 3. Use Pro or fewer characters in this shot.`
        );
      }
    });
  }
  return { picks, warnings };
}

// Round-robin across role groups (canonical role order), lowest priority first within each.
function roleSpread(refs: RefInput[], n: number): RefInput[] {
  const byRole = new Map<Role, RefInput[]>();
  for (const role of ROLE_ORDER) {
    const rs = refs.filter(r => r.role === role).sort((a, b) => a.priority - b.priority);
    if (rs.length) byRole.set(role, rs);
  }
  const out: RefInput[] = [];
  while (out.length < n && byRole.size > 0) {
    for (const role of [...byRole.keys()]) {
      if (out.length >= n) break;
      const rs = byRole.get(role)!;
      out.push(rs.shift()!);
      if (rs.length === 0) byRole.delete(role);
    }
  }
  return out;
}
```

- [ ] **Step 3: Run** → PASS (fix implementation, not tests, if not)
- [ ] **Step 4: Commit** — `git commit -am "feat: cap-aware reference selection with role spread and warnings"`

---

### Task 6: Prompt assembly

**Files:** Create: `src/lib/prompt.ts`, `tests/prompt.test.ts`.

- [ ] **Step 1: Failing test**

```ts
// tests/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { assemblePrompt } from '@/lib/prompt';

describe('assemblePrompt', () => {
  it('orders tokens by category, then relationship lines, then scene, then output spec', () => {
    const out = assemblePrompt({
      tokens: [
        { category: 'mood', value: 'Melancholic, quiet dread.' },
        { category: 'palette', value: 'Muted warm palette.' },
      ],
      entities: [
        { name: 'Mara', type: 'character' },
        { name: 'Lantern', type: 'prop' },
      ],
      scene: 'Mara lifts the lantern in the tavern doorway at night.',
      aspectRatio: '21:9', resolution: '2K',
    });
    const idx = (s: string) => out.indexOf(s);
    expect(idx('Muted warm palette.')).toBeLessThan(idx('Melancholic'));
    expect(idx('Melancholic')).toBeLessThan(idx('Character reference: Mara'));
    expect(idx('Character reference: Mara')).toBeLessThan(idx('Object reference: Lantern'));
    expect(idx('Object reference: Lantern')).toBeLessThan(idx('Mara lifts the lantern'));
    expect(out).toContain('21:9');
  });
});
```

Run → FAIL

- [ ] **Step 2: Implement**

```ts
// src/lib/prompt.ts
const CATEGORY_ORDER = ['palette', 'lighting', 'lens', 'film_stock', 'mood', 'era', 'custom'] as const;

export interface PromptTokenIn { category: (typeof CATEGORY_ORDER)[number]; value: string; }
export interface PromptEntityIn { name: string; type: 'character' | 'prop' | 'setting'; }

const REL_LINE: Record<PromptEntityIn['type'], (n: string) => string> = {
  character: n => `Character reference: ${n} — keep face, hair and costume exactly as shown in the reference images.`,
  prop: n => `Object reference: ${n} — preserve this object's exact design, materials and details.`,
  setting: n => `Location reference: ${n} — preserve this location's layout, architecture and atmosphere.`,
};

export function assemblePrompt(input: {
  tokens: PromptTokenIn[]; entities: PromptEntityIn[];
  scene: string; aspectRatio: string; resolution: string;
}): string {
  const tokenLines = [...input.tokens]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .map(t => t.value);
  const relLines = input.entities.map(e => REL_LINE[e.type](e.name));
  const outputSpec = `Single ${input.resolution} still frame, ${input.aspectRatio} aspect ratio.`;
  return [...tokenLines, ...relLines, input.scene.trim(), outputSpec].filter(Boolean).join('\n');
}
```

- [ ] **Step 3: Run** → PASS  ·  **Step 4: Commit** — `git commit -am "feat: deterministic prompt assembly"`

---

### Task 7: Gemini wrapper

**Files:** Create: `src/lib/gemini.ts`, `tests/gemini.test.ts`.

- [ ] **Step 1: Failing test (mocked SDK)**

```ts
// tests/gemini.test.ts
import { describe, it, expect, vi } from 'vitest';

const generateContent = vi.fn().mockResolvedValue({
  candidates: [{ content: { parts: [
    { text: 'here you go' },
    { inlineData: { mimeType: 'image/png', data: Buffer.from('fakepng').toString('base64') } },
  ] } }],
});
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent }; constructor(_: unknown) {} },
}));

describe('generateImages', () => {
  it('passes refs as inlineData parts before the prompt and extracts image buffers', async () => {
    const { generateImages } = await import('@/lib/gemini');
    const out = await generateImages({
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'a lantern',
      refs: [{ data: Buffer.from('img1'), mimeType: 'image/png' }],
      aspectRatio: '16:9', resolution: '1K',
    });
    expect(out).toHaveLength(1);
    expect(out[0].data.toString()).toBe('fakepng');
    const call = generateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-flash-image-preview');
    const parts = call.contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe('image/png');
    expect(parts.at(-1).text).toBe('a lantern');
    expect(call.config.responseModalities).toEqual(['TEXT', 'IMAGE']);
  });
});
```

Run → FAIL

- [ ] **Step 2: Implement**

```ts
// src/lib/gemini.ts
import { GoogleGenAI } from '@google/genai';
import type { ModelId } from '@/lib/models';

export interface RefPayload { data: Buffer; mimeType: string; }
export interface GeneratedImage { data: Buffer; mimeType: string; }

const g = globalThis as unknown as { __fdsAi?: GoogleGenAI };
function client() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set (.env.local)');
  return (g.__fdsAi ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }));
}

export async function generateImages(input: {
  model: ModelId; prompt: string; refs: RefPayload[];
  aspectRatio: string; resolution: string;
}): Promise<GeneratedImage[]> {
  const parts = [
    ...input.refs.map(r => ({ inlineData: { mimeType: r.mimeType, data: r.data.toString('base64') } })),
    { text: input.prompt },
  ];
  const res = await client().models.generateContent({
    model: input.model,
    contents: [{ role: 'user', parts }],
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: input.aspectRatio, imageSize: input.resolution },
    },
  });
  const out: GeneratedImage[] = [];
  for (const p of res.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData?.data) out.push({ data: Buffer.from(p.inlineData.data, 'base64'), mimeType: p.inlineData.mimeType ?? 'image/png' });
  }
  if (out.length === 0) {
    const text = res.candidates?.[0]?.content?.parts?.find(p => 'text' in p && p.text)?.text;
    throw new Error(text ? `Model returned no image: ${text.slice(0, 300)}` : 'Model returned no image (possibly safety-blocked).');
  }
  return out;
}
```

- [ ] **Step 3: Verify SDK param names** — open `node_modules/@google/genai/dist/**/types.d.ts` and confirm `imageConfig.aspectRatio` / `imageSize` and `responseModalities` names for the installed version; adjust field names here AND in the mocked test if the SDK differs. This step is done when `npx tsc --noEmit` passes with no `as any` in this file.
- [ ] **Step 4: Run** `npx vitest run tests/gemini.test.ts` → PASS
- [ ] **Step 5: Commit** — `git commit -am "feat: gemini image generation wrapper"`

---

### Task 8: Generation service + serial queue + boot sweep

**Files:** Create: `src/lib/generate.ts`, `src/lib/queries.ts`, `instrumentation.ts`, `tests/generate.test.ts`.

- [ ] **Step 1: Shared queries**

```ts
// src/lib/queries.ts
import { db, tables } from '@/db';
import { eq, inArray, desc } from 'drizzle-orm';
import type { EntityWithRefs, Role } from '@/lib/select-refs';

export function entitiesWithRefs(entityIds?: number[]): EntityWithRefs[] {
  const es = entityIds
    ? db.select().from(tables.entities).where(inArray(tables.entities.id, entityIds)).all()
    : db.select().from(tables.entities).all();
  return es.map(e => ({
    id: e.id, slug: e.slug, name: e.name, type: e.type,
    refs: db.select().from(tables.refs).where(eq(tables.refs.entityId, e.id)).all()
      .map(r => ({ imageId: r.imageId, role: r.role as Role, priority: r.priority })),
  }));
}

export function defaultTokens() {
  return db.select().from(tables.styleTokens).where(eq(tables.styleTokens.isDefault, true)).all();
}

export function latestRevisionId(tokenId: number): number {
  const rev = db.select().from(tables.tokenRevisions).where(eq(tables.tokenRevisions.tokenId, tokenId))
    .orderBy(desc(tables.tokenRevisions.id)).limit(1).all()[0];
  return rev.id;
}
```

- [ ] **Step 2: Failing test for the service (mock gemini module)**

```ts
// tests/generate.test.ts
import { describe, it, expect, vi } from 'vitest';

process.env.LIBRARY_ROOT = `/tmp/fds-gen-${process.pid}`;
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

vi.mock('@/lib/gemini', () => ({
  generateImages: vi.fn().mockResolvedValue([{ data: PNG_1x1, mimeType: 'image/png' }]),
}));

describe('generation service', () => {
  it('runs the full loop: create -> run -> outputs linked, status done', async () => {
    // IMPORT @/db FIRST: its client mkdir's LIBRARY_ROOT. drizzle-kit push does NOT
    // create the parent dir and exits 0 anyway, so a push before this silently no-ops.
    const { db, tables } = await import('@/db');
    const { execSync } = await import('node:child_process');
    execSync('npx drizzle-kit push --force', { env: { ...process.env }, stdio: 'ignore' });
    const { saveImageFile } = await import('@/lib/store');
    const { createGeneration, runPending } = await import('@/lib/generate');
    const { eq } = await import('drizzle-orm');

    const [e] = db.insert(tables.entities).values({ slug: 'mara', name: 'Mara', type: 'character' }).returning().all();
    const f = await saveImageFile(PNG_1x1, 'png', 'imported');
    const [img] = db.insert(tables.images).values({ ...f, source: 'imported' }).returning().all();
    db.insert(tables.refs).values({ entityId: e.id, imageId: img.id, role: 'front', priority: 1 }).run();

    const genId = createGeneration({
      entityIds: [e.id], scene: 'Mara at night', model: 'gemini-3.1-flash-image-preview',
      aspectRatio: '16:9', resolution: '1K',
    });
    await runPending(genId);

    const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
    expect(gen.status).toBe('done');
    expect(gen.promptFinal).toContain('Character reference: Mara');
    const inputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all();
    expect(inputs).toHaveLength(1);
    const outputs = db.select().from(tables.images).where(eq(tables.images.generationId, genId)).all();
    expect(outputs).toHaveLength(1);
  });
});
```

Run → FAIL

- [ ] **Step 3: Implement service**

```ts
// src/lib/generate.ts
import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { selectRefs } from '@/lib/select-refs';
import { assemblePrompt } from '@/lib/prompt';
import { entitiesWithRefs, defaultTokens, latestRevisionId } from '@/lib/queries';
import { generateImages } from '@/lib/gemini';
import { saveImageFile, readImage } from '@/lib/store';
import type { ModelId } from '@/lib/models';

export interface CreateGenInput {
  entityIds: number[]; scene: string; model: ModelId;
  aspectRatio: string; resolution: string; promptOverride?: string;
}

export function createGeneration(input: CreateGenInput): number {
  const ents = entitiesWithRefs(input.entityIds);
  const { picks } = selectRefs(ents, input.model);
  const tokens = defaultTokens(); // M1: defaults only; M2 adds per-shot selection
  const promptFinal = input.promptOverride ?? assemblePrompt({
    tokens: tokens.map(t => ({ category: t.category, value: t.value })),
    entities: ents.filter(e => picks.some(p => p.entityId === e.id)).map(e => ({ name: e.name, type: e.type })),
    scene: input.scene, aspectRatio: input.aspectRatio, resolution: input.resolution,
  });

  // NOTE: .all() is required — drizzle-orm 0.45's .returning() is a QueryPromise,
  // not synchronously iterable, so bare destructuring throws at runtime.
  const [gen] = db.insert(tables.generations).values({
    promptUser: input.scene, promptFinal, model: input.model,
    aspectRatio: input.aspectRatio, resolution: input.resolution, status: 'pending',
  }).returning().all();

  for (const p of picks)
    db.insert(tables.generationInputs).values({ generationId: gen.id, imageId: p.imageId, entityId: p.entityId, slot: p.slot }).run();
  for (const t of tokens)
    db.insert(tables.generationTokens).values({ generationId: gen.id, tokenId: t.id, tokenRevisionId: latestRevisionId(t.id) }).run();
  return gen.id;
}

let chain: Promise<unknown> = Promise.resolve(); // serial queue — one Gemini call at a time

export function enqueue(genId: number): void {
  chain = chain.then(() => runPending(genId)).catch(() => {});
}

export async function runPending(genId: number): Promise<void> {
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
  if (!gen || gen.status !== 'pending') return;
  const started = Date.now();
  try {
    const inputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all();
    const refs = inputs.map(i => {
      const img = db.select().from(tables.images).where(eq(tables.images.id, i.imageId)).all()[0];
      return { data: readImage(img.path), mimeType: `image/${img.format === 'jpg' ? 'jpeg' : img.format}` };
    });
    const results = await generateImages({
      model: gen.model as ModelId, prompt: gen.promptFinal, refs,
      aspectRatio: gen.aspectRatio, resolution: gen.resolution,
    });
    let seq = 1;
    for (const r of results) {
      const ext = r.mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
      const f = await saveImageFile(r.data, ext, 'generated', genId, seq++);
      db.insert(tables.images).values({ ...f, source: 'generated', generationId: genId }).run();
    }
    db.update(tables.generations).set({ status: 'done', durationMs: Date.now() - started }).where(eq(tables.generations.id, genId)).run();
  } catch (err) {
    db.update(tables.generations).set({
      status: 'failed', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - started,
    }).where(eq(tables.generations.id, genId)).run();
  }
}

export function sweepStalePending(): void {
  db.update(tables.generations).set({ status: 'failed', error: 'interrupted — retry' })
    .where(eq(tables.generations.status, 'pending')).run();
}

export function retryGeneration(genId: number): number {
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, genId)).all()[0];
  if (!gen) throw new Error('generation not found');
  const [fresh] = db.insert(tables.generations).values({
    promptUser: gen.promptUser, promptFinal: gen.promptFinal, model: gen.model,
    aspectRatio: gen.aspectRatio, resolution: gen.resolution, status: 'pending',
  }).returning().all();
  for (const i of db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, genId)).all())
    db.insert(tables.generationInputs).values({ generationId: fresh.id, imageId: i.imageId, entityId: i.entityId, slot: i.slot }).run();
  for (const t of db.select().from(tables.generationTokens).where(eq(tables.generationTokens.generationId, genId)).all())
    db.insert(tables.generationTokens).values({ generationId: fresh.id, tokenId: t.tokenId, tokenRevisionId: t.tokenRevisionId }).run();
  return fresh.id;
}
```

`instrumentation.ts` (repo root):
```ts
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { sweepStalePending } = await import('@/lib/generate');
    sweepStalePending();
  }
}
```

- [ ] **Step 4: Run** `npx vitest run tests/generate.test.ts` → PASS; then full `npm test` → all green
- [ ] **Step 5: Commit** — `git commit -am "feat: generation service, serial queue, stale-pending sweep, retry"`

---

### Task 9: Server actions

**Files:** Create: `src/app/actions.ts`.

- [ ] **Step 1: Implement (thin, zod-validated, revalidate paths)**

```ts
// src/app/actions.ts
'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { db, tables } from '@/db';
import { and, eq } from 'drizzle-orm';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const entityIn = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['character', 'prop', 'setting']),
  description: z.string().max(2000).default(''),
});

export async function createEntity(input: z.infer<typeof entityIn>) {
  const v = entityIn.parse(input);
  const [e] = db.insert(tables.entities).values({ ...v, slug: slugify(v.name) }).returning().all();
  revalidatePath('/library');
  return { id: e.id, slug: e.slug };
}

const promoteIn = z.object({
  imageId: z.number().int().positive(),
  entityId: z.number().int().positive(),
  role: z.enum(['front', 'three_quarter', 'full_body', 'expression', 'detail', 'environment']),
});

export async function promoteToRef(input: z.infer<typeof promoteIn>) {
  const v = promoteIn.parse(input);
  db.insert(tables.refs)
    .values({ entityId: v.entityId, imageId: v.imageId, role: v.role, priority: 100 })
    .onConflictDoUpdate({ target: [tables.refs.entityId, tables.refs.imageId], set: { role: v.role } })
    .run();
  revalidatePath('/library');
}

export async function demoteRef(entityId: number, imageId: number) {
  db.delete(tables.refs).where(and(eq(tables.refs.entityId, entityId), eq(tables.refs.imageId, imageId))).run();
  revalidatePath('/library');
}

export async function setRefPriority(refId: number, priority: number) {
  db.update(tables.refs).set({ priority: z.number().int().parse(priority) }).where(eq(tables.refs.id, refId)).run();
  revalidatePath('/library');
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` → clean
- [ ] **Step 3: Commit** — `git commit -am "feat: server actions (entities, promote/demote, priority)"`

---

### Task 10: API routes

**Files:** Create: `src/app/api/generate/route.ts`, `src/app/api/generations/[id]/route.ts`, `src/app/api/images/[id]/route.ts`, `src/app/api/import/route.ts`.

- [ ] **Step 1: Implement all four**

```ts
// src/app/api/generate/route.ts
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createGeneration, enqueue } from '@/lib/generate';
import { MODELS } from '@/lib/models';

const bodyIn = z.object({
  entityIds: z.array(z.number().int().positive()).min(0).max(12),
  scene: z.string().min(1).max(4000),
  model: z.enum(['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview']),
  aspectRatio: z.string(), resolution: z.string(),
  promptOverride: z.string().max(8000).optional(),
});

export async function POST(req: Request) {
  const parsed = bodyIn.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const m = MODELS[parsed.data.model];
  if (!m.aspectRatios.includes(parsed.data.aspectRatio) || !m.resolutions.includes(parsed.data.resolution))
    return NextResponse.json({ error: 'aspect/resolution not supported by model' }, { status: 400 });
  const id = createGeneration(parsed.data);
  enqueue(id);
  return NextResponse.json({ id });
}
```

```ts
// src/app/api/generations/[id]/route.ts
import { NextResponse } from 'next/server';
import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gen = db.select().from(tables.generations).where(eq(tables.generations.id, Number(id))).all()[0];
  if (!gen) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const outputs = db.select().from(tables.images).where(eq(tables.images.generationId, gen.id)).all();
  return NextResponse.json({ ...gen, outputs: outputs.map(o => ({ id: o.id, width: o.width, height: o.height })) });
}
```

```ts
// src/app/api/images/[id]/route.ts
import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { readImage } from '@/lib/store';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const img = db.select().from(tables.images).where(eq(tables.images.id, Number(id))).all()[0];
  if (!img) return new Response('not found', { status: 404 });
  const thumb = new URL(req.url).searchParams.get('thumb') === '1';
  const data = readImage(thumb ? img.thumbPath : img.path);
  const type = thumb ? 'image/webp' : `image/${img.format === 'jpg' ? 'jpeg' : img.format}`;
  return new Response(new Uint8Array(data), {
    headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
}
```

```ts
// src/app/api/import/route.ts
import { NextResponse } from 'next/server';
import { db, tables } from '@/db';
import { saveImageFile } from '@/lib/store';
import { eq } from 'drizzle-orm';

const OK_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
};

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  const ext = OK_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: `unsupported type ${file.type}` }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'file exceeds 50 MB API limit' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const saved = await saveImageFile(buf, ext, 'imported');
  const existing = db.select().from(tables.images).where(eq(tables.images.sha256, saved.sha256)).all()[0];
  const img = existing ?? db.insert(tables.images).values({ ...saved, source: 'imported' }).returning().all()[0];
  return NextResponse.json({ imageId: img.id, deduped: Boolean(existing) });
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` → clean; `npm test` → green
- [ ] **Step 3: Commit** — `git commit -am "feat: api routes (generate, poll, images, import)"`

---

### Task 11: App shell

**Files:** Modify: `src/app/layout.tsx`, `src/app/globals.css` (dark default), `src/app/page.tsx` (redirect); Create: `src/components/sidebar.tsx`, `src/app/(screens)/tokens/page.tsx` stub.

- [ ] **Step 1: Implement**

```tsx
// src/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { Sidebar } from '@/components/sidebar';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = { title: 'Film Design System' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 overflow-x-hidden p-6">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
```

```tsx
// src/components/sidebar.tsx
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/library', label: 'Library' },
  { href: '/generate', label: 'Generate' },
  { href: '/tokens', label: 'Tokens' },
  { href: '/history', label: 'History' },
];

export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="w-52 shrink-0 border-r border-border p-4">
      <div className="mb-6 text-sm font-semibold tracking-wide">Film Design System</div>
      <nav className="space-y-1">
        {NAV.map(n => (
          <Link key={n.href} href={n.href}
            className={cn('block rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground',
              path.startsWith(n.href) && 'bg-accent text-foreground')}>
            {n.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

`src/app/page.tsx`:
```tsx
import { redirect } from 'next/navigation';
export default function Home() { redirect('/library'); }
```

`src/app/(screens)/tokens/page.tsx`:
```tsx
export default function TokensPage() {
  return <div className="text-muted-foreground">Style tokens UI arrives in M2. The default base-style token is applied to every generation.</div>;
}
```

- [ ] **Step 2: Verify** `npm run dev` → `/` redirects to `/library` (404 body for now is fine), sidebar renders, dark theme active.
- [ ] **Step 3: Commit** — `git commit -am "feat: app shell (sidebar, dark theme, routes)"`

---

### Task 12: Library screen

**Files:** Create: `src/app/(screens)/library/page.tsx`, `src/app/(screens)/library/[slug]/page.tsx`, `src/components/entity-create-dialog.tsx`, `src/components/import-dropzone.tsx`, `src/components/ref-card.tsx`.

- [ ] **Step 1: Entity list page (server component)**

```tsx
// src/app/(screens)/library/page.tsx
import Link from 'next/link';
import { db, tables } from '@/db';
import { eq } from 'drizzle-orm';
import { EntityCreateDialog } from '@/components/entity-create-dialog';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  const entities = db.select().from(tables.entities).all();
  const refCount = (id: number) => db.select().from(tables.refs).where(eq(tables.refs.entityId, id)).all().length;
  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Library</h1>
        <EntityCreateDialog />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {entities.map(e => (
          <Link key={e.id} href={`/library/${e.slug}`} className="rounded-lg border border-border p-4 hover:bg-accent">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium">{e.name}</span>
              <Badge variant="outline">{e.type}</Badge>
            </div>
            <div className="text-xs text-muted-foreground">{refCount(e.id)} refs</div>
          </Link>
        ))}
        {entities.length === 0 && <div className="col-span-full text-muted-foreground">No entities yet — create your first character, prop or setting.</div>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create dialog (client)**

```tsx
// src/components/entity-create-dialog.tsx
'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEntity } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export function EntityCreateDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'character' | 'prop' | 'setting'>('character');
  const [description, setDescription] = useState('');
  const [pending, start] = useTransition();
  const router = useRouter();

  const submit = () => start(async () => {
    const { slug } = await createEntity({ name, type, description });
    setOpen(false);
    router.push(`/library/${slug}`);
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New entity</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New entity</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2"><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Mara" /></div>
          <div className="space-y-2"><Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as never)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="character">Character</SelectItem>
                <SelectItem value="prop">Prop</SelectItem>
                <SelectItem value="setting">Setting</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} /></div>
          <Button onClick={submit} disabled={pending || !name.trim()}>{pending ? 'Creating…' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Entity detail page + ref card + import dropzone**

```tsx
// src/app/(screens)/library/[slug]/page.tsx
import { notFound } from 'next/navigation';
import { db, tables } from '@/db';
import { eq, desc } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { RefCard } from '@/components/ref-card';
import { ImportDropzone } from '@/components/import-dropzone';

export const dynamic = 'force-dynamic';

export default async function EntityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entity = db.select().from(tables.entities).where(eq(tables.entities.slug, slug)).all()[0];
  if (!entity) notFound();

  const refRows = db.select().from(tables.refs).where(eq(tables.refs.entityId, entity.id)).all()
    .sort((a, b) => a.priority - b.priority);
  const usedIn = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.entityId, entity.id)).all();

  return (
    <div className="space-y-8">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{entity.name}</h1>
          <Badge variant="outline">{entity.type}</Badge>
        </div>
        {entity.description && <p className="mt-1 max-w-xl text-sm text-muted-foreground">{entity.description}</p>}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Canon references ({refRows.length})</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {refRows.map(r => <RefCard key={r.id} refRow={r} />)}
        </div>
        <div className="mt-4"><ImportDropzone entityId={entity.id} /></div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Used in {usedIn.length} generations</h2>
      </section>
    </div>
  );
}
```

```tsx
// src/components/ref-card.tsx
'use client';
import { useTransition } from 'react';
import { demoteRef, promoteToRef, setRefPriority } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ROLES = ['front', 'three_quarter', 'full_body', 'expression', 'detail', 'environment'] as const;

export function RefCard({ refRow }: { refRow: { id: number; entityId: number; imageId: number; role: string; priority: number } }) {
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/images/${refRow.imageId}?thumb=1`} alt="" className="aspect-square w-full rounded object-cover" />
      <Select defaultValue={refRow.role}
        onValueChange={role => start(() => promoteToRef({ imageId: refRow.imageId, entityId: refRow.entityId, role: role as never }))}>
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}</SelectContent>
      </Select>
      <div className="flex gap-1">
        <Button size="sm" variant="outline" className="h-6 flex-1 text-xs" disabled={pending}
          onClick={() => start(() => setRefPriority(refRow.id, refRow.priority - 15))}>↑</Button>
        <Button size="sm" variant="outline" className="h-6 flex-1 text-xs" disabled={pending}
          onClick={() => start(() => demoteRef(refRow.entityId, refRow.imageId))}>demote</Button>
      </div>
    </div>
  );
}
```

```tsx
// src/components/import-dropzone.tsx
'use client';
import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { promoteToRef } from '@/app/actions';
import { toast } from 'sonner';

export function ImportDropzone({ entityId }: { entityId: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [, start] = useTransition();
  const router = useRouter();

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) { toast.error(`${file.name}: ${json.error}`); continue; }
      start(() => promoteToRef({ imageId: json.imageId, entityId, role: 'front' }));
      toast.success(`${file.name} imported as reference (role: front — adjust on the card)`);
    }
    router.refresh();
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`cursor-pointer rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground ${drag ? 'border-primary bg-accent' : 'border-border'}`}
    >
      Drop images here (or click) to import as references — sketches and photos welcome
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/heif" multiple hidden
        onChange={e => handleFiles(e.target.files)} />
    </div>
  );
}
```

- [ ] **Step 4: Verify in browser** — create entity "Mara" (character), drop a photo, see it as a ref, change role, demote, re-import. Check terminal for errors.
- [ ] **Step 5: Commit** — `git commit -am "feat: library screen (entities, refs, import)"`

---

### Task 13: Generate screen

**Files:** Create: `src/app/(screens)/generate/page.tsx`, `src/components/shot-composer.tsx`.

- [ ] **Step 1: Server page ships entities-with-refs to the client**

```tsx
// src/app/(screens)/generate/page.tsx
import { entitiesWithRefs, defaultTokens } from '@/lib/queries';
import { ShotComposer } from '@/components/shot-composer';

export const dynamic = 'force-dynamic';

export default function GeneratePage() {
  return <ShotComposer entities={entitiesWithRefs()} tokens={defaultTokens().map(t => ({ name: t.name, value: t.value }))} />;
}
```

- [ ] **Step 2: Composer (client) — selection, payload preview with cap meters, poll results, promote**

```tsx
// src/components/shot-composer.tsx
'use client';
import { useEffect, useMemo, useState } from 'react';
import { selectRefs, type EntityWithRefs } from '@/lib/select-refs';
import { MODELS, DEFAULT_MODEL, type ModelId } from '@/lib/models';
import { promoteToRef } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

type GenStatus = { id: number; status: 'pending' | 'done' | 'failed'; error?: string; outputs: { id: number }[] };
const ROLES = ['front', 'three_quarter', 'full_body', 'expression', 'detail', 'environment'] as const;

export function ShotComposer({ entities, tokens }: { entities: EntityWithRefs[]; tokens: { name: string; value: string }[] }) {
  const [selected, setSelected] = useState<number[]>([]);
  const [scene, setScene] = useState('');
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [aspect, setAspect] = useState('16:9');
  const [resolution, setResolution] = useState('1K');
  const [gens, setGens] = useState<GenStatus[]>([]);

  const chosen = entities.filter(e => selected.includes(e.id));
  const { picks, warnings } = useMemo(() => selectRefs(chosen, model), [chosen, model]);
  const caps = MODELS[model].caps;
  const used = { character: picks.filter(p => p.slot === 'character').length, object: picks.filter(p => p.slot === 'object').length };

  useEffect(() => {
    const pending = gens.filter(g => g.status === 'pending');
    if (pending.length === 0) return;
    const t = setInterval(async () => {
      for (const g of pending) {
        const res = await fetch(`/api/generations/${g.id}`);
        const json: GenStatus = await res.json();
        if (json.status !== 'pending') setGens(cur => cur.map(c => (c.id === g.id ? json : c)));
      }
    }, 1500);
    return () => clearInterval(t);
  }, [gens]);

  async function generate() {
    const res = await fetch('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityIds: selected, scene, model, aspectRatio: aspect, resolution }),
    });
    const json = await res.json();
    if (!res.ok) { toast.error(json.error); return; }
    setGens(cur => [{ id: json.id, status: 'pending', outputs: [] }, ...cur]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <h1 className="text-xl font-semibold">Generate</h1>
        <section>
          <div className="mb-2 text-sm font-medium text-muted-foreground">Entities</div>
          <div className="flex flex-wrap gap-2">
            {entities.map(e => (
              <button key={e.id}
                onClick={() => setSelected(s => (s.includes(e.id) ? s.filter(x => x !== e.id) : [...s, e.id]))}
                className={`rounded-full border px-3 py-1 text-sm ${selected.includes(e.id) ? 'border-primary bg-primary/15' : 'border-border text-muted-foreground'}`}>
                {e.name} <span className="opacity-60">({e.refs.length})</span>
              </button>
            ))}
            {entities.length === 0 && <span className="text-sm text-muted-foreground">No entities yet — create them in Library.</span>}
          </div>
        </section>
        <section>
          <div className="mb-2 text-sm font-medium text-muted-foreground">Style tokens (defaults, M1)</div>
          {tokens.map(t => <Badge key={t.name} variant="secondary" className="mr-2">{t.name}</Badge>)}
        </section>
        <Textarea rows={4} placeholder="Scene: Mara lifts the lantern in the tavern doorway at night…" value={scene} onChange={e => setScene(e.target.value)} />
        <div className="grid grid-cols-3 gap-2">
          <Select value={model} onValueChange={v => setModel(v as ModelId)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{Object.values(MODELS).map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={aspect} onValueChange={setAspect}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{MODELS[model].aspectRatios.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={resolution} onValueChange={setResolution}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{MODELS[model].resolutions.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <section className="rounded-lg border border-border p-3">
          <div className="mb-2 flex justify-between text-xs text-muted-foreground">
            <span>Payload</span>
            <span>char {used.character}/{caps.character} · obj {used.object}/{caps.object}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {picks.map(p => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={`${p.entityId}-${p.imageId}`} src={`/api/images/${p.imageId}?thumb=1`} alt="" className="h-12 w-12 rounded object-cover" />
            ))}
            {picks.length === 0 && <span className="text-xs text-muted-foreground">No references will be sent.</span>}
          </div>
          {warnings.map(w => <div key={w} className="mt-2 text-xs text-amber-400">⚠ {w}</div>)}
        </section>
        <Button onClick={generate} disabled={!scene.trim()} className="w-full">Generate</Button>
      </div>

      <div className="space-y-4">
        {gens.map(g => (
          <div key={g.id} className="rounded-lg border border-border p-3">
            {g.status === 'pending' && <div className="animate-pulse text-sm text-muted-foreground">Generating #{g.id}…</div>}
            {g.status === 'failed' && <div className="text-sm text-red-400">#{g.id} failed: {g.error}</div>}
            {g.status === 'done' && g.outputs.map(o => <ResultCard key={o.id} imageId={o.id} entities={entities} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ imageId, entities }: { imageId: number; entities: EntityWithRefs[] }) {
  const [entityId, setEntityId] = useState<string>('');
  const [role, setRole] = useState<string>('front');
  return (
    <div className="space-y-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/images/${imageId}`} alt="" className="max-h-[60vh] rounded" />
      <div className="flex items-center gap-2">
        <Select value={entityId} onValueChange={setEntityId}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Promote to…" /></SelectTrigger>
          <SelectContent>{entities.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r.replace('_', ' ')}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" disabled={!entityId}
          onClick={async () => { await promoteToRef({ imageId, entityId: Number(entityId), role: role as never }); toast.success('Promoted to reference'); }}>
          Promote
        </Button>
        <a href={`/api/images/${imageId}`} download className="text-sm text-muted-foreground underline">download</a>
      </div>
    </div>
  );
}
```

Note: `selectRefs` and `models.ts` are pure/isomorphic — importing them client-side is intended (payload preview must match the server exactly; `createGeneration` re-runs the same function server-side).

- [ ] **Step 3: Verify in browser** — select Mara, watch cap meter, generate (with real `GEMINI_API_KEY`), see result appear, promote it to Mara/three_quarter, confirm it now shows in Library and in the next payload preview.
- [ ] **Step 4: Commit** — `git commit -am "feat: generate screen (composer, payload preview, results, promote)"`

---

### Task 14: History screen

**Files:** Create: `src/app/(screens)/history/page.tsx`, `src/components/retry-button.tsx`; Modify: `src/app/api/generations/[id]/route.ts` (add POST retry).

- [ ] **Step 1: Add retry endpoint** — append to `src/app/api/generations/[id]/route.ts`:

```ts
import { retryGeneration, enqueue } from '@/lib/generate';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const freshId = retryGeneration(Number(id));
  enqueue(freshId);
  return NextResponse.json({ id: freshId });
}
```

- [ ] **Step 2: History page**

```tsx
// src/app/(screens)/history/page.tsx
import { db, tables } from '@/db';
import { desc, eq } from 'drizzle-orm';
import { Badge } from '@/components/ui/badge';
import { RetryButton } from '@/components/retry-button';

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  const gens = db.select().from(tables.generations).orderBy(desc(tables.generations.id)).limit(100).all();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">History</h1>
      {gens.map(g => {
        const outputs = db.select().from(tables.images).where(eq(tables.images.generationId, g.id)).all();
        const inputs = db.select().from(tables.generationInputs).where(eq(tables.generationInputs.generationId, g.id)).all();
        return (
          <details key={g.id} className="rounded-lg border border-border p-4">
            <summary className="flex cursor-pointer items-center gap-3 text-sm">
              <span className="font-mono text-muted-foreground">#{g.id}</span>
              <Badge variant={g.status === 'done' ? 'secondary' : g.status === 'failed' ? 'destructive' : 'outline'}>{g.status}</Badge>
              <span className="truncate">{g.promptUser}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{g.model.includes('pro') ? 'Pro' : 'Flash'} · {g.aspectRatio} · {g.resolution}</span>
            </summary>
            <div className="mt-4 space-y-3">
              {g.error && <div className="text-sm text-red-400">{g.error} <RetryButton id={g.id} /></div>}
              <div className="flex flex-wrap gap-2">
                {outputs.map(o => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={o.id} src={`/api/images/${o.id}?thumb=1`} alt="" className="h-28 rounded" />
                ))}
              </div>
              <div>
                <div className="mb-1 text-xs text-muted-foreground">References sent ({inputs.length})</div>
                <div className="flex flex-wrap gap-1">
                  {inputs.map(i => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i.id} src={`/api/images/${i.imageId}?thumb=1`} alt="" className="h-12 w-12 rounded object-cover" />
                  ))}
                </div>
              </div>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">{g.promptFinal}</pre>
            </div>
          </details>
        );
      })}
      {gens.length === 0 && <div className="text-muted-foreground">No generations yet.</div>}
    </div>
  );
}
```

```tsx
// src/components/retry-button.tsx
'use client';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function RetryButton({ id }: { id: number }) {
  const router = useRouter();
  return (
    <Button size="sm" variant="outline"
      onClick={async () => { await fetch(`/api/generations/${id}`, { method: 'POST' }); router.refresh(); }}>
      Retry
    </Button>
  );
}
```

- [ ] **Step 3: Verify** — history lists generations with refs-sent thumbnails and the exact final prompt; retry a failed one.
- [ ] **Step 4: Commit** — `git commit -am "feat: history screen with lineage and retry"`

---

### Task 15: M1 exit verification (spec §11)

**Files:** Create: `tests/smoke-gemini.test.ts`, `README.md` (replace stub).

- [ ] **Step 1: Live smoke test (opt-in)**

```ts
// tests/smoke-gemini.test.ts
import { describe, it, expect } from 'vitest';

describe.skipIf(process.env.SMOKE_GEMINI !== '1')('gemini live smoke', () => {
  it('generates one image from a text-only prompt', async () => {
    const { generateImages } = await import('@/lib/gemini');
    const out = await generateImages({
      model: 'gemini-3.1-flash-image-preview',
      prompt: 'A brass lantern on a wooden table, cinematic still.',
      refs: [], aspectRatio: '1:1', resolution: '1K',
    });
    expect(out[0].data.length).toBeGreaterThan(10_000);
  }, 120_000);
});
```

Run: `SMOKE_GEMINI=1 npx vitest run tests/smoke-gemini.test.ts` → PASS (requires key; costs one Flash generation)

- [ ] **Step 2: The loop, for real, in the app** — with dev server running:
  1. Library → create character (e.g. "Mara"), import 1–2 face/costume photos or sketches as refs.
  2. Generate → select Mara, scene prompt, Flash, 16:9/1K → Generate → result appears.
  3. Promote the result to Mara / three_quarter.
  4. Generate a second shot; **verify the payload preview now includes the promoted image**, and History for the new generation lists it under "References sent".
  5. Confirm in **Chrome and Safari** (per standing rule).
- [ ] **Step 3: Full test suite + types** — `npm test && npx tsc --noEmit` → all green.
- [ ] **Step 4: README** — replace the stub with: what this is (one paragraph), quickstart (`npm i`, `cp .env.local.example .env.local` + set key, `npm run db:push -- --force && npm run seed`, `npm run dev`), Tailscale note (`npm run dev -- -H 0.0.0.0` to review from iPad), and a pointer to the spec.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: README quickstart; test: live gemini smoke (opt-in)"`

---

## Plan self-review notes

- **Spec coverage:** storage/FS §4→Task 4; schema §5→Task 3; selection §6→Task 5; prompt §7→Task 6; screens §8→Tasks 11–14 (Tokens = M2 stub as spec'd); server §9→Tasks 8–10; errors §10→Tasks 7–8 (sweep in instrumentation.ts, retry in 8/14); testing §11→per-task + Task 15. Payload pin/remove override (§6) deferred to M2 alongside token toggling — both are composer-editing features; noted as a conscious cut, warnings + preview ship in M1.
- **Type consistency:** `EntityWithRefs`/`Pick`/`Role` defined once in `select-refs.ts`; `ModelId`/`Slot` in `models.ts`; all later tasks import from there.
- **Known risk:** exact `@google/genai` config field names + preview model IDs — Task 7 Step 3 verifies against the installed SDK types before proceeding; model IDs live only in `models.ts` if they need adjusting.
