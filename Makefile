# ═══════════════════════════════════════════════════════════════════
# Stitch Design Workflow — Makefile
# MCP server: Google Stitch → Claude Code / Cursor / VS Code / Antigravity
# ═══════════════════════════════════════════════════════════════════

SHELL         := /bin/bash
.DEFAULT_GOAL := help
PROJECT_DIR   := $(shell pwd)
DIST_DIR      := $(PROJECT_DIR)/dist
SERVER_ENTRY  := $(DIST_DIR)/server.js
NODE_BIN      := $(PROJECT_DIR)/node_modules/.bin
PACKAGE_NAME  := stitch-design-workflow

# Colors for terminal output
CYAN   := \033[36m
GREEN  := \033[32m
YELLOW := \033[33m
RED    := \033[31m
DIM    := \033[2m
BOLD   := \033[1m
RESET  := \033[0m

# ─── Core Commands ────────────────────────────────────────────────

.PHONY: help
help: ## Show this help
	@echo ""
	@echo "  $(BOLD)$(CYAN)Stitch Design Workflow$(RESET) — MCP Server"
	@echo "  $(DIM)Prompt → Stitch → Claude Code / Cursor / VS Code / Antigravity$(RESET)"
	@echo ""
	@echo "  $(BOLD)Core:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; /^(setup|install|build|start|dev|lint)/ {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)Maintenance:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; /^(clean|rebuild|health|logs|tree|zip)/ {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "  $(BOLD)MCP Setup:$(RESET)"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; /^(claude|cursor|vscode|agy)/ {printf "    $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""

.PHONY: setup
setup: install build verify ## First-time setup: install + build + verify
	@echo ""
	@echo "  $(GREEN)✓ Setup complete.$(RESET)"
	@echo "  $(DIM)Next: export STITCH_API_KEY=your-key && make start$(RESET)"

.PHONY: install
install: ## Install npm dependencies
	@echo "  $(CYAN)⟳ Installing dependencies...$(RESET)"
	@npm install --silent
	@echo "  $(GREEN)✓ Dependencies installed$(RESET)"

.PHONY: build
build: ## Compile TypeScript → dist/
	@echo "  $(CYAN)⟳ Compiling TypeScript...$(RESET)"
	@npx tsc
	@echo "  $(GREEN)✓ Build complete → $(DIST_DIR)$(RESET)"

.PHONY: start
start: _check-build ## Run the MCP server (production mode)
	@echo "  $(CYAN)▶ Starting MCP server (stdio transport)...$(RESET)"
	@echo "  $(DIM)Auth: $${STITCH_API_KEY:+API Key}$${STITCH_ACCESS_TOKEN:+OAuth}$${GOOGLE_CLOUD_PROJECT:+gcloud ADC}$(RESET)"
	@node $(SERVER_ENTRY)

.PHONY: dev
dev: ## Run with tsx hot-reload (development mode)
	@echo "  $(CYAN)▶ Starting dev server with hot-reload...$(RESET)"
	@npx tsx src/server.ts

.PHONY: lint
lint: ## Type-check without emitting (CI-friendly)
	@echo "  $(CYAN)⟳ Type-checking...$(RESET)"
	@npx tsc --noEmit
	@echo "  $(GREEN)✓ No type errors$(RESET)"

# ─── Maintenance Commands ─────────────────────────────────────────

.PHONY: clean
clean: ## Remove dist/ and node_modules/
	@echo "  $(YELLOW)⟳ Cleaning build artifacts...$(RESET)"
	@rm -rf dist node_modules
	@echo "  $(GREEN)✓ Clean$(RESET)"

.PHONY: rebuild
rebuild: clean install build ## Clean + install + build (nuclear option)
	@echo "  $(GREEN)✓ Full rebuild complete$(RESET)"

.PHONY: health
health: _check-build ## Run a quick Stitch API health check
	@echo "  $(CYAN)🩺 Running health check...$(RESET)"
	@echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"stitch_health_check","arguments":{"verbose":true}}}' | \
		node $(SERVER_ENTRY) 2>/dev/null | head -20 || \
		echo "  $(RED)✗ Health check failed. Is STITCH_API_KEY set?$(RESET)"

.PHONY: logs
logs: ## Tail server logs (when running in background)
	@echo "  $(DIM)MCP servers log to stderr. If running via editor, check the editor's MCP output panel.$(RESET)"
	@echo "  $(DIM)For standalone: make start 2>&1 | tee server.log$(RESET)"

.PHONY: tree
tree: ## Show project file structure
	@echo ""
	@echo "  $(BOLD)$(CYAN)Project Structure$(RESET)"
	@echo ""
	@find src -type f | sort | sed 's|^|  |'
	@echo ""
	@echo "  $(DIM)+ package.json, tsconfig.json, Makefile, README.md$(RESET)"

.PHONY: zip
zip: build ## Package the project for distribution
	@echo "  $(CYAN)⟳ Packaging...$(RESET)"
	@cd .. && zip -r $(PACKAGE_NAME).zip stitch-workflow/ \
		-x "stitch-workflow/node_modules/*" \
		-x "stitch-workflow/dist/*" \
		-x "stitch-workflow/.git/*" \
		> /dev/null
	@echo "  $(GREEN)✓ Created ../$(PACKAGE_NAME).zip$(RESET)"

.PHONY: verify
verify: ## Verify Node.js version and build output
	@echo "  $(CYAN)⟳ Verifying environment...$(RESET)"
	@node -e "const v=process.versions.node.split('.')[0]; if(v<18){console.error('Node 18+ required, got '+process.versions.node);process.exit(1)}" \
		&& echo "  $(GREEN)✓ Node.js $$(node --version)$(RESET)" \
		|| (echo "  $(RED)✗ Node.js 18+ required$(RESET)" && exit 1)
	@test -f $(SERVER_ENTRY) \
		&& echo "  $(GREEN)✓ Build output exists$(RESET)" \
		|| echo "  $(YELLOW)⚠ No build output yet — run 'make build'$(RESET)"
	@test -f node_modules/.package-lock.json \
		&& echo "  $(GREEN)✓ Dependencies installed$(RESET)" \
		|| echo "  $(YELLOW)⚠ Dependencies missing — run 'make install'$(RESET)"

# ─── MCP Setup Commands ──────────────────────────────────────────

.PHONY: claude-add
claude-add: _check-build _check-key ## Register this server in Claude Code's MCP config
	@echo "  $(CYAN)⟳ Adding to Claude Code...$(RESET)"
	@claude mcp add stitch-workflow \
		-e STITCH_API_KEY=$(STITCH_API_KEY) \
		-- node $(SERVER_ENTRY) \
		&& echo "  $(GREEN)✓ Added to Claude Code. Verify with: claude mcp list$(RESET)" \
		|| echo "  $(RED)✗ Failed. Is 'claude' CLI installed?$(RESET)"

.PHONY: cursor-init
cursor-init: _check-build ## Generate .cursor/mcp.json in the current directory
	@echo "  $(CYAN)⟳ Creating .cursor/mcp.json...$(RESET)"
	@mkdir -p .cursor
	@cat > .cursor/mcp.json << EOF
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["$(SERVER_ENTRY)"],
      "env": {
        "STITCH_API_KEY": "$${STITCH_API_KEY:-your-stitch-api-key-here}"
      }
    }
  }
}
EOF
	@echo "  $(GREEN)✓ Created .cursor/mcp.json$(RESET)"
	@echo "  $(DIM)Restart Cursor to pick up the new MCP server.$(RESET)"
	@if [ "$${STITCH_API_KEY}" = "" ]; then \
		echo "  $(YELLOW)⚠ STITCH_API_KEY not set — edit .cursor/mcp.json with your key$(RESET)"; \
	fi

.PHONY: vscode-init
vscode-init: _check-build ## Generate .vscode/mcp.json in the current directory
	@echo "  $(CYAN)⟳ Creating .vscode/mcp.json...$(RESET)"
	@mkdir -p .vscode
	@cat > .vscode/mcp.json << EOF
{
  "servers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["$(SERVER_ENTRY)"],
      "env": {
        "STITCH_API_KEY": "$${STITCH_API_KEY:-your-stitch-api-key-here}"
      }
    }
  }
}
EOF
	@echo "  $(GREEN)✓ Created .vscode/mcp.json$(RESET)"
	@echo "  $(DIM)Works with Cline, Continue, and Copilot MCP extensions.$(RESET)"
	@if [ "$${STITCH_API_KEY}" = "" ]; then \
		echo "  $(YELLOW)⚠ STITCH_API_KEY not set — edit .vscode/mcp.json with your key$(RESET)"; \
	fi

