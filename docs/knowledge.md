# Knowledge behind the builder

Product facts the wizard relies on. Versions: Kong Gateway 3.15 / 3.16 (incl. AI plugins, "AI Gateway 1.x"), AI Gateway 2.2 / 2.3, Konnect (2026-11).
Checked on 2026-11-05: Kong Gateway 3.17 is not released (3.16.0.1 is the latest); AI Gateway 2.3.0 shipped on 2026-11-04
and is the Konnect default runtime. The version step picks 2.3 or 2.2 for AI Gateway 2.x.
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
  when no Consumer was mapped. Consumer mapping only runs if `consumer_claim` is set. `consumer_claims` (array of paths)
  already exists in 3.16, with `consumer_claim` deprecated. `credential_claims` (array of paths, first match wins) arrives in
  Gateway 3.17 and AI Gateway 2.3; `credential_claim` becomes its deprecated shorthand (removal in 4.0) and the control
  plane strips `credential_claims` for older data planes (Kong source). The builder keeps `credential_claim`.
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
  for Kong Identity clients; `control_plane_consumer`; `custom`. No certificate (mTLS) identity type.
- Principal `type` is `agent` (deployed AI agent), `user` (human) or unset; the builder sets `user` for employees.
  Other principal fields: `active` (inactive principals are treated as nonexistent; portal principals can't be deactivated),
  read-only `groups` and `provisioned_by` (`konnect_user`, `developer_portal`, `trusted_idp`). Metadata: at most 50 keys,
  values are bool, string, int or arrays of strings/ints.
- Directories also hold principal groups (with group API keys), principal basic-auth credentials and trusted IdPs
  (`issuer_url`, `jwks_uri`, JIT provisioning with claim mapping).
- Plugins with `principals.enabled`: `key-auth`, `basic-auth`, `openid-connect` (`principal_claim`, `principal_by`,
  `match_consumer`, `match_consumer_groups`, `error_on_miss`). In principals mode `key-auth` skips local credentials
  (`identity_realms: []`).
- Plugins can't be attached to a principal. Scope them with `condition` expressions instead.
- Terraform `kong/konnect` 3.28.0 (2026-10-06) manages them: `konnect_identity_directory` (moved from the beta provider),
  `_principal` (`metadata` is a JSON string), `_principal_identity` (one of `oidc`, `auth_server_client`,
  `control_plane_consumer`, `custom`), `_principal_api_key`, `_principal_basic_auth`, `_group`, `_group_membership`,
  `_trusted_idp`. Terraform can't read back a generated (`v1`) API key secret, so the builder imports one (`type: imported`,
  `secret` from a sensitive variable) (`terraform validate` on 3.28). kongctl and Kong Operator have no principal resource.

### Kong Identity auth servers

- OAuth 2.0 / OIDC servers hosted by Konnect, one subdomain each: `https://<sub>.<region>.identity.konghq.com/auth`.
  Token endpoint `/oauth/token`, JWKS `/.well-known/jwks`.
- Publicly documented grant: `client_credentials`. `authorization_code` and `refresh_token` are internal only; the
  `jwt-bearer` grant (private-key-JWT client auth, ID-JAG) and client ID metadata documents are not generally available.
  Employees should keep a corporate IdP.
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
| Rate-limit `strategy: local` counts per data plane node; `cluster` needs a traditional, database-backed deployment (not hybrid, Konnect or DB-less) | Generated plans keep `local` and a note says to use `redis` with several nodes |
| A vault reference must be the whole field value: `"Bearer {vault://…}"` reaches the provider as literal text (401, measured on AI Gateway 2.3.1) | Store `Bearer <key>` in the secret and reference it as the whole header value, on 1.x and 2.x |
| `key-auth` reads the header value as is, with no `Bearer` prefix handling (AI Gateway source, `kong/plugins/key-auth/handler.lua`) | Claude Code sends `ANTHROPIC_API_KEY` as `x-api-key`: added to `key_names` when employees call models. Clients that send `Authorization: Bearer <key>` (Codex, Copilot, Cursor) don't match `key-auth` |
| `ai-rate-limiting-advanced` calendar windows (`window_type: calendar`, `limits[].period: week/month`) and `tokens_count_strategy: cost` exist in the 2.2 and 2.3 schemas | The 2.x LLM plan is a monthly cost budget plus a per-minute token cap. Cost uses target `input_cost` / `output_cost` (USD per 1M tokens, developer.konghq.com/ai-gateway/model-cost-management/); a target without prices counts as free |
| `ai-mcp-proxy` `logging.log_audits` and `log_statistics` default to `false` (3.15, 3.16, 2.2, 2.3 schemas); the 2.x MCP server entity exposes `config.logging.audits` and `payloads` only (kongctl 1.23) | MCP servers with an ACL get audits on: one log entry per ACL decision |

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
  termination answers **401** (`lab-verified`). Konnect now pins `ai-deck-converter` v0.32.7 (was v0.27.0). On converter
  main a model with a single strategy gets no fallback and the auth plugin answers 401 itself; agents keep the fallback and
  MCP servers never get one. Whether v0.32.7 includes the model change is unverified: re-run AI-1 / AI-2 to check.
