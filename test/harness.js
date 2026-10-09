// Enumerate every answer path the wizard allows and run derive/buildSeq/gen* on it.
const fs = require("fs");
const vm = require("vm");
const html = fs.readFileSync(__dirname + "/../site/index.html", "utf8");
let js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
js = js.slice(0, js.indexOf("/* ---------- result rendering"));
const ctx = vm.createContext({ console });
vm.runInContext(js + "\nthis.API={S,STEPS,visibleSteps,derive,buildSeq,genDeclarative,genApi,genTf,labMatch};", ctx);
const X = ctx.API, S = X.S;

const subsets = a => a.reduce((acc, x) => acc.concat(acc.map(s => [...s, x])), [[]]).filter(s => s.length);
let n = 0, errs = 0, cgFree = 0;
const labs = {};
function walk(i) {
  const vs = X.visibleSteps();
  if (i >= vs.length) {
    n++;
    try {
      const d = X.derive(S), q = X.buildSeq(S, d);
      const outs = [X.genDeclarative(S, d), X.genApi(S, d), X.genTf(S, d)];
      if (!q.steps.every(s => q.lanes.some(l => l.id === s.f) && q.lanes.some(l => l.id === s.t))) throw new Error("step references a missing lane");
      for (const o of outs) if (/undefined|NaN|\[object/.test(o.text)) throw new Error(`"${o.title}" output contains undefined/NaN`);
      if (!d.groups.length) cgFree++;
      const m = X.labMatch(S); if (m) labs[m] = (labs[m] || 0) + 1;
    } catch (e) { errs++; if (errs < 8) console.log("ERR", e.message, JSON.stringify(S)); }
    return;
  }
  const st = vs[i], opts = st.options(S).filter(o => !o.disabled).map(o => o.v);
  const choices = st.multi ? [...(opts.includes("none") ? [["none"]] : []), ...subsets(opts.filter(v => v !== "none"))] : opts;
  const saved = JSON.stringify(S);
  for (const c of choices) { Object.assign(S, JSON.parse(saved)); S[st.id] = c; walk(i + 1); }
  Object.assign(S, JSON.parse(saved));
}
walk(0);
console.log(`paths=${n} errors=${errs} cg-free=${cgFree} lab-matches=${JSON.stringify(labs)}`);
