# Knowledge behind the builder

Product facts the wizard relies on. Versions: Kong Gateway 3.15 / 3.16 (incl. AI plugins, "AI Gateway 1.x"), AI Gateway 2.2, Konnect (2026-10).
Each fact names its source: Kong docs (developer.konghq.com), the Kong Gateway source, the Konnect Terraform
provider, or a lab run (`lab-verified`). Check the source before changing a rule in `site/index.html`.

## Identity records

The wizard's "identity record" step decides where Kong finds the caller and its groups.

| Record | What Kong stores | Groups come from | Needs |
|---|---|---|---|
| Token claims | Nothing | A token claim (`consumer_groups_claim`) mapped to existing Consumer Groups by name or UUID | Any OIDC issuer |
| Kong Identity principals | Principal in a Konnect directory: identities, credentials (API keys, basic auth), metadata | `metadata.consumer_groups` (names or UUIDs, `lab-verified`) | Konnect control plane and data planes, Gateway 3.15+ |
| Consumers | One entity per caller per control plane | Consumer membership | Nothing |

### Token claims (virtual credentials)

- `openid-connect` with `credential_claim` (default `["sub"]`) sets `ctx.authenticated_credential = { id = <claim> }`
  when no Consumer was mapped. Consumer mapping only runs if `consumer_claim` is set. Gateway 3.17 deprecates both for
  the array forms `credential_claims` / `consumer_claims` (Kong source); the builder keeps the 3.16 names.
- `consumer_groups_claim` runs independently of Consumer mapping. An array claim is matched element by element, by name
  or UUID; unknown names are skipped. If none match, the request gets 403 unless `consumer_groups_optional: true`.
  Principal groups (`match_consumer_groups`) replace it when the principal has any (Kong source).
- `authenticated_groups_claim` only sets `ctx.authenticated_groups` for the ACL plugin: it never creates Consumer Group
  membership, so Consumer-Group-scoped plugins don't fire from it (Kong source). AI Gateway auth strategies don't document
  it; the config is passed through to the plugin as is.

### Kong Identity principals

- A principal is the identity of an external client, workload or human calling a gateway. It is not a Konnect user.
- One directory per region. The data plane looks principals up over mTLS (`/<directory>/v2/authenticate` and
  `fetch-principal`) and caches them for the lower of the directory TTL (600 s by default) and `db_cache_ttl`; misses
  are cached 60 s at most. The docs limit uncached lookups to 100/s per directory.
- `metadata.consumer_groups` entries resolve by UUID or by name in the data plane; the docs only promise UUIDs, so
  generated metadata should switch to UUIDs if names stop resolving (Kong source).
- Identity types: `oidc {issuer, claim{name,value}}` for tokens from any IdP; `auth_server_client {auth_server_id, client_id}`
  for Kong Identity clients; `control_plane_consumer`; `custom`. Principal `type` is `agent` or unset.
- Plugins with `principals.enabled`: `key-auth`, `basic-auth`, `openid-connect` (`principal_claim`, `principal_by`,
  `match_consumer`, `match_consumer_groups`, `error_on_miss`). In principals mode `key-auth` skips local credentials
  (`identity_realms: []`).
- Plugins can't be attached to a principal. Scope them with `condition` expressions instead.
- No Terraform or kongctl resource for principals; use the Konnect API (`/v2/directories/{id}/principals`, `/identities`, `/api-keys`).
  The directory itself is `konnect_identity_directory` in the beta provider.

### Kong Identity auth servers

- OAuth 2.0 / OIDC servers hosted by Konnect, one subdomain each: `https://<sub>.<region>.identity.konghq.com/auth`.
  Token endpoint `/oauth/token`, JWKS `/.well-known/jwks`.
- Publicly documented grant: `client_credentials`. Employees should keep a corporate IdP.
- Claims can be static or templated per client: `${ .Client.Labels.skills | default "" | splitList "." | toJson }`
  renders a JSON array (`lab-verified`).
- Terraform: `konnect_identity_auth_server`, `_scope`, `_client`, `_claim`, `_client_secret`.

## Plugin rules the builder encodes

