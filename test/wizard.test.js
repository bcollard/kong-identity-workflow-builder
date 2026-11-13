// Wizard rules: visibility, disabled options, pruning, no dead ends.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLogic, KONNECT, explorable } = require("./lib/app");

const X = loadLogic();
const BLANK = JSON.stringify(X.S);
const reset = (state = {}) => { Object.assign(X.S, JSON.parse(BLANK), state); };
const step = id => X.STEPS.find(s => s.id === id);
const opt = (id, v) => step(id).options(X.S).find(o => o.v === v);
const visible = id => X.visibleSteps().some(s => s.id === id);
const konnectOnly = { skip: !KONNECT && "Konnect control plane out of scope (IWB_DEPLOY=self,konnect to run)" };

test("step ids are unique and every option has a label and a description", () => {
  const ids = X.STEPS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  reset({ product: "api", deploy: KONNECT ? "konnect" : "self", version: "3.16", caller: "apps", cred: "cc", idp: "ki", record: KONNECT ? "principals" : "claims", access: "subcg" });
  for (const st of X.STEPS) for (const o of st.options(X.S)) {
    assert.ok(o.label, `${st.id}/${o.v} has a label`);
    assert.ok(typeof o.s === "string", `${st.id}/${o.v} has a description`);
  }
});

test("version step: Kong Gateway versions for API Gateway and AI Gateway 1.x, AI Gateway runtimes for 2.x", () => {
  const vals = () => step("version").options(X.S).map(o => o.v);
  for (const product of ["api", "ai1"]) { reset({ product }); assert.ok(visible("version")); assert.deepEqual(JSON.parse(JSON.stringify(vals())), ["3.16", "3.15"]); }
  reset({ product: "ai" }); assert.ok(visible("version")); assert.deepEqual(JSON.parse(JSON.stringify(vals())), ["2.3", "2.2"]);
  reset({ product: "api", version: "3.16" }); X.S.product = "ai"; X.prune(); assert.equal(X.S.version, null, "a Kong Gateway version is dropped for AI Gateway 2.x");
});

test("Token Vault: AI Gateway 2.3 MCP servers on Konnect, with an IdP token or a Kong Identity API key", () => {
  const base = { product: "ai", deploy: "konnect", version: "2.3", caller: "employees", target: "mcp", cred: "oidc", idp: "okta", record: "claims" };
  reset(base); assert.ok(visible("upstream")); assert.ok(!opt("upstream", "vault-user").disabled);
  assert.ok(!visible("provider")); X.S.upstream = "vault-user"; assert.ok(visible("provider"));
  assert.ok(opt("provider", "static_secret").disabled, "a static secret is shared only");
  X.S.upstream = "vault-shared"; assert.ok(!opt("provider", "static_secret").disabled);
  reset({ ...base, version: "2.2" }); assert.match(opt("upstream", "vault-user").disabled, /2\.3/);
  reset({ ...base, deploy: "self" }); assert.match(opt("upstream", "vault-user").disabled, /Konnect/);
  reset({ ...base, caller: "apps", cred: "apikey", idp: null, record: "consumers" }); assert.match(opt("upstream", "vault-shared").disabled, /Consumer keys/);
  reset({ ...base, caller: "apps", cred: "apikey", idp: null, record: "principals" }); assert.ok(!opt("upstream", "vault-shared").disabled);
  reset({ ...base, target: "models" }); assert.ok(!visible("upstream"));
});

test("scenario IDs: answers without the later steps keep their payload; AI Gateway IDs from before the version step open as 2.2", () => {
  const api = { product: "api", deploy: "konnect", version: "3.16", caller: "apps", target: null, cred: "apikey", idp: null, record: "principals", access: "subcg", plans: ["tier-cg"], analytics: ["konnect"], upstream: null, provider: null };
  assert.equal(X.scenarioPayload(api).length, 1 + 9 + 2 * 2, "no characters for unanswered later steps");
  const ai = { ...api, product: "ai", version: null, target: "models", cred: "cc", idp: "ki", plans: ["llm"] };
  const old = X.scenarioId(ai, "1.7.0"), p = X.parseScenarioId(old);
  assert.ok(!p.error); assert.equal(p.state.version, "2.2");
  assert.equal(X.legacyPayload(p.state), X.scenarioPayload(ai));
  const tv = { ...ai, version: "2.3", target: "mcp", upstream: "vault-user", provider: "github" };
  assert.deepEqual(JSON.parse(JSON.stringify(X.parseScenarioId(X.scenarioId(tv)).state)), tv);
});

