.DEFAULT_GOAL := help
.PHONY: help serve test

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-8s\033[0m %s\n", $$1, $$2}'

serve: ## Serve site/ on http://localhost:8080
	python3 -m http.server 8080 --directory site

test: ## Run every wizard path through the generators (Node, no dependencies)
	node test/harness.js
