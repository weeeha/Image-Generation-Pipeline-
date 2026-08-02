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

// `z.infer<typeof entityIn>` is the schema's *output* type: because `description` has a
// `.default()`, zod guarantees it's always present post-parse, so the output type marks it
// required — which would force every caller to pass `description` explicitly, defeating the
// point of the default. `z.input<typeof entityIn>` is the pre-parse type, where a defaulted
// field stays optional, which is the shape callers should actually be able to pass.
export async function createEntity(input: z.input<typeof entityIn>) {
  const v = entityIn.parse(input);
  const slug = slugify(v.name);

  // entities.slug is UNIQUE; inserting straight through on a collision throws a raw
  // SQLite constraint error. Pre-check and fail with a clear, user-facing message instead.
  // No TOCTOU race here: better-sqlite3 is synchronous and this function awaits nothing
  // between the select and the insert, so no other request can interleave.
  const dup = db.select().from(tables.entities).where(eq(tables.entities.slug, slug)).all()[0];
  if (dup) throw new Error(`An entity named "${v.name}" already exists`);

  const [e] = db.insert(tables.entities).values({ ...v, slug }).returning().all();
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
