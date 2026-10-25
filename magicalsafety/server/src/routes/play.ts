import multer from "multer";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { legalActions, parseCommandRules, replay, voiceKeywords, WORLDS, type LegalAction } from "@magicalsafety/engine";
import { rateLimit } from "../auth";
import type { AgentKit } from "../agent";
import { hashToken, type SessionHub } from "../realtime/sessionHub";
import type { SessionMeta } from "../store/schemas";
import type { Store } from "../store/store";
import { inspectWav, WavError } from "../tools/wav";

const CommandBody = z.strictObject({ text: z.string().trim().min(1).max(300) });
const FacebookBody = z.strictObject({ accessToken: z.string().min(10).max(2000), includeFriends: z.boolean().default(false), useName: z.boolean().default(false) });

const RecapDoc = z.strictObject({
  status: z.enum(["pending", "ready", "unavailable"]),
  reason: z.string().max(200).optional(),
  b64: z.string().optional(),
  model: z.string().optional(),
  createdAt: z.number(),
});

const toClient = (la: LegalAction) => ({ key: la.key, label: la.label, group: la.group, action: la.action, ...(la.realWorld ? { realWorld: la.realWorld } : {}) });

/** Player-facing integrations: voice, spoken/typed commands, Facebook name, and the recap illustration. */
export function playRoutes(store: Store, hub: SessionHub, kit: AgentKit): Router {
  const r = Router();
  const inflight = new Set<string>();

  /** The calling player of THIS session, by their token. */
  const playerOf = (req: Request, meta: SessionMeta | undefined) => {
    const token = req.header("x-player-token");
    return meta && token ? meta.players.find((p) => p.tokenHash === hashToken(token)) : undefined;
  };
  const notFound = (res: Response) => void res.status(404).json({ error: "Not found" });

  // ---------- Voice: push-to-talk WAV -> transcript ----------
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 2 } });
  r.post("/:id/voice", rateLimit(30), (req, res) => {
    upload.single("audio")(req, res, async (err: unknown) => {
      if (err) return void res.status((err as { code?: string }).code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: "That recording can't be used" });
      const meta = store.getMeta(String(req.params.id));
      const player = playerOf(req, meta);
      if (!meta || !player) return notFound(res);
      const state = hub.stateOf(meta.id);
      if (!state || state.phase !== "running") return void res.status(409).json({ error: "The session isn't running" });
      if (!req.file) return void res.status(400).json({ error: "No recording was sent" });
      let info;
      try { info = inspectWav(req.file.buffer); } catch (e) { return void res.status(400).json({ error: e instanceof WavError ? e.message : "Unusable recording" }); }

      const org = store.getOrg(meta.orgId);
      const maxMs = (org?.limits.maxVoiceSecondsPerSession ?? 300) * 1000;
      if (kit.usage.get(meta.orgId, "voice_ms", "session", meta.id) + info.durationMs > maxMs) return void res.status(429).json({ error: "This session has used its voice time" });

      const result = await kit.tools.executeTool({
        tool: "muse.transcribe", orgId: meta.orgId, sessionId: meta.id, requestedBy: "player",
        args: { wav: req.file.buffer, keywords: voiceKeywords(WORLDS[meta.config.worldId]!) },
      });
      // Not configured, not allowed, or the service failed: the client falls back to browser speech or typing, and says so.
      if (!result.ok) return void res.status(503).json({ error: "Voice isn't available right now", unavailable: true });
      kit.usage.add(meta.orgId, "voice_ms", "session", meta.id, info.durationMs);
      res.json({ transcript: (result.output as { transcript: string }).transcript, method: "muse" });
    });
  });

  // ---------- Commands: words -> one of the player's legal actions (never executed here) ----------
  r.post("/:id/command", rateLimit(60), async (req, res) => {
    const meta = store.getMeta(String(req.params.id));
    const player = playerOf(req, meta);
    if (!meta || !player) return notFound(res);
    const body = CommandBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Say or type something first" });
    const state = hub.stateOf(meta.id);
    if (!state || state.phase !== "running") return void res.status(409).json({ error: "The session isn't running" });
    const legal = legalActions(state, player.id);

    const rules = parseCommandRules(body.data.text, legal);
    if (rules.kind === "action") return void res.json({ kind: "action", via: "rules", action: toClient(rules.action) });
    if (rules.kind === "choices") return void res.json({ kind: "choices", via: "rules", choices: rules.choices.map(toClient) });
    try {
      const picked = await kit.pickAction(state, legal, body.data.text);
      if (picked.action) return void res.json({ kind: "action", via: picked.generatedBy === "rules" ? "rules" : "model", action: toClient(picked.action) });
    } catch { /* fall through: treat it as chat */ }
    res.json({ kind: "none" });
  });

  // ---------- Facebook: verify the login, optionally use the verified name in the lobby ----------
  r.post("/:id/facebook", rateLimit(20), async (req, res) => {
    const meta = store.getMeta(String(req.params.id));
    const player = playerOf(req, meta);
    if (!meta || !player) return notFound(res);
    const body = FacebookBody.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Invalid request" });
    const result = await kit.tools.executeTool({ tool: "fb.profile", orgId: meta.orgId, sessionId: meta.id, requestedBy: "player", args: { accessToken: body.data.accessToken, includeFriends: body.data.includeFriends } });
    if (!result.ok) return void res.status(503).json({ error: "Facebook isn't available right now", unavailable: true });
    const out = result.output as { name: string; pictureUrl: string | null; friends: string[] | null };
    if (body.data.useName && meta.status === "lobby") {
      const p = meta.players.find((x) => x.id === player.id)!;
      p.name = out.name;
      p.fb = { name: out.name, pictureUrl: out.pictureUrl };
      await store.saveMeta(meta);
      hub.broadcast(meta.id);
    }
    res.json({ name: out.name, pictureUrl: out.pictureUrl, friends: out.friends });
  });

  // ---------- Recap illustration (async, limit-checked) ----------
  const recapDoc = async (id: string) => {
    const p = RecapDoc.safeParse(await store.getDoc(id, "recap"));
    return p.success ? p.data : null;
  };
  const authorised = (req: Request) => {
    const meta = store.getMeta(String(req.params.id));
    return meta && playerOf(req, meta) ? meta : undefined;
  };

  r.post("/:id/recap", rateLimit(10), async (req, res) => {
    const meta = authorised(req);
    if (!meta) return notFound(res);
    if (meta.status !== "ended") return void res.status(409).json({ error: "The session hasn't finished yet" });
    const existing = await recapDoc(meta.id);
    if (existing && (existing.status !== "unavailable" || inflight.has(meta.id))) return void res.json({ status: existing.status, ...(existing.reason ? { reason: existing.reason } : {}) });
    if (inflight.has(meta.id)) return void res.json({ status: "pending" });
    inflight.add(meta.id);
    await store.putDoc(meta.id, "recap", { status: "pending", createdAt: Date.now() });
    res.status(202).json({ status: "pending" });
    // Generated in the background; the page polls GET /recap.
    void (async () => {
      try {
        // The tone follows the recorded outcome. The prompt is authored per world: no names, chat or details are sent.
        const log = await store.loadLog(meta.id);
        const success = log.ok ? replay({ config: log.header.config, seed: log.header.seed, players: log.header.players }, log.inputs).actOutcomes.at(-1)?.success ?? false : false;
        const prompt = WORLDS[meta.config.worldId]!.recap[success ? "success" : "setback"];
        const out = await kit.tools.executeTool({ tool: "muse.image", orgId: meta.orgId, sessionId: meta.id, requestedBy: "agent", args: { prompt, kind: "recap" } });
        if (out.ok) {
          const o = out.output as { b64: string; model: string };
          await store.putDoc(meta.id, "recap", { status: "ready", b64: o.b64, model: o.model, createdAt: Date.now() });
        } else {
          await store.putDoc(meta.id, "recap", { status: "unavailable", reason: out.reason.slice(0, 160), createdAt: Date.now() });
        }
      } catch {
        await store.putDoc(meta.id, "recap", { status: "unavailable", reason: "The illustration couldn't be made", createdAt: Date.now() });
      } finally {
        inflight.delete(meta.id);
      }
    })();
  });

  r.get("/:id/recap", rateLimit(120), async (req, res) => {
    const meta = authorised(req);
    if (!meta) return notFound(res);
    const d = await recapDoc(meta.id);
    res.json(d ? { status: d.status, ...(d.reason ? { reason: d.reason } : {}), ...(d.model ? { model: d.model } : {}) } : { status: "none" });
  });

  r.get("/:id/recap.webp", rateLimit(120), async (req, res) => {
    const meta = authorised(req);
    if (!meta) return notFound(res);
    const d = await recapDoc(meta.id);
    if (!d || d.status !== "ready" || !d.b64) return void res.status(404).end();
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(d.b64, "base64"));
  });

  return r;
}
