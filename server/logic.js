// Load the wizard's pure logic (everything above "result rendering" in site/index.html) into a VM context.
// Shared by the server (scenario API) and the tests, so both run exactly the code the browser runs.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const PAGE = path.join(__dirname, "../site/index.html");
const MARKER = "/* ---------- result rendering";
const VERSION_LINE = 'const APP_VERSION = "dev";';
const EXPORTS = "S,STEPS,IDP,WHO,visibleSteps,prune,complete,derive,buildSeq,genDeclarative,genApi,genTf,labMatch,outputTabs," +
  "APP_VERSION,ID_STEPS,CODES,scenarioPayload,scenarioId,parseScenarioId,openScenario";

/** The page with the release version stamped in. */
function pageHtml(version = "dev") {
  const html = fs.readFileSync(PAGE, "utf8");
  if (!html.includes(VERSION_LINE)) throw new Error(`${PAGE} lacks ${VERSION_LINE}`);
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

module.exports = { PAGE, pageHtml, loadLogic };
