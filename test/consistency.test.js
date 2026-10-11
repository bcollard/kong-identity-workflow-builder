// Cross-panel consistency on every wizard path: blueprint, group table, sequence, inspector and generated config agree.
const test = require("node:test");
const assert = require("node:assert/strict");
const yaml = require("js-yaml");
const { DEPLOYS, KONNECT, loadLogic, allPaths, runtimeClasses, render, label } = require("./lib/app");

const X = loadLogic();
const PATHS = allPaths(X);
const CLASSES = runtimeClasses(PATHS);

const failures = [];
const fail = (s, msg) => failures.push(`${label(s)}: ${msg}`);
const report = name => { const f = failures.splice(0); assert.equal(f.length, 0, `${name}\n${f.slice(0, 15).join("\n")}${f.length > 15 ? `\n… ${f.length - 15} more` : ""}`); };

/** Names of plugins configured anywhere in a decK document. */
function deckPluginNames(doc) {
  const names = new Set();
  const add = list => (list || []).forEach(p => names.add(p.name));
  add(doc.plugins);
  (doc.consumer_groups || []).forEach(g => add(g.plugins));
  (doc.consumers || []).forEach(c => add(c.plugins));
  (doc.services || []).forEach(s => { add(s.plugins); (s.routes || []).forEach(r => add(r.plugins)); });
  return names;
}
/** In AI Gateway 2.x, plugins come from entities: map each to the plugin it becomes. */
function kongctlPluginNames(gw) {
  const names = new Set();
  (gw.auth_strategies || []).forEach(a => names.add(a.type));
  (gw.policies || []).forEach(p => names.add(p.type));
  if ((gw.models || []).length) names.add("ai-proxy-advanced");
  if ((gw.agents || []).length) names.add("ai-a2a-proxy");
  if ((gw.mcp_servers || []).length) names.add("ai-mcp-proxy");
  const acl = [...(gw.models || []), ...(gw.agents || []), ...(gw.mcp_servers || [])].some(e => e.access?.acls || e.access?.default_tool_acls);
  if (acl) names.add("acl");
  return names;
}
/** Plugins the Konnect API tab creates on the control plane (bodies of POST …/core-entities/plugins). */
function apiPlugins(text) {
  return [...text.matchAll(/core-entities\/plugins[^\n]*\n\s*-d '((?:[^']|'\$[A-Z_]+')*)'/g)].map(m => JSON.parse(m[1].replace(/'\$[A-Z_]+'/g, "X")));
}
const LANE_PLUGIN = { "ai-rate-limit-adv": "ai-rate-limiting-advanced", "rate-limiting-adv": "rate-limiting-advanced", "ai-proxy-adv": "ai-proxy-advanced" };

const parsed = new Map();
function view(s) {
  const r = render(X, s);
  const doc = yaml.load(r.cfg.decl.text);
  const gw = doc.ai_gateways ? doc.ai_gateways[0] : s.product === "ai" ? doc : null; // kongctl (Konnect) or flat deck ai sync file (self-managed)
  return { ...r, doc, gw };
}
for (const s of CLASSES) parsed.set(label(s), view(s));

test(`paths enumerated on ${DEPLOYS.join(" + ")} (${PATHS.length} paths, ${CLASSES.length} runtime classes)`, () => {
  assert.ok(PATHS.length > (KONNECT ? 60000 : 1000));
  assert.ok(PATHS.every(p => DEPLOYS.includes(p.deploy)), "only in-scope control planes");
});

test("groups table = consumer groups declared in the config (names unique)", () => {
  for (const s of CLASSES) {
    const { d, doc, gw } = parsed.get(label(s));
    const want = d.groups.map(g => g.name);
    if (new Set(want).size !== want.length) fail(s, `duplicate group names ${want}`);
    const got = (gw ? gw.consumer_groups : doc.consumer_groups || []) || [];
    const gotNames = got.map(g => g.name);
    if (want.sort().join() !== gotNames.sort().join()) fail(s, `table [${want}] vs config [${gotNames}]`);
  }
  report("groups");
});

test("subscription ACLs only reference declared groups", () => {
  for (const s of CLASSES.filter(c => c.access === "subcg")) {
    const { d, doc, gw } = parsed.get(label(s));
    const groups = new Set(d.groups.map(g => g.name));
    const lists = [];
    if (gw) for (const e of [...(gw.models || []), ...(gw.agents || []), ...(gw.mcp_servers || [])]) lists.push(e.access?.acls?.allow || []);
    else for (const sv of doc.services || []) for (const p of [...(sv.plugins || []), ...(sv.routes || []).flatMap(r => r.plugins || [])]) {
      if (p.name === "acl") lists.push(p.config.allow || []);
      if (p.name === "ai-mcp-proxy") (p.config.default_acl || []).forEach(a => lists.push(a.allow || []));
    }
    if (!lists.length) fail(s, "subscription chosen but no ACL generated");
    for (const n of lists.flat()) if (!groups.has(n)) fail(s, `ACL allows "${n}" which isn't a declared group`);
  }
  report("ACL references");
});

