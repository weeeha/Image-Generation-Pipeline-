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
