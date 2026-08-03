"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createEntity } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type EntityType = "character" | "prop" | "setting";

const TYPE_OPTIONS: { value: EntityType; label: string }[] = [
  { value: "character", label: "Character" },
  { value: "prop", label: "Prop" },
  { value: "setting", label: "Setting" },
];

const TYPE_LABELS: Record<EntityType, string> = {
  character: "Character",
  prop: "Prop",
  setting: "Setting",
};

export function EntityCreateDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<EntityType>("character");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function reset() {
    setName("");
    setType("character");
    setDescription("");
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        const { slug } = await createEntity({ name: trimmed, type, description });
        setOpen(false);
        reset();
        router.push(`/library/${slug}`);
      } catch (err) {
        // createEntity throws a plain Error('An entity named "X" already exists') on
        // duplicate slugs — surface it as a toast instead of an unhandled rejection.
        toast.error(err instanceof Error ? err.message : "Failed to create entity");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {/* Base UI's DialogTrigger has no `asChild` prop (that's a Radix-only concept) — it
          composes via `render`, which supplies the element/styling while the trigger's own
          children become the rendered content. This mirrors how DialogClose is already
          composed with Button inside ui/dialog.tsx. */}
      <DialogTrigger render={<Button />}>
        <Plus className="size-4" />
        New entity
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New entity</DialogTitle>
          <DialogDescription>
            Add a character, prop, or setting to this film&apos;s canon.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="entity-name">Name</Label>
            <Input
              id="entity-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mara"
              maxLength={80}
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-type">Type</Label>
            {/* Base UI's Select DOES keep Radix's `onValueChange` (unlike Dialog's trigger,
                this one lines up with what shadcn/Radix code usually expects). The value can
                be `null` per its types (single-select still allows a null/no-selection
                state), so the callback narrows before calling setType — no `as` cast needed. */}
            <Select
              value={type}
              onValueChange={(v) => {
                if (v) setType(v);
              }}
            >
              <SelectTrigger id="entity-type" className="w-full">
                {/* Base UI's SelectValue shows the raw `value` by default (unlike Radix,
                    it doesn't mirror the matched SelectItem's children) — a render-function
                    child is needed to show the capitalized label instead of "character". */}
                <SelectValue>{(value: EntityType | null) => (value ? TYPE_LABELS[value] : null)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="entity-description">Description</Label>
            <Textarea
              id="entity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional notes for continuity"
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
