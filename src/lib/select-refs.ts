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
  // TODO(Task R2): this function only implements the legacy per-category "split" caps
  // (Gemini). Pooled allocation (GPT Image 2 — one undifferentiated pool, deliberately
  // under-filled) is a follow-up task; it will need a different selection strategy
  // entirely, not just a different cap lookup.
  const refPolicy = MODELS[model].refPolicy;
  if (refPolicy.mode !== 'split') {
    throw new Error('pooled reference policy not implemented yet');
  }
  const caps = refPolicy.caps;
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
