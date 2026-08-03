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

// --- Task R2: pooled mode (gpt-image-2) ------------------------------------

const extra: EntityWithRefs = {
  id: 5, slug: 'extra', name: 'Extra', type: 'prop',
  refs: [
    ref(41, 'front', 1), ref(42, 'three_quarter', 2), ref(43, 'full_body', 3), ref(44, 'expression', 4),
    ref(45, 'detail', 5), ref(46, 'environment', 6), ref(47, 'front', 7), ref(48, 'detail', 8),
  ], // 8 refs available — strictly between pooled's recommended (5) and cap (16)
};

const bigPropA: EntityWithRefs = {
  id: 6, slug: 'big-a', name: 'BigA', type: 'prop',
  refs: [
    ref(51, 'front', 1), ref(52, 'three_quarter', 2), ref(53, 'full_body', 3), ref(54, 'expression', 4),
    ref(55, 'detail', 5), ref(56, 'environment', 6), ref(57, 'front', 7), ref(58, 'three_quarter', 8),
    ref(59, 'full_body', 9), ref(60, 'expression', 10),
  ], // 10 refs
};
const bigPropB: EntityWithRefs = {
  id: 7, slug: 'big-b', name: 'BigB', type: 'prop',
  refs: [
    ref(71, 'front', 1), ref(72, 'three_quarter', 2), ref(73, 'full_body', 3), ref(74, 'expression', 4),
    ref(75, 'detail', 5), ref(76, 'environment', 6), ref(77, 'front', 7), ref(78, 'three_quarter', 8),
    ref(79, 'full_body', 9), ref(80, 'expression', 10),
  ], // 10 refs
};

describe('selectRefs — pooled mode (gpt-image-2)', () => {
  it('defaults the budget to the recommended value (5), not the cap (16)', () => {
    const { picks } = selectRefs([extra], 'gpt-image-2');
    expect(picks).toHaveLength(5); // extra has 8 refs available — would be 8 if the cap applied instead
  });

  it('honors an explicit budget within the cap', () => {
    const { picks } = selectRefs([extra], 'gpt-image-2', { budget: 7 });
    expect(picks).toHaveLength(7);
  });

  it('clamps a budget above the cap down to 16', () => {
    const { picks } = selectRefs([bigPropA, bigPropB], 'gpt-image-2', { budget: 99 });
    expect(picks).toHaveLength(16); // not 20 (10+10 available), not 99
    expect(picks.filter(p => p.entityId === bigPropA.id)).toHaveLength(8);
    expect(picks.filter(p => p.entityId === bigPropB.id)).toHaveLength(8);
  });

  it('allocates characters before objects regardless of input order', () => {
    const { picks } = selectRefs([lantern, tavern, mara], 'gpt-image-2');
    // mara (character) is last in the input but must be allocated first.
    expect(picks[0].entityId).toBe(mara.id);
    expect(picks[1].entityId).toBe(mara.id);
    expect(picks.filter(p => p.entityId === mara.id)).toHaveLength(2);
    expect(picks.filter(p => p.slot === 'character')).toHaveLength(2);
    expect(picks.filter(p => p.slot === 'object')).toHaveLength(3); // lantern 2 + tavern 1
  });

  it('still spreads roles within an entity in pooled mode', () => {
    const { picks } = selectRefs([lantern, tavern, mara], 'gpt-image-2');
    const maraIds = picks.filter(p => p.entityId === mara.id).map(p => p.imageId);
    expect(maraIds).toEqual([1, 3]); // front, three_quarter — not [1,2] (two fronts)
  });

  it('warns when a character is allocated fewer than 3 refs', () => {
    const { warnings } = selectRefs([lantern, tavern, mara], 'gpt-image-2');
    expect(warnings.some(w => w.includes('Mara') && w.includes('consistency'))).toBe(true);
  });
});
