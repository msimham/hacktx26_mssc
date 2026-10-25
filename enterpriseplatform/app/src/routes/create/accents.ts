export interface Accent {
  readonly chip: string;
  readonly field: string;
  readonly text: string;
  readonly card: string;
  readonly bar: string;
  readonly badge: string;
}

/** Full class strings so Tailwind can see them at build time. */
export const ACCENTS: readonly Accent[] = [
  {
    chip: "border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-400 hover:bg-violet-100",
    field: "focus:border-violet-500 focus:ring-violet-500/30",
    text: "text-violet-600",
    card: "border-l-violet-500",
    bar: "from-violet-500 to-fuchsia-500",
    badge: "bg-violet-100 text-violet-700",
  },
  {
    chip: "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400 hover:bg-rose-100",
    field: "focus:border-rose-500 focus:ring-rose-500/30",
    text: "text-rose-600",
    card: "border-l-rose-500",
    bar: "from-rose-500 to-orange-400",
    badge: "bg-rose-100 text-rose-700",
  },
  {
    chip: "border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400 hover:bg-amber-100",
    field: "focus:border-amber-500 focus:ring-amber-500/30",
    text: "text-amber-600",
    card: "border-l-amber-500",
    bar: "from-amber-400 to-orange-500",
    badge: "bg-amber-100 text-amber-800",
  },
  {
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400 hover:bg-emerald-100",
    field: "focus:border-emerald-500 focus:ring-emerald-500/30",
    text: "text-emerald-600",
    card: "border-l-emerald-500",
    bar: "from-emerald-500 to-teal-400",
    badge: "bg-emerald-100 text-emerald-700",
  },
  {
    chip: "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-400 hover:bg-sky-100",
    field: "focus:border-sky-500 focus:ring-sky-500/30",
    text: "text-sky-600",
    card: "border-l-sky-500",
    bar: "from-sky-500 to-indigo-500",
    badge: "bg-sky-100 text-sky-700",
  },
  {
    chip: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 hover:border-fuchsia-400 hover:bg-fuchsia-100",
    field: "focus:border-fuchsia-500 focus:ring-fuchsia-500/30",
    text: "text-fuchsia-600",
    card: "border-l-fuchsia-500",
    bar: "from-fuchsia-500 to-pink-400",
    badge: "bg-fuchsia-100 text-fuchsia-700",
  },
];

export const accentAt = (i: number): Accent => ACCENTS[i % ACCENTS.length]!;
