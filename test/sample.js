// Print the generated outputs for one answer set: node test/sample.js '{"product":"api",...}'
const X = require("../server/logic").loadLogic();
Object.assign(X.S, JSON.parse(process.argv[2]));
const d = X.derive(X.S), q = X.buildSeq(X.S, d);
console.log(q.lanes.map(l => l.label).join(" | ")); q.steps.forEach((s, i) => console.log(`${i + 1}. ${s.f}→${s.t} ${s.l}`));
for (const g of [X.genDeclarative, X.genApi, X.genTf]) { const o = g(X.S, d); console.log(`\n===== ${o.title}\n${o.text}`); }