- A valid token whose `consumer_claims` value matches no AI Consumer is rejected the same way (`consumer_optional`
  defaults to false); it is never proxied (Kong source).
- Model and agent `access.acls` take exactly one of `allow`, `deny`, `allow_when`, `deny_when`; the CEL forms need runtime
  2.2 and can read `principal.metadata` (Kong source). kongctl declares them from 1.23.0; the builder emits `allow_when` on
  models and agents for "Principal metadata + ACL allow_when" (not run in a lab yet). MCP server ACLs accept CEL from
  runtime 2.3 only, so the builder offers it on MCP servers with 2.3. The `acl` policy is global-only.
- Konnect agent `config.logging` accepts only `payloads` and `max_payload_size` (kongctl 1.23.0 schema); A2A statistics
  are logged by default (`ai-deck-converter` `DefaultLogStatistics = true`).
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

## AI Gateway 2.3

AI Gateway 2.3.0 shipped on 2026-11-04 and is the Konnect default runtime. With version 2.3 the builder sets
`min_runtime_version: "2.3"` on the gateway (kongctl and Terraform), offers `allow_when` on MCP servers, and offers Token
Vault upstream credentials. Not used yet (backlog): the rate-limit and expression items below. What 2.3 adds (Kong source,
kongctl docs, Konnect AI Gateway OpenAPI):

- MCP server ACLs: `access.acls`, `default_tool_acls` and per-tool ACLs accept `allow_when` / `deny_when`. A server-level
  rule takes exactly one form; a tool entry may pair `allow`+`deny` or `allow_when`+`deny_when`, not mix them. On a
  `passthrough-listener`, a server-level `allow_when` gates tools, not the MCP connection.
- CEL can read `principal.groups` and `principal.type`.
- `ai-rate-limiting-advanced`: `match: [{type: principal, key: id | display_name | metadata.<name>, partition_by: true}]`
  and `custom_key` (with `expressions.custom_key`). Still not allowed on agents or MCP servers.
- Policies take `expressions` (CEL per field, static fallback).
- MCP servers: native `rate_limiting.limits[{method | tool, limit, window_size}]` per node, listener types only.
- `openid-connect` strategies: `credential_claims`, `principals.jit.{all_claims, claims}` (claims sent to the principal lookup).
  An MCP strategy with `access.metadata` now lowers to `openid-connect` instead of `ai-mcp-oauth2`.
- Token Vault (below) on MCP servers, model providers and OIDC auth strategies.

## Token Vault

- Generally available since 2026-11-04 with AI Gateway 2.3, included with Kong Gateway subscriptions
  (konghq.com/blog/product-releases/kong-token-vault). Docs: developer.konghq.com/identity/token-vault/.
- Konnect-only credential broker in Kong Identity: a directory with `vault_enabled: true` stores upstream OAuth tokens or
  static secrets, encrypted with the directory's vault public key (RSA ≥ 2048 or EC ≥ 256, up to 5 keys). The matching
  private key stays on the data planes, so Konnect can't decrypt them. The AI Gateway exchanges the caller's token for the
  upstream credential (RFC 8693, over mTLS) and injects it; a caller who hasn't enrolled gets an enrollment URL (valid
  10 minutes) through virtual `authenticate` / `check_authentication_status` MCP tools. Exchanges are cached 5 minutes
  per node, optionally in Redis.
