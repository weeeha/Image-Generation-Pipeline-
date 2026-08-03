"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadCloud } from "lucide-react";
import { promoteToRef } from "@/app/actions";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const HEIC_TYPES = new Set(["image/heic", "image/heif"]);

function isHeic(file: File): boolean {
  return HEIC_TYPES.has(file.type) || /\.(heic|heif)$/i.test(file.name);
}

interface ImportResponse {
  imageId?: number;
  deduped?: boolean;
  error?: string;
}

export function ImportDropzone({ entityId }: { entityId: number }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const router = useRouter();

  async function importOne(file: File) {
    // HEIC/HEIF is rejected here, before ever hitting the network: sharp on this
    // machine can parse the container but can't decode HEVC pixels, so the server
    // would fail with a cryptic libheif error. iPhone photos default to HEIC.
    if (isHeic(file)) {
      toast.error(`${file.name}: HEIC isn't supported — export as JPEG first.`);
      return;
    }
    if (!ACCEPTED_TYPES.has(file.type)) {
      toast.error(`${file.name}: unsupported file type — use PNG, JPEG, or WebP.`);
      return;
    }

    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/import", { method: "POST", body: fd });
      const json: ImportResponse = await res.json();
      if (!res.ok || !json.imageId) {
        toast.error(`${file.name}: ${json.error ?? "import failed"}`);
        return;
      }
      await promoteToRef({ imageId: json.imageId, entityId, role: "front" });
      toast.success(`${file.name} added as a reference (role: front — adjust below)`);
    } catch {
      toast.error(`${file.name}: import failed`);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    for (const file of Array.from(files)) {
      await importOne(file);
    }
    setImporting(false);
    router.refresh();
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-8 text-center transition-colors",
        dragging ? "border-foreground/40 bg-accent/60" : "hover:border-foreground/25 hover:bg-accent/30",
        importing && "pointer-events-none opacity-60"
      )}
    >
      <UploadCloud className="size-5 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {importing ? "Importing…" : "Drop images here, or click to choose files"}
      </p>
      <p className="text-xs text-muted-foreground/70">
        PNG, JPEG, or WebP — HEIC exports from iPhone aren&apos;t supported yet
      </p>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