test("identity record shows up in the config: principals, claims, consumers", () => {
  for (const s of CLASSES) {
    const { cfg } = parsed.get(label(s));
    const t = cfg.decl.text;
    const hasPrincipals = /principals:/.test(t);
    if (s.record === "principals" && !hasPrincipals) fail(s, "principals record but no principals block");
    if (s.record !== "principals" && hasPrincipals) fail(s, `principals block for record ${s.record}`);
    if (s.record === "claims" && !/credential_claim/.test(t)) fail(s, "claims record without credential_claim");
    if (s.record === "consumers" && !/\bconsumers:/.test(t)) fail(s, "consumers record without consumers");
    if (s.record !== "consumers" && /\nconsumers:|\n    consumers:/.test(t)) fail(s, `consumers declared for record ${s.record}`);
    if (s.deploy === "self" && hasPrincipals) fail(s, "principals on a self-managed control plane");
  }
  report("identity record");
});

test("sequence diagram is well formed and its plugin lanes match the config", () => {
  for (const s of CLASSES) {
    const { seq, doc, gw } = parsed.get(label(s));
    const ids = seq.lanes.map(l => l.id);
    if (new Set(ids).size !== ids.length) fail(s, `duplicate lanes ${ids}`);
    if (seq.steps.some(st => !ids.includes(st.f) || !ids.includes(st.t))) fail(s, "a step references a missing lane");
    if (seq.steps.at(-1).t !== "c") fail(s, "last step doesn't return to the caller");
    if (!seq.steps.some(st => st.f === "c")) fail(s, "the caller never sends anything");
    const plugins = gw ? kongctlPluginNames(gw) : deckPluginNames(doc);
    for (const p of apiPlugins(parsed.get(label(s)).cfg.api.text)) plugins.add(p.name); // applied by the Konnect API tab
    for (const l of seq.lanes.filter(l => l.kind === "plugin")) {
      const name = LANE_PLUGIN[l.label] || l.label;
      if (!plugins.has(name)) fail(s, `lane "${l.label}" has no matching plugin in the config [${[...plugins]}]`);
    }
    const lanePlugins = new Set(seq.lanes.filter(l => l.kind === "plugin").map(l => LANE_PLUGIN[l.label] || l.label));
    for (const p of ["openid-connect", "key-auth", "acl", "ace", "rate-limiting", "rate-limiting-advanced", "ai-rate-limiting-advanced", "ai-proxy-advanced", "ai-a2a-proxy", "ai-mcp-proxy"])
      if (plugins.has(p) && !lanePlugins.has(p) && !(p === "acl" && s.target === "mcp")) fail(s, `config has ${p} but the sequence shows no lane for it`);
  }
  report("sequence");
});

test("inspector lists every group and the recorded usage matches the analytics plan", () => {
  for (const s of PATHS) {
    const r = render(X, s);
    const acc = {}; r.seq.steps.forEach(st => Object.assign(acc, st.set || {}));
    for (const g of r.d.groups) if (!(acc.groups || "").includes(g.name)) { fail(s, `inspector misses group ${g.name}`); break; }
    const tools = r.d.an.map(a => a.tool);
    const want = { konnect: "Konnect Analytics", cost: "AI Cost Management (Beta)", agentan: "Agent analytics", prom: "Prometheus + Grafana", otel: "OpenTelemetry" };
    for (const [k, tool] of Object.entries(want)) if (s.analytics.includes(k) !== tools.includes(tool)) fail(s, `analytics "${k}" selected=${s.analytics.includes(k)} but plan has ${tool}=${tools.includes(tool)}`);
    if (r.d.an.length && !acc.analytics) fail(s, "analytics selected but the last step records no usage");
  }
  report("inspector / analytics");
});

test("version rules: nothing 3.16-only is generated for 3.15", () => {
  for (const s of CLASSES.filter(c => c.version === "3.15")) {
    const { cfg } = parsed.get(label(s));
    const t = cfg.decl.text + cfg.tf.text;
    for (const re of [/allow_when/, /expressions/, /identifier: principal|identifier = "principal"/, /limit_by: principal|limit_by = "principal"/, /enable_principal_attribute/])
      if (re.test(t)) fail(s, `3.16-only ${re} in 3.15 output`);
  }
  report("3.15");
});

test("output tabs: Terraform only for Konnect, Konnect API only when there is something to call", () => {
  for (const s of CLASSES) {
    const { tabs, cfg } = parsed.get(label(s));
    if (tabs[0] !== "decl") fail(s, "first tab isn't the declarative config");
    if ((s.deploy === "konnect") !== tabs.includes("tf")) fail(s, `deploy=${s.deploy} tabs=${tabs}`);
    if (/Nothing to call/.test(cfg.api.text) === tabs.includes("api")) fail(s, `api tab shown=${tabs.includes("api")} with ${cfg.api.text.length} chars`);
  }
  report("tabs");
});

