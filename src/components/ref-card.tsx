"use client";

import { useTransition } from "react";
import { ArrowUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { demoteRef, promoteToRef, setRefPriority } from "@/app/actions";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Role } from "@/lib/select-refs";

const ROLES: Role[] = [
  "front",
  "three_quarter",
  "full_body",
  "expression",
  "detail",
  "environment",
];

function roleLabel(role: Role) {
  return role.replace(/_/g, " ");
}

export interface RefRow {
  id: number;
  entityId: number;
  imageId: number;
  role: Role;
  priority: number;
}

export function RefCard({ refRow }: { refRow: RefRow }) {
  const [pending, startTransition] = useTransition();

  function onRoleChange(role: Role) {
    startTransition(async () => {
      try {
        await promoteToRef({ imageId: refRow.imageId, entityId: refRow.entityId, role });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update role");
      }
    });
  }

  function onRaise() {
    startTransition(async () => {
      try {
        await setRefPriority(refRow.id, refRow.priority - 15);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to reorder");
      }
    });
  }

  function onDemote() {
    startTransition(async () => {
      try {
        await demoteRef(refRow.entityId, refRow.imageId);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to remove reference");
      }
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-2">
      <div className="aspect-square overflow-hidden rounded-md bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- local API-served bytes, next/image is unnecessary here */}
        <img
          src={`/api/images/${refRow.imageId}?thumb=1`}
          alt=""
          className="size-full object-cover"
        />
      </div>

      <Select
        value={refRow.role}
        onValueChange={(role) => {
          if (role) onRoleChange(role);
        }}
        disabled={pending}
      >
        <SelectTrigger size="sm" className="w-full text-xs" aria-label="Reference role">
          {/* Base UI's SelectValue shows the raw `value` by default — unlike Radix, it does
              NOT automatically mirror the matched SelectItem's rendered children. A
              render-function child (or the root's `items` prop) is required to show a
              formatted label instead of the raw enum string. */}
          <SelectValue>{(value: Role | null) => (value ? roleLabel(value) : null)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((role) => (
            <SelectItem key={role} value={role} className="text-xs">
              {roleLabel(role)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center justify-between gap-1.5">
        <div className="flex gap-1">
          <Button
            size="icon-xs"
            variant="outline"
            disabled={pending}
            onClick={onRaise}
            title="Raise priority"
            aria-label="Raise priority"
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-xs"
            variant="outline"
            disabled={pending}
            onClick={onDemote}
            title="Remove from canon"
            aria-label="Remove from canon"
            className="text-destructive hover:bg-destructive/10"
          >
            <Trash2 />
          </Button>
        </div>
        <span className="text-[0.65rem] text-muted-foreground/70">
          priority {refRow.priority}
        </span>
      </div>
    </div>
  );
}
