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