- Provider templates (`template_name`): `github`, `slack`, `atlassian`, `google` (OAuth app: `client_id` + `client_secret`);
  `snowflake`, `databricks` (plus your endpoints); `atlassian-rovo`, `datadog`, `miro` (DCR, no client); `custom-oauth`
  (client + endpoints); `static_secret` (API key stored on the provider, shared only). `credential_type`: `user` (default
  for OAuth: each principal enrolls) or `shared` (an admin enrolls once, or stores the secret).
- Upstream services need no RFC 8693 support (GitHub and Atlassian have none): the exchange runs between the gateway and
  Token Vault. At enrollment the user consents on the service, Token Vault exchanges the authorization code itself, then
  refreshes the token before expiry (provider `refresh_buffer_seconds`, with locking; a failed refresh keeps releasing a
  still-valid token). Source: developer.konghq.com/kong-identity/token-vault/.
- Callers are identified from a trusted IdP token (`iss` + `sub`; trusted IdP on the directory with
  `vault_access_enabled: true`, issuer equal to the token's `iss`; principals are provisioned just in time) or from a Kong
  Identity API key (`subject_token_type: api_key`). Consumer credentials can't be exchanged. Kong Identity auth servers
  can be trusted IdPs.
- Gateway side: AI Gateway 2.3 only (`ai-mcp-proxy` `auth.provider: token_vault`, plus `token-vault-exchange`,
  `token-vault-callback-handler`, `token-vault-credential-manager` plugins). Not in Kong Gateway 3.16 or 3.17.
- Konnect entities: a `token-vault` datastore (`directory`, `current_version`, `keys` as `{vault://…}` references);
  `token_vault {provider, subject_token_type, credential, cache}` + `datastores` on MCP servers and model providers;
  `token_vault.enable_credential_manager` on OIDC auth strategies. kongctl docs require the datastore whenever `token_vault`
  is set; the Konnect validator and converter only when `enable_credential_manager: true`.
- Terraform 3.28: `konnect_ai_gateway_datastore`, `konnect_identity_vault_key`, `_vault_provider`, `_vault_provider_credential`.
- The entity docs show `config.upstream.auth: {type: token_vault, token_vault: {directory, provider}}` on MCP servers,
  while the Konnect API (and kongctl 1.23) put `token_vault` and `datastores` on the MCP server entity. The builder follows
  the API, which the kongctl schema validates. The 2.3 `ai-mcp-proxy` plugin schema (`schemas/aigw-2.3`) carries the lowered
  form: `auth.provider: token_vault` and `auth.token_vault {directory, provider, subject_token_type (access_token | api_key),
  storage {backend: konnect, current_version, keys}, cache.redis, credential.inbound/outbound}`. When `subject_token_type` is
  unset the plugin infers it: a JWS is an access token, anything else an API key.

## Kong Operator

- Latest: v2.4.0-rapid.3.1 (2026-11-04); latest non-rapid v2.3.3. No CRDs for Kong Identity directories, principals or
  auth servers: identity objects come from Terraform or the Konnect API.
- AI Gateway CRDs (`aiconfiguration.konghq.com`): `AIGatewayAuthStrategy` (`key-auth` / `openid-connect`, `principals`,
  `tokenVault`), `AIGatewayMCPServer` (`tokenVault`, ACLs referencing `AIGatewayConsumerGroup`), `AIGatewayDatastore`
  (`redis-ce`, `redis-ee`, `vectordb`, `token-vault`), `AIGatewayConsumer`, `AIGatewayConsumerCredential` (`api-key` only).

## Kong Gateway 3.17 (unreleased)

On `master` as of 2026-11-05, no release date. Relevant to the builder once it ships:

- `openid-connect` `credential_claims` and `principals.jit` (see Token claims).
- `rate-limiting-advanced` `missing_identifier_behavior`: `ip` (default), `reject` (403), `skip`, `fixed_key`.
- CEL variables `principal.type` and `principal.groups` in `condition` and ACL `allow_when` / `deny_when`.
- `opentelemetry` `metrics.enable_credential_attribute` (`kong.auth.credential.id`) and `client_certificate`.
- No new auth plugin gets `principals` (still `key-auth`, `basic-auth`, `openid-connect`); route `protocols` default unchanged.

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
