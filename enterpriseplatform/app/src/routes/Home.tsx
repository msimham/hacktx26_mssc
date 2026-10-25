import { Link, useNavigate } from "react-router-dom";
import { Reveal } from "./Reveal";
import { buttonPrimary } from "./create/WizardShell";

const TOPICS = [
  "🔥 Fire safety", "💊 Drug response", "🤝 Team collaboration", "🌱 Onboarding", "🗣️ Difficult conversations",
  "🚑 Crisis response", "🧭 Leadership", "📣 Delegation", "🛟 Asking for help", "🧩 Problem solving",
];

const HOW = [
  { emoji: "✍️", title: "Tell us what to train", body: "Say it in your own words. Fire drills, tough conversations, first-week onboarding: anything.", tint: "from-violet-100 to-fuchsia-100" },
  { emoji: "🎬", title: "We help you build your agent", body: "Your own training agent builds a playable simulation your people step into together, by voice, text or images.", tint: "from-rose-100 to-orange-100" },
  { emoji: "🌱", title: "Everyone practices, everyone grows", body: "The agent watches how each person handled it, spots the gaps, and adapts the next simulation.", tint: "from-emerald-100 to-sky-100" },
];

const TRUST = [
  { emoji: "🔒", title: "Private by design", body: "Your scenarios, transcripts and results are visible only to your organization." },
  { emoji: "🛂", title: "You control access", body: "Decide who can create simulations, who can play them, and who can see results." },
  { emoji: "🗂️", title: "Your data stays yours", body: "Your training content is never shared with other organizations." },
  { emoji: "🏢", title: "Built for teams at scale", body: "From one department to the whole organization, with one consistent experience." },
];

const EXAMPLES = [
  { emoji: "🔥", title: "Fire safety", line: "A night shift, an alarm, and a blocked exit.", train: "Fire safety", tint: "bg-rose-500" },
  { emoji: "💊", title: "Drug response", line: "A suspected overdose. Who does what, and how fast?", train: "Drug response", tint: "bg-violet-500" },
  { emoji: "🤝", title: "Team collaboration", line: "Four people, one deadline, and missing information.", train: "Team collaboration", tint: "bg-amber-500" },
];

