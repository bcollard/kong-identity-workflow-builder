# Identity Paths builder: static page + a dependency-free Node server (scenario API, version stamp).
# Base image pinned by digest; Dependabot proposes updates.
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4
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
