// Group wizard paths into runtime-equivalent classes (analytics choices don't change gateway behaviour)
const X = require("../server/logic").loadLogic();
const S = X.S;
const subsets = a => a.reduce((acc, x) => acc.concat(acc.map(s => [...s, x])), [[]]).filter(s => s.length);
const all = [], classes = new Map();
(function walk(i) {
  const vs = X.visibleSteps();
  if (i >= vs.length) {
    all.push(1);
    const core = ["product","deploy","version","caller","target","cred","idp","record","access"].map(k => S[k] ?? "-").join("|") + "|" + [...S.plans].sort().join("+");
    if (!classes.has(core)) classes.set(core, JSON.parse(JSON.stringify(S)));
    return;
  }
  const st = vs[i], opts = st.options(S).filter(o => !o.disabled).map(o => o.v);
  const choices = st.multi ? [...(opts.includes("none") ? [["none"]] : []), ...subsets(opts.filter(v => v !== "none"))] : opts;
  const saved = JSON.stringify(S);
  for (const c of choices) { Object.assign(S, JSON.parse(saved)); S[st.id] = c; walk(i + 1); }
  Object.assign(S, JSON.parse(saved));
})(0);
const cls = [...classes.values()];
const by = (f) => cls.reduce((m, c) => (m[f(c)] = (m[f(c)] || 0) + 1, m), {});
const labIdp = c => !c.idp || c.idp === "keycloak" || c.idp === "ki";
const testable = cls.filter(labIdp);
console.log(`paths=${all.length} runtime-classes=${cls.length} lab-reachable(idp keycloak/ki/none)=${testable.length}`);
console.log("classes by product:", JSON.stringify(by(c => c.product)));
console.log("lab-reachable by product/deploy:", JSON.stringify(testable.reduce((m, c) => (m[c.product + "/" + c.deploy] = (m[c.product + "/" + c.deploy] || 0) + 1, m), {})));
console.log("lab-reachable by caller:", JSON.stringify(testable.reduce((m, c) => (m[c.caller] = (m[c.caller] || 0) + 1, m), {})));
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(testable, null, 1));
