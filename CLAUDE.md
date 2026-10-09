# kong-identity-workflow-builder

Read `docs/knowledge.md` (verified product facts behind every wizard rule) and `docs/backlog.md` (what's untested or missing) before changing the wizard.

- Everything ships from `site/`; `site/index.html` is the whole app (no framework, no build). Keep it self-contained:
  fonts from Google Fonts only, no other external scripts.
- `test/harness.js` evaluates the app's script up to `/* ---------- result rendering` and walks every answer path.
  Keep pure logic (STEPS, derive, buildSeq, gen*) above that marker and DOM code below it. Run `make test` before pushing.
- Generated config must follow Kong Gateway 3.16 / AI Gateway 2.2 field names. When adding an option, verify the field
  in the Kong source or docs first; `labMatch()` badges only paths that were actually run in a lab.
- No Kong-internal material (roadmap IDs, internal tickets, Slack, customer names): this repo is public-facing.
