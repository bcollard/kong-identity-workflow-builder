// Render the real page in jsdom: the DOM shows exactly what the logic computed, and the wizard can be clicked through.
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { KONNECT, loadLogic, allPaths, runtimeClasses, render, label, pageHtml } = require("./lib/app");

const X = loadLogic();
const CLASSES = runtimeClasses(allPaths(X));
const HTML = pageHtml();

function openPage(saved, url = "https://builder.test/identity-paths/") {
  const dom = new JSDOM(HTML, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); // reduced motion: no packet animation
      w.Element.prototype.scrollIntoView = () => {};
      if (saved) w.localStorage.setItem("iwb", JSON.stringify(saved));
    },
  });
  const w = dom.window;
  if (saved && !/\/s\//.test(url)) w.document.getElementById("b-resume")?.click(); // remembered answers open on Resume
  return w;
}
const text = el => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

// A spread of runtime classes: every Nth one, plus the lab scenarios, plus each product × deploy × caller once.
function sample() {
  const picked = new Map();
  CLASSES.forEach((c, i) => { if (i % 97 === 0) picked.set(label(c), c); });
  for (const c of CLASSES) {
    const k = `${c.product}/${c.deploy}/${c.caller}/${c.target}`;
    if (![...picked.values()].some(p => `${p.product}/${p.deploy}/${p.caller}/${p.target}` === k)) picked.set(label(c), c);
    if (render(X, c).lab) picked.set(label(c), c);
  }
  return [...picked.values()];
}
const SAMPLE = sample();

