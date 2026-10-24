export function MockBadge({ label = "MOCK" }: { label?: string }) {
  return (
    <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300">
      {label}
    </span>
  );
}
