# Kong Identity Workflow Builder

A static, single-page wizard that turns a few answers into a Kong identity blueprint:

1. Product (API Gateway 3.16 or AI Gateway 2.2) and control plane (Konnect or self-managed)
2. Who calls (employees, apps, agents, Dev Portal applications) and, on AI Gateway, what they call (models, A2A agents, MCP servers)
3. Credential (OIDC login, OAuth client credentials, API keys) and OAuth server (Kong Identity, Okta, Entra ID, Keycloak, AD FS)
4. Identity record (token claims, Kong Identity principals, Consumers)
5. Access control, usage plans and analytics

It shows which Consumer Groups are really needed (sub-CGs, tier-CGs, BU-CGs) and who owns them, plays an animated
sequence diagram, and generates kongctl/decK, Konnect API and Terraform snippets.

Combinations whose core path matches one of five scenarios run end to end in a lab are badged as validated;
everything else is a generated draft.

## Develop

No build step and no server code: `site/index.html` is plain HTML, CSS and JavaScript.

```bash
make serve   # http://localhost:8080
make test    # walk every answer path (≈32k) through the generators with Node
node test/sample.js '{"product":"api","deploy":"konnect","caller":"portal","cred":"cc","idp":"okta","record":"portalapp","access":"portal","plans":["pkg"],"analytics":["konnect"]}'   # print one blueprint
```

## Deploy

Pushing to `main` runs `.github/workflows/pages.yaml`: the path harness, then a GitHub Pages deployment of `site/`.
Enable Pages once with **Settings → Pages → Source: GitHub Actions**.
