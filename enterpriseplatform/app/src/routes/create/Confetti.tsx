const PIECES = ["🎉", "✨", "🎊", "⭐", "💜", "🧡", "💚", "💙"];

export function Confetti() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 flex justify-around">
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="animate-confetti text-3xl"
          style={{ "--dy": `${280 + (i % 3) * 120}px`, "--dx": `${(i % 2 ? 1 : -1) * 30}px`, animationDelay: `${i * 90}ms` } as React.CSSProperties}
        >
          {p}
        </span>
      ))}
    </div>
  );
}
