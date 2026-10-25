/** Pulsing placeholders shown while data loads, so the page doesn't jump or look broken. */
export function Bar({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${w} ${h} animate-pulse rounded bg-white/10 motion-reduce:animate-none`} aria-hidden="true" />;
}

export function Card({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2 rounded-xl bg-night-2 p-4" aria-hidden="true">
      <Bar w="w-1/3" h="h-5" />
      {Array.from({ length: lines }, (_, i) => <Bar key={i} w={i === lines - 1 ? "w-2/3" : "w-full"} />)}
    </div>
  );
}

export function PageSkeleton({ label = "Loading…", cards = 3 }: { label?: string; cards?: number }) {
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6" role="status" aria-live="polite" aria-label={label}>
      <Bar w="w-1/2" h="h-8" />
      {Array.from({ length: cards }, (_, i) => <Card key={i} />)}
      <span className="sr-only">{label}</span>
    </main>
  );
}

export function GameSkeleton() {
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[260px_minmax(0,1fr)_320px]" role="status" aria-live="polite" aria-label="Loading the game">
      <Card lines={5} />
      <div className="aspect-[16/9] animate-pulse rounded-xl bg-white/10 motion-reduce:animate-none" aria-hidden="true" />
      <Card lines={6} />
      <span className="sr-only">Loading the game</span>
    </div>
  );
}