- Kong Gateway 3.16 routes default to `protocols: [https]` (`kong/db/schema/entities/routes.lua`); a plain-HTTP call gets
  **426 Upgrade Required** (`lab-verified` on 3.16.0.0).
- `deck gateway sync` needs a database-backed control plane: a DB-less node answers 405 (`cannot create or update
  'consumers' entities when not using a database`). DB-less nodes load the same file with `POST /config` (`lab-verified`).
- `kong.client.get_credential().id` is the credential's UUID; for Consumer records, log `kong.client.get_consumer().username`
  to get a readable caller label.

| Rule | Consequence |
|---|---|
| A plugin is unique per `{name, route, service, consumer, consumer_group}`. `condition` isn't part of the key | Two `rate-limiting-advanced` instances with different conditions on one route are rejected. Use `expressions` instead. |
| With several Consumer Groups carrying the same plugin, the first group in the request's list wins. Each batch of groups is sorted by name, but a second auth step appends its batch after the first, and the source calls the order "subject to change". A group-scoped plugin also shadows a route-level one | Stack plans with different plugins: API plans on `rate-limiting-advanced`, BU plans on basic `rate-limiting` (`lab-verified`: both header sets on one response) |
| Basic `rate-limiting` only has fixed periods (second → year) | "100 per 5 s" needs `rate-limiting-advanced` (`window_size: [5]`) |
| `service-protection` has `no_consumer_group` | It can only be a service-wide ceiling, not a plan |
| Consumer-group-scoped plugins fire from `ctx.authenticated_consumer_groups`, without a Consumer | Groups from claims or principal metadata carry plans |
| RLA `identifier: consumer` falls back to the credential, then to `missing_identifier_behavior` (default: client IP, 3.17) | Per-caller counters work with an OIDC virtual credential under `consumer` or `credential`; the builder emits `credential` to make it explicit |
| ACL with `include_consumer_groups: true` matches group names with no Consumer | Subscription groups work with claims and principals |
| 3.16: ACL `allow_when` / `deny_when`, RLA and basic RL `identifier`/`limit_by: principal`, plugin `expressions` (`limit`, `minute`…) reading `principal.metadata` | API Gateway can drop Consumer Groups entirely with principals |
| `condition` variables: `principal.id/display_name/metadata`, `consumer_group.names/ids`, `route.tags`, `service.tags`, `http.headers.*`, `kong.ctx.shared` | Scope global plugins to tagged APIs: `route.tags != null && "order-management" in route.tags` |
| Gateway 3.16 rejects the whole config if `openid-connect` has `ssl_verify: false` | Always set `ssl_verify: true`; decK also requires `cache_tokens_salt` (`lab-verified`) |

## AI Gateway 2.2 specifics

- Models, agents and MCP servers authenticate only through an **AuthStrategy** (`key-auth` or `openid-connect`).
  Auth plugins are rejected as policies.
- Konnect allows **one `openid-connect` auth strategy per model, agent or MCP server** (`only 1 auth strategy of type
  "openid-connect" is allowed`, `lab-verified`); a model may add one `key-auth` strategy. There is no gateway-wide limit:
  models with different strategy sets get separate routes (Kong source). One strategy accepts several issuers with
  `issuers_allowed` + `extra_jwks_uris` (passed through to the plugin), except on MCP servers with `access.metadata`,
  which lower to `ai-mcp-oauth2` and drop both fields. With several issuers, map callers on a claim unique across them.
- Missing or unknown tokens: the converter adds an `anonymous` fallback consumer carrying a `request-termination` (401).
  With a model ACL the ACL rejects it first (**403**, `lab-verified` on a single-strategy model); without one the
  termination answers **401** (`lab-verified`). Konnect pins `ai-deck-converter` v0.27.0; on converter main a model with a
  single strategy gets no fallback and the auth plugin answers 401 itself.
- A valid token whose `consumer_claims` value matches no AI Consumer is rejected the same way (`consumer_optional`
  defaults to false); it is never proxied (Kong source).
- Model and agent `access.acls` take one of `allow`, `deny`, `allow_when`, `deny_when`; the CEL forms need runtime 2.2 and can
  read `principal.metadata` (Kong source). kongctl 1.20.1 doesn't declare them yet, so the builder still uses sub-CGs on
  AI Gateway 2.x. MCP ACLs reject CEL. The `acl` policy is global-only.
