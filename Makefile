PORT ?= 8000
URL  := http://localhost:$(PORT)

.PHONY: help run play open stop

help: ## Show available commands
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-6s %s\n", $$1, $$2}'

run: ## Serve the game at http://localhost:PORT
	@echo "Chill Valley running at $(URL)  (Ctrl+C to stop)"
	@python3 -m http.server $(PORT)

play: ## Serve the game and open it in the browser
	@(sleep 1 && open $(URL)) &
	@$(MAKE) --no-print-directory run

open: ## Open the game in the browser (server must be running)
	@open $(URL)

stop: ## Stop a server left running on PORT
	@lsof -ti tcp:$(PORT) | xargs kill 2>/dev/null && echo "Stopped server on $(PORT)" || echo "Nothing running on $(PORT)"
