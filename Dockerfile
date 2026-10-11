# Identity Paths builder: static page + a dependency-free Node server (scenario API, version stamp).
# Base image pinned by digest; Dependabot proposes updates.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY site ./site
COPY e2e/results ./e2e/results
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
