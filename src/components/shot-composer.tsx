'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, TriangleAlert, Plus, Minus, Wand2, Download, RotateCcw } from 'lucide-react';
import { selectRefs, type EntityWithRefs, type Role } from '@/lib/select-refs';
import { MODELS, DEFAULT_MODEL, type ModelId, type Provider, type RefPolicy } from '@/lib/models';
import { promoteToRef } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type ModelAvailability = Record<ModelId, { available: boolean; reason?: string }>;
type EntityType = EntityWithRefs['type'];

interface TokenView {
  id: number;
  name: string;
  value: string;
}

interface ShotComposerProps {
  entities: EntityWithRefs[];
  tokens: TokenView[];
  availability: ModelAvailability;
}

type GenStatus = 'pending' | 'done' | 'failed';
interface GenOutput {
  id: number;
  width: number;
  height: number;
}
interface TrackedGeneration {
  id: number;
  status: GenStatus;
  error?: string;
  outputs: GenOutput[];
  model: ModelId;
  scene: string;
  entityNames: string[];
  aspectRatio: string;
  resolution: string;
}
interface GenerateApiResponse {
  id?: number;
  error?: string;
}
interface GenerationPollResult {
  status: GenStatus;
  error?: string | null;
  outputs: GenOutput[];
}

const ROLES: Role[] = ['front', 'three_quarter', 'full_body', 'expression', 'detail', 'environment'];
const roleLabel = (role: Role) => role.replace(/_/g, ' ');

const TYPE_META: Record<EntityType, { label: string; dot: string }> = {
  character: { label: 'Characters', dot: 'bg-sky-400' },
  prop: { label: 'Props', dot: 'bg-amber-400' },
  setting: { label: 'Settings', dot: 'bg-emerald-400' },
};

const PROVIDER_LABELS: Record<Provider, string> = { google: 'Google', openai: 'OpenAI' };
const PROVIDER_ORDER: Provider[] = ['google', 'openai'];
const MODELS_BY_PROVIDER = PROVIDER_ORDER.map((provider) => ({
  provider,
  models: Object.values(MODELS).filter((m) => m.provider === provider),
})).filter((g) => g.models.length > 0);

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function refCountClass(e: EntityWithRefs): string {
  if (e.refs.length === 0) return 'text-amber-500';
  if (e.type === 'character' && e.refs.length < 3) return 'text-amber-500/80';
  return 'text-muted-foreground/70';
}

