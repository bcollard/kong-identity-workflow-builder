// Print the generated outputs for one answer set: node test/sample.js '{"product":"api",...}'
const fs = require("fs"), vm = require("vm");
const html = fs.readFileSync(__dirname + "/../site/index.html", "utf8");
let js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));
js = js.slice(0, js.indexOf("/* ---------- result rendering"));
const ctx = vm.createContext({ console });
vm.runInContext(js + "\nthis.API={S,derive,buildSeq,genDeclarative,genApi,genTf};", ctx);
const X = ctx.API; Object.assign(X.S, JSON.parse(process.argv[2]));
const d = X.derive(X.S), q = X.buildSeq(X.S, d);
console.log(q.lanes.map(l => l.label).join(" | ")); q.steps.forEach((s, i) => console.log(`${i + 1}. ${s.f}→${s.t} ${s.l}`));
for (const g of [X.genDeclarative, X.genApi, X.genTf]) { const o = g(X.S, d); console.log(`\n===== ${o.title}\n${o.text}`); }
