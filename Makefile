.DEFAULT_GOAL := help
.PHONY: help serve test test-all schemas image scenario

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-8s\033[0m %s\n", $$1, $$2}'

serve: ## Run the server on http://localhost:8080/identity-paths/
	node server/server.js

image: ## Build the container image locally (identity-paths:dev)
	docker build --build-arg APP_VERSION=dev -t identity-paths:dev .

scenario: ## Decode a scenario ID and write its files: make scenario ID=v1.0.0-... [OUT=dir]
	node tools/scenario.js $(ID) $(if $(OUT),--out $(OUT))

test: ## Unit, schema, consistency and render tests, self-managed control planes (npm ci first)
	npm test

test-all: ## Same, including Konnect control planes
	npm run test:all

schemas: ## Refresh Kong plugin schema snapshots from real containers (needs Docker)
	test/fixtures/refresh-schemas.sh