.PHONY: agy-init
agy-init: _check-build ## Generate Antigravity MCP config
	@echo "  $(CYAN)⟳ Creating Antigravity MCP config...$(RESET)"
	@mkdir -p ~/.antigravity 2>/dev/null || true
	@AGY_CONFIG="$${HOME}/.antigravity/mcp.json"; \
	if [ -f "$$AGY_CONFIG" ]; then \
		echo "  $(YELLOW)⚠ $$AGY_CONFIG already exists — backing up to $$AGY_CONFIG.bak$(RESET)"; \
		cp "$$AGY_CONFIG" "$$AGY_CONFIG.bak"; \
	fi; \
	cat > "$$AGY_CONFIG" << EOF
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["$(SERVER_ENTRY)"],
      "env": {
        "STITCH_API_KEY": "$${STITCH_API_KEY:-your-stitch-api-key-here}"
      }
    }
  }
}
EOF
	@echo "  $(GREEN)✓ Created ~/.antigravity/mcp.json$(RESET)"
	@echo "  $(DIM)Restart Antigravity to activate.$(RESET)"
	@if [ "$${STITCH_API_KEY}" = "" ]; then \
		echo "  $(YELLOW)⚠ STITCH_API_KEY not set — edit ~/.antigravity/mcp.json with your key$(RESET)"; \
	fi

# ─── MCP Config Generators (for external projects) ───────────────

.PHONY: mcp-json
mcp-json: _check-build ## Print MCP server config JSON to stdout (pipe-friendly)
	@cat << EOF
{
  "stitch-workflow": {
    "command": "node",
    "args": ["$(SERVER_ENTRY)"],
    "env": {
      "STITCH_API_KEY": "$${STITCH_API_KEY:-YOUR_STITCH_API_KEY}"
    }
  }
}
EOF

# ─── Internal Helpers ─────────────────────────────────────────────

.PHONY: _check-build
_check-build:
	@test -f $(SERVER_ENTRY) || (echo "  $(RED)✗ Build output missing. Run 'make build' first.$(RESET)" && exit 1)

.PHONY: _check-key
_check-key:
	@test -n "$${STITCH_API_KEY}" || (echo "  $(RED)✗ STITCH_API_KEY not set. Export it first:$(RESET)" && \
		echo "  $(DIM)export STITCH_API_KEY=your-key$(RESET)" && exit 1)
