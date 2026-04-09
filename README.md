# Stitch Design Workflow — MCP Server

> **Prompt → UI → Code → Your Editor. One pipeline. Zero friction.**

An MCP server that orchestrates [Google Stitch](https://stitch.withgoogle.com)'s AI-powered UI generation into a seamless design-to-code pipeline for **Claude Code**, **Cursor**, **VS Code**, and **Google Antigravity**.

```
┌──────────────────┐      ┌─────────────────┐      ┌──────────────────────────────┐
│   Your Prompt    │─────▶│  Google Stitch   │─────▶│  stitch-design-workflow      │
│                  │      │  (Gemini 3 Pro)  │      │  MCP Server                  │
│  "dark crypto    │      │                  │      │  ┌────────────────────────┐  │
│   dashboard      │      │  Renders UI as   │      │  │ 8 tools exposed        │  │
│   with sidebar"  │      │  HTML/CSS/React  │      │  │ via MCP protocol       │  │
└──────────────────┘      └─────────────────┘      │  └────────────────────────┘  │
                                                    └──────────────┬───────────────┘
                                                                   │
                          ┌────────────────────────────────────────┼───────────────────────┐
                          │                    │                   │                       │
                          ▼                    ▼                   ▼                       ▼
                 ┌──────────────┐     ┌──────────────┐    ┌──────────────┐    ┌───────────────┐
                 │  Claude Code │     │    Cursor     │    │   VS Code    │    │  Antigravity  │
                 │              │     │              │    │              │    │               │
                 │  .claude/    │     │  .cursor/    │    │  .vscode/   │    │ .antigravity/ │
                 │  DESIGN.md   │     │  DESIGN.md   │    │  DESIGN.md  │    │  rules.md     │
                 │  src/        │     │  src/        │    │  src/       │    │  DESIGN.md    │
                 └──────────────┘     └──────────────┘    └──────────────┘    └───────────────┘
```

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Authentication](#authentication)
- [MCP Setup — Claude Code](#mcp-setup--claude-code)
- [MCP Setup — Cursor](#mcp-setup--cursor)
- [MCP Setup — VS Code](#mcp-setup--vs-code)
- [MCP Setup — Google Antigravity](#mcp-setup--google-antigravity)
- [Tools Reference](#tools-reference)
- [Usage Examples](#usage-examples)
- [Architecture](#architecture)
- [Makefile Commands](#makefile-commands)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Prerequisites

| Requirement | Minimum Version | Check |
|---|---|---|
| Node.js | 18.0+ | `node --version` |
| npm | 9.0+ | `npm --version` |
| Google Cloud account | — | [console.cloud.google.com](https://console.cloud.google.com) |
| Stitch API enabled | — | See [Authentication](#authentication) |

Optional (for gcloud ADC auth):

| Requirement | Install |
|---|---|
| gcloud CLI | `curl -sSL https://sdk.cloud.google.com \| bash` |

---

## Quick Start

```bash
# 1. Clone the project
git clone <your-repo-url> stitch-workflow
cd stitch-workflow

# 2. Install, build, verify — one command
make setup

# 3. Set your Stitch API key
export STITCH_API_KEY="your-key-here"

# 4. Run the server (stdio mode for MCP)
make start

# Or use the dev server with hot-reload
make dev
```

If you prefer step-by-step:

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript → dist/
npm run start        # Launch MCP server (stdio transport)
```

---

## Authentication

Three methods, checked in priority order. You only need **one**.

### Option A: Stitch API Key (Recommended)

The fastest path. No GCP project setup required.

1. Go to [stitch.withgoogle.com](https://stitch.withgoogle.com)
2. Click your **profile icon** (top-right) → **Stitch Settings**
3. Navigate to **API Keys** → **Create Key**
4. Copy the key

```bash
export STITCH_API_KEY="your-key-here"
```

### Option B: OAuth Access Token

For short-lived sessions or CI/CD pipelines.

```bash
export STITCH_ACCESS_TOKEN="ya29.your-token"
export GOOGLE_CLOUD_PROJECT="your-project-id"    # optional
```

### Option C: gcloud Application Default Credentials (ADC)

For users who already have `gcloud` configured. The server shells out to
`gcloud auth print-access-token` at runtime.

```bash
# One-time setup
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
gcloud beta services mcp enable stitch.googleapis.com

# Set the project for the server
export GOOGLE_CLOUD_PROJECT="your-project-id"
```

Verify authentication works:

```bash
make health
```

---

## MCP Setup — Claude Code

Claude Code natively supports MCP servers. Two options:

### Option 1: CLI One-Liner

```bash
claude mcp add stitch-workflow \
  -e STITCH_API_KEY=your-key \
  -- node $(pwd)/dist/server.js
```

### Option 2: Settings File

Add to `~/.claude/settings.json` (global) or `.claude/settings.json` (per-project):

```json
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
      "env": {
        "STITCH_API_KEY": "your-stitch-api-key"
      }
    }
  }
}
```

### Option 3: gcloud ADC (no API key)

```json
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
      "env": {
        "GOOGLE_CLOUD_PROJECT": "your-project-id"
      }
    }
  }
}
```

### Using It in Claude Code

```
> claude "Use stitch_full_pipeline to build a dark crypto dashboard and export to claude_code"

> claude "Generate a SaaS pricing page with glassmorphism style, 3 variants, export to claude_code and local_files"

> claude "Run stitch_health_check"
```

Claude Code auto-reads the generated `DESIGN.md` from the project root and applies the design tokens to all subsequent code generation.

---

## MCP Setup — Cursor

Cursor supports MCP via its settings. Three paths:

### Option 1: Project-Level Config (Recommended)

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
      "env": {
        "STITCH_API_KEY": "your-stitch-api-key"
      }
    }
  }
}
```

### Option 2: Global Config

Create or edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
      "env": {
        "STITCH_API_KEY": "your-stitch-api-key"
      }
    }
  }
}
```

### Option 3: Via Cursor Settings UI

1. Open Cursor → **Settings** (Ctrl+, or Cmd+,)
2. Search **MCP** or navigate to **Features → MCP Servers**
3. Click **Add New MCP Server**
4. Name: `stitch-workflow`
5. Command: `node`
6. Args: `/absolute/path/to/stitch-workflow/dist/server.js`
7. Environment: `STITCH_API_KEY=your-key`

### Using It in Cursor

In Cursor's AI chat (Cmd+L / Ctrl+L), the tools become available automatically:

```
Generate a mobile fitness app using stitch_full_pipeline, dark theme, export to local_files

Run stitch_health_check to verify connectivity

List all my Stitch projects
```

Cursor's Composer mode also picks up `DESIGN.md` as context when it's in the project root.

---

## MCP Setup — VS Code

VS Code supports MCP through extensions like **Cline**, **Continue**, or the built-in **GitHub Copilot** MCP support.

### For Cline / Continue / Copilot MCP

Create `.vscode/mcp.json` in your project root:

```json
{
  "servers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
      "env": {
        "STITCH_API_KEY": "your-stitch-api-key"
      }
    }
  }
}
```

### For Cline Specifically

Open the Cline extension sidebar → **MCP Servers** → **Add Server**:

```json
{
  "stitch-workflow": {
    "command": "node",
    "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
    "env": {
      "STITCH_API_KEY": "your-stitch-api-key"
    }
  }
}
```

The exported `DESIGN.md` and `.vscode/settings.json` are auto-generated by the `stitch_export_to_devtool` tool when you target `vscode`.

---

## MCP Setup — Google Antigravity

Antigravity is a VS Code fork with native MCP support.

### Option 1: MCP Catalog UI

1. Open Antigravity
2. **Settings** → **MCP** → **Add New Server**
3. Name: `stitch-workflow`, Command: `node`, Args: path to `dist/server.js`
4. Add env: `STITCH_API_KEY=your-key`

### Option 2: Config File

Create or edit `~/.antigravity/mcp.json`:

```json
{
  "mcpServers": {
    "stitch-workflow": {
      "command": "node",
      "args": ["/absolute/path/to/stitch-workflow/dist/server.js"],
      "env": {
        "STITCH_API_KEY": "your-stitch-api-key"
      }
    }
  }
}
```

### The Antigravity + Stitch Power Workflow

When you export to `antigravity`, the server generates three files that Antigravity's agent auto-discovers:

1. `.antigravity/rules.md` — agent build instructions
2. `DESIGN.md` — design system specification
3. `screenshots/` — visual reference for the agent

The agent enters an autonomous build loop: read design → generate code → launch browser → test → iterate.

```
Start a mission: "Build a React app from the Stitch designs in src/"
```

---

## Tools Reference

| Tool | Description | Key Params |
|---|---|---|
| `stitch_full_pipeline` | End-to-end: prompt → generate → extract → export | `prompt`, `targets[]`, `variants` |
| `stitch_generate_screen` | Generate UI from a text prompt via Stitch | `prompt`, `platform`, `style` |
| `stitch_extract_design` | Extract design tokens from a screen | `projectId`, `screenId` |
| `stitch_export_to_devtool` | Package designs for a target editor | `projectId`, `screenIds[]`, `target` |
| `stitch_list_projects` | List all Stitch projects | — |
| `stitch_list_screens` | List screens in a project | `projectId` |
| `stitch_get_screen_code` | Fetch raw HTML/CSS for a screen | `projectId`, `screenId` |
| `stitch_health_check` | Verify Stitch API + auth | `verbose` |

### `stitch_full_pipeline` — The Flagship Tool

One call does everything. This is what you'll use 90% of the time.

```json
{
  "prompt": "Dark-themed crypto dashboard with sidebar navigation, KPI cards, and portfolio chart",
  "platform": "web",
  "style": "glassmorphism, neon accents",
  "targets": ["claude_code", "antigravity"],
  "variants": 3,
  "outputDir": "/home/user/projects/crypto-dash"
}
```

**What it produces:**

```
crypto-dash/
├── DESIGN.md                  # Design system (colors, fonts, spacing, components)
├── .claude/settings.json      # Claude Code project config
├── .antigravity/rules.md      # Antigravity agent instructions
├── src/
│   └── components/
│       ├── screen-abc123.html # Variant 1
│       ├── screen-def456.html # Variant 2
│       └── screen-ghi789.html # Variant 3
└── screenshots/
    ├── screen-abc123.png
    ├── screen-def456.png
    └── screen-ghi789.png
