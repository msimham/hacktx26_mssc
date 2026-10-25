import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { blankOrg, OrgConfig, OrgDocument, type OrgConfig as Org } from "@magicalsafety/engine";
import type { Env } from "../config/env";
import { passcodeOk, rateLimit } from "../auth";
import type { AgentKit } from "../agent";
import { draftObjectives } from "../agent/builderDraft";
import type { Store } from "../store/store";
import { SEEDED_ORG_ID } from "../orgs/seed";
import { SAMPLE_RESULTS } from "../tools/serpapi";
import { randomBytes } from "node:crypto";

const NewOrg = z.strictObject({ name: z.string().trim().min(1).max(80) });
const NewDoc = z.strictObject({
  title: z.string().trim().min(1).max(120),
  // Text only: the client reads .md/.txt files in the browser and sends the text. Control characters are removed.
  text: z.string().min(1).max(40_000).transform((s) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")),
});
const Search = z.strictObject({ query: z.string().trim().min(1).max(300), k: z.number().int().min(1).max(5).optional() });
const Research = z.strictObject({ query: z.string().trim().min(3).max(200) });
const Approve = z.strictObject({
  title: z.string().trim().min(1).max(200),
  url: z.string().url().max(500).refine((u) => /^https?:\/\//i.test(u)),
  snippet: z.string().trim().min(1).max(500),
  mock: z.boolean().default(false),
});
const Draft = z.strictObject({ orgId: z.string().optional(), description: z.string().trim().min(10).max(2000) });

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "doc";

export function orgRoutes(env: Env, store: Store, kit: AgentKit): Router {
  const r = Router();

  // Everything here is organizer-only. Same 404 for "no such org" and "not allowed to see it" is unnecessary
  // because the passcode check comes first and applies to the whole router.
  r.use(rateLimit(120), (req: Request, res: Response, next: () => void) => {
    if (!passcodeOk(req.header("x-organizer-passcode"), env.organizerPasscode)) return void res.status(401).json({ error: "Organizer passcode required" });
    next();
  });

  const warnings = (org: Org) => [
    ...(org.model.allowContributorMode && org.model.modelId === "muse-spark-1.3-contributor" && !env.allowContributor ? ["Contributor mode is requested here but the server does not allow it (META_ALLOW_CONTRIBUTOR=false), so the standard model is used."] : []),
    ...(org.model.provider === "meta" && !env.metaApiKey ? ["No Meta key on the server: this organization runs on deterministic rules."] : []),
  ];
  const get = (req: Request, res: Response): Org | undefined => {
    const org = store.getOrg(String(req.params.id));
    if (!org) res.status(404).json({ error: "Not found" });
    return org;
  };

  r.get("/", (_req, res) => {
    res.json({ orgs: store.listOrgs().map((o) => ({ id: o.id, name: o.name, audience: o.audience, objectives: o.objectives.length, documents: o.documents.length, seeded: o.id === SEEDED_ORG_ID })) });
  });

  r.post("/", async (req, res) => {
    const body = NewOrg.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Give the organization a name" });
    const id = `org_${slug(body.data.name).slice(0, 18)}_${randomBytes(2).toString("hex")}`;
    const org = blankOrg(id, body.data.name);
    await store.saveOrg(org);
    res.status(201).json({ org, warnings: warnings(org) });
  });

  // Objective drafting is a model call (or its deterministic stand-in). Declared before "/:id" routes.
  r.post("/draft", async (req, res) => {
    const body = Draft.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Describe what you want to teach in a sentence or two" });
    const org = body.data.orgId ? store.getOrg(body.data.orgId) : undefined;
    if (body.data.orgId && !org) return void res.status(404).json({ error: "Not found" });
    const scope = org?.id ?? "org_builder";
    const maxDrafts = org?.limits.maxBuilderDraftsPerDay ?? 10;
    if (kit.usage.get(scope, "drafts", "day") >= maxDrafts) return void res.status(429).json({ error: `Daily limit of ${maxDrafts} drafts reached` });
    kit.usage.add(scope, "drafts", "day");
    const budget = { max: maxDrafts, used: () => kit.usage.get(scope, "draft_calls", "day"), spend: () => kit.usage.add(scope, "draft_calls", "day") };
    try {
      const out = await draftObjectives({ runner: kit.runner, provider: kit.providerFor(org), scopeId: scope, description: body.data.description, budget });
      res.json({ ...out.value, generatedBy: out.generatedBy, fallbackUsed: out.fallbackUsed });
    } catch (err) {
      console.error("[draft]", err instanceof Error ? err.message : "failed");
      res.status(500).json({ error: "Could not draft objectives" });
    }
  });

  r.get("/:id", (req, res) => { const o = get(req, res); if (o) res.json({ org: o, warnings: warnings(o), seeded: o.id === SEEDED_ORG_ID }); });

  r.put("/:id", async (req, res) => {
    const existing = get(req, res);
    if (!existing) return;
    const parsed = OrgConfig.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return void res.status(400).json({ error: `${first?.path.join(".") || "organization"}: ${first?.message ?? "invalid"}` });
    }
    if (parsed.data.id !== existing.id) return void res.status(400).json({ error: "An organization's id cannot change" });
    await store.saveOrg(parsed.data);
    res.json({ org: parsed.data, warnings: warnings(parsed.data) });
  });

  r.delete("/:id", async (req, res) => {
    const o = get(req, res);
    if (!o) return;
    if (o.id === SEEDED_ORG_ID) return void res.status(400).json({ error: "The demo organization can't be deleted" });
    await store.deleteOrg(o.id);
    res.json({ ok: true });
  });

  r.post("/:id/documents", async (req, res) => {
    const o = get(req, res);
    if (!o) return;
    const body = NewDoc.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "A document needs a title and up to 40,000 characters of text" });
    if (o.documents.length >= 20) return void res.status(400).json({ error: "An organization can hold up to 20 documents" });
    let id = slug(body.data.title);
    for (let n = 2; o.documents.some((d) => d.id === id); n++) id = `${slug(body.data.title).slice(0, 36)}_${n}`;
    const doc = OrgDocument.parse({ id, title: body.data.title, text: body.data.text, source: "uploaded" });
    try {
      const next = OrgConfig.parse({ ...o, documents: [...o.documents, doc] });
      await store.saveOrg(next);
      res.status(201).json({ org: next });
    } catch {
      res.status(400).json({ error: "That would make the organization too large" });
    }
  });

  r.delete("/:id/documents/:docId", async (req, res) => {
    const o = get(req, res);
    if (!o) return;
    const next = { ...o, documents: o.documents.filter((d) => d.id !== req.params.docId) };
    if (next.documents.length === o.documents.length) return void res.status(404).json({ error: "Not found" });
    await store.saveOrg(OrgConfig.parse(next));
    res.json({ org: next });
  });

  // Preview what the training agent would find. Goes through the same tool pipeline as the agent.
  r.post("/:id/search", async (req, res) => {
    const o = get(req, res);
    if (!o) return;
    const body = Search.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Enter something to search for" });
    const result = await kit.tools.executeTool({ tool: "org_docs.search", args: { query: body.data.query, k: body.data.k ?? 3 }, orgId: o.id, requestedBy: "organizer" });
    if (!result.ok) return void res.status(403).json({ error: result.reason });
    res.json(result.output);
  });

  // What the training agent and drafter did for this organization (redacted inputs, validated outputs, cost).
  r.get("/:id/runs", async (req, res) => { const o = get(req, res); if (o) res.json({ runs: await kit.runLog.list(o.id) }); });

  // Research: search the web, then explicitly approve what becomes one of this organization's documents.
  // Without a SerpApi key, clearly labeled sample results are returned so the flow can still be tried.
  r.post("/:id/research", async (req, res) => {
    const o = get(req, res);
    if (!o) return;
    const body = Research.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "Enter what you want to research" });
    if (!env.serpApiKey) return void res.json({ mock: true, results: SAMPLE_RESULTS });
    const result = await kit.tools.executeTool({ tool: "serpapi.search", args: { query: body.data.query, num: 5 }, orgId: o.id, requestedBy: "organizer" });
    if (!result.ok) return void res.status(403).json({ error: result.reason });
    res.json({ mock: false, ...(result.output as object) });
  });

  r.post("/:id/research/approve", async (req, res) => {
    const o = get(req, res);
    if (!o) return;
    const body = Approve.safeParse(req.body);
    if (!body.success) return void res.status(400).json({ error: "That result can't be saved" });
    if (o.documents.length >= 20) return void res.status(400).json({ error: "An organization can hold up to 20 documents" });
    const strip = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const title = `${body.data.mock ? "[Sample] " : ""}${strip(body.data.title)}`.slice(0, 120);
    let id = slug(title);
    for (let n = 2; o.documents.some((d) => d.id === id); n++) id = `${slug(title).slice(0, 36)}_${n}`;
    try {
      const doc = OrgDocument.parse({ id, title, source: "approved_web", ...(body.data.mock ? {} : { url: body.data.url }), text: `# ${title}\n\n${strip(body.data.snippet)}${body.data.mock ? "" : `\n\nSource: ${body.data.url}`}` });
      const next = OrgConfig.parse({ ...o, documents: [...o.documents, doc] });
      await store.saveOrg(next);
      res.status(201).json({ org: next });
    } catch {
      res.status(400).json({ error: "That would make the organization too large" });
    }
  });

  r.get("/:id/audit", (req, res) => { const o = get(req, res); if (o) res.json({ audit: kit.tools.audit(o.id) }); });

  return r;
}
