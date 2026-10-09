# Tests

`npm ci && npm test` (Node 22+). Everything runs offline; no Kong, Konnect or browser needed.

## Scope

| Command | Control planes | Paths / runtime classes |
|---|---|---|
| `npm test` (default) | self-managed only | ~12k / ~1.5k |
| `npm run test:all` or `IWB_DEPLOY=self,konnect npm test` | self-managed + Konnect | ~64k / ~4.4k |

`IWB_DEPLOY` filters the deploy step in every path walk. Konnect-only tests (Dev Portal, principals, kongctl schema,
Terraform, lab badges, Konnect pruning) are reported as skipped when Konnect is out of scope.

| File | What it proves |
|---|---|
| `wizard.test.js` | Step visibility, disabled options and their reasons, pruning after an upstream change, no dead ends |
| `outputs.test.js` | For each runtime class (~4.4k): YAML parses; every decK plugin matches the real Kong 3.16 / 3.15 plugin schema; kongctl files match `kongctl explain` and the AI Gateway 2.2 plugin schemas; curl JSON bodies parse; Terraform uses existing `konnect_*` resources |
| `consistency.test.js` | On every path (~64k): the groups table equals the groups in the config, ACLs only reference declared groups, the identity record shows up in the config, sequence lanes match configured plugins, inspector and analytics agree, nothing 3.16-only for 3.15, tab rules, lab badges |
| `render.test.js` | The real page in jsdom: the DOM shows what the logic computed (lanes, steps, KPIs, groups table, badge, every code tab), a full click-through, disabled options stay unselectable |

Fixtures (`fixtures/`):
- `schemas/<target>/*.json`: `/schemas/plugins/<name>` from real containers. Refresh with `make schemas` when a version changes.
- `kongctl-ai_gateway.schema.json`: `kongctl explain ai_gateway --output json` (version in `kongctl-version.txt`).
  Known gaps handled in the test: `models` is exported as an empty object, `principals.match_consumer_groups` is missing,
  and nested items don't need `ai_gateway` (all three applied fine with kongctl 1.20.1 in the lab).
- `terraform-resources.txt`: resource names from the `kong/konnect` and `kong/konnect-beta` provider docs.

`node test/classes.js` prints how many paths and runtime classes the wizard has.