```

---

## Usage Examples

### Generate and export to Claude Code

```bash
# In Claude Code:
claude "Use stitch_full_pipeline: build a SaaS analytics dashboard, dark theme, \
  export to claude_code, 2 variants"
```

### Generate and export to Cursor

```
# In Cursor chat (Cmd+L):
"Use stitch_full_pipeline to create a mobile fitness tracker app, \
  export to local_files at ./designs, 3 variants"
```

### Explore existing projects

```
"Run stitch_list_projects"
"Run stitch_list_screens for project proj_abc123"
"Run stitch_get_screen_code for project proj_abc123, screen scr_001"
```

### Extract design tokens from an existing screen

```
"Run stitch_extract_design for project proj_abc123, screen scr_001"
```

### Health check

```bash
make health
# or in any MCP client: "Run stitch_health_check with verbose mode"
```

---

## Architecture

```
stitch-workflow/
├── src/
│   ├── server.ts                  # MCP server entry — tool registration & routing
│   ├── tools/
│   │   ├── generate-screen.ts     # stitch_generate_screen — prompt → Stitch → screen
│   │   ├── extract-design.ts      # stitch_extract_design — screen → design tokens
│   │   ├── export-to-devtool.ts   # stitch_export_to_devtool — the bridge to editors
│   │   └── full-pipeline.ts       # stitch_full_pipeline — end-to-end orchestrator
│   ├── prompts/
│   │   └── templates.ts           # AI prompt constants (versioned, never inline)
│   ├── connectors/
│   │   └── stitch-client.ts       # Stitch API client (auth, retry, logging, timeouts)
│   ├── validators/
│   │   └── schemas.ts             # Zod schemas for every input/output boundary
│   ├── utils/
│   │   ├── logger.ts              # Structured logging (stderr, never stdout)
│   │   ├── retry.ts               # Exponential backoff + jitter
│   │   └── health-check.ts        # Service reachability pre-flight
│   └── configs/
│       └── mcp-configs.json       # Copy-paste MCP configs for all targets
├── dist/                          # Compiled output (git-ignored)
├── Makefile                       # All project commands
├── package.json
├── tsconfig.json
└── README.md                      # You are here
```

### Design Principles

- **Zod on every boundary** — no unvalidated data enters or leaves any tool
- **Structured logging to stderr** — stdout is reserved for MCP protocol; all logs go to stderr with timestamp, tool name, duration, and input hash
- **Retry with jitter** — all external API calls get 3 retries with exponential backoff + random jitter to prevent thundering herd
- **Graceful degradation** — if variant 2/3 fails, variants 1 and 3 still export; if one export target fails, others continue
- **DESIGN.md as the universal bridge** — the format that Stitch, Claude Code, Cursor, and Antigravity all understand
- **Prompt templates as constants** — AI prompts live in `prompts/templates.ts`, versioned, never inline

---

## Makefile Commands

Run `make help` to see all commands. Summary:

| Command | Description |
|---|---|
| `make setup` | First-time setup: install + build + verify |
| `make install` | Install npm dependencies |
| `make build` | Compile TypeScript → dist/ |
| `make start` | Run the MCP server (production) |
| `make dev` | Run with tsx hot-reload (development) |
| `make lint` | Type-check without emitting |
| `make clean` | Remove dist/ and node_modules/ |
| `make rebuild` | Clean + install + build |
| `make health` | Quick Stitch API health check |
| `make zip` | Package the project for distribution |
| `make claude-add` | Register this server in Claude Code |
| `make cursor-init` | Generate .cursor/mcp.json in current dir |
| `make vscode-init` | Generate .vscode/mcp.json in current dir |
| `make agy-init` | Generate Antigravity MCP config |
| `make tree` | Show project file structure |

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `STITCH_API_KEY` | Stitch API key (from Stitch Settings) | One of these |
| `STITCH_ACCESS_TOKEN` | OAuth2 access token | three is |
| `GOOGLE_CLOUD_PROJECT` | GCP project ID (for ADC fallback) | required |

The server resolves auth in priority order: `STITCH_API_KEY` → `STITCH_ACCESS_TOKEN` → gcloud ADC.

---

## Troubleshooting

### "Failed to get gcloud access token"

You're using ADC auth but gcloud isn't configured:

```bash
gcloud auth login
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```

### "Stitch API 403: Permission denied"

Your API key or token doesn't have access. For API keys:

1. Verify the key at stitch.withgoogle.com → Settings → API Keys
2. Make sure the key hasn't been revoked

For ADC:

```bash
gcloud beta services mcp enable stitch.googleapis.com
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

### "Screen generation timed out"

Stitch screen generation takes 2-10 minutes (Gemini 3 Pro under the hood). The server has a 10-minute timeout. If it still times out, try a simpler prompt or verify with `make health`.

### "Tool not found" in Claude Code / Cursor

1. Verify the server runs: `make health`
2. Check the path in your MCP config is **absolute** (not relative)
3. Restart your editor after adding MCP config
4. In Claude Code: `claude mcp list` to verify registration

### MCP server doesn't start

```bash
# Check Node.js version
node --version   # Must be 18+

# Verify build succeeded
make rebuild

# Test manually
STITCH_API_KEY=your-key node dist/server.js
# Should hang (waiting for stdio input) — that's correct for MCP
```

---

## License

MIT
