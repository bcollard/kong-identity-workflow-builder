// Wizard rules: visibility, disabled options, pruning, no dead ends.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLogic } = require("./lib/app");

const X = loadLogic();
const BLANK = JSON.stringify(X.S);
const reset = (state = {}) => { Object.assign(X.S, JSON.parse(BLANK), state); };
const step = id => X.STEPS.find(s => s.id === id);
const opt = (id, v) => step(id).options(X.S).find(o => o.v === v);
const visible = id => X.visibleSteps().some(s => s.id === id);

test("step ids are unique and every option has a label and a description", () => {
  const ids = X.STEPS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length);
  reset({ product: "api", deploy: "konnect", version: "3.16", caller: "apps", cred: "cc", idp: "ki", record: "principals", access: "subcg" });
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
  reset({ product: "api", deploy: "konnect", caller: "employees", cred: "oidc" });
  assert.ok(opt("idp", "ki").disabled);
  reset({ product: "api", deploy: "konnect", caller: "apps", cred: "cc" });
  assert.ok(!opt("idp", "ki").disabled);
});

test("Dev Portal apps: API Gateway on Konnect only; no Keycloak/AD FS DCR", () => {
  for (const product of ["ai", "ai1"]) { reset({ product, deploy: "konnect" }); assert.ok(opt("caller", "portal").disabled, product); }
  reset({ product: "api", deploy: "self" }); assert.ok(opt("caller", "portal").disabled);
  reset({ product: "api", deploy: "konnect", caller: "portal", cred: "cc" });
  assert.ok(!opt("caller", "portal").disabled);
  assert.ok(opt("idp", "keycloak").disabled); assert.ok(opt("idp", "adfs").disabled); assert.ok(!opt("idp", "okta").disabled);
});

test("principals need Konnect; claims need a token", () => {
  reset({ product: "api", deploy: "self", caller: "apps", cred: "cc", idp: "okta" });
  assert.ok(opt("record", "principals").disabled);
  reset({ product: "api", deploy: "konnect", caller: "apps", cred: "apikey" });
  assert.ok(opt("record", "claims").disabled);
  assert.ok(!opt("record", "principals").disabled);
});

test("3.15 disables allow_when and metadata-driven plans", () => {
  const base = { product: "api", deploy: "konnect", caller: "apps", cred: "apikey", record: "principals" };
  reset({ ...base, version: "3.15" });
  assert.ok(opt("access", "meta").disabled);
  assert.ok(opt("plans", "tier-meta").disabled); assert.ok(opt("plans", "bu-meta").disabled);
  reset({ ...base, version: "3.16" });
  assert.ok(!opt("access", "meta").disabled);
  assert.ok(!opt("plans", "tier-meta").disabled); assert.ok(!opt("plans", "bu-meta").disabled);
});

test("AI Gateway 2.x can't do group-free subscriptions on models; 1.x can", () => {
  const base = { deploy: "konnect", caller: "apps", target: "models", cred: "cc", idp: "ki", record: "principals" };
  reset({ ...base, product: "ai" }); assert.ok(opt("access", "meta").disabled);
  reset({ ...base, product: "ai1", version: "3.16" }); assert.ok(!opt("access", "meta").disabled);
});

test("token budgets only on LLM models; AI Cost Management only on AI Gateway 2.x models", () => {
  for (const product of ["ai", "ai1"]) {
    reset({ product, deploy: "konnect", version: "3.16", caller: "apps", target: "a2a", cred: "cc", idp: "ki", record: "principals", access: "subcg" });
    assert.ok(opt("plans", "llm").disabled, `${product} a2a`);
  }
  reset({ product: "ai1", deploy: "konnect", version: "3.16", caller: "apps", target: "models" }); assert.ok(opt("analytics", "cost").disabled);
  reset({ product: "ai", deploy: "konnect", caller: "apps", target: "models" }); assert.ok(!opt("analytics", "cost").disabled);
});

test("prune drops answers made invalid by an upstream change", () => {
  reset({ product: "api", deploy: "konnect", version: "3.16", caller: "apps", cred: "apikey", record: "principals", access: "meta", plans: ["tier-meta"], analytics: ["konnect"] });
  X.S.deploy = "self"; X.prune();
  assert.equal(X.S.record, null);
  assert.equal(X.S.access, null);
  assert.deepEqual([...X.S.plans], []);
  assert.deepEqual([...X.S.analytics], []);            // Konnect Analytics needs Konnect
  reset({ product: "ai", deploy: "konnect", caller: "apps", target: "models" });
  X.S.product = "api"; X.prune();
  assert.equal(X.S.target, null, "target cleared when it becomes invisible");
});

test("no dead ends: every reachable visible step offers at least one enabled option", () => {
  const dead = [];
  (function walk(i) {
    const vs = X.visibleSteps();
    if (i >= vs.length) return;
    const st = vs[i], opts = st.options(X.S).filter(o => !o.disabled);
    if (!opts.length) { dead.push(`${st.id} after ${JSON.stringify(X.S)}`); return; }
    const saved = JSON.stringify(X.S);
    for (const o of opts) { Object.assign(X.S, JSON.parse(saved)); X.S[st.id] = st.multi ? [o.v] : o.v; walk(i + 1); }
    Object.assign(X.S, JSON.parse(saved));
  })(0);
  reset();
  assert.deepEqual(dead.slice(0, 3), []);
});