test("target step: AI products only", () => {
  reset({ product: "api" }); assert.ok(!visible("target"));
  reset({ product: "ai" }); assert.ok(visible("target"));
  reset({ product: "ai1" }); assert.ok(visible("target"));
});

test("Kong Identity can't log employees in", () => {
  reset({ product: "api", deploy: "self", caller: "employees", cred: "oidc" });
  assert.ok(opt("idp", "ki").disabled);
  reset({ product: "api", deploy: "self", caller: "apps", cred: "cc" });
  assert.ok(!opt("idp", "ki").disabled);
});

test("Dev Portal apps are unavailable on a self-managed control plane", () => {
  for (const product of ["api", "ai", "ai1"]) { reset({ product, deploy: "self" }); assert.ok(opt("caller", "portal").disabled, product); }
});

test("Dev Portal apps: API Gateway on Konnect only; no Keycloak/AD FS DCR", konnectOnly, () => {
  for (const product of ["ai", "ai1"]) { reset({ product, deploy: "konnect" }); assert.ok(opt("caller", "portal").disabled, product); }
  reset({ product: "api", deploy: "konnect", caller: "portal", cred: "cc" });
  assert.ok(!opt("caller", "portal").disabled);
  assert.ok(opt("idp", "keycloak").disabled); assert.ok(opt("idp", "adfs").disabled); assert.ok(!opt("idp", "okta").disabled);
});

test("self-managed: no principals; API keys map to Consumers", () => {
  for (const product of ["api", "ai", "ai1"]) {
    reset({ product, deploy: "self", version: "3.16", caller: "apps", target: "models", cred: "cc", idp: "okta" });
    assert.ok(opt("record", "principals").disabled, product);
    assert.ok(!opt("record", "claims").disabled, product);
  }
  reset({ product: "api", deploy: "self", version: "3.16", caller: "apps", cred: "apikey" });
  assert.ok(opt("record", "claims").disabled);
  assert.ok(!opt("record", "consumers").disabled);
});

test("self-managed: principal-metadata access and plans, Konnect Analytics and AI Cost Management are disabled", () => {
  reset({ product: "api", deploy: "self", version: "3.16", caller: "apps", cred: "apikey", record: "consumers" });
  assert.ok(opt("access", "meta").disabled);
  assert.ok(opt("plans", "tier-meta").disabled); assert.ok(opt("plans", "bu-meta").disabled);
  assert.ok(opt("analytics", "konnect").disabled);
  assert.ok(!opt("analytics", "prom").disabled); assert.ok(!opt("analytics", "otel").disabled);
  reset({ product: "ai", deploy: "self", caller: "apps", target: "models" });
  assert.ok(opt("analytics", "cost").disabled);
});

test("principals need Konnect; claims need a token", konnectOnly, () => {
  reset({ product: "api", deploy: "konnect", caller: "apps", cred: "apikey" });
  assert.ok(opt("record", "claims").disabled);
  assert.ok(!opt("record", "principals").disabled);
});

test("3.15 disables allow_when and metadata-driven plans", konnectOnly, () => {
  const base = { product: "api", deploy: "konnect", caller: "apps", cred: "apikey", record: "principals" };
  reset({ ...base, version: "3.15" });
  assert.ok(opt("access", "meta").disabled);
  assert.ok(opt("plans", "tier-meta").disabled); assert.ok(opt("plans", "bu-meta").disabled);
  reset({ ...base, version: "3.16" });
  assert.ok(!opt("access", "meta").disabled);
  assert.ok(!opt("plans", "tier-meta").disabled); assert.ok(!opt("plans", "bu-meta").disabled);
});

test("principal-metadata subscriptions: AI Gateway 2.x models and agents, not MCP servers; 1.x on every target", konnectOnly, () => {
  const base = { deploy: "konnect", caller: "apps", cred: "cc", idp: "ki", record: "principals" };
  for (const target of ["models", "a2a", "mcp"]) {
    reset({ ...base, target, product: "ai" }); assert.equal(!!opt("access", "meta").disabled, target === "mcp", `ai ${target}`);
    reset({ ...base, target, product: "ai1", version: "3.16" }); assert.ok(!opt("access", "meta").disabled, `ai1 ${target}`);
  }
});

test("Terraform creates principals with the stable kong/konnect identity resources", konnectOnly, () => {
  for (const [cred, idp, res] of [["apikey", null, "konnect_identity_principal_api_key"], ["cc", "ki", "konnect_identity_principal_identity"], ["cc", "okta", "konnect_identity_principal_identity"]]) {
    reset({ product: "api", deploy: "konnect", version: "3.16", caller: "apps", cred, idp, record: "principals", access: "meta", plans: ["none"], analytics: ["konnect"] });
    const tf = X.genTf(X.S, X.derive(X.S)).text;
    for (const r of ["konnect_identity_directory", "konnect_identity_principal", res]) assert.match(tf, new RegExp(`resource "${r}"`), `${cred}/${idp}: ${r}`);
    assert.doesNotMatch(tf, /konnect-beta/);
  }
});

