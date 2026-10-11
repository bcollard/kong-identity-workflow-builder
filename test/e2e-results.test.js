// Recorded end-to-end runs (e2e/results/*.json): well formed, tied to a decodable scenario, and reported honestly.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { loadLogic, render } = require("./lib/app");
const { RESULTS_DIR } = require("../server/logic");

const X = loadLogic();
const files = fs.existsSync(RESULTS_DIR) ? fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json")) : [];

test(`recorded results are well formed (${files.length})`, { skip: !files.length && "no results recorded" }, () => {
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8"));
    assert.equal(f, `${r.payload}.json`, `${f}: named after its payload`);
    const p = X.parseScenarioId(r.id);
    assert.ok(!p.error, `${f}: id decodes`);
    assert.equal(X.scenarioPayload(p.state), r.payload, `${f}: payload matches the id`);
    for (const k of ["date", "builder", "environment", "raw_generated_file"]) assert.ok(r[k], `${f}: ${k}`);
    assert.ok(Object.keys(r.hashes || {}).length, `${f}: hashes of the applied tabs`);
    assert.equal(r.passed, r.checks.filter(c => c.pass).length, `${f}: passed count`);
    assert.equal(r.failed, r.checks.filter(c => !c.pass).length, `${f}: failed count`);
    assert.doesNotMatch(JSON.stringify(r), /runlocal\.dev|kpat_|spat_|client_secret":"[A-Za-z0-9]/, `${f}: nothing private`);
  }
});

test("the page reports each result as current or as tested with an earlier output", () => {
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8"));
    const v = render(X, X.parseScenarioId(r.id).state);
    assert.ok(v.e2e, `${f}: found by the page`);
    const current = Object.entries(r.hashes).every(([t, h]) => X.outputHash(v.cfg[t].text) === h);
    assert.equal(v.e2e.current, current, `${f}: current flag`);
    if (!current) console.log(`  note: ${r.id} was tested with an earlier output (${r.builder}); re-run it to refresh the badge`);
  }
});
