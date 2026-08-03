"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RetryResponse {
  id?: number;
  error?: string;
}

export function RetryButton({ generationId }: { generationId: number }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function retry() {
    setPending(true);
    try {
      const res = await fetch(`/api/generations/${generationId}`, { method: "POST" });
      const json: RetryResponse = await res.json();
      if (!res.ok || typeof json.id !== "number") {
        toast.error(json.error ?? "Retry failed");
        return;
      }
      toast.success("Retry started — it will appear at the top of the list");
      router.refresh();
    } catch {
      toast.error("Retry failed — check the server is reachable");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={() => void retry()} disabled={pending}>
      <RotateCcw />
      {pending ? "Retrying…" : "Retry"}
    </Button>
  );
}
