# Backlog

## Test every combination

- Walk each wizard path family in a lab and promote it to `labMatch()` when it passes. Priority order:
  1. AI Gateway 2.2 models and agents with principals and no Consumer Groups: `access.acls.allow_when` on
     `principal.metadata` (generated since v1.7.0 with kongctl 1.23+). Check the 403 for a missing token.
  2. Re-run AI-2 and the API Gateway Konnect principals run (`11112025230M03`): v1.7.0 changed the "↳" tag comments in
     their Konnect API tab (principals now have Terraform resources), so their badges show an earlier output. Also check
     whether Konnect's converter (v0.32.7) still adds the anonymous fallback on single-strategy models (401 vs 403).
  3. Dev Portal applications (key-auth and DCR with Kong Identity), ACE with `if_present`, per-app `condition`.
  4. Okta, Entra ID and AD FS claim names (`sub` / `azp` / `appid`, `groups` / `roles` / `group`).
  5. AI Gateway MCP servers with token-claim tool ACLs.
  6. AI Gateway 1.x on 3.16 and 3.15: OIDC multi-issuer, ACL allow_when on model routes, ai-rate-limiting-advanced llm_providers mode with identifier: credential, ai-mcp-proxy tool ACLs from a claim.
  7. AI Cost Management subjects and tags (needs an org enabled for the Beta and model prices).
- Add a "copy all" export (zip or single markdown) of the generated config.

## End-to-end runs from a scenario ID

Runners exist for AI Gateway 2.x on Konnect (Keycloak employees, Kong Identity apps), API Gateway self-managed (API keys
on Consumers) and API Gateway on Konnect (Kong Identity apps with principals). Results: `e2e/results/`. Next:

- Konnect Analytics attribution (by principal, consumer group, BU) isn't checked yet.
- Runners for AI Gateway 1.x, A2A agents and MCP servers, Dev Portal applications, Okta/Entra/AD FS claim shapes
  (Keycloak standing in), and self-managed AI Gateway 2.x (`deck ai sync`).
- Bulk: `deck gateway validate --online` on every runtime class.
- AI-1 and AI-2 were run with the earlier LLM plan (fixed one-hour token window). Since v1.9.0 the plan is a monthly cost
  budget plus a per-minute cap: re-run them to check the calendar window and target prices against a live data plane.

## AI Gateway 2.3

The version step offers 2.3 (since v1.8.0): MCP `allow_when` and Token Vault use it. Still to do:

- Lab runs: Token Vault per-user (Okta or Keycloak, GitHub) and shared static secret; MCP `allow_when`.
- Token Vault for model providers (`token_vault` on `model_providers`), selectors on shared credentials (one key per team),
  several upstream MCP servers behind one `listener`, Redis credential cache.
- MCP tool ACLs with CEL.
- LLM token budgets per principal (`match: {type: principal, partition_by: true}`) and per-tier limits read from principal
  metadata (`key: metadata.<name>`), without tier-CGs.
- MCP hit limits with the native `rate_limiting` block (per tool or method) next to `rate-limiting-advanced`.
- Policy `expressions`, `credential_claims`, `principals.jit`.

## Wizard variables not covered yet

| Variable | Why it matters |
|---|---|
| Several caller populations on one AI model | One `openid-connect` strategy per model: generate `issuers_allowed` + `extra_jwks_uris` on it, with a claim unique across issuers, or a second model per issuer |
| Token exchange / on-behalf-of (RFC 8693, actor token) | Agents acting for a user; `openid-connect` token exchange and `ai-mcp-oauth2` token exchange |
| MCP OAuth (`ai-mcp-oauth2`) | MCP clients discovering the auth server through protected-resource metadata (`openid-connect` `protected_resource_metadata`, 3.16 / AI Gateway 2.3) |
| Principal groups and trusted IdPs | Kong Identity groups (`principal.groups` in CEL, 3.17 / AI Gateway 2.3) could replace sub-CGs in metadata; trusted IdPs JIT-provision principals |
| Kong Operator manifests | `AIGateway*` CRDs could fill a Kubernetes tab for AI Gateway 2.x; there are no Kong Identity CRDs |
| mTLS clients | Certificate-bound callers; principal identity by certificate |
| Several control planes or environments | Consumer Group UUIDs per control plane vs names in principal metadata |
| Self-managed Terraform | The Terraform tab is hidden for self-managed control planes; the `kong/kong-gateway` provider could fill it |
| Dev Portal apps on AI routes | ACE on a control plane that also carries AI plugins |

## Generated config gaps

- Terraform AI model, agent and MCP resources are stubs that point to the kongctl tab.
- Terraform plugin `expressions` and `condition` support depends on the provider version; check before relying on them.
- No API or Terraform resource for API packages. Terraform principal API keys are imported (Terraform can't read back a
  generated key).
- DCR provider `dcr_config` is IdP-specific and left as a placeholder.

## UI

- Review on a phone and in light theme.
- Show which answers changed downstream when an earlier answer is edited.
- Link each warning to its source in `docs/knowledge.md`.
