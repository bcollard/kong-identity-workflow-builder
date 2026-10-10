// Scenario IDs: unique, reversible, version-tagged, and stable across releases (codes are append-only).
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("child_process");
const http = require("http");
const vm = require("vm");
const { loadLogic, allPaths, label } = require("./lib/app");

const X = loadLogic();
const PATHS = allPaths(X);
const BLANK = JSON.stringify(X.S);
const pick = s => Object.fromEntries(X.ID_STEPS.map(k => [k, s[k]]));

test(`every path has a unique ID that decodes to the same answers (${PATHS.length} paths)`, () => {
  const seen = new Map(), errs = [];
  for (const p of PATHS) {
    const pl = X.scenarioPayload(p);
    if (seen.has(pl)) errs.push(`${label(p)} and ${seen.get(pl)} share ${pl}`);
    seen.set(pl, label(p));
    const r = X.parseScenarioId(X.scenarioId(p, "1.2.3"));
    if (r.error || r.version !== "1.2.3" || JSON.stringify(pick(r.state)) !== JSON.stringify(pick(p))) errs.push(`${label(p)} doesn't round-trip`);
  }
  assert.deepEqual(errs.slice(0, 5), []);
});

test("every option any step can offer has a permanent code (all control planes)", () => {
  const missing = new Set();
  (function walk(i) { // all deploys, regardless of the test scope
    const vs = X.visibleSteps();
    if (i >= vs.length) return;
    const st = vs[i], saved = JSON.stringify(X.S);
    for (const o of st.options(X.S)) {
      if (!X.CODES[st.id]?.includes(o.v)) missing.add(`${st.id}=${o.v}`);
      if (o.disabled) continue;
      Object.assign(X.S, JSON.parse(saved)); X.S[st.id] = st.multi ? [o.v] : o.v; walk(i + 1);
    }
    Object.assign(X.S, JSON.parse(saved));
  })(0);
  Object.assign(X.S, JSON.parse(BLANK));
  assert.deepEqual([...missing], []);
  assert.deepEqual([...X.ID_STEPS].sort(), [...X.STEPS.map(s => s.id)].sort(), "every wizard step is encoded");
  for (const k of ["plans", "analytics"]) assert.ok(X.CODES[k].length <= 10, `${k}: format 1 holds 10 multi-choice codes`);
  for (const [k, v] of Object.entries(X.CODES)) assert.ok(v.length <= 31 && new Set(v).size === v.length, `${k}: ≤ 31 unique codes`);
});

test("codes are append-only compared with the last release tag", t => {
  let tag;
  try { tag = execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return t.skip("no release tag yet"); }
  const html = execFileSync("git", ["show", `${tag}:site/index.html`], { encoding: "utf8" });
  const cut = html.indexOf("/* ---------- result rendering");
  const src = html.slice(html.lastIndexOf("<script>", cut) + 8, cut);
  const ctx = vm.createContext({});
  vm.runInContext(`${src}\nthis.R={ID_STEPS,CODES};`, ctx);
  const old = ctx.R;
  assert.deepEqual([...X.ID_STEPS.slice(0, old.ID_STEPS.length)], [...old.ID_STEPS], `ID_STEPS changed since ${tag}`);
  for (const [k, v] of Object.entries(old.CODES)) assert.deepEqual([...X.CODES[k].slice(0, v.length)], [...v], `CODES.${k} changed since ${tag}`);
});

test("IDs carry the minting version; the payload doesn't depend on it", () => {
  const s = PATHS[0];
  assert.match(X.scenarioId(s, "1.0.0"), /^v1\.0\.0-1[0-9A-Z]+$/);
  assert.equal(X.scenarioId(s, "1.0.0").split("-")[1].slice(0, -1), X.scenarioId(s, "2.5.0").split("-")[1].slice(0, -1));
  assert.notEqual(X.scenarioId(s, "1.0.0"), X.scenarioId(s, "2.5.0"));
});