test("no lab badge on self-managed paths (the lab ran on Konnect)", () => {
  for (const s of PATHS.filter(p => p.deploy === "self")) {
    const lab = X.labMatch(Object.assign(X.S, JSON.parse(JSON.stringify(s))));
    if (lab) fail(s, `badge ${lab}`);
  }
  report("self-managed badges");
});

test("lab badge only on the exact combinations that ran in the lab", { skip: !KONNECT && "Konnect control plane out of scope" }, () => {
  const seen = {};
  for (const s of PATHS) {
    const lab = X.labMatch(Object.assign(X.S, JSON.parse(JSON.stringify(s))));
    if (!lab) continue;
    seen[lab] = true;
    const ok = {
      "AI-1": s.product === "ai" && s.caller === "employees" && s.idp === "keycloak" && s.record === "claims",
      "AI-2": s.product === "ai" && s.caller === "apps" && s.idp === "ki" && s.record === "principals",
      "AI-3": s.product === "ai" && s.caller === "agents" && s.target === "a2a",
      "API-1": s.product === "api" && s.version === "3.16" && s.cred === "apikey" && s.record === "principals",
      "API-2": s.product === "api" && s.version === "3.16" && s.idp === "keycloak" && s.record === "claims",
    }[lab];
    if (!ok) fail(s, `badge ${lab} on a different combination`);
    if (s.deploy !== "konnect") fail(s, `badge ${lab} on self-managed`);
  }
  for (const id of ["AI-1", "AI-2", "AI-3", "API-1", "API-2"]) if (!seen[id]) failures.push(`badge ${id} is unreachable`);
  report("lab badges");
});

test("AI Gateway 2.x: every model target's provider is declared in the same file (Konnect rejects unknown providers)", () => {
  for (const s of CLASSES.filter(c => c.product === "ai" && c.target === "models")) {
    const { gw } = parsed.get(label(s));
    const declared = new Set((gw.model_providers || []).map(p => p.name));
    for (const m of gw.models || []) for (const t of m.targets || []) if (!declared.has(t.provider)) fail(s, `model ${m.name} uses undeclared provider ${t.provider}`);
    for (const p of gw.model_providers || []) for (const h of p.config?.auth?.headers || [])
      if (/\{vault:\/\//.test(h.value) && !/^\{vault:\/\/[^}]+\}$/.test(h.value)) fail(s, `provider ${p.name}: a vault reference must be the whole value, got "${h.value}"`);
  }
  report("model providers");
});

test("token groups only block callers when access is decided by subscription groups", () => {
  for (const s of CLASSES) {
    const { cfg } = parsed.get(label(s));
    for (const m of cfg.decl.text.matchAll(/consumer_groups_optional: (\S+)/g)) {
      const want = String(s.access !== "subcg");
      if (m[1] !== want) fail(s, `consumer_groups_optional: ${m[1]} with access ${s.access} (want ${want})`);
    }
  }
  report("consumer_groups_optional");
});

test("How to apply: every tab is placed, API-only sections make the API tab required, roles are valid", () => {
  const ROLES = new Set(["required", "recommended", "choice", "partial"]);
  for (const s of CLASSES) {
    const { d, cfg, tabs } = parsed.get(label(s));
    const plan = X.applyPlan(s, d, cfg, tabs);
    const placed = new Set(plan.flatMap(st => st.items.map(i => i.tab)));
    for (const t of tabs) if (!placed.has(t)) fail(s, `tab ${t} missing from How to apply`);
    for (const st of plan) for (const i of st.items) {
      if (!tabs.includes(i.tab)) fail(s, `How to apply points to hidden tab ${i.tab}`);
      if (!ROLES.has(i.role)) fail(s, `role ${i.role}`);
    }
    const apiRole = plan.flatMap(st => st.items).find(i => i.tab === "api")?.role;
    if (/↳ API only/.test(cfg.api.text) && tabs.includes("api") && apiRole !== "required") fail(s, "API-only sections but the API tab isn't required");
    if (s.deploy === "self" && !/database-backed/.test(plan.at(-1).note) && !d.ai) fail(s, "self-managed decK without the database note");
    // every section of the API tab carries a tag (except the env header)
    if (tabs.includes("api")) for (const sec of cfg.api.text.split(/\n\n(?=# )/).slice(0)) {
      if (/^export KONNECT_API/.test(sec)) continue;
      if (/^# /.test(sec) && !/\n# ↳ /.test(sec)) fail(s, `untagged API section: ${sec.split("\n")[0]}`);
    }
  }
  report("How to apply");
});

test("3.16 HTTPS-only route default is flagged for gateway products on 3.16", () => {
  for (const s of CLASSES.filter(c => c.product !== "ai")) {
    const { d } = parsed.get(label(s));
    const flagged = [...d.warns].some(w => /protocols \[https\]/.test(w));
    if (flagged !== (s.version !== "3.15")) fail(s, `3.16 HTTPS warning shown=${flagged}`);
  }
  report("3.16 HTTPS");
});
