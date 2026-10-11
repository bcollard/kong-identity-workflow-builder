// Load the wizard's pure logic (everything above "result rendering" in site/index.html) into a VM context.
// Shared by the server (scenario API) and the tests, so both run exactly the code the browser runs.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const PAGE = path.join(__dirname, "../site/index.html");
const MARKER = "/* ---------- result rendering";
const VERSION_LINE = 'const APP_VERSION = "dev";';
const RESULTS_LINE = "const E2E_RESULTS = {};";
const RESULTS_DIR = path.join(__dirname, "../e2e/results");
const EXPORTS = "S,STEPS,IDP,WHO,visibleSteps,prune,complete,derive,buildSeq,genDeclarative,genApi,genTf,labMatch,outputTabs,applyPlan," +
  "APP_VERSION,ID_STEPS,CODES,scenarioPayload,scenarioId,parseScenarioId,openScenario,E2E_RESULTS,outputHash,e2eStatus,highlight";

/** Recorded end-to-end runs, keyed by scenario payload (newest run wins). */
function e2eResults() {
  const out = {};
  if (!fs.existsSync(RESULTS_DIR)) return out;
  for (const f of fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith(".json")).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), "utf8"));
    if (!out[r.payload] || out[r.payload].date < r.date) out[r.payload] = r;
  }
  return out;
}

/** The page with the release version and the recorded end-to-end results stamped in. */
function pageHtml(version = "dev") {
  let html = fs.readFileSync(PAGE, "utf8");
  for (const l of [VERSION_LINE, RESULTS_LINE]) if (!html.includes(l)) throw new Error(`${PAGE} lacks ${l}`);
  html = html.replace(RESULTS_LINE, `const E2E_RESULTS = ${JSON.stringify(e2eResults()).replace(/</g, "\\u003c")};`);
  return version === "dev" ? html : html.replace(VERSION_LINE, `const APP_VERSION = ${JSON.stringify(version)};`);
}

function loadLogic(version = "dev") {
  const html = pageHtml(version);
  const cut = html.indexOf(MARKER);
  if (cut < 0) throw new Error("result rendering marker not found");
  const js = html.slice(html.lastIndexOf("<script>", cut) + 8, cut); // the app script, not the analytics tag
  const ctx = vm.createContext({ console });
  vm.runInContext(`${js}\nthis.API={${EXPORTS}};`, ctx);
  return ctx.API;
}

module.exports = { PAGE, RESULTS_DIR, pageHtml, loadLogic, e2eResults };
