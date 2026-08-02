import Link from "next/link";

// Next's own built-in 404 fallback injects `body { background: #fff }` (verified via a
// live browser check), which breaks the dark shell for any unmatched route or notFound()
// call. Providing this file replaces that fallback and keeps the shell's dark theme intact
// — it's a generic 404, not the Generate/History screens themselves.
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-24 text-center">
      <p className="text-lg font-medium text-foreground">Page not found</p>
      <p className="text-sm text-muted-foreground">This route doesn&apos;t exist yet.</p>
      <Link
        href="/library"
        className="mt-2 text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        Back to Library
      </Link>
    </div>
  );
}
