import { Loader2 } from 'lucide-react';

/** Loading and error states shared by the YALLA pages. */
export function YallaStatus({ loading, error, what }: { loading: boolean; error: string | null; what: string }) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading {what}…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Could not load {what}. {error}
      </div>
    );
  }
  return null;
}
