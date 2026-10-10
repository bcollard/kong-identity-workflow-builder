# Security

Please report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on this repository.
Don't open a public issue for a security problem.

## What runs where

- `kong.runlocal.dev/identity-paths/` is served by `server/server.js` on Cloud Run: no dependencies, fixed routes, GET/HEAD
  only, a hash-based Content Security Policy, HSTS and no framing. It stores nothing server-side.
- The container runs as a service account with no permissions. Releases are deployed only from `v*` tags of this
  repository by `.github/workflows/release.yaml`, through Workload Identity Federation (no long-lived keys).
- The page keeps your answers in your browser's `localStorage`. Google Analytics runs in Consent Mode and sets no
  cookies until you accept.
