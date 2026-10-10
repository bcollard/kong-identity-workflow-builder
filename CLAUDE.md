# kong-identity-workflow-builder

Read `docs/knowledge.md` (verified product facts behind every wizard rule) and `docs/backlog.md` (what's untested or missing) before changing the wizard.

- `site/index.html` is the whole app (no framework, no build); `server/server.js` serves it under `/identity-paths/` and
  stamps the release version. Keep the page self-contained: fonts from Google Fonts only, no other external scripts.
- Scenario IDs (`scenarioId`, `CODES`, `ID_STEPS`): codes are append-only. A new option gets a new code at the end of its
  list; never reorder, reuse or delete one. A new step goes at the end of `ID_STEPS`. A layout change needs a new `ID_FORMAT`
  and a decoder that still reads the old one. Releases are plain semver tags matching `package.json` (no pre-release suffix).
- Tests (`test/README.md`) load the app's script up to `/* ---------- result rendering` and walk every answer path.
  Keep pure logic (STEPS, derive, buildSeq, gen*, outputTabs) above that marker and DOM code below it. Run `npm test` before pushing;
  a schema failure means the generator emits a field Kong doesn't accept: fix the generator, not the fixture.
- Generated config must follow Kong Gateway 3.16 / AI Gateway 2.2 field names. When adding an option, verify the field
  in the Kong source or docs first; `labMatch()` badges only paths that were actually run in a lab.
- No Kong-internal material (roadmap IDs, internal tickets, Slack, customer names): this repo is public-facing.
