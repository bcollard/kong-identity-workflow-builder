// Load the wizard's pure logic (everything above "result rendering") from site/index.html into a VM context.

const { PAGE, pageHtml, loadLogic } = require("../../server/logic");

// Control planes in scope. Default: self-managed only. IWB_DEPLOY=self,konnect runs the Konnect paths too.
const DEPLOYS = (process.env.IWB_DEPLOY || "self").split(",").map(x => x.trim()).filter(Boolean);
const KONNECT = DEPLOYS.includes("konnect");
/** Wizard options to explore: enabled, and on an in-scope control plane. */
const explorable = (st, s) => st.options(s).filter(o => !o.disabled && (st.id !== "deploy" || DEPLOYS.includes(o.v)));

const subsets = a => a.reduce((acc, x) => acc.concat(acc.map(s => [...s, x])), [[]]).filter(s => s.length);

/** Every complete answer set the wizard allows on the in-scope control planes (respects visibility and disabled options). */
function allPaths(X) {
  const out = [], S = X.S;
  const blank = JSON.stringify(S);
  (function walk(i) {
    const vs = X.visibleSteps();
    if (i >= vs.length) { out.push(JSON.parse(JSON.stringify(S))); return; }
    const st = vs[i], opts = explorable(st, S).map(o => o.v);
    const choices = st.multi ? [...(opts.includes("none") ? [["none"]] : []), ...subsets(opts.filter(v => v !== "none"))] : opts;
    const saved = JSON.stringify(S);
    for (const c of choices) { Object.assign(S, JSON.parse(saved)); S[st.id] = c; walk(i + 1); }
    Object.assign(S, JSON.parse(saved));
  })(0);
  Object.assign(S, JSON.parse(blank));
  return out;
}

/** One representative per runtime class: analytics choices collapsed, everything else kept. */
const CORE = ["product", "deploy", "version", "caller", "target", "cred", "idp", "record", "access"];
function runtimeClasses(paths) {
  const m = new Map();
  for (const p of paths) {
    const k = CORE.map(f => p[f] ?? "-").join("|") + "|" + [...p.plans].sort().join("+");
    // prefer the representative with the most analytics, so analytics-driven plugins are exercised too
    if (!m.has(k) || p.analytics.length > m.get(k).analytics.length) m.set(k, p);
  }
  return [...m.values()];
}

/** Render all outputs for one answer set. */
function render(X, state) {
  Object.assign(X.S, JSON.parse(JSON.stringify(state)));
  const d = X.derive(X.S), seq = X.buildSeq(X.S, d);
  const cfg = { decl: X.genDeclarative(X.S, d), api: X.genApi(X.S, d), tf: X.genTf(X.S, d) };
  return { s: JSON.parse(JSON.stringify(X.S)), d, seq, cfg, tabs: X.outputTabs(X.S, cfg), lab: X.labMatch(X.S), e2e: X.e2eStatus(X.S, cfg) };
}

const label = s => CORE.map(f => s[f] ?? "-").join("/") + "/" + s.plans.join("+") + "/" + s.analytics.join("+");

module.exports = { DEPLOYS, KONNECT, explorable, loadLogic, allPaths, runtimeClasses, render, label, pageHtml, PAGE };