test("token budgets only on LLM models", () => {
  for (const product of ["ai", "ai1"]) for (const target of ["a2a", "mcp", "models"]) {
    reset({ product, deploy: "self", version: "3.16", caller: "apps", target, cred: "cc", idp: "okta", record: "claims", access: "subcg" });
    assert.equal(!!opt("plans", "llm").disabled, target !== "models", `${product} ${target}`);
  }
});

test("AI Cost Management only on AI Gateway 2.x models", konnectOnly, () => {
  reset({ product: "ai1", deploy: "konnect", version: "3.16", caller: "apps", target: "models" }); assert.ok(opt("analytics", "cost").disabled);
  reset({ product: "ai", deploy: "konnect", caller: "apps", target: "models" }); assert.ok(!opt("analytics", "cost").disabled);
});

test("prune drops answers made invalid by an upstream change", () => {
  reset({ product: "api", deploy: "self", version: "3.16", caller: "apps", cred: "cc", idp: "okta", record: "claims", access: "claimacl", plans: ["tier-cg"], analytics: ["prom"] });
  X.S.cred = "apikey"; X.prune();
  assert.equal(X.S.idp, null, "no IdP for API keys");
  assert.equal(X.S.record, null, "claims need a token");
  assert.equal(X.S.access, null, "groups claim ACL needs claims");
  reset({ product: "ai", deploy: "self", caller: "apps", target: "models" });
  X.S.product = "api"; X.prune();
  assert.equal(X.S.target, null, "target cleared when it becomes invisible");
});

test("prune: moving from Konnect to self-managed drops principals and Konnect Analytics", konnectOnly, () => {
  reset({ product: "api", deploy: "konnect", version: "3.16", caller: "apps", cred: "apikey", record: "principals", access: "meta", plans: ["tier-meta"], analytics: ["konnect"] });
  X.S.deploy = "self"; X.prune();
  assert.equal(X.S.record, null);
  assert.equal(X.S.access, null);
  assert.deepEqual([...X.S.plans], []);
  assert.deepEqual([...X.S.analytics], []);            // Konnect Analytics needs Konnect
});

test("no dead ends: every reachable visible step offers at least one enabled option", () => {
  const dead = [];
  (function walk(i) {
    const vs = X.visibleSteps();
    if (i >= vs.length) return;
    const st = vs[i], opts = explorable(st, X.S);
    if (!opts.length) { dead.push(`${st.id} after ${JSON.stringify(X.S)}`); return; }
    const saved = JSON.stringify(X.S);
    for (const o of opts) { Object.assign(X.S, JSON.parse(saved)); X.S[st.id] = st.multi ? [o.v] : o.v; walk(i + 1); }
    Object.assign(X.S, JSON.parse(saved));
  })(0);
  reset();
  assert.deepEqual(dead.slice(0, 3), []);
});

test("AI Gateway 2.x LLM budget: monthly cost budget, burst cap, prices on the target, per-node counter note", () => {
  for (const version of ["2.2", "2.3"]) {
    reset({ product: "ai", deploy: "self", version, caller: "apps", target: "models", cred: "cc", idp: "okta", record: "claims", access: "claimacl", plans: ["llm"], analytics: ["prom"] });
    const d = X.derive(X.S), y = X.genDeclarative(X.S, d).text;
    assert.match(y, /window_type: calendar/); assert.match(y, /period: month, tokens_count_strategy: cost/);
    assert.match(y, /input_cost: 2, output_cost: 8/);
    assert.ok(d.notes.some(n => /strategy: local/.test(n) && /redis/.test(n)), version);
  }
});

test("MCP servers with an ACL: the apply steps list the access tests", () => {
  reset({ product: "ai", deploy: "self", version: "2.3", caller: "employees", target: "mcp", cred: "oidc", idp: "okta", record: "claims", access: "claimacl", plans: ["none"], analytics: ["prom"] });
  const d = X.derive(X.S), cfg = { decl: X.genDeclarative(X.S, d), api: X.genApi(X.S, d) };
  const notes = X.applyPlan(X.S, d, cfg, X.outputTabs(X.S, cfg)).map(st => st.note).join(" ");
  assert.match(notes, /empty groups claim/);
});
