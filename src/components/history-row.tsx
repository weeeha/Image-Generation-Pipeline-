"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronDown,
  TriangleAlert,
  Loader2,
  ImageOff,
  Copy,
  Check,
  ExternalLink,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RetryButton } from "@/components/retry-button";
import { PromoteControl, type PromoteControlEntity } from "@/components/promote-control";

export interface HistoryOutput {
  id: number;
  width: number;
  height: number;
}

export interface HistoryRefGroup {
  entityId: number | null;
  entityName: string;
  slot: "character" | "object";
  imageIds: number[];
}

export interface HistoryToken {
  tokenId: number;
  name: string;
  value: string;
}

export interface HistoryEntry {
  id: number;
  status: "pending" | "done" | "failed";
  promptUser: string;
  promptFinal: string;
  modelLabel: string;
  providerLabel: string;
  quality: string | null;
  aspectRatio: string;
  resolution: string;
  durationLabel: string | null;
  error: string | null;
  createdAtRelative: string;
  createdAtAbsolute: string;
  outputs: HistoryOutput[];
  referenceGroups: HistoryRefGroup[];
  tokens: HistoryToken[];
}

const STATUS_STYLES: Record<HistoryEntry["status"], string> = {
  pending: "border-amber-800/40 bg-amber-950/40 text-amber-300",
  done: "border-emerald-800/40 bg-emerald-950/40 text-emerald-300",
  failed: "border-red-900/40 bg-red-950/40 text-red-300",
};

const SLOT_LABELS: Record<HistoryRefGroup["slot"], string> = {
  character: "Character",
  object: "Object",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function ThumbStack({ outputs }: { outputs: HistoryOutput[] }) {
  if (outputs.length === 0) {
    return (
      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-muted/40">
        <ImageOff className="size-4 text-muted-foreground/40" />
      </div>
    );
  }
  const shown = outputs.slice(0, 2);
  const extra = outputs.length - shown.length;
  return (
    <div className="flex shrink-0 -space-x-2">
      {shown.map((o, i) => (
        <div
          key={o.id}
          className="relative size-11 overflow-hidden rounded-md bg-muted ring-2 ring-card"
          style={{ zIndex: shown.length - i }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here */}
          <img src={`/api/images/${o.id}?thumb=1`} alt="" className="size-full object-cover" />
          {extra > 0 && i === shown.length - 1 && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-[0.65rem] font-medium text-white">
              +{extra}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy — select and copy the text manually");
        }
      }}
      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function HistoryRow({
  entry,
  entities,
}: {
  entry: HistoryEntry;
  entities: PromoteControlEntity[];
}) {
  const [expanded, setExpanded] = useState(false);

  const summary = [entry.modelLabel, entry.aspectRatio, entry.resolution, entry.quality ?? undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-accent/40"
      >
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
            STATUS_STYLES[entry.status]
          )}
        >
          {entry.status}
        </span>
        <ThumbStack outputs={entry.outputs} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-foreground">{truncate(entry.promptUser, 110)}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            #{entry.id} · {summary} · {entry.createdAtRelative}
          </p>
        </div>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-5 border-t border-border p-4">
          <section>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Output{entry.outputs.length === 1 ? "" : "s"}
            </h3>
            {entry.status === "pending" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Still generating…
              </p>
            ) : entry.outputs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No output image.</p>
            ) : (
              <div className="flex flex-wrap gap-4">
                {entry.outputs.map((o) => (
                  <div key={o.id} className="w-full max-w-xs space-y-1.5 sm:w-56">
                    <a
                      href={`/api/images/${o.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-lg bg-black/20 ring-1 ring-foreground/10 transition-opacity hover:opacity-90"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here */}
                      <img
                        src={`/api/images/${o.id}?thumb=1`}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                    </a>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {o.width}×{o.height}
                      </span>
                      <a
                        href={`/api/images/${o.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
                      >
                        Full size <ExternalLink className="size-3" />
                      </a>
                    </div>
                    <PromoteControl imageId={o.id} entities={entities} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {entry.status === "failed" && (
            <section className="space-y-2 rounded-lg border border-red-900/40 bg-red-950/20 p-3">
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
                <p className="text-xs break-words text-red-300/80">{entry.error ?? "Unknown error"}</p>
              </div>
              <RetryButton generationId={entry.id} />
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Reference images sent
            </h3>
            {entry.referenceGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reference images — text-only generation.</p>
            ) : (
              <div className="space-y-3">
                {entry.referenceGroups.map((g) => (
                  <div key={`${g.entityId}-${g.slot}`}>
                    <div className="mb-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{g.entityName}</span> ·{" "}
                      {SLOT_LABELS[g.slot]} · {g.imageIds.length}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.imageIds.map((imageId, i) => (
                        <a
                          key={`${imageId}-${i}`}
                          href={`/api/images/${imageId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here */}
                          <img
                            src={`/api/images/${imageId}?thumb=1`}
                            alt=""
                            className="size-12 rounded-md object-cover ring-1 ring-foreground/10 transition-opacity hover:opacity-80"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Final prompt
              </h3>
              <CopyButton text={entry.promptFinal} />
            </div>
            <pre className="m-0 max-h-72 overflow-y-auto rounded-lg bg-black/30 p-3 font-mono text-xs whitespace-pre-wrap break-words text-foreground/90 ring-1 ring-foreground/10 select-text">
              {entry.promptFinal}
            </pre>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Style tokens in force
            </h3>
            {entry.tokens.length === 0 ? (
              <p className="text-sm text-muted-foreground">No style tokens recorded for this generation.</p>
            ) : (
              <div className="space-y-2">
                {entry.tokens.map((t) => (
                  <div key={t.tokenId} className="rounded-lg border border-border p-2.5">
                    <p className="text-xs font-medium text-foreground">{t.name}</p>
                    <p className="mt-0.5 text-xs break-words text-muted-foreground">{t.value}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{entry.providerLabel}</span>
              <span>{entry.modelLabel}</span>
              <span>{entry.aspectRatio}</span>
              <span>{entry.resolution}</span>
              {entry.quality && <span>{entry.quality}</span>}
              {entry.durationLabel && <span>{entry.durationLabel}</span>}
              <span>{entry.createdAtAbsolute}</span>
            </div>
            <Link
              href={`/generate?from=${entry.id}`}
              className="inline-flex items-center gap-1.5 text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <Wand2 className="size-3.5" />
              Use as starting point
            </Link>
          </section>
        </div>
      )}
    </div>
  );
}