- Both auth strategy types accept `config.principals` (`enabled`, `directory`, `principal_claim`, `principal_by`,
  `match_consumer`, `match_consumer_groups`, `error_on_miss`).
- `ai-rate-limiting-advanced`: no `principal` identifier; rules use `match` on `consumer_group` (`key: name`) plus
  `{type: credential, partition_by: true}` for per-caller budgets (the `credential` and `service` match types need
  runtime 2.2). The counter key comes only from `partition_by` matchers; `identifier` is ignored in `policies` mode.
  Not allowed on agents or MCP servers.
  One global policy with one rule per tier avoids the one-instance-per-plugin limit.
- Policies accept `condition` (2.1+) but there are no plugin `expressions` in 2.2.
- A2A: `ai-a2a-proxy` rewrites agent card URLs to the gateway. Skill trimming needs a `post-function` `body_filter`
  (runs after the proxy: priority −1000 < 819) reading `kong.client.get_jwt_token_payload()`; the strict sandbox has no
  `setmetatable` (use `cjson.empty_array`). A2A `message/send` carries no skill id, so trimming governs discovery only.
- MCP tool ACLs can read a token claim directly: `acl_attribute_type: oauth_access_token` + `access_token_claim_field`.
- Two file formats. Konnect: `kongctl apply` with an `ai_gateways: [{ref, …}]` wrapper and `ref` on every entity.
  Self-managed: `deck ai sync` reads the flat entity model of `ai-deck-converter` (top-level `models`, `agents`,
  `mcp_servers`, `auth_strategies`, `policies`, `consumers`, `consumer_groups`, `model_providers`), with group membership
  listed on each consumer and passthrough MCP servers using top-level `upstream_url`. The converter ignores unknown keys,
  so a kongctl file given to `deck ai sync` becomes an empty config. Preview the lowered config with
  `deck file ai2kong -s aigw.yaml`.

## AI Gateway 1.x (Kong Gateway + AI plugins)

- Limiting MCP traffic (`lab-verified` on 3.16.0.0, ai-mcp-proxy passthrough-listener):
  - `rate-limiting-advanced` on the MCP route counts every MCP message (initialize, tools/list, notifications,
    tools/call), per caller with `identifier: credential` / `consumer` / `principal`. Works on AI Gateway 2.x too
    (policy scope `mcp-servers`).
  - `ai-rate-limiting-advanced` `policies` mode only counts LLM tokens or cost: it never limits MCP calls.
  - A tool-call-only budget works with the deprecated `llm_providers: [{name: requestPrompt}]` mode and a
    `request_prompt_count_function` that returns 1 for `tools/call` and 0 otherwise. The mode is deprecated (removed
    after 4.0) and absent from the AI Gateway 2.x plugin.
  - Plugin order on the route: openid-connect (1050) → rate-limiting-advanced (910) → ai-rate-limiting-advanced (905)
    → ai-mcp-proxy (820).

AI plugins configured as ordinary plugins on services and routes (decK, Admin API, Konnect control planes, KIC).

| Topic | AI Gateway 1.x (Gateway 3.15 / 3.16) | AI Gateway 2.x (2.2) |
|---|---|---|
| Authentication | Any auth plugin on the route. One `openid-connect` can accept several issuers (`issuers_allowed` + `extra_jwks_uris`) | AuthStrategy only, one `openid-connect` strategy per model |
| Subscriptions without groups | ACL `allow_when` on principal metadata (3.16), or `authenticated_groups_claim` | Not possible: access lists take group names |
| Token budgets | `ai-rate-limiting-advanced` policy mode (3.14+) matches `consumer`, `consumer_group`, `ip`, `header`, `path`, `model`, `provider` only; counters come from matched values. Per caller without Consumers: deprecated `llm_providers` mode with `identifier: credential`, scoped to a tier group | Global policy, `consumer_group` match + `credential` partition |
| A2A / MCP | `ai-a2a-proxy` (3.14+), `ai-mcp-proxy` (`passthrough-listener`, `default_acl: [{scope: tools, allow, deny}]`), `ai-mcp-oauth2` (3.12+) | Agent and MCP server entities |
| Metrics | Prometheus `ai_metrics: true`; OTel `enable_ai_metrics` (+ principal attribute on 3.16) | prometheus / opentelemetry policies |
| AI Cost Management | Not available (AI Gateway 2.x only) | Beta, US |
| Terraform | `konnect_gateway_plugin_ai_proxy_advanced`, `_ai_rate_limiting_advanced`, `_ai_a2a_proxy`, `_ai_mcp_proxy`, `_ai_mcp_oauth2` | `konnect_ai_gateway_*` |

