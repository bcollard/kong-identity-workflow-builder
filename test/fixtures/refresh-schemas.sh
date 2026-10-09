#!/usr/bin/env bash
# Snapshot the plugin schemas the builder generates config for, from real Kong containers (DB-less, Admin API on loopback).
# Re-run when you bump a version. Needs a Docker host (marina: eval "$(marina docker-env)").
set -euo pipefail
cd "$(dirname "$0")"

PLUGINS_GW="openid-connect key-auth acl rate-limiting rate-limiting-advanced http-log prometheus opentelemetry post-function ace
ai-proxy-advanced ai-rate-limiting-advanced ai-a2a-proxy ai-mcp-proxy ai-mcp-oauth2"
PLUGINS_AIGW="openid-connect key-auth acl ai-rate-limiting-advanced ai-proxy-advanced ai-a2a-proxy ai-mcp-proxy post-function prometheus opentelemetry
ai-model-selector ai-mcp-oauth2 request-termination"   # last line: plugins ai-deck-converter adds when lowering deck ai sync files

dump() { # name image plugins...   (ONLY=<name> refreshes a single target)
  local name="$1" image="$2"; shift 2
  [[ -z "${ONLY:-}" || "$ONLY" == "$name" ]] || return 0
  local c="schema-dump-$name"
  acurl() { docker run --rm --network "container:$c" curlimages/curl:8.10.1 -sf "$@"; }   # Kong images ship no curl
  docker rm -f "$c" >/dev/null 2>&1 || true
  docker run -d --name "$c" -e KONG_DATABASE=off -e KONG_ADMIN_LISTEN=127.0.0.1:8001 \
    -e KONG_LICENSE_DATA="${KONG_LICENSE_DATA:-}" "$image" >/dev/null
  for _ in $(seq 1 60); do acurl http://127.0.0.1:8001/status >/dev/null 2>&1 && break; sleep 1; done
  mkdir -p "schemas/$name"
  acurl http://127.0.0.1:8001/schemas/plugins > "schemas/$name/_plugin-entity.json"
  acurl http://127.0.0.1:8001/ | jq '{version}' > "schemas/$name/_version.json"
  for p in "$@"; do
    acurl "http://127.0.0.1:8001/schemas/plugins/$p" > "schemas/$name/$p.json" \
      || { echo "  ! $name: no schema for $p"; rm -f "schemas/$name/$p.json"; }
  done
  echo "$name: $(jq -r .version "schemas/$name/_version.json") · $(ls "schemas/$name" | grep -vc '^_') plugin schemas"
  docker rm -f "$c" >/dev/null
}
dump gw-3.16 kong/kong-gateway:3.16.0.0 $PLUGINS_GW
dump gw-3.15 kong/kong-gateway:3.15.0.6 $PLUGINS_GW
dump aigw-2.2 kong/kong-ai-gateway:2.2.0 $PLUGINS_AIGW
