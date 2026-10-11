# Kong Identity Workflow Builder

Live at **https://kong.runlocal.dev/identity-paths/**.

A single-page wizard that turns a few answers into a Kong identity blueprint:

1. Product (API Gateway, AI Gateway 1.x = Kong Gateway + AI plugins, or AI Gateway 2.x), control plane (Konnect or self-managed) and Gateway version (3.15 / 3.16)
2. Who calls (employees, apps, agents, Dev Portal applications) and, on AI Gateway, what they call (models, A2A agents, MCP servers)
3. Credential (OIDC login, OAuth client credentials, API keys) and OAuth server (Kong Identity, Okta, Entra ID, Keycloak, AD FS)
4. Identity record (token claims, Kong Identity principals, Consumers)
5. Access control, usage plans and analytics

It shows which Consumer Groups are really needed (sub-CGs, tier-CGs, BU-CGs) and who owns them, plays an animated
sequence diagram, and generates kongctl/decK, Konnect API and Terraform snippets.

Combinations whose core path matches one of five scenarios run end to end in a lab are badged as validated;
everything else is a generated draft.

## Scenario links

Every complete set of answers has an ID such as `v1.0.0-1121203032020GS`: the app version that generated it, then the
answers encoded with permanent codes, then a check character. The address bar always holds the link
(`/identity-paths/s/<id>`), and **Copy link** next to the result copies it.

- The same answers always give the same payload; only the `v<version>` prefix changes between releases.
- Only the latest release is served. It opens older IDs when the path still exists, and otherwise says which answers it
  can no longer reproduce. To see exactly what a link showed, check out its tag and run `node tools/scenario.js <id>`.
- `GET /identity-paths/api/scenarios/<id>` returns the decoded answers and whether the running version supports them.
- Step and option codes are append-only (`CODES` in `site/index.html`); a test compares them with the last release tag.

## End-to-end results

`e2e/results/<payload>.json` records scenarios whose generated files were applied to a running gateway and checked step
by step: the date, the builder version, every substitution needed to run (with its kind: `env`, `substitution`,
`fixture`, `generator-gap`), every check, and a hash of each tab that was applied. The server injects them into the page.

| Badge | Meaning |
|---|---|
| Tested end to end · date · n/n checks | These exact files ran (the hashes match what this version generates) |
| Tested with an earlier version of this output | The scenario ran, but the generator has changed since: re-run it |
| Identity flow lab-tested · this file not applied | The lab ran its own configuration for this identity flow |
| Generated draft | Not run |

The runners live outside this repo (they drive a private lab: kind clusters, Konnect, Keycloak, mock upstreams);
only their public-safe results are committed here.

## Develop

`site/index.html` is plain HTML, CSS and JavaScript; `server/server.js` serves it under `/identity-paths/` (no dependencies).

```bash
make serve           # http://localhost:8080/identity-paths/
npm ci && npm test   # wizard rules, scenario IDs, real-schema validation, deck ai sync conversion, consistency, jsdom render (test/README.md)
node tools/scenario.js v1.0.0-1121203032020GS --out /tmp/sc   # decode an ID and write its generated files
```

## Release

1. Bump `version` in `package.json` (plain semver) and merge to `main`.
2. Tag and push: `git tag v1.1.0 && git push origin v1.1.0`.

`.github/workflows/release.yaml` runs the tests, builds the image, pushes it to Artifact Registry, deploys it to Cloud Run
and creates the GitHub release. It authenticates with Workload Identity Federation (tag refs of this repo only); the
`GCP_*` and `IDENTITY_PATHS_IMAGE_REPO` repository variables come from the private infrastructure repo's outputs.
