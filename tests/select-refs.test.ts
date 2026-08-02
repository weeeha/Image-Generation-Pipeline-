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
