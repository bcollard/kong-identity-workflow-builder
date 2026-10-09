.DEFAULT_GOAL := help
.PHONY: help serve test test-all schemas

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-8s\033[0m %s\n", $$1, $$2}'

serve: ## Serve site/ on http://localhost:8080
	python3 -m http.server 8080 --directory site

test: ## Unit, schema, consistency and render tests, self-managed control planes (npm ci first)
	npm test

test-all: ## Same, including Konnect control planes
	npm run test:all

schemas: ## Refresh Kong plugin schema snapshots from real containers (needs Docker)
	test/fixtures/refresh-schemas.sh
