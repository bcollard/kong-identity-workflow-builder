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

test("version step: shown for API Gateway and AI Gateway 1.x, hidden for AI Gateway 2.x", () => {
  reset({ product: "api" }); assert.ok(visible("version"));
  reset({ product: "ai1" }); assert.ok(visible("version"));
  reset({ product: "ai" }); assert.ok(!visible("version"));
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

test("AI Gateway 2.x can't do group-free subscriptions on models; 1.x can", konnectOnly, () => {
  const base = { deploy: "konnect", caller: "apps", target: "models", cred: "cc", idp: "ki", record: "principals" };
  reset({ ...base, product: "ai" }); assert.ok(opt("access", "meta").disabled);
  reset({ ...base, product: "ai1", version: "3.16" }); assert.ok(!opt("access", "meta").disabled);
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
