// Serves the builder under /identity-paths/ (Cloud Run, or `make serve` locally). No dependencies.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { pageHtml, loadLogic } = require("./logic");

const BASE = "/identity-paths";
const VERSION = process.env.APP_VERSION || require("../package.json").version;
const HTML = pageHtml(VERSION);
const NOT_FOUND = fs.readFileSync(path.join(__dirname, "../site/404.html"), "utf8").replace('href="./"', `href="${BASE}/"`);
const X = loadLogic(VERSION);
const BLANK = JSON.stringify(X.S);

/** Decode a scenario ID with the running version: answers, and whether this version can reproduce them. */
function scenario(id) {
  Object.assign(X.S, JSON.parse(BLANK));
  const r = X.openScenario(id);
  const state = JSON.parse(JSON.stringify(X.S));
  const out = { id, running: VERSION, minted: r.version || null, supported: r.ok, message: r.message || null };
  if (r.dropped || r.unknown) Object.assign(out, { answers: state, dropped: r.dropped, unknown: r.unknown,
    canonical: r.ok ? X.scenarioId(state, VERSION) : null });
  return out;
}

function send(res, code, type, body, extra = {}) {
  res.writeHead(code, { "content-type": type, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin",
    "cache-control": "no-cache", "x-app-version": VERSION, ...extra });
  res.end(res.req.method === "HEAD" ? undefined : body);
}

const server = http.createServer((req, res) => {
  if (!["GET", "HEAD"].includes(req.method)) return send(res, 405, "text/plain", "method not allowed\n", { allow: "GET, HEAD" });
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (p === "/" || p === BASE) return send(res, 301, "text/plain", "", { location: `${BASE}/` });
  if (p === `${BASE}/` || /^\/identity-paths\/s\/[^/]+\/?$/.test(p)) return send(res, 200, "text/html; charset=utf-8", HTML);
  if (p === `${BASE}/version.json`) return send(res, 200, "application/json", JSON.stringify({ version: VERSION, idFormat: "1" }) + "\n");
  const m = /^\/identity-paths\/api\/scenarios\/([^/]+)$/.exec(p);
  if (m) {
    const body = scenario(decodeURIComponent(m[1]));
    return send(res, body.minted === null ? 400 : 200, "application/json", JSON.stringify(body, null, 2) + "\n");
  }
  return send(res, 404, "text/html; charset=utf-8", NOT_FOUND);
});

if (require.main === module) {
  const port = Number(process.env.PORT || 8080);
  server.listen(port, () => console.log(`identity-paths v${VERSION} on :${port}${BASE}/`));
}
module.exports = { server, scenario, VERSION };