export function Home() {
  const navigate = useNavigate();
  return (
    <div className="overflow-x-clip">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
        <span className="font-display text-lg font-extrabold tracking-tight">TALE ✨ <span className="hidden text-sm font-semibold text-slate-500 sm:inline">Training Agents for Learning Experiences</span></span>
        <Link to="/create" className="text-sm font-medium text-violet-700 hover:underline">Start creating</Link>
      </header>

      <section className="relative mx-auto max-w-5xl px-4 pb-20 pt-10 text-center sm:pt-16">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute -left-10 top-4 size-40 animate-float rounded-full bg-fuchsia-300/50 blur-2xl" />
          <div className="absolute right-0 top-24 size-52 animate-float rounded-full bg-amber-300/50 blur-2xl [animation-delay:-2s]" />
          <div className="absolute bottom-0 left-1/3 size-44 animate-float rounded-full bg-sky-300/50 blur-2xl [animation-delay:-4s]" />
        </div>
        <p className="mx-auto mb-5 inline-block rounded-full bg-white px-4 py-1.5 text-sm font-medium text-violet-700 shadow-sm ring-1 ring-violet-100">
          The secure platform for custom training simulation agents
        </p>
        <h1 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-7xl">
          <span className="block bg-gradient-to-r from-rose-500 to-orange-400 bg-clip-text text-transparent">TALE:</span>
          Build a{" "}
          <span className="bg-gradient-to-r from-violet-600 via-fuchsia-500 to-orange-400 bg-clip-text text-transparent">
            training simulation agent
          </span>{" "}
          that prepares your people.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">
          Describe what your team needs to practice, and TALE builds a custom training simulation agent that runs the simulation, plays the other roles and coaches each person. Ready in about a minute.
        </p>
        <div className="mt-9 flex flex-col items-center gap-3">
          <Link to="/create" className={`${buttonPrimary} px-8 py-4 text-lg`}>+ Create Training Simulation Agent</Link>
          <span className="text-sm text-slate-500">6 quick questions. Private to your organization.</span>
        </div>
        <p aria-hidden className="mt-14 animate-bounce text-sm text-slate-400">scroll to see how it works ↓</p>
      </section>

      <div aria-hidden className="border-y border-violet-100 bg-white py-4">
        <div className="flex w-max animate-marquee gap-3">
          {[...TOPICS, ...TOPICS].map((t, i) => (
            <span key={i} className="whitespace-nowrap rounded-full bg-violet-50 px-4 py-2 text-sm font-medium text-violet-800">{t}</span>
          ))}
        </div>
      </div>

      <section className="mx-auto max-w-5xl px-4 py-20">
        <Reveal>
          <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-5xl">From idea to your own simulation agent in three steps</h2>
        </Reveal>
        <ol className="mt-12 grid gap-5 md:grid-cols-3">
          {HOW.map((h, i) => (
            <li key={h.title}>
              <Reveal delay={i * 120}>
                <div className={`h-full rounded-3xl bg-gradient-to-br ${h.tint} p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-lg`}>
                  <div className="text-4xl">{h.emoji}</div>
                  <h3 className="mt-4 font-display text-xl font-extrabold">{i + 1}. {h.title}</h3>
                  <p className="mt-2 text-slate-700">{h.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-slate-900 px-4 py-20 text-white">
        <div className="mx-auto max-w-5xl">
          <Reveal>
            <h2 className="text-center font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Pick a starting point</h2>
            <p className="mt-3 text-center text-slate-300">Or start from scratch. Everything stays editable.</p>
          </Reveal>
          <ul className="mt-12 grid gap-5 md:grid-cols-3">
            {EXAMPLES.map((ex, i) => (
              <li key={ex.title}>
                <Reveal delay={i * 120}>
                  <button
                    type="button"
                    onClick={() => navigate("/create", { state: { train: ex.train } })}
                    className="group h-full w-full rounded-3xl bg-white/5 p-6 text-left ring-1 ring-white/10 transition hover:-translate-y-1 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <span className={`inline-flex size-12 items-center justify-center rounded-2xl text-2xl ${ex.tint}`}>{ex.emoji}</span>
                    <h3 className="mt-4 font-display text-xl font-extrabold">{ex.title}</h3>
                    <p className="mt-1 text-slate-300">{ex.line}</p>
                    <span className="mt-4 inline-block text-sm font-medium text-amber-300 transition group-hover:translate-x-1">Use this →</span>
                  </button>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-20">
        <Reveal>
          <p className="text-center text-sm font-semibold uppercase tracking-widest text-violet-600">Enterprise-ready</p>
          <h2 className="mt-2 text-center font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Playful for your people. Serious about your data.</h2>
        </Reveal>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2">
          {TRUST.map((t, i) => (
            <li key={t.title}>
              <Reveal delay={i * 100}>
                <div className="flex h-full gap-4 rounded-3xl border border-violet-100 bg-white p-6 shadow-sm">
                  <span aria-hidden className="text-3xl">{t.emoji}</span>
                  <div>
                    <h3 className="font-display text-lg font-extrabold">{t.title}</h3>
                    <p className="mt-1 text-slate-600">{t.body}</p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-4 pb-24 pt-4 text-center">
        <Reveal>
          <h2 className="font-display text-4xl font-extrabold tracking-tight sm:text-6xl">Ready to make your first training simulation agent? 🚀</h2>
          <Link to="/create" className={`${buttonPrimary} mt-8 inline-block px-8 py-4 text-lg`}>+ Create Training Simulation Agent</Link>
        </Reveal>
      </section>

      <footer className="border-t border-violet-100 px-4 py-8 text-center text-sm text-slate-500">
        <strong className="font-display text-slate-700">TALE</strong>: Training Agents for Learning Experiences
      </footer>
    </div>
  );
}
