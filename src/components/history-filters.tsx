"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FilterEntity {
  id: number;
  name: string;
  type: "character" | "prop" | "setting";
}

export interface FilterModel {
  id: string;
  label: string;
}

export interface HistoryFiltersValue {
  entity?: string; // entity id, as a string (matches the URL search param)
  model?: string;
  status?: string;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
];

const TYPE_LABELS: Record<FilterEntity["type"], string> = {
  character: "Characters",
  prop: "Props",
  setting: "Settings",
};

const TYPE_ORDER: FilterEntity["type"][] = ["character", "prop", "setting"];

// Filters are plain <Select>s that rewrite the URL and let the server component
// (src/app/(screens)/history/page.tsx) re-read and re-query from scratch — no client
// state duplicates what's already the source of truth in the URL, so a refresh always
// reflects exactly what's showing.
export function HistoryFilters({
  entities,
  models,
  current,
}: {
  entities: FilterEntity[];
  models: FilterModel[];
  current: HistoryFiltersValue;
}) {
  const router = useRouter();

  function apply(next: HistoryFiltersValue) {
    const params = new URLSearchParams();
    if (next.entity) params.set("entity", next.entity);
    if (next.model) params.set("model", next.model);
    if (next.status) params.set("status", next.status);
    const qs = params.toString();
    router.replace(qs ? `/history?${qs}` : "/history");
  }

  const groupedEntities = TYPE_ORDER.map((type) => ({
    type,
    items: entities.filter((e) => e.type === type),
  })).filter((g) => g.items.length > 0);

  const hasActiveFilter = Boolean(current.entity || current.model || current.status);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={current.entity ?? "all"}
        onValueChange={(v) => {
          if (v) apply({ ...current, entity: v === "all" ? undefined : v });
        }}
      >
        <SelectTrigger size="sm" className="w-40" aria-label="Filter by entity">
          {/* Base UI's SelectValue shows the raw `value`, not the matched item's children —
              a render-function child maps the id/sentinel back to a readable label. */}
          <SelectValue>
            {(v: string | null) => {
              if (!v || v === "all") return "All entities";
              return entities.find((e) => String(e.id) === v)?.name ?? "All entities";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All entities</SelectItem>
          {groupedEntities.map(({ type, items }) => (
            <SelectGroup key={type}>
              <SelectLabel>{TYPE_LABELS[type]}</SelectLabel>
              {items.map((e) => (
                <SelectItem key={e.id} value={String(e.id)}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={current.model ?? "all"}
        onValueChange={(v) => {
          if (v) apply({ ...current, model: v === "all" ? undefined : v });
        }}
      >
        <SelectTrigger size="sm" className="w-52" aria-label="Filter by model">
          <SelectValue>
            {(v: string | null) => {
              if (!v || v === "all") return "All models";
              return models.find((m) => m.id === v)?.label ?? "All models";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All models</SelectItem>
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={current.status ?? "all"}
        onValueChange={(v) => {
          if (v) apply({ ...current, status: v === "all" ? undefined : v });
        }}
      >
        <SelectTrigger size="sm" className="w-36" aria-label="Filter by status">
          <SelectValue>
            {(v: string | null) => {
              if (!v || v === "all") return "All statuses";
              return STATUS_OPTIONS.find((s) => s.value === v)?.label ?? "All statuses";
            }}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUS_OPTIONS.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => apply({})}
          className="text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