None of the 1.x paths has been run in a lab yet.

## Dev Portal applications

- `ace` plugin (Gateway 3.13+), linked to a whole control plane, does authentication (with the API's application auth strategy)
  and access control per API or API package. `match_policy: if_present` lets unmatched routes through; `required` 404s them.
  It runs after other auth plugins, which then need `config.anonymous`. Max 1,000 operations per API.
- Since 3.15 the portal creates a Kong Identity principal per application (principal ID = application ID). Per-app plugins:
  `condition: principal.id == "<application id>"`, or map the application to an existing Consumer.
- Application auth strategies: `key_auth` or `openid_connect` + DCR provider (`okta`, `azureAd`, `auth0`, Curity, Kong Identity,
  HTTP bridge for anything else).
- API package rate limits apply cumulatively across the package's operations. No API or Terraform resource for packages.
- Terraform: `konnect_application_auth_strategy`, `konnect_dcr_provider`, `konnect_api`, `konnect_api_implementation`
  (`control_plane_reference`), `konnect_api_publication`, `konnect_gateway_plugin_ace`.

## IdP claim defaults used by the builder

| IdP | User claim | App claim | Groups claim | Note |
|---|---|---|---|---|
| Kong Identity | — | `sub` (client_id) | templated from client labels | Machine tokens only |
| Okta | `sub` | `sub` | `groups` | Needs a custom authorization server and a groups filter |
| Entra ID | `preferred_username` | `azp` | `roles` | `groups` holds object IDs; use app roles |
| Keycloak | `preferred_username` | `azp` | `groups` | Group membership mapper, full path off (`lab-verified`) |
| AD FS | `upn` | `appid` | `group` | Issuance transform rule; one group arrives as a string |

Only Keycloak and Kong Identity were run in the lab; the others are documented defaults to test.

## Analytics

| Need | Source |
|---|---|
| Per caller without Consumers | Konnect `/v2/api-requests`: `oidc_credential` (virtual credential), `principal`, `consumer_group` / `ai_gateway_consumer_group` IDs, `application`, `api_package`, AI token counts (`lab-verified`) |
| Per BU | A BU Consumer Group (analytics dimension) or a log label. Principal metadata is not an analytics dimension: the data plane only reports `principal.id` |
| Prometheus | Only a `consumer` label. Identity labels need http-log `custom_fields_by_lua` → Vector `log_to_metric` (`lab-verified`) |
| OpenTelemetry | `enable_principal_attribute` (3.16) adds `kong.auth.principal.*` to request counts (`lab-verified`) |
| AI Cost Management (Beta, US) | Subjects `principal/<uuid>` > `consumer/<uuid>` > `oidc/<claim>`; tags from `ai-cost-*` headers via a global pre-function. Not lab-verified |

## Lab-verified scenarios

`labMatch()` badges these core paths (run end to end on 2026-10-09, Gateway 3.16.0.0 and AI Gateway 2.2.0, Konnect US):

| ID | Path |
|---|---|
| AI-1 | AI · employees · models · OIDC Keycloak · token claims · sub-CG · LLM token budget |
| AI-2 | AI · apps · models · client credentials Kong Identity · principals · sub-CG · LLM token budget |
| AI-3 | AI · agents · A2A · client credentials Kong Identity · principals · sub-CG · no plan |
| API-1 | API · apps · API keys · principals · sub-CG · tier-CG (± BU-CG) |
| API-2 | API · employees · OIDC Keycloak · token claims · sub-CG · BU-CG |
