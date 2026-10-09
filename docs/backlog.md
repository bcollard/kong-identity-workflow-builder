# Backlog

## Test every combination

- Walk each wizard path family in a lab and promote it to `labMatch()` when it passes. Priority order:
  1. API Gateway with principals and no Consumer Groups (`access: meta`, `tier-meta`, `bu-meta`): ACL `allow_when` and
     plugin `expressions` haven't been run yet.
  2. Dev Portal applications (key-auth and DCR with Kong Identity), ACE with `if_present`, per-app `condition`.
  3. Okta, Entra ID and AD FS claim names (`sub` / `azp` / `appid`, `groups` / `roles` / `group`).
  4. AI Gateway MCP servers with token-claim tool ACLs.
  5. AI Cost Management subjects and tags (needs an org enabled for the Beta and model prices).
- Add a "copy all" export (zip or single markdown) of the generated config.

## Wizard variables not covered yet

| Variable | Why it matters |
|---|---|
| Several caller populations on one AI model | One `openid-connect` strategy per model: the builder should generate one route per issuer |
| Token exchange / on-behalf-of (RFC 8693, actor token) | Agents acting for a user; `openid-connect` token exchange and `ai-mcp-oauth2` token exchange |
| MCP OAuth (`ai-mcp-oauth2`) | MCP clients discovering the auth server through protected-resource metadata |
| mTLS clients | Certificate-bound callers; principal identity by certificate |
| Several control planes or environments | Consumer Group UUIDs per control plane vs names in principal metadata |
| Self-managed AI Gateway | `deck ai sync` output instead of kongctl, no principals |

## Generated config gaps

- Terraform AI model, agent and MCP resources are stubs that point to the kongctl tab.
- Terraform plugin `expressions` and `condition` support depends on the provider version; check before relying on them.
- No API or Terraform resource for API packages; principals have no Terraform resource.
- DCR provider `dcr_config` is IdP-specific and left as a placeholder.

## UI

- Review on a phone and in light theme.
- Show which answers changed downstream when an earlier answer is edited.
- Link each warning to its source in `docs/knowledge.md`.
