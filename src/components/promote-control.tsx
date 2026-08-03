"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { promoteToRef } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@/lib/select-refs";

// Duplicated locally rather than imported: no shared export of the role list/label exists
// today (src/lib/select-refs.ts only exports the `Role` type), and both existing consumers
// (src/components/ref-card.tsx, src/components/shot-composer.tsx) already keep their own
// local copies rather than centralizing this — matching that established convention here.
const ROLES: Role[] = ["front", "three_quarter", "full_body", "expression", "detail", "environment"];

function roleLabel(role: Role): string {
  return role.replace(/_/g, " ");
}

export interface PromoteControlEntity {
  id: number;
  name: string;
}

/**
 * Promote-to-reference form for a single output image: pick an entity + role, then
 * canonize this image via the existing `promoteToRef` server action. Mirrors the inline
 * `PromoteForm` in shot-composer.tsx (same action, same two-select-plus-button shape) but
 * lives as its own component here since History's output gallery isn't otherwise a client
 * component boundary shared with the Generate screen.
 */
export function PromoteControl({
  imageId,
  entities,
}: {
  imageId: number;
  entities: PromoteControlEntity[];
}) {
  const [entityId, setEntityId] = useState<number | null>(null);
  const [role, setRole] = useState<Role>("front");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  if (entities.length === 0) return null;

  function submit() {
    if (entityId === null) {
      toast.error("Choose an entity to promote to");
      return;
    }
    startTransition(async () => {
      try {
        await promoteToRef({ imageId, entityId, role });
        toast.success("Promoted to reference");
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to promote");
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
        <SelectTrigger size="sm" className="w-full" aria-label="Promote to entity">
          <SelectValue>
            {(v: number | null) =>
              v !== null ? (entities.find((e) => e.id === v)?.name ?? "Promote to…") : "Promote to…"
            }
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
      <div className="flex items-center gap-1.5">
        <Select
          value={role}
          onValueChange={(v) => {
            if (v) setRole(v);
          }}
          disabled={pending}
        >
          <SelectTrigger size="sm" className="w-28 shrink-0" aria-label="Reference role">
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={submit}
          disabled={pending || entityId === null}
        >
          {pending ? "…" : "Promote"}
        </Button>
      </div>
    </div>
  );
}