export function ShotComposer({ entities, tokens, availability }: ShotComposerProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const [scene, setScene] = useState('');
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL);
  const [aspect, setAspect] = useState('16:9');
  const [resolution, setResolution] = useState('1K');
  const [quality, setQuality] = useState<string | undefined>(undefined);
  const [budget, setBudget] = useState(5); // only meaningful once a pooled model is active
  const [submitting, setSubmitting] = useState(false);
  const [retrying, setRetrying] = useState<number | null>(null);
  const [gens, setGens] = useState<TrackedGeneration[]>([]);

  const info = MODELS[model];
  const refPolicy = info.refPolicy;

  // Selecting a model must clamp aspect/resolution/quality/budget to values it actually
  // supports. Rather than syncing that back into state via an effect (an extra render pass,
  // and the classic "you might not need an effect" derived-state trap), the clamped value
  // used for display and submission is simply derived at render time from whatever the user
  // last picked — falling back to the new model's first/default option when the stored pick
  // isn't one of its options. The raw setters below are never touched by model changes, so a
  // choice that happens to still be valid (e.g. aspect ratio, identical across all models
  // today) is naturally remembered across switches instead of being reset.
  const effectiveAspect = info.aspectRatios.includes(aspect) ? aspect : info.aspectRatios[0];
  const effectiveResolution = info.resolutions.includes(resolution) ? resolution : info.resolutions[0];
  const effectiveQuality = info.qualities
    ? quality && info.qualities.includes(quality)
      ? quality
      : (info.defaultQuality ?? info.qualities[0])
    : undefined;
  const effectiveBudget = refPolicy.mode === 'pooled' ? Math.min(Math.max(budget, 1), refPolicy.cap) : budget;

  const grouped = useMemo(() => {
    const g: Record<EntityType, EntityWithRefs[]> = { character: [], prop: [], setting: [] };
    for (const e of entities) g[e.type].push(e);
    return g;
  }, [entities]);

  const chosen = useMemo(() => entities.filter((e) => selected.includes(e.id)), [entities, selected]);

  const { picks, warnings } = useMemo(
    () => selectRefs(chosen, model, { budget: effectiveBudget }),
    [chosen, model, effectiveBudget]
  );

  const used = useMemo(
    () => ({
      character: picks.filter((p) => p.slot === 'character').length,
      object: picks.filter((p) => p.slot === 'object').length,
      total: picks.length,
    }),
    [picks]
  );

  // Entities the caller selected and that DO have references, but that still received zero
  // picks — selectRefs only warns about this for characters below 3 refs; this covers the
  // general case (e.g. a prop squeezed out by too many props competing for a small cap) so
  // the preview never silently drops something without explanation.
  const crowdedOut = useMemo(() => {
    const pickedIds = new Set(picks.map((p) => p.entityId));
    return chosen.filter((e) => e.refs.length > 0 && !pickedIds.has(e.id));
  }, [chosen, picks]);

  function toggleEntity(id: number) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function generate() {
    const trimmedScene = scene.trim();
    if (!trimmedScene) return;
    const avail = availability[model];
    if (!avail.available) {
      toast.error(avail.reason ?? `${info.label} is unavailable`);
      return;
    }
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        entityIds: selected,
        scene: trimmedScene,
        model,
        aspectRatio: effectiveAspect,
        resolution: effectiveResolution,
      };
      if (info.qualities) body.quality = effectiveQuality;
      if (refPolicy.mode === 'pooled') body.budget = effectiveBudget;

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json: GenerateApiResponse = await res.json();
      if (!res.ok || typeof json.id !== 'number') {
        toast.error(json.error ?? 'Failed to start generation');
        return;
      }
      const newId = json.id;
      setGens((cur) => [
        {
          id: newId,
          status: 'pending',
          outputs: [],
          model,
          scene: trimmedScene,
          entityNames: chosen.map((e) => e.name),
          aspectRatio: effectiveAspect,
          resolution: effectiveResolution,
        },
        ...cur,
      ]);
    } catch {
      toast.error('Failed to reach the server — is it running?');
    } finally {
      setSubmitting(false);
    }
  }

  async function retry(oldId: number) {
    setRetrying(oldId);
    try {
      const res = await fetch(`/api/generations/${oldId}`, { method: 'POST' });
      const json: GenerateApiResponse = await res.json();
      if (!res.ok || typeof json.id !== 'number') {
        toast.error(json.error ?? 'Retry failed');
        return;
      }
      const freshId = json.id;
      setGens((cur) =>
        cur.map((g) => (g.id === oldId ? { ...g, id: freshId, status: 'pending', error: undefined, outputs: [] } : g))
      );
    } catch {
      toast.error('Retry failed — check the server is reachable');
    } finally {
      setRetrying(null);
    }
  }

  // Poll every ~1.5s while anything is pending; stop as soon as nothing is. Re-keying on
  // `gens` means a status flip (or a new submission) naturally restarts the interval with
  // the current pending set, and the cleanup covers both re-runs and unmount.
  useEffect(() => {
    const pendingIds = gens.filter((g) => g.status === 'pending').map((g) => g.id);
    if (pendingIds.length === 0) return;
    const interval = setInterval(() => {
      for (const id of pendingIds) {
        fetch(`/api/generations/${id}`)
          .then(async (res) => {
            if (!res.ok) return;
            const json: GenerationPollResult = await res.json();
            if (json.status === 'pending') return;
            setGens((cur) =>
              cur.map((g) =>
                g.id === id ? { ...g, status: json.status, error: json.error ?? undefined, outputs: json.outputs } : g
              )
            );
          })
          .catch(() => {
            // transient network hiccup — the next tick will try again
          });
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [gens]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-medium text-foreground">Generate</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compose a shot from your canon, preview exactly what will be sent, then generate.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[400px_1fr]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-medium text-foreground">Entities</h2>
            {entities.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No entities yet.{' '}
                <Link href="/library" className="underline underline-offset-4 hover:text-foreground">
                  Create one in Library
                </Link>{' '}
                to start composing a shot.
              </div>
            ) : (
              <div className="space-y-3">
                {(['character', 'prop', 'setting'] as EntityType[]).map((type) => {
                  const list = grouped[type];
                  if (list.length === 0) return null;
                  const meta = TYPE_META[type];
                  return (
                    <div key={type}>
                      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <span className={cn('size-1.5 rounded-full', meta.dot)} />
                        {meta.label}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {list.map((e) => {
                          const isSelected = selected.includes(e.id);
                          return (
                            <button
                              key={e.id}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => toggleEntity(e.id)}
                              className={cn(
                                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                                isSelected
                                  ? 'border-foreground/30 bg-accent text-foreground'
                                  : 'border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                              )}
                            >
                              {e.name}
                              <span className={cn('tabular-nums text-xs', refCountClass(e))}>{e.refs.length}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium text-foreground">Style tokens</h2>
            {tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground">No default style tokens configured.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {tokens.map((t) => (
                  <Badge key={t.id} variant="secondary" className="font-normal">
                    {t.name}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground/70">
              Per-shot token control arrives in M2 — every generation currently uses these defaults.
            </p>
          </section>

          <section className="space-y-1.5">
            <Label htmlFor="scene">Scene</Label>
            <Textarea
              id="scene"
              rows={4}
              maxLength={4000}
              placeholder="Mara lifts the lantern in the tavern doorway at night…"
              value={scene}
              onChange={(e) => setScene(e.target.value)}
            />
          </section>

          <section className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="model-select">Model</Label>
              <Select
                value={model}
                onValueChange={(v) => {
                  if (v) setModel(v);
                }}
              >
                <SelectTrigger id="model-select" className="w-full">
                  <SelectValue>{(v: ModelId | null) => (v ? MODELS[v].label : null)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MODELS_BY_PROVIDER.map(({ provider, models }) => (
                    <SelectGroup key={provider}>
                      <SelectLabel>{PROVIDER_LABELS[provider]}</SelectLabel>
                      {models.map((m) => {
                        const avail = availability[m.id];
                        return (
                          <SelectItem key={m.id} value={m.id} disabled={!avail.available}>
                            <span className="flex flex-col py-0.5 pr-1">
                              <span>{m.label}</span>
                              {!avail.available && (
                                <span className="text-[0.7rem] leading-tight text-muted-foreground">
                                  {avail.reason}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="aspect-select">Aspect ratio</Label>
                <Select
                  value={effectiveAspect}
                  onValueChange={(v) => {
                    if (v) setAspect(v);
                  }}
                >
                  <SelectTrigger id="aspect-select" className="w-full">
                    <SelectValue>{(v: string | null) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {info.aspectRatios.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="resolution-select">Resolution</Label>
                <Select
                  value={effectiveResolution}
                  onValueChange={(v) => {
                    if (v) setResolution(v);
                  }}
                >
                  <SelectTrigger id="resolution-select" className="w-full">
                    <SelectValue>{(v: string | null) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {info.resolutions.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {info.qualities && (
              <div className="space-y-1.5">
                <Label htmlFor="quality-select">Quality</Label>
                <Select
                  value={effectiveQuality}
                  onValueChange={(v) => {
                    if (v) setQuality(v);
                  }}
                >
                  <SelectTrigger id="quality-select" className="w-full">
                    <SelectValue>{(v: string | null) => v}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {info.qualities.map((q) => (
                      <SelectItem key={q} value={q}>
                        {q}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Price scales roughly 35× from low to high — <span className="font-medium">auto</span> lets the
                  model choose.
                </p>
              </div>
            )}

            {refPolicy.mode === 'pooled' && (
              <BudgetControl
                budget={effectiveBudget}
                cap={refPolicy.cap}
                recommended={refPolicy.recommended}
                onChange={setBudget}
              />
            )}
          </section>

          <PayloadPreview
            chosen={chosen}
            picks={picks}
            warnings={warnings}
            crowdedOut={crowdedOut}
            refPolicy={refPolicy}
            used={used}
          />

          <div className="space-y-2">
            <Button
              type="button"
              className="w-full"
              size="lg"
              onClick={() => void generate()}
              disabled={!scene.trim() || submitting || !availability[model]?.available}
            >
              <Wand2 />
              {submitting ? 'Starting…' : 'Generate'}
            </Button>
            {!availability[model]?.available && (
              <p className="text-xs text-amber-400">
                {info.label} is unavailable — {availability[model]?.reason}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {gens.length === 0 ? (
            <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              <Wand2 className="mb-2 size-5 text-muted-foreground/50" />
              Results will appear here as they generate.
            </div>
          ) : (
            gens.map((g) => (
              <GenerationCard key={g.id} gen={g} entities={entities} onRetry={retry} retrying={retrying} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function BudgetControl({
  budget,
  cap,
  recommended,
  onChange,
}: {
  budget: number;
  cap: number;
  recommended: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm">Reference budget</Label>
        <span className="text-xs text-muted-foreground">
          {budget} of {cap} · {recommended} recommended
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Decrease reference budget"
          disabled={budget <= 1}
          onClick={() => onChange(Math.max(1, budget - 1))}
        >
          <Minus />
        </Button>
        <div className="flex-1 rounded-md bg-muted/40 py-1 text-center text-sm tabular-nums">{budget}</div>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          aria-label="Increase reference budget"
          disabled={budget >= cap}
          onClick={() => onChange(Math.min(cap, budget + 1))}
        >
          <Plus />
        </Button>
        {budget !== recommended && (
          <Button type="button" size="xs" variant="ghost" onClick={() => onChange(recommended)}>
            Reset to {recommended}
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        More references dilute each one&apos;s influence — {recommended} curated beats a full pool of {cap}.
      </p>
    </div>
  );
}

function Meter({
  label,
  used,
  cap,
  recommended,
}: {
  label: string;
  used: number;
  cap: number;
  recommended?: number;
}) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
  const overRecommended = recommended !== undefined && used > recommended;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('tabular-nums font-medium', overRecommended ? 'text-amber-400' : 'text-foreground')}>
          {used}/{cap}
          {recommended !== undefined && (
            <span className="ml-1.5 font-normal text-muted-foreground">· {recommended} recommended</span>
          )}
        </span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', overRecommended ? 'bg-amber-500/70' : 'bg-foreground/60')}
          style={{ width: `${pct}%` }}
        />
        {recommended !== undefined && cap > 0 && (
          <div
            className="absolute top-0 h-full w-px bg-foreground/50"
            style={{ left: `${Math.min(100, (recommended / cap) * 100)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function PayloadPreview({
  chosen,
  picks,
  warnings,
  crowdedOut,
  refPolicy,
  used,
}: {
  chosen: EntityWithRefs[];
  picks: { imageId: number; entityId: number; slot: 'character' | 'object' }[];
  warnings: string[];
  crowdedOut: EntityWithRefs[];
  refPolicy: RefPolicy;
  used: { character: number; object: number; total: number };
}) {
  const allWarnings = [
    ...warnings,
    ...crowdedOut.map(
      (e) => `${e.name} didn't get a reference slot this shot — too many entities competing for the budget.`
    ),
  ];

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-foreground">Payload preview</h2>
        <span className="text-xs text-muted-foreground">
          {used.total} reference{used.total === 1 ? '' : 's'}
        </span>
      </div>

      {refPolicy.mode === 'split' ? (
        <div className="space-y-2">
          <Meter label="Character" used={used.character} cap={refPolicy.caps.character} />
          <Meter label="Object" used={used.object} cap={refPolicy.caps.object} />
        </div>
      ) : (
        <Meter label="References" used={used.total} cap={refPolicy.cap} recommended={refPolicy.recommended} />
      )}

      {chosen.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No entities selected — this generation will be text-only.
        </p>
      ) : picks.length === 0 ? (
        <p className="text-xs text-amber-400">
          Selected entities have no usable references — this generation will be text-only.
        </p>
      ) : (
        <div className="space-y-3">
          {chosen.map((e) => {
            const ps = picks.filter((p) => p.entityId === e.id);
            if (ps.length === 0) return null;
            return (
              <div key={e.id}>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  {e.name} · {ps.length}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {ps.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here
                    <img
                      key={p.imageId}
                      src={`/api/images/${p.imageId}?thumb=1`}
                      alt=""
                      className="size-12 rounded-md object-cover ring-1 ring-foreground/10"
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {allWarnings.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          {allWarnings.map((w) => (
            <div key={w} className="flex items-start gap-1.5 text-xs text-amber-400">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function GenerationCard({
  gen,
  entities,
  onRetry,
  retrying,
}: {
  gen: TrackedGeneration;
  entities: EntityWithRefs[];
  onRetry: (id: number) => void;
  retrying: number | null;
}) {
  const summary = `${MODELS[gen.model].label} · ${gen.aspectRatio} · ${gen.resolution}${
    gen.entityNames.length ? ` · ${gen.entityNames.join(', ')}` : ''
  }`;

  if (gen.status === 'pending') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-4">
        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm text-foreground">Generating — {truncate(gen.scene, 90)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{summary} · usually about 10 seconds</p>
        </div>
      </div>
    );
  }

  if (gen.status === 'failed') {
    return (
      <div className="space-y-3 rounded-xl border border-red-900/40 bg-red-950/20 p-4">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-300">Generation failed</p>
            <p className="mt-0.5 text-xs break-words text-red-300/80">{gen.error}</p>
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onRetry(gen.id)}
          disabled={retrying === gen.id}
        >
          <RotateCcw />
          {retrying === gen.id ? 'Retrying…' : 'Retry'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <p className="text-xs text-muted-foreground">{summary}</p>
        <p className="text-sm text-foreground">{gen.scene}</p>
      </div>
      <div className="space-y-4">
        {gen.outputs.map((o) => (
          <div key={o.id} className="space-y-2">
            <div className="overflow-hidden rounded-lg bg-black/20 ring-1 ring-foreground/10">
              {/* eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here */}
              <img src={`/api/images/${o.id}`} alt="" className="max-h-[65vh] w-full object-contain" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <PromoteForm imageId={o.id} entities={entities} />
              <a
                href={`/api/images/${o.id}`}
                download
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
              >
                <Download className="size-3.5" />
                Download
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PromoteForm({ imageId, entities }: { imageId: number; entities: EntityWithRefs[] }) {
  const [entityId, setEntityId] = useState<number | null>(null);
  const [role, setRole] = useState<Role>('front');
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (entities.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        <Link href="/library" className="underline underline-offset-4 hover:text-foreground">
          Create an entity
        </Link>{' '}
        to promote this image to a reference.
      </p>
    );
  }

  function submit() {
    if (entityId === null) {
      toast.error('Choose an entity to promote to');
      return;
    }
    startTransition(async () => {
      try {
        await promoteToRef({ imageId, entityId, role });
        toast.success('Promoted to reference');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to promote');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Select
        value={entityId}
        onValueChange={(v) => {
          if (v !== null) setEntityId(v);
        }}
        disabled={pending}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Promote to entity">
          <SelectValue>
            {(v: number | null) => (v !== null ? (entities.find((e) => e.id === v)?.name ?? 'Promote to…') : 'Promote to…')}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {entities.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={role}
        onValueChange={(v) => {
          if (v) setRole(v);
        }}
        disabled={pending}
      >
        <SelectTrigger size="sm" className="w-32" aria-label="Reference role">
          <SelectValue>{(v: Role | null) => (v ? roleLabel(v) : null)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r} value={r} className="text-xs">
              {roleLabel(r)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" variant="outline" onClick={submit} disabled={pending || entityId === null}>
        {pending ? 'Promoting…' : 'Promote'}
      </Button>
    </div>
  );
}
