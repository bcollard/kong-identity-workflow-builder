#!/usr/bin/env node
// Decode a scenario ID with this checkout's code, print the answers, and optionally write the generated files.
//   node tools/scenario.js v1.0.0-1121203032020GS              # answers + support status (JSON)
//   node tools/scenario.js v1.0.0-1121203032020GS --out dir    # also dir/{decl,api,tf}.* as the page shows them
// To reproduce exactly what a link showed, check out the tag it names first: git checkout v<version>.
const fs = require("fs");
const path = require("path");
const { loadLogic } = require("../server/logic");

const [id, flag, dir] = process.argv.slice(2);
if (!id) { console.error("usage: node tools/scenario.js <scenario-id> [--out dir]"); process.exit(2); }
const version = require("../package.json").version;
const X = loadLogic(version);
const r = X.openScenario(id);
const answers = JSON.parse(JSON.stringify(X.S));
const out = { id, minted: r.version || null, checkout: version, supported: r.ok, message: r.message || null, answers };
if (r.version && r.version !== version && r.version !== "dev") out.hint = `git checkout v${r.version} reproduces the original page`;
if (!r.ok) { console.log(JSON.stringify(out, null, 2)); process.exit(1); }
const d = X.derive(X.S), cfg = { decl: X.genDeclarative(X.S, d), api: X.genApi(X.S, d), tf: X.genTf(X.S, d) };
out.tabs = [...X.outputTabs(X.S, cfg)];
out.lab = X.labMatch(X.S) || null;
out.groups = d.groups.map(g => g.name);
out.sequence = X.buildSeq(X.S, d).steps.map((s, i) => `${i + 1}. ${s.f} → ${s.t}: ${s.h}`);
if (flag === "--out") {
  fs.mkdirSync(dir, { recursive: true });
  const ext = { decl: "yaml", api: "sh", tf: "tf" };
  for (const t of out.tabs) fs.writeFileSync(path.join(dir, `${t}.${ext[t]}`), cfg[t].text);
  fs.writeFileSync(path.join(dir, "scenario.json"), JSON.stringify(out, null, 2) + "\n");
  out.written = out.tabs.map(t => path.join(dir, `${t}.${ext[t]}`));
}
console.log(JSON.stringify(out, null, 2));
