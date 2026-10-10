# Identity Paths builder: static page + a dependency-free Node server (scenario API, version stamp).
FROM node:22-alpine
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY site ./site
USER node
EXPOSE 8080
CMD ["node", "server/server.js"]
