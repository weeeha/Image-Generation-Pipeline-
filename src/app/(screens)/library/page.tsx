import Link from "next/link";
import { entitiesWithRefs } from "@/lib/queries";
import { EntityCreateDialog } from "@/components/entity-create-dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ImageOff } from "lucide-react";

export const dynamic = "force-dynamic";

type EntityType = "character" | "prop" | "setting";

const TYPE_STYLES: Record<EntityType, string> = {
  character: "border-sky-800/40 bg-sky-950/40 text-sky-300",
  prop: "border-amber-800/40 bg-amber-950/40 text-amber-300",
  setting: "border-emerald-800/40 bg-emerald-950/40 text-emerald-300",
};

const MAX_THUMBS = 4;
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
};

function TypeBadge({ type }: { type: EntityType }) {
  return (
    <Badge variant="outline" className={cn("shrink-0 font-normal", TYPE_STYLES[type])}>
      {type}
    </Badge>
  );
}

function ThumbGrid({ refs }: { refs: { imageId: number; priority: number }[] }) {
  if (refs.length === 0) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center bg-muted/30">
        <ImageOff className="size-5 text-muted-foreground/40" />
      </div>
    );
  }

  const top = [...refs].sort((a, b) => a.priority - b.priority).slice(0, MAX_THUMBS);
  const extra = refs.length - top.length;
  const layout = top.length >= 4 ? "grid-cols-2 grid-rows-2" : GRID_COLS[top.length];

  return (
    <div className={cn("grid aspect-[4/3] gap-px bg-border", layout)}>
      {top.map((ref, i) => (
        <div key={ref.imageId} className="relative overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here */}
          <img
            src={`/api/images/${ref.imageId}?thumb=1`}
            alt=""
            className="size-full object-cover"
          />
          {extra > 0 && i === top.length - 1 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs font-medium text-white">
              +{extra}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function LibraryPage() {
  const entities = [...entitiesWithRefs()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-medium text-foreground">Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {entities.length === 0
              ? "Nothing curated yet."
              : `${entities.length} ${entities.length === 1 ? "entity" : "entities"} in this film's canon.`}
          </p>
        </div>
        <EntityCreateDialog />
      </div>

      {entities.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-24 text-center">
          <p className="text-sm text-muted-foreground">
            No characters, props, or settings yet.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create the first one to start building this film&apos;s visual canon.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {entities.map((e) => (
            <Link
              key={e.id}
              href={`/library/${e.slug}`}
              className="group overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 transition-colors hover:ring-foreground/25"
            >
              <ThumbGrid refs={e.refs} />
              <div className="flex items-center justify-between gap-2 p-3 pb-1.5">
                <span className="truncate text-sm font-medium text-foreground">{e.name}</span>
                <TypeBadge type={e.type} />
              </div>
              <div className="px-3 pb-3 text-xs text-muted-foreground">
                {e.refs.length === 0
                  ? "No references yet"
                  : `${e.refs.length} reference${e.refs.length === 1 ? "" : "s"}`}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