test("typos, truncation and foreign strings are rejected; ambiguous letters are tolerated", () => {
  const id = X.scenarioId(PATHS[100], "1.0.0");
  const flip = (str, i) => str.slice(0, i) + (str[i] === "2" ? "3" : "2") + str.slice(i + 1);
  for (let i = id.indexOf("-") + 2; i < id.length; i++) assert.ok(X.parseScenarioId(flip(id, i)).error, `flip at ${i}`);
  assert.ok(X.parseScenarioId(id.slice(0, -2)).error);
  assert.ok(X.parseScenarioId("hello").error);
  assert.ok(!X.parseScenarioId(id.toLowerCase()).error, "case-insensitive");
});

test("opening an ID: same version, older version, unknown codes, answers this version no longer accepts", () => {
  const reset = () => Object.assign(X.S, JSON.parse(BLANK));
  const s = PATHS.find(p => p.product === "api" && p.record === "consumers");
  reset(); let r = X.openScenario(X.scenarioId(s, X.APP_VERSION));
  assert.ok(r.ok); assert.equal(r.message, "");
  reset(); r = X.openScenario(X.scenarioId(s, "0.9.0"));
  assert.ok(r.ok); assert.match(r.message, /Shared from v0\.9\.0/);
  // an option code this version doesn't know (minted by a newer release)
  const body = `v9.0.0-${X.scenarioPayload(s).slice(0, 1)}V${X.scenarioPayload(s).slice(2)}`;
  const future = body + [...body].reduce((a, c, i) => (a * 31 + c.charCodeAt(0) * (i + 1)) % 32, 7).toString().replace(/.*/, n => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[n]);
  reset(); r = X.openScenario(future);
  assert.ok(!r.ok); assert.deepEqual([...r.unknown], ["product#26"]);
  // a combination the wizard forbids: principals on a self-managed control plane
  reset(); r = X.openScenario(X.scenarioId({ ...s, deploy: "self", record: "principals" }, "1.0.0"));
  assert.ok(!r.ok); assert.ok(r.dropped.includes("record"), r.message);
  reset();
});

test("server: routes, version stamp and scenario API", async () => {
  process.env.APP_VERSION = "1.4.0";
  delete require.cache[require.resolve("../server/server")];
  const { server } = require("../server/server");
  await new Promise(r => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = p => new Promise((ok, ko) => http.get(base + p, res => { let b = ""; res.on("data", c => b += c); res.on("end", () => ok({ code: res.statusCode, headers: res.headers, body: b })); }).on("error", ko));
  try {
    assert.equal((await get("/")).headers.location, "/identity-paths/");
    const page = await get("/identity-paths/");
    assert.equal(page.code, 200); assert.match(page.body, /const APP_VERSION = "1\.4\.0";/);
    const s = PATHS.find(p => p.analytics.includes("prom"));
    const id = X.scenarioId(s, "1.3.0");
    assert.equal((await get(`/identity-paths/s/${id}`)).code, 200);
    const api = JSON.parse((await get(`/identity-paths/api/scenarios/${id}`)).body);
    assert.equal(api.minted, "1.3.0"); assert.equal(api.running, "1.4.0"); assert.equal(api.supported, true);
    assert.deepEqual(pick(api.answers), pick(s));
    assert.equal(api.canonical, X.scenarioId(s, "1.4.0"));
    assert.equal((await get(`/identity-paths/api/scenarios/nope`)).code, 400);
    assert.equal(JSON.parse((await get("/identity-paths/version.json")).body).version, "1.4.0");
    assert.equal((await get("/identity-paths/nope")).code, 404);
    // CSP allows exactly the page's inline scripts, as served
    const csp = page.headers["content-security-policy"];
    const crypto = require("crypto");
    const inline = [...page.body.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.equal(inline.length, 2, "Google tag loader + app");
    for (const js of inline) assert.ok(csp.includes(`'sha256-${crypto.createHash("sha256").update(js).digest("base64")}'`), "inline script hash in CSP");
    assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers["strict-transport-security"], "max-age=31536000");
    assert.doesNotMatch(page.body, / on[a-z]+="/, "no inline event handlers (CSP would block them)");
  } finally { server.close(); delete process.env.APP_VERSION; }
});
