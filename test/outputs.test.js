// Generated configuration is parseable and valid against real Kong / kongctl / Terraform schemas.
// One representative per runtime class (analytics collapsed to the richest variant).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const Ajv2020 = require("ajv/dist/2020");
const { KONNECT, loadLogic, allPaths, runtimeClasses, render, label } = require("./lib/app");
const { checkPlugin, checkConfig } = require("./lib/kong-schema");

const X = loadLogic();
const CLASSES = runtimeClasses(allPaths(X));
const FIX = path.join(__dirname, "fixtures");
const TF_RESOURCES = new Set(fs.readFileSync(path.join(FIX, "terraform-resources.txt"), "utf8").split("\n").filter(Boolean));
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validateGateway = ajv.compile(JSON.parse(fs.readFileSync(path.join(FIX, "kongctl-ai_gateway.schema.json"), "utf8")));

const target = s => s.product === "ai" ? "aigw-2.2" : `gw-${s.version || "3.16"}`;

/** Every plugin object in a decK file, with a readable location. */
function deckPlugins(doc) {
  const out = [];
  (doc.plugins || []).forEach((p, i) => out.push([p, `plugins[${i}]`]));
  (doc.consumer_groups || []).forEach(g => (g.plugins || []).forEach((p, i) => out.push([p, `consumer_groups(${g.name}).plugins[${i}]`])));
  (doc.consumers || []).forEach(c => (c.plugins || []).forEach((p, i) => out.push([p, `consumers(${c.username}).plugins[${i}]`])));
  (doc.services || []).forEach(sv => {
    (sv.plugins || []).forEach((p, i) => out.push([p, `services(${sv.name}).plugins[${i}]`]));
    (sv.routes || []).forEach(r => (r.plugins || []).forEach((p, i) => out.push([p, `routes(${r.name}).plugins[${i}]`])));
  });
  return out;
}

const failures = [];
const fail = (s, msg) => failures.push(`${label(s)}: ${msg}`);
const report = name => { const f = failures.splice(0); assert.equal(f.length, 0, `${name}\n${f.slice(0, 15).join("\n")}${f.length > 15 ? `\n… ${f.length - 15} more` : ""}`); };

test(`runtime classes enumerated (${CLASSES.length})`, () => { assert.ok(CLASSES.length > 1000); });

test("no undefined, NaN or [object Object] in any output", () => {
  for (const s of CLASSES) {
    const r = render(X, s);
    for (const [k, o] of Object.entries(r.cfg)) if (/undefined|NaN|\[object /.test(o.text)) fail(s, `${k} output contains undefined/NaN/[object]`);
  }
  report("bad tokens");
});

test("declarative output parses as YAML with the expected top-level shape", () => {
  for (const s of CLASSES) {
    const r = render(X, s);
    let doc;
    try { doc = yaml.load(r.cfg.decl.text); } catch (e) { fail(s, `YAML: ${e.message.split("\n")[0]}`); continue; }
    if (s.product === "ai") { if (!Array.isArray(doc?.ai_gateways)) fail(s, "kongctl file without ai_gateways"); }
    else if (doc?._format_version !== "3.0") fail(s, "decK file without _format_version 3.0");
  }
  report("YAML");
});

test("decK plugins match the Kong plugin schemas of the selected version", () => {
  for (const s of CLASSES.filter(c => c.product !== "ai")) {
    const doc = yaml.load(render(X, s).cfg.decl.text);
    for (const [p, where] of deckPlugins(doc)) for (const e of checkPlugin(p, target(s), where)) fail(s, e);
  }
  report("decK plugin schema");
});

test("AI Gateway 2.x auth strategies and policies match the AI Gateway 2.2 plugin schemas", () => {
  for (const s of CLASSES.filter(c => c.product === "ai")) {
    const doc = yaml.load(render(X, s).cfg.decl.text);
    for (const gw of doc.ai_gateways) {
      for (const a of gw.auth_strategies || []) for (const e of checkConfig(a.type, a.config, "aigw-2.2", `auth_strategies(${a.name})`)) fail(s, e);
      for (const p of gw.policies || []) for (const e of checkConfig(p.type, p.config, "aigw-2.2", `policies(${p.name})`)) fail(s, e);
    }
  }
  report("AI Gateway 2.2 plugin schema");
});

test("kongctl AI Gateway files match the kongctl schema", { skip: !KONNECT && "Konnect control plane out of scope" }, () => {
  for (const s of CLASSES.filter(c => c.product === "ai" && c.deploy === "konnect")) {
    const doc = yaml.load(render(X, s).cfg.decl.text);
    for (const gw of doc.ai_gateways) {
      // Known gap in `kongctl explain` 1.20.1: principals.match_consumer_groups is missing from the schema although the
      // Konnect API accepts it (applied with kongctl 1.20.1 in the lab). The field is still checked against the AI Gateway
      // 2.2 openid-connect schema below.
      const forAjv = JSON.parse(JSON.stringify(gw));
      for (const a of forAjv.auth_strategies || []) if (a.config?.principals) delete a.config.principals.match_consumer_groups;
      // The explain schema describes top-level resource files, which carry an "ai_gateway" back-reference.
      // Nested items get it implicitly (lab-verified), so add it before validating.
      for (const k of Object.keys(forAjv)) if (Array.isArray(forAjv[k])) forAjv[k].forEach(it => { if (it && typeof it === "object") it.ai_gateway ??= "!ref aigw"; });
      // `kongctl explain` 1.20.1 exports models as an empty closed object; check the fields the lab-applied file used instead.
      for (const m of forAjv.models || []) for (const k of ["ref", "name", "display_name", "type", "formats", "targets", "config"]) if (!(k in m)) fail(s, `kongctl model ${m.name} lacks ${k}`);
      delete forAjv.models;
      if (!validateGateway(forAjv)) for (const e of validateGateway.errors.slice(0, 3))
        fail(s, `kongctl ${e.instancePath || "/"} ${e.message}${e.params?.additionalProperty ? " (" + e.params.additionalProperty + ")" : ""}${e.params?.allowedValues ? " " + JSON.stringify(e.params.allowedValues) : ""}`);
    }
  }
  report("kongctl schema");
});

test("API calls carry valid JSON bodies", () => {
  for (const s of CLASSES) {
    const text = render(X, s).cfg.api.text;
    for (const m of text.matchAll(/-d '((?:[^']|'\$[A-Z_]+')*)'/g)) {
      const body = m[1].replace(/'\$[A-Z_]+'/g, "X");
      try { JSON.parse(body); } catch (e) { fail(s, `JSON body: ${e.message} in ${body.slice(0, 80)}`); }
    }
  }
  report("API JSON");
});

test("Terraform uses existing konnect resources and balanced braces", { skip: !KONNECT && "Konnect control plane out of scope" }, () => {
  for (const s of CLASSES.filter(c => c.deploy === "konnect")) {
    const text = render(X, s).cfg.tf.text;
    for (const m of text.matchAll(/resource "([a-z0-9_]+)"/g)) if (!TF_RESOURCES.has(m[1])) fail(s, `unknown Terraform resource ${m[1]}`);
    const code = text.replace(/#.*$/gm, "").replace(/"(?:[^"\\]|\\.)*"/g, '""');
    for (const [o, c] of [["{", "}"], ["[", "]"], ["(", ")"]]) {
      const n = ch => code.split(ch).length - 1;
      if (n(o) !== n(c)) fail(s, `unbalanced ${o}${c} in Terraform`);
    }
  }
  report("Terraform");
});
