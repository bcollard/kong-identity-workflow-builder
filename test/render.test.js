// Render the real page in jsdom: the DOM shows exactly what the logic computed, and the wizard can be clicked through.
const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const { KONNECT, loadLogic, allPaths, runtimeClasses, render, label, pageHtml } = require("./lib/app");

const X = loadLogic();
const CLASSES = runtimeClasses(allPaths(X));
const HTML = pageHtml();

function openPage(saved) {
  const dom = new JSDOM(HTML, {
    url: "https://builder.test/",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} }); // reduced motion: no packet animation
      w.Element.prototype.scrollIntoView = () => {};
      if (saved) w.localStorage.setItem("iwb", JSON.stringify(saved));
    },
  });
  return dom.window;
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
