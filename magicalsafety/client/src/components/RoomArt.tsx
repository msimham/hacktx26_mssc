import type { ReactElement } from "react";
// Hand-made SVG fallback art, so the world looks like a place with no generated images.
// TODO(USER): run `npm run gen:assets` after adding META_MODEL_API_KEY to replace these with Muse Image art (Phase 6).
const SHAPES: Record<string, ReactElement> = {
  ballroom: (
    <>
      <ellipse cx="500" cy="520" rx="420" ry="90" fill="#0b1230" opacity=".55" />
      {[200, 500, 800].map((x) => (
        <g key={x}>
          <line x1={x} y1="0" x2={x} y2="90" stroke="#d4af37" strokeWidth="3" />
          <circle cx={x} cy="110" r="26" fill="#f7e08a" opacity=".9" />
          <circle cx={x} cy="110" r="52" fill="#f7e08a" opacity=".15" />
        </g>
      ))}
      {[90, 910].map((x) => <rect key={x} x={x - 40} y="150" width="80" height="260" rx="40" fill="#0b1230" opacity=".5" />)}
    </>
  ),
  dais: (
    <>
      <rect x="0" y="0" width="140" height="600" fill="#7a1f3d" opacity=".75" />
      <rect x="860" y="0" width="140" height="600" fill="#7a1f3d" opacity=".75" />
      <rect x="380" y="240" width="240" height="260" rx="14" fill="#d4af37" opacity=".85" />
      <rect x="410" y="270" width="180" height="150" rx="10" fill="#8a1c3c" />
      <path d="M690 190 q30 60 0 110 q-30 -50 0 -110z" fill="#f7e08a" />
    </>
  ),
  cabinet: (
    <>
      {[140, 260, 380].map((y) => <rect key={y} x="120" y={y} width="760" height="16" fill="#5a3d1c" />)}
      <rect x="430" y="300" width="180" height="110" rx="10" fill="#b2373a" stroke="#f6edd6" strokeWidth="5" />
      <rect x="505" y="330" width="30" height="50" fill="#f6edd6" />
      <rect x="490" y="345" width="60" height="20" fill="#f6edd6" />
    </>
  ),
  courtyard: (
    <>
      <circle cx="170" cy="110" r="60" fill="#f6f1c7" opacity=".9" />
      <path d="M640 520 V260 a110 110 0 0 1 220 0 V520z" fill="#0a1628" opacity=".7" />
      <ellipse cx="300" cy="470" rx="100" ry="70" fill="#e08a2c" />
      <rect x="360" y="440" width="70" height="40" rx="8" fill="#a55a1c" />
    </>
  ),
  staircase: (
    <>
      <path d="M100 560 L100 460 L260 460 L260 380 L420 380 L420 300 L580 300 L580 220 L740 220 L740 560z" fill="#e5def0" opacity=".25" />
      {[260, 420, 580].map((x) => <g key={x}><rect x={x - 6} y="120" width="12" height="150" fill="#d4af37" /><circle cx={x} cy="110" r="18" fill="#f7e08a" /></g>)}
    </>
  ),
};

export function RoomArt({ roomId, gradient }: { roomId: string; gradient: [string, string] }) {
  return (
    <svg viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id={`g-${roomId}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={gradient[0]} />
          <stop offset="1" stopColor={gradient[1]} />
        </linearGradient>
      </defs>
      <rect width="1000" height="600" fill={`url(#g-${roomId})`} />
      {SHAPES[roomId]}
      <rect y="520" width="1000" height="80" fill="#000" opacity=".25" />
    </svg>
  );
}
