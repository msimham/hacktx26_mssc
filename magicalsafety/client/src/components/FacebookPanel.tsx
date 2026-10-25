import { useState } from "react";
import { Unavailable, verifyFacebook } from "../api";
import { fbConfigured, fbLogin, fbShare } from "../social/fbSdk";
import { loadPlayerBySession } from "../session/storage";
import { MockBadge } from "./MockBadge";

// Clearly fake. Real friend names are never shown unless Facebook returned them for a signed-in tester.
const MOCK_FRIENDS = ["Sam (demo)", "Priya (demo)", "Jordan (demo)"];

interface Props { sessionId: string; joinLink: string; showFriends: boolean }

/** Optional Facebook extras for the lobby: share the join link, use your verified name, and (dev mode only) see friends. */
export function FacebookPanel({ sessionId, joinLink, showFriends }: Props) {
  const configured = fbConfigured();
  const token = loadPlayerBySession(sessionId)?.token ?? "";
  const [msg, setMsg] = useState<string | null>(null);
  const [friends, setFriends] = useState<string[] | null>(null);
  const [wantFriends, setWantFriends] = useState(false);
  const [busy, setBusy] = useState(false);

  const useMyName = async () => {
    setBusy(true); setMsg(null);
    try {
      const accessToken = await fbLogin();
      const r = await verifyFacebook(sessionId, token, accessToken, { useName: true, includeFriends: wantFriends });
      setFriends(r.friends);
      setMsg(`Signed in as ${r.name}. Only your name and picture are used.`);
    } catch (e) {
      setMsg(e instanceof Unavailable ? "Facebook sign-in isn't available on this server right now. You can keep your typed name." : (e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <section aria-label="Facebook" className="rounded-xl bg-night-2 p-4">
      <h2 className="mb-2 flex items-center gap-2 font-display text-lg text-gold">Friends {!configured && <MockBadge label="NOT CONFIGURED" />}</h2>
      {configured ? (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void fbShare(joinLink).catch((e: Error) => setMsg(e.message))} className="rounded bg-[#1877f2] px-3 py-1.5 font-semibold text-white">Share on Facebook</button>
            <button type="button" disabled={busy} onClick={() => void useMyName()} className="rounded bg-night px-3 py-1.5 ring-1 ring-white/20 hover:ring-gold disabled:opacity-50">Use my Facebook name</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={wantFriends} onChange={(e) => setWantFriends(e.target.checked)} /> Also show friends who use this app <span className="text-amber-300">(dev mode only, unverified)</span></label>
          {friends && <p className="text-xs">Friends also training: {friends.length ? friends.join(", ") : "none found"}.</p>}
          <p className="text-xs text-slate-400">Optional. We ask only for your public profile, never your messages, groups or location.</p>
        </div>
      ) : (
        <div className="space-y-2 text-sm text-slate-300">
          <p>Facebook isn't set up on this server, so use <strong>Copy link</strong> to invite people.</p>
          {showFriends && (
            <div className="rounded bg-night p-3">
              <div className="mb-1 flex items-center gap-2 text-xs"><MockBadge /> Demo friends (not real people)</div>
              <ul className="list-disc pl-5 text-xs">{MOCK_FRIENDS.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-xs text-slate-200">{msg}</p>}
    </section>
  );
}
