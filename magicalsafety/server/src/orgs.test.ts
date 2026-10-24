import { afterEach, describe, expect, it } from "vitest";
import { blankOrg, OrgConfig, type OrgConfig as Org } from "@magicalsafety/engine";
import { boot, cleanup, kit, PASS } from "./testkit";
import { chunkDocument, searchOrgDocs, tokenize } from "./tools/orgDocs";
import { riversideOrg } from "./orgs/seed";
import { createToolExecutor } from "./tools/executeTool";
import { Usage } from "./tools/usage";
import { JsonFileStore } from "./store/store";
import type { ToolDef } from "./tools/types";
import { z } from "zod";
import { mockDraft, validateDraft, type ObjectiveDraft } from "./agent/builderDraft";
import { selectProvider } from "./agent";
import { readEnv } from "./config/env";
import { MockProvider } from "./agent/providers/mock";

afterEach(cleanup);

describe("organization API", () => {
  it("is organizer-only", async () => {
    const b = await boot();
    expect((await b.org("", { pass: null })).status).toBe(401);
    expect((await b.org("", { pass: "wrong" })).status).toBe(401);
    expect((await b.org("/org_riverside", { pass: null })).status).toBe(401);
    expect((await b.org("")).status).toBe(200);
  });

  it("seeds the demo organization and protects it from deletion", async () => {
    const b = await boot();
    const list = (await (await b.org("")).json()) as { orgs: { id: string; seeded: boolean }[] };
    expect(list.orgs.find((o) => o.id === "org_riverside")?.seeded).toBe(true);
    expect((await b.org("/org_riverside", { method: "DELETE" })).status).toBe(400);
  });

  it("creates, edits, validates and deletes", async () => {
    const b = await boot();
    const created = (await (await b.org("", { method: "POST", body: { name: "Night Shift Team" } })).json()) as { org: Org };
    const id = created.org.id;
    expect(id).toMatch(/^org_night_shift_team_[0-9a-f]{4}$/);
    expect(OrgConfig.safeParse(created.org).success).toBe(true);

    const edited = { ...created.org, audience: "Hospital volunteers", objectives: [{ id: "speak_up", title: "Speak up", description: "", competency: "communication" as const }], rubric: [{ objectiveId: "speak_up", indicator: "info_shared_ratio" as const, direction: "at_least" as const, target: 0.9, weight: 5 }] };
    expect((await b.org(`/${id}`, { method: "PUT", body: edited })).status).toBe(200);
    expect(((await (await b.org(`/${id}`)).json()) as { org: Org }).org.audience).toBe("Hospital volunteers");

    const bad = async (patch: Record<string, unknown>) => (await b.org(`/${id}`, { method: "PUT", body: { ...edited, ...patch } })).status;
    expect(await bad({ rubric: [{ ...edited.rubric[0], objectiveId: "nope" }] })).toBe(400);
    expect(await bad({ rubric: [{ ...edited.rubric[0], direction: "is_true" }] })).toBe(400); // doesn't make sense for a ratio
    expect(await bad({ rubric: [{ ...edited.rubric[0], target: 5 }] })).toBe(400); // out of range
    expect(await bad({ socialEnvironment: "strangers" })).toBe(400); // belongs to the session layer
    expect(await bad({ worldId: "castle" })).toBe(400);
    expect(await bad({ id: "org_other" })).toBe(400);
    expect(await bad({ safety: { ...edited.safety, requireAuthoredSafetyContent: false } })).toBe(400);

    expect((await b.org(`/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await b.org(`/${id}`)).status).toBe(404);
  });

  it("warns when contributor mode is requested but the server does not allow it", async () => {
    const b = await boot();
    const org = blankOrg("org_warn", "Warn");
    await kit.server!.store.saveOrg(org);
    const res = await b.org("/org_warn", { method: "PUT", body: { ...org, model: { provider: "meta", modelId: "muse-spark-1.3-contributor", allowContributorMode: true } } });
    const body = (await res.json()) as { warnings: string[] };
    expect(body.warnings.join(" ")).toMatch(/Contributor mode/);
  });

  it("adds and removes documents, sanitizing text and enforcing limits", async () => {
    const b = await boot();
    const id = ((await (await b.org("", { method: "POST", body: { name: "Docs" } })).json()) as { org: Org }).org.id;
    const add = (title: string, text: string) => b.org(`/${id}/documents`, { method: "POST", body: { title, text } });
    const r = await add("Call Guide", "# Calling\nCall security.\u0000\u0007");
    expect(r.status).toBe(201);
    const doc = ((await r.json()) as { org: Org }).org.documents[0]!;
    expect(doc.text).not.toMatch(/[\u0000\u0007]/);
    expect(doc.id).toBe("call_guide");
    expect(((await (await add("Call Guide", "again")).json()) as { org: Org }).org.documents.map((d) => d.id)).toEqual(["call_guide", "call_guide_2"]);
    expect((await add("", "x")).status).toBe(400);
    expect((await add("Big", "x".repeat(40_001))).status).toBe(400);
    expect((await b.org(`/${id}/documents/call_guide`, { method: "DELETE" })).status).toBe(200);
    expect((await b.org(`/${id}/documents/nope`, { method: "DELETE" })).status).toBe(404);
  });

  it("previews retrieval through the tool pipeline, and honors the allowlist", async () => {
    const b = await boot();
    const hit = (await (await b.org("/org_riverside/search", { method: "POST", body: { query: "who should I call for help" } })).json()) as { results: { heading: string; matchedTerms: string[] }[] };
    expect(hit.results[0]!.heading).toBe("Calling for help");
    expect(hit.results[0]!.matchedTerms.length).toBeGreaterThan(0);
    const org = riversideOrg();
    await b.org("/org_riverside", { method: "PUT", body: { ...org, tools: { allowed: [] } } });
    const denied = await b.org("/org_riverside/search", { method: "POST", body: { query: "call" } });
    expect(denied.status).toBe(403);
    const audit = (await (await b.org("/org_riverside/audit")).json()) as { audit: { decision: string }[] };
    expect(audit.audit.map((a) => a.decision)).toEqual(["allowed", "denied"]);
  });
});

describe("organization document retrieval", () => {
  const doc = (text: string) => ({ id: "d", title: "Doc", text, source: "uploaded" as const });

  it("chunks by heading and keeps chunks within the size cap", () => {
    const chunks = chunkDocument(doc(`# One\nalpha\n\n## Two\nbeta\n\n## Three\n${"gamma delta. ".repeat(400)}`));
    expect(chunks.map((c) => c.heading).slice(0, 3)).toEqual(["One", "Two", "Three"]);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1600);
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it("strips markup", () => {
    expect(chunkDocument(doc("# T\n<script>alert(1)</script>hello"))[0]!.text).not.toContain("<script>");
  });

  it("ranks the relevant chunk first and explains why", () => {
    const org = riversideOrg();
    const [first, second] = searchOrgDocs(org, "call security 911 help", 3);
    expect(first!.heading).toBe("Calling for help");
    expect(first!.matchedTerms).toEqual(expect.arrayContaining(["call", "security", "911"]));
    expect(first!.score).toBeGreaterThan(second?.score ?? 0);
    const team = searchOrgDocs(org, "name a specific person for each task", 1)[0]!;
    expect(team.heading).toBe("Working as a team");
  });

  it("returns nothing for empty or unmatched queries, and tokenizes sensibly", () => {
    expect(searchOrgDocs(riversideOrg(), "the and for", 3)).toEqual([]);
    expect(searchOrgDocs(riversideOrg(), "zzzzqqq", 3)).toEqual([]);
    expect(searchOrgDocs({ documents: [] }, "call", 3)).toEqual([]);
    expect(tokenize("Call the AED, now!")).toEqual(["call", "aed", "now"]);
  });
});

describe("executeTool pipeline", () => {
  const echoArgs = z.strictObject({ n: z.number().int().min(0).max(10) });
  const makeTool = (over: Partial<ToolDef<{ n: number }, { ok: boolean }>> = {}): ToolDef<never, unknown> => ({
    name: "serpapi.search", argsSchema: echoArgs, outputSchema: z.strictObject({ ok: z.boolean() }), allowedRequesters: ["agent", "organizer"], timeoutMs: 100,
    limit: { counter: "searches", scope: "day", max: (o: Org) => o.limits.maxSearchesPerDay },
    async execute() { return { ok: true }; }, ...over,
  } as unknown as ToolDef<never, unknown>);

  async function setup(tool: ToolDef<never, unknown>, orgPatch: Partial<Org> = {}) {
    const store = new JsonFileStore();
    const org = OrgConfig.parse({ ...blankOrg("org_aa", "A"), tools: { allowed: ["serpapi.search"] }, limits: { ...blankOrg("org_aa", "A").limits, maxSearchesPerDay: 2 }, ...orgPatch });
    await store.saveOrg(org);
    await store.saveOrg(blankOrg("org_bb", "B"));
    const usage = new Usage();
    const ex = createToolExecutor({ store, usage, registry: { "serpapi.search": tool }, secrets: () => ["sk-secret-777"] });
    return { store, ex, org };
  }
  const req = (over: Record<string, unknown> = {}) => ({ tool: "serpapi.search", args: { n: 1 }, orgId: "org_aa", requestedBy: "agent" as const, ...over });

  it("denies unknown tools and invalid arguments", async () => {
    const { ex } = await setup(makeTool());
    expect(await ex.executeTool(req({ tool: "rm -rf" }))).toMatchObject({ ok: false, reason: "Unknown tool" });
    expect(await ex.executeTool(req({ tool: "__proto__" }))).toMatchObject({ ok: false, reason: "Unknown tool" });
    expect(await ex.executeTool(req({ args: { n: "x" } }))).toMatchObject({ ok: false, reason: "Invalid arguments" });
    expect(await ex.executeTool(req({ args: { n: 1, extra: true } }))).toMatchObject({ ok: false });
  });

  it("denies tools that aren't on the organization's allowlist, and requesters that aren't permitted", async () => {
    const { ex } = await setup(makeTool(), { tools: { allowed: [] } });
    expect((await ex.executeTool(req())) as { reason: string }).toMatchObject({ ok: false, reason: expect.stringMatching(/not enabled/) });
    const s2 = await setup(makeTool());
    expect(await s2.ex.executeTool(req({ requestedBy: "player" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/may not use/) });
    expect(await s2.ex.executeTool(req({ orgId: "org_zzz" }))).toMatchObject({ ok: false, reason: "Unknown organization" });
  });

  it("enforces the organization/session boundary", async () => {
    const { ex, store } = await setup(makeTool());
    const cfg = (await import("@magicalsafety/engine")).defaultSessionConfig({ id: "ses_x0000001", orgId: "org_bb", joinCode: "AAAAAA" });
    await store.createSession({ id: "ses_x0000001", code: "AAAAAA", orgId: "org_bb", createdAt: 1, status: "lobby", config: cfg, seed: 1, hostId: null, players: [], logHead: null });
    // org_a's tool, but the session belongs to org_b
    expect(await ex.executeTool(req({ sessionId: "ses_x0000001" }))).toMatchObject({ ok: false, reason: "Session belongs to a different organization" });
    expect(await ex.executeTool(req({ sessionId: "ses_nope0001" }))).toMatchObject({ ok: false, reason: "Unknown session" });
  });

  it("enforces usage limits", async () => {
    const { ex } = await setup(makeTool());
    expect((await ex.executeTool(req())).ok).toBe(true);
    expect((await ex.executeTool(req())).ok).toBe(true);
    expect(await ex.executeTool(req())).toMatchObject({ ok: false, reason: expect.stringMatching(/limit of 2/) });
  });

  it("validates outputs, times out, and never throws", async () => {
    const bad = await setup(makeTool({ execute: async () => ({ ok: "yes" }) as never }));
    expect(await bad.ex.executeTool(req())).toMatchObject({ ok: false, reason: "The tool returned an unexpected result" });
    const slow = await setup(makeTool({ execute: () => new Promise(() => {}) }));
    expect(await slow.ex.executeTool(req())).toMatchObject({ ok: false, reason: "The tool timed out" });
    const boom = await setup(makeTool({ execute: async () => { throw new Error("secret detail sk-secret-777"); } }));
    const r = await boom.ex.executeTool(req());
    expect(r).toMatchObject({ ok: false, reason: "The tool failed" });
    expect(JSON.stringify(r)).not.toContain("secret detail");
  });

  it("audits every decision with redacted argument summaries", async () => {
    const { ex } = await setup(makeTool());
    await ex.executeTool(req({ args: { n: 1 } }));
    await ex.executeTool(req({ args: { n: 99, note: "token sk-secret-777" } }));
    const a = ex.audit("org_aa");
    expect(a.map((x) => x.decision)).toEqual(["allowed", "denied"]);
    expect(JSON.stringify(a)).not.toContain("sk-secret-777");
    expect(a[0]).toMatchObject({ tool: "serpapi.search", orgId: "org_aa", requestedBy: "agent" });
  });
});

describe("Draft with Muse Spark", () => {
  it("the deterministic drafter turns a description into valid, editable objectives", () => {
    const d = mockDraft("Teach volunteers to recognize emergencies, call for help, and share the work");
    const v = validateDraft(d);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.objectives.map((o) => o.competency)).toEqual(expect.arrayContaining(["recognition", "help_seeking", "delegation"]));
    const org = OrgConfig.safeParse({ ...blankOrg("org_t1", "T"), objectives: v.value.objectives, rubric: v.value.rubric });
    expect(org.success).toBe(true);
  });

  it("clamps what a model drafts to what the schema allows", () => {
    const draft: ObjectiveDraft = {
      objectives: [
        { title: "Call fast", description: "ok", competency: "help_seeking" },
        { title: "Give 300 mg of aspirin", description: "dose them", competency: "coordination" },
        { title: "Speak up", description: "", competency: "communication" },
      ],
      rubric: [
        { objectiveIndex: 0, indicator: "time_to_help_request_ms", direction: "is_true", target: 9_999_999, weight: 5 },
        { objectiveIndex: 2, indicator: "info_shared_ratio", direction: "at_least", target: 5, weight: 3 },
        { objectiveIndex: 4, indicator: "succeeded", direction: "is_true", target: 0, weight: 1 },
      ],
    };
    const v = validateDraft(draft);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.objectives.map((o) => o.title)).toEqual(["Call fast", "Speak up"]); // the unsafe one is gone
    const call = v.value.rubric.find((r) => r.indicator === "time_to_help_request_ms")!;
    expect(call.direction).toBe("at_most");
    expect(call.target).toBe(300_000);
    expect(v.value.rubric.find((r) => r.indicator === "info_shared_ratio")!.target).toBe(1);
    expect(v.value.rubric.some((r) => r.indicator === "succeeded")).toBe(false); // pointed at a missing objective
    expect(v.policy.some((p) => p.rule.startsWith("safety:"))).toBe(true);
    expect(OrgConfig.safeParse({ ...blankOrg("org_t2", "T"), objectives: v.value.objectives, rubric: v.value.rubric }).success).toBe(true);
  });

  it("refuses a draft where everything was unsafe", () => {
    expect(validateDraft({ objectives: [{ title: "Start chest compressions", description: "", competency: "coordination" }], rubric: [] }).ok).toBe(false);
  });

  it("works over HTTP in demo mode, labeled as rules, and respects the daily limit", async () => {
    const b = await boot();
    const draft = (description: string, orgId?: string) => b.org("/draft", { method: "POST", body: { description, ...(orgId && { orgId }) } });
    const res = await draft("Teach new hires to notice trouble and tell their team what they know");
    const body = (await res.json()) as { generatedBy: string; objectives: { competency: string }[]; rubric: unknown[] };
    expect(res.status).toBe(200);
    expect(body.generatedBy).toBe("rules");
    expect(body.objectives.length).toBeGreaterThan(0);
    expect((await draft("short")).status).toBe(400);
    expect((await b.org("/draft", { method: "POST", body: { description: "x".repeat(30) }, pass: null })).status).toBe(401);

    const org = riversideOrg();
    await b.org("/org_riverside", { method: "PUT", body: { ...org, limits: { ...org.limits, maxBuilderDraftsPerDay: 1 } } });
    expect((await draft("Teach people to call for help early", "org_riverside")).status).toBe(200);
    expect((await draft("Teach people to call for help early", "org_riverside")).status).toBe(429);
  });
});

describe("provider selection per organization", () => {
  const env = (extra: Record<string, string>) => readEnv({ ORGANIZER_PASSCODE: PASS, ...extra });
  const org = (model: Org["model"]): Org => ({ ...blankOrg("org_pp", "P"), model });
  const label = (e: ReturnType<typeof env>, o?: Org) => selectProvider(e, o, new Map()).label;

  it("uses rules without a key, or when the organization chose mock", () => {
    expect(selectProvider(env({}), org({ provider: "meta", modelId: "muse-spark-1.3", allowContributorMode: false }), new Map())).toBeInstanceOf(MockProvider);
    expect(selectProvider(env({ META_MODEL_API_KEY: "k-123456" }), org({ provider: "mock", modelId: "muse-spark-1.3", allowContributorMode: false }), new Map())).toBeInstanceOf(MockProvider);
  });
  it("never uses contributor mode unless the organization AND the server both opt in", () => {
    const key = { META_MODEL_API_KEY: "k-123456" };
    const wants = org({ provider: "meta", modelId: "muse-spark-1.3-contributor", allowContributorMode: true });
    expect(label(env(key), wants)).toBe("muse-spark-1.3"); // server says no
    expect(label(env({ ...key, META_ALLOW_CONTRIBUTOR: "true" }), org({ ...wants.model, allowContributorMode: false }))).toBe("muse-spark-1.3"); // org says no
    expect(label(env({ ...key, META_ALLOW_CONTRIBUTOR: "true" }), wants)).toBe("muse-spark-1.3-contributor");
    expect(label(env(key), undefined)).toBe("muse-spark-1.3");
  });
});
