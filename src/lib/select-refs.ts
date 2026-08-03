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

function slotOf(e: EntityWithRefs): Slot {
  return e.type === 'character' ? 'character' : 'object';
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

// 0 for characters, 1 for everything else — used to stable-sort characters first.
function characterRank(e: EntityWithRefs): number {
  return slotOf(e) === 'character' ? 0 : 1;
}

// Even-split a shared budget across a group (remainder to earlier entities), then
// role-spread within each entity. Shared by both split mode (called once per category,
// with that category's hard cap as the budget) and pooled mode (called once across all
// entities, with the pool's soft recommended/explicit budget).
function allocate(group: EntityWithRefs[], budget: number, picks: Pick[], warnings: string[]): void {
  if (group.length === 0) return;
  const base = Math.floor(budget / group.length);
  const remainder = budget % group.length;

  group.forEach((e, i) => {
    const slot = slotOf(e);
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

export function selectRefs(
  entities: EntityWithRefs[],
  model: ModelId,
  opts?: { budget?: number }
): { picks: Pick[]; warnings: string[] } {
  const refPolicy = MODELS[model].refPolicy;
  const warnings: string[] = [];
  const picks: Pick[] = [];

  // Zero-ref entities are excluded (with a warning) up front, in input order, for both
  // modes — unused allowance is never redistributed to make up for an excluded entity.
  const nonEmpty: EntityWithRefs[] = [];
  for (const e of entities) {
    if (e.refs.length === 0) {
      warnings.push(`${e.name} has no references — it will not be sent. Import or promote refs first.`);
      continue;
    }
    nonEmpty.push(e);
  }

  if (refPolicy.mode === 'split') {
    // Hard per-category caps: characters and objects each get their own independent
    // budget, filled to the last slot.
    const groups: Record<Slot, EntityWithRefs[]> = { character: [], object: [] };
    for (const e of nonEmpty) {
      groups[slotOf(e)].push(e);
    }
    for (const slot of ['character', 'object'] as Slot[]) {
      allocate(groups[slot], refPolicy.caps[slot], picks, warnings);
    }
    return { picks, warnings };
  }

  // Pooled mode: one shared, undifferentiated budget across all entities. Defaults to
  // the soft `recommended` size (curated beats crammed), not the hard `cap` — an
  // explicit budget is still clamped to the cap so callers can never overflow the API
  // limit. Characters go first (stable within each group): identity drift matters more
  // than prop drift, and sorting here removes any ordering burden from callers.
  const budget = clamp(opts?.budget ?? refPolicy.recommended, 0, refPolicy.cap);
  const sorted = [...nonEmpty].sort((a, b) => characterRank(a) - characterRank(b));
  allocate(sorted, budget, picks, warnings);
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
