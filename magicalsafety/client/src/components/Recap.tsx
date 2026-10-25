import { useEffect, useRef, useState } from "react";
import { getRecap, getRecapImage, startRecap, type RecapStatus } from "../api";
import { MockBadge } from "./MockBadge";

/** The "team moment" illustration at the end. Made on request (it costs an image) and never required. */
export function Recap({ sessionId, token }: { sessionId: string; token: string }) {
  const [st, setSt] = useState<RecapStatus>({ status: "none" });
  const [img, setImg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { void getRecap(sessionId, token).then(setSt); return () => { if (timer.current) clearInterval(timer.current); }; }, [sessionId, token]);
  useEffect(() => { if (st.status === "ready" && !img) void getRecapImage(sessionId, token).then(setImg); }, [st.status, img, sessionId, token]);
  useEffect(() => {
    if (st.status !== "pending") return;
    timer.current = setInterval(() => void getRecap(sessionId, token).then(setSt), 1500);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [st.status, sessionId, token]);

  const make = async () => { setSt({ status: "pending" }); await startRecap(sessionId, token); void getRecap(sessionId, token).then(setSt); };

  return (
    <section aria-label="Team moment" className="rounded-xl bg-night-2 p-4">
      <h2 className="mb-2 font-display text-lg text-gold">Your team moment</h2>
      {img ? (
        <figure><img src={img} alt="An illustration of a team gathered together" className="w-full max-w-xl rounded-lg" /><figcaption className="mt-1 text-xs text-slate-400">Made with Muse Image from a fixed, name-free prompt.</figcaption></figure>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          {/* Hand-made placeholder, shown whenever the real illustration isn't there */}
          <svg viewBox="0 0 200 110" className="w-56 rounded-lg" role="img" aria-label="A simple placeholder illustration of four friends standing together">
            <rect width="200" height="110" fill="#16264f" />
            <circle cx="165" cy="22" r="12" fill="#f7e08a" />
            {[45, 80, 115, 150].map((x, i) => <g key={x}><circle cx={x} cy={58 - (i % 2) * 4} r="9" fill="#e8d5b5" /><rect x={x - 10} y={67 - (i % 2) * 4} width="20" height="30" rx="8" fill={["#d4af37", "#6b8bd6", "#c0677a", "#5fa889"][i]} /></g>)}
            <rect y="97" width="200" height="13" fill="#0b1230" />
          </svg>
          <div className="text-sm">
            {st.status === "pending" && <p role="status">Painting your illustration…</p>}
            {st.status === "unavailable" && <p><MockBadge label="PLACEHOLDER" /> <span className="ml-2 text-slate-300">The illustration service isn't available ({st.reason ?? "not configured"}), so this is the stand-in.</span></p>}
            {(st.status === "none" || st.status === "unavailable") && <button onClick={() => void make()} className="mt-2 rounded bg-night px-3 py-1.5 ring-1 ring-white/20 hover:ring-gold">{st.status === "unavailable" ? "Try again" : "Make a team-moment illustration"}</button>}
          </div>
        </div>
      )}
    </section>
  );
}