test(`rendered result matches the computed blueprint (${SAMPLE.length} sampled classes)`, () => {
  const errs = [];
  for (const s of SAMPLE) {
    const r = render(X, s);
    const w = openPage({ S: s, cur: "analytics" });
    const doc = w.document, res = doc.getElementById("result");
    const e = m => errs.push(`${label(s)}: ${m}`);
    if (res.hidden) { e("result hidden"); w.close(); continue; }
    if (/undefined|NaN|\[object /.test(res.textContent)) e("undefined/NaN in the rendered result");
    if (/undefined|NaN|\[object /.test(doc.getElementById("blueprint").textContent)) e("undefined/NaN in the blueprint");
    // lanes, steps, step counter
    if (doc.querySelectorAll("#diagram g.hd").length !== r.seq.lanes.length) e("lane count");
    if (doc.querySelectorAll("#diagram g.msg").length !== r.seq.steps.length) e("step count");
    if (text(doc.getElementById("sn")) !== `${r.seq.steps.length} / ${r.seq.steps.length}`) e(`step counter "${text(doc.getElementById("sn"))}"`);
    // KPI and groups table
    const kpi = text(doc.querySelector("#blueprint .kpi b"));
    if (kpi !== String(r.d.groups.length)) e(`KPI groups ${kpi} vs ${r.d.groups.length}`);
    const groupPanel = [...res.querySelectorAll(".panel")].find(p => text(p.querySelector("h3")) === "Consumer Groups to create");
    const rows = groupPanel ? groupPanel.querySelectorAll("tbody tr").length : -1;
    if (rows !== r.d.groups.length && !(r.d.groups.length === 0 && /None\./.test(text(groupPanel)))) e(`group rows ${rows} vs ${r.d.groups.length}`);
    // badge
    const badge = text(res.querySelector(".badge"));
    if (r.lab ? !badge.includes(r.lab) : !/draft/i.test(badge)) e(`badge "${badge}" (lab=${r.lab})`);
    // tabs and code
    const tabs = [...res.querySelectorAll("[data-t]")].map(b => b.dataset.t);
    if (tabs.join() !== r.tabs.join()) e(`tabs [${tabs}] vs [${r.tabs}]`);
    for (const t of tabs) {
      res.querySelector(`[data-t="${t}"]`).click();
      if (doc.getElementById("code").textContent !== r.cfg[t].text) e(`code of tab ${t} differs from the generator`);
    }
    w.close();
  }
  assert.deepEqual(errs.slice(0, 12), []);
});

test("click through the wizard to the API-1 lab path", { skip: !KONNECT && "Konnect control plane out of scope" }, () => {
  const w = openPage(null), doc = w.document;
  doc.getElementById("b-reset").click();
  const choose = lab => {
    const btn = [...doc.querySelectorAll("#question .opt")].find(b => text(b.querySelector(".l")).startsWith(lab));
    assert.ok(btn, `option "${lab}" on step "${text(doc.querySelector("#question h2"))}"`);
    assert.notEqual(btn.getAttribute("aria-disabled"), "true", `option "${lab}" is enabled`);
    btn.click();
  };
  const next = () => doc.getElementById("b-next").click();
  choose("API Gateway"); choose("Konnect"); choose("Kong Gateway 3.16"); choose("Apps"); choose("API keys");
  choose("Kong Identity principals"); choose("Subscription groups + ACL");
  choose("Per-API plan · tier-CG"); next();
  choose("Konnect Analytics"); next();
  const res = doc.getElementById("result");
  assert.equal(res.hidden, false, "result shown");
  assert.match(text(res.querySelector(".badge")), /API-1/);
  assert.match(text(res), /sub-orders-api/);
  assert.match(text(res), /tier-bronze/);
  // going back and changing the version prunes what 3.15 can't do and keeps the result consistent
  [...doc.querySelectorAll("#stepper button")].find(b => text(b).includes("Gateway version")).click();
  choose("Kong Gateway 3.15");
  assert.doesNotMatch(doc.getElementById("code")?.textContent || "", /identifier: principal/);
  w.close();
});

test("click through a self-managed API key path", () => {
  const w = openPage(null), doc = w.document;
  doc.getElementById("b-reset").click();
  const choose = lab => {
    const btn = [...doc.querySelectorAll("#question .opt")].find(b => text(b.querySelector(".l")).startsWith(lab));
    assert.ok(btn, `option "${lab}" on step "${text(doc.querySelector("#question h2"))}"`);
    assert.notEqual(btn.getAttribute("aria-disabled"), "true", `option "${lab}" is enabled`);
    btn.click();
  };
  const next = () => doc.getElementById("b-next").click();
  choose("API Gateway"); choose("Self-managed"); choose("Kong Gateway 3.16"); choose("Apps"); choose("API keys");
  choose("Kong Consumers"); choose("Subscription groups + ACL");
  choose("Per-API plan · tier-CG"); next();
  choose("Prometheus + Grafana"); next();
  const res = doc.getElementById("result");
  assert.equal(res.hidden, false, "result shown");
  assert.match(text(res.querySelector(".badge")), /draft/i);
  assert.match(text(res), /sub-orders-api/);
  assert.match(text(res), /tier-bronze/);
  const tabs = [...res.querySelectorAll("[data-t]")].map(b => b.dataset.t);
  assert.ok(!tabs.includes("tf"), "no Terraform tab on self-managed");
  assert.doesNotMatch(doc.getElementById("code").textContent, /principals|konnect-control-plane-name/);
  w.close();
});

test("disabled options can't be selected", () => {
  const w = openPage({ S: { product: "api", deploy: "self", version: null, caller: null, target: null, cred: null, idp: null, record: null, access: null, plans: [], analytics: [] }, cur: "caller" });
  const doc = w.document;
  const portal = [...doc.querySelectorAll("#question .opt")].find(b => text(b.querySelector(".l")).startsWith("Dev Portal apps"));
  assert.equal(portal.getAttribute("aria-disabled"), "true");
  portal.click();
  assert.equal(portal.getAttribute("aria-pressed"), "false");
  w.close();
});

test("a shared link opens the scenario, ignores what the browser remembered, and the address bar follows edits", () => {
  const s = CLASSES.find(c => c.product === "api" && c.record === "consumers" && c.analytics.includes("prom"));
  const id = X.scenarioId(s, "0.9.0");
  const other = CLASSES.find(c => c.product !== s.product);
  const w = openPage({ S: other, cur: "analytics" }, `https://builder.test/identity-paths/s/${id}`), doc = w.document;
  assert.equal(doc.getElementById("result").hidden, false);
  assert.equal(text(doc.getElementById("sid")), X.scenarioId(s, X.APP_VERSION), "re-minted with the running version");
  assert.match(text(doc.getElementById("notice")), /Shared from v0\.9\.0/);
  assert.equal(w.location.pathname, `/identity-paths/s/${X.scenarioId(s, X.APP_VERSION)}`);
  doc.getElementById("b-reset").click();
  assert.equal(w.location.pathname, "/identity-paths/", "incomplete answers: base URL");
  w.close();
});

test("a broken link explains itself and leaves the wizard usable", () => {
  const w = openPage(null, "https://builder.test/identity-paths/s/v1.0.0-1111101221040H9"), doc = w.document;
  assert.match(text(doc.getElementById("notice")), /Can't open .*typo/);
  assert.ok(doc.querySelectorAll("#question .opt").length > 0);
  assert.equal(doc.getElementById("result").hidden, true, "no example loaded behind the error");
  w.close();
});

test("the home page starts empty; remembered answers wait behind Resume; Start over forgets them", () => {
  let w = openPage(null), doc = w.document;
  assert.equal(doc.getElementById("result").hidden, true, "no example on a first visit");
  assert.equal(doc.getElementById("notice").hidden, true);
  assert.equal(text(doc.querySelector("#question h2")), "Which gateway receives the calls?", "step 1");
  assert.equal(w.location.pathname, "/identity-paths/");
  w.close();

  const s = CLASSES.find(c => c.product === "api");
  const dom = new JSDOM(HTML, { url: "https://builder.test/identity-paths/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(win) { win.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); win.Element.prototype.scrollIntoView = () => {};
      win.localStorage.setItem("iwb", JSON.stringify({ S: s, cur: "analytics" })); } });
  w = dom.window; doc = w.document;
  assert.equal(doc.getElementById("result").hidden, true, "remembered answers aren't applied on their own");
  assert.match(text(doc.getElementById("notice")), /remembers answers/);
  assert.ok(JSON.parse(w.localStorage.getItem("iwb")).S.product, "the empty wizard doesn't overwrite them");
  doc.getElementById("b-resume").click();
  assert.equal(doc.getElementById("result").hidden, false);
  assert.equal(doc.getElementById("notice").hidden, true);
  assert.equal(w.location.pathname, `/identity-paths/s/${X.scenarioId(s, X.APP_VERSION)}`);
  doc.getElementById("b-reset").click();
  assert.equal(w.localStorage.getItem("iwb"), null, "Start over forgets the answers");
  w.close();
});

test("analytics consent: banner until the visitor chooses, Consent Mode updated, choice remembered", () => {
  const w = openPage(null), doc = w.document;
  const consentCalls = () => [...w.dataLayer].filter(a => a[0] === "consent").map(a => `${a[1]}:${a[2].analytics_storage}`);
  assert.equal(doc.getElementById("consent").hidden, false, "banner on a first visit");
  assert.deepEqual(consentCalls(), ["default:denied"], "no analytics storage before a choice");
  doc.getElementById("c-accept").click();
  assert.equal(doc.getElementById("consent").hidden, true);
  assert.deepEqual(consentCalls(), ["default:denied", "update:granted"]);
  assert.equal(w.localStorage.getItem("iwb-consent"), "granted");
  w.close();
  const dom = new JSDOM(HTML, { url: "https://builder.test/identity-paths/", runScripts: "dangerously", pretendToBeVisual: true,
    beforeParse(win) { win.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); win.Element.prototype.scrollIntoView = () => {};
      win.localStorage.setItem("iwb-consent", "denied"); } });
  assert.equal(dom.window.document.getElementById("consent").hidden, true, "a stored choice hides the banner");
  dom.window.close();
});
