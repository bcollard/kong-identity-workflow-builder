# Backlog

## Test every combination

- Walk each wizard path family in a lab and promote it to `labMatch()` when it passes. Priority order:
  1. API Gateway with principals and no Consumer Groups (`access: meta`, `tier-meta`, `bu-meta`): ACL `allow_when` and
     plugin `expressions` haven't been run yet.
  2. Dev Portal applications (key-auth and DCR with Kong Identity), ACE with `if_present`, per-app `condition`.
  3. Okta, Entra ID and AD FS claim names (`sub` / `azp` / `appid`, `groups` / `roles` / `group`).
  4. AI Gateway MCP servers with token-claim tool ACLs.
  5. AI Gateway 1.x on 3.16 and 3.15: OIDC multi-issuer, ACL allow_when on model routes, ai-rate-limiting-advanced llm_providers mode with identifier: credential, ai-mcp-proxy tool ACLs from a claim.
  6. AI Cost Management subjects and tags (needs an org enabled for the Beta and model prices).
- Add a "copy all" export (zip or single markdown) of the generated config.

## End-to-end runs from a scenario ID

Given an ID: `node tools/scenario.js <id> --out dir` gives the answers and files. Next steps:

- Self-managed: marina cluster with the scenario's Kong version, `deck gateway sync` / `deck ai sync` of `dir/decl.yaml`,
  Keycloak standing in for Okta / Entra / AD FS (same claim names), mock upstreams, then one request per sequence step.
- Konnect: reuse the lab helpers (control plane, Kong Identity, principals) with the same request checks.
- Bulk: `deck gateway validate --online` on every runtime class against local 3.15 / 3.16 / AI Gateway 2.2 control planes.

## Wizard variables not covered yet

| Variable | Why it matters |
|---|---|
| Several caller populations on one AI model | One `openid-connect` strategy per model: the builder should generate one route per issuer |
| Token exchange / on-behalf-of (RFC 8693, actor token) | Agents acting for a user; `openid-connect` token exchange and `ai-mcp-oauth2` token exchange |
| MCP OAuth (`ai-mcp-oauth2`) | MCP clients discovering the auth server through protected-resource metadata |
| mTLS clients | Certificate-bound callers; principal identity by certificate |
| Several control planes or environments | Consumer Group UUIDs per control plane vs names in principal metadata |
| Self-managed Terraform | The Terraform tab is hidden for self-managed control planes; the `kong/kong-gateway` provider could fill it |
| Dev Portal apps on AI routes | ACE on a control plane that also carries AI plugins |

## Generated config gaps

- Terraform AI model, agent and MCP resources are stubs that point to the kongctl tab.
- Terraform plugin `expressions` and `condition` support depends on the provider version; check before relying on them.
- No API or Terraform resource for API packages; principals have no Terraform resource.
- DCR provider `dcr_config` is IdP-specific and left as a placeholder.

## UI

- Review on a phone and in light theme.
- Show which answers changed downstream when an earlier answer is edited.
- Link each warning to its source in `docs/knowledge.md`.
