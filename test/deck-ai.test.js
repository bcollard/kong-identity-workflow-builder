// Self-managed AI Gateway 2.x: the generated file is what `deck ai sync` reads (the ai-deck-converter entity model),
// and what it lowers to is valid Kong config that still matches the blueprint.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");
const { loadLogic, allPaths, runtimeClasses, render, label } = require("./lib/app");
const { checkPlugin } = require("./lib/kong-schema");

const X = loadLogic();
const CLASSES = runtimeClasses(allPaths(X)).filter(c => c.product === "ai" && c.deploy === "self");
const FIELDS = require("./fixtures/aigw-entity-model.fields.json");
const TOOL = path.join(__dirname, "tools/aigw-convert");
const hasGo = spawnSync("go", ["version"]).status === 0;
const noClasses = !CLASSES.length && "no self-managed AI Gateway 2.x paths in scope";

const failures = [];
const fail = (s, msg) => failures.push(`${label(s)}: ${msg}`);
const report = name => { const f = failures.splice(0); assert.equal(f.length, 0, `${name}\n${f.slice(0, 15).join("\n")}${f.length > 15 ? `\n… ${f.length - 15} more` : ""}`); };

/** Keys the converter would silently drop (its YAML decoding ignores unknown fields). */
function unknownKeys(v, def, p, out) {
  if (def === "open" || def === "scalar" || v === null || typeof v !== "object") return out;
  if (typeof def === "string") return out; // recursive type reference: stop
  if ("" in def) return out;               // inline map: any key
  if (Array.isArray(v)) { v.forEach((x, i) => unknownKeys(x, def, `${p}[${i}]`, out)); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (!(k in def)) out.push(`${p}.${k}`);
    else unknownKeys(x, def[k], `${p}.${k}`, out);
  }
  return out;
}

test(`deck ai sync files use only fields the converter reads (${CLASSES.length} classes)`, { skip: noClasses }, () => {
  for (const s of CLASSES) {
    const doc = yaml.load(render(X, s).cfg.decl.text);
    if (!doc || typeof doc !== "object") { fail(s, "empty document"); continue; }
    for (const k of unknownKeys(doc, FIELDS, "", [])) fail(s, `"${k}" is ignored by deck ai sync`);
  }
  report("entity model fields");
});

test("deck ai sync files lower to valid Kong config that matches the blueprint", { skip: noClasses || (!hasGo && "needs Go to run ai-deck-converter (test/tools/aigw-convert)") }, () => {
  const rendered = CLASSES.map(s => ({ s, r: render(X, s) }));
  const res = spawnSync("go", ["run", ".", "convert"], { cwd: TOOL, input: JSON.stringify(rendered.map(x => x.r.cfg.decl.text)), maxBuffer: 1 << 28, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  const out = JSON.parse(res.stdout);
  rendered.forEach(({ s, r }, i) => {
    const { kong, warnings, error } = out[i];
    if (error) return fail(s, `conversion error: ${error}`);
    for (const w of warnings || []) fail(s, `warning: ${w}`);
    const doc = yaml.load(kong);
    // every lowered plugin is valid for AI Gateway 2.2
    const plugins = [...(doc.plugins || []), ...(doc.consumer_groups || []).flatMap(g => g.plugins || []),
      ...(doc.consumers || []).flatMap(c => c.plugins || []),
      ...(doc.services || []).flatMap(sv => [...(sv.plugins || []), ...(sv.routes || []).flatMap(rt => rt.plugins || [])])];
    if (!plugins.length) return fail(s, "lowered config has no plugins");
    for (const p of plugins) {
      const { route, service, consumer, consumer_group, model, tags, ...rest } = p; // FKs and tags written by the converter
      for (const e of checkPlugin(rest, "aigw-2.2", "lowered")) fail(s, e);
    }
    const names = new Set(plugins.map(p => p.name));
    // the route is protected by the chosen strategy, the target plugin exists
    if (!names.has(r.d.auth.plugin)) fail(s, `no ${r.d.auth.plugin} plugin after lowering`);
    const want = { models: "ai-proxy-advanced", a2a: "ai-a2a-proxy", mcp: "ai-mcp-proxy" }[s.target];
    if (!names.has(want)) fail(s, `no ${want} plugin after lowering`);
    if (s.plans.includes("llm") && !names.has("ai-rate-limiting-advanced")) fail(s, "token budget policy not lowered");
    if (s.analytics.includes("prom") && !names.has("prometheus")) fail(s, "prometheus policy not lowered");
    // subscription ACLs land where the converter puts them: acl plugin (models, agents) or default_acl (MCP)
    if (s.access === "subcg") {
      const allow = s.target === "mcp"
        ? plugins.filter(p => p.name === "ai-mcp-proxy").flatMap(p => (p.config.default_acl || []).flatMap(a => a.allow || []))
        : plugins.filter(p => p.name === "acl").flatMap(p => p.config.allow || []);
      if (!allow.includes(r.d.tgt.sub)) fail(s, `subscription group ${r.d.tgt.sub} not enforced after lowering [${allow}]`);
    }
    // groups and consumer membership survive
    const groups = (doc.consumer_groups || []).map(g => g.name).sort();
    if (groups.join() !== r.d.groups.map(g => g.name).sort().join()) fail(s, `lowered groups [${groups}] vs blueprint [${r.d.groups.map(g => g.name)}]`);
    if (s.record === "consumers") {
      const c = (doc.consumers || []).find(x => x.username === r.d.who.name);
      if (!c) fail(s, `consumer ${r.d.who.name} missing after lowering`);
      else if (r.d.groups.length && (c.groups || []).map(g => g.name).sort().join() !== groups.join()) fail(s, `consumer groups [${(c.groups || []).map(g => g.name)}]`);
    }
  });
  report("lowered config");
});
