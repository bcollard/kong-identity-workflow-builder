# Identity Paths builder: static page + a dependency-free Node server (scenario API, version stamp).
# Base image pinned by digest; Dependabot proposes updates.
FROM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5
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
