#!/usr/bin/env node
/**
 * Stitch Design Workflow — MCP Server
 * 
 * The nerve center. This file:
 * 1. Registers all tools with the MCP SDK
 * 2. Handles authentication resolution
 * 3. Routes tool calls to their handlers
 * 4. Manages the StitchClient lifecycle
 * 
 * Run modes:
 *   - Claude Code:    claude mcp add stitch-workflow -- node dist/server.js
 *   - VS Code:        Add to .vscode/mcp.json
 *   - Antigravity:    Add to MCP catalog
 *   - Standalone:     node dist/server.js (stdio transport)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { StitchClient } from "./connectors/stitch-client.js";
import { createLogger } from "./utils/logger.js";
import { checkServiceHealth } from "./utils/health-check.js";

// Tool handlers
import { generateScreen } from "./tools/generate-screen.js";
import { extractDesignContext } from "./tools/extract-design.js";
import { exportToDevTool } from "./tools/export-to-devtool.js";
import { runFullPipeline } from "./tools/full-pipeline.js";

// Schemas (for tool definitions)
import {
  GenerateScreenInputSchema,
  ExtractDesignContextInputSchema,
  FetchScreenCodeInputSchema,
  BuildSiteInputSchema,
  ExportToDevToolInputSchema,
  FullPipelineInputSchema,
  HealthCheckInputSchema,
  AuthConfigSchema,
} from "./validators/schemas.js";

const logger = createLogger("server");

// ═══════════════════════════════════════════════════════
// Auth Resolution — figure out how we're talking to Stitch
// ═══════════════════════════════════════════════════════

function resolveAuth() {
  // Priority: STITCH_API_KEY > STITCH_ACCESS_TOKEN > gcloud ADC
  if (process.env.STITCH_API_KEY) {
    return AuthConfigSchema.parse({
      method: "api_key",
      apiKey: process.env.STITCH_API_KEY,
    });
  }

  if (process.env.STITCH_ACCESS_TOKEN) {
    return AuthConfigSchema.parse({
      method: "oauth",
      accessToken: process.env.STITCH_ACCESS_TOKEN,
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    });
  }

  // Default: Application Default Credentials via gcloud CLI
  return AuthConfigSchema.parse({
    method: "gcloud_adc",
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  });
}

// ═══════════════════════════════════════════════════════
// Tool Definitions — what we expose to the MCP client
// ═══════════════════════════════════════════════════════

const TOOLS = [
  {
    name: "stitch_generate_screen",
    description:
      "Generate a UI screen from a text prompt using Google Stitch. " +
      "Describe what you want (e.g., 'dark-themed dashboard with sidebar nav and KPI cards') " +
      "and Stitch renders it as HTML/CSS. Takes 2-10 minutes for generation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "Natural language description of the UI to generate (min 10 chars)" },
        projectId: { type: "string", description: "Existing Stitch project ID, or omit to create new" },
        platform: { type: "string", enum: ["web", "mobile"], default: "web" },
        style: { type: "string", description: "Visual style hints: 'dark theme', 'minimal', 'glassmorphism'" },
        designSystemUrl: { type: "string", description: "URL to extract design system from" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "stitch_extract_design",
    description:
      "Extract design tokens (colors, fonts, spacing, components, layout) from a Stitch screen. " +
      "Returns structured design context that feeds into DESIGN.md generation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "Stitch project ID" },
        screenId: { type: "string", description: "Screen ID within the project" },
      },
      required: ["projectId", "screenId"],
    },
  },
  {
    name: "stitch_export_to_devtool",
    description:
      "Export Stitch designs to a development tool. Generates DESIGN.md, HTML/CSS code, " +
      "screenshots, and tool-specific configuration files. " +
      "Targets: claude_code, vscode, antigravity, local_files.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "Stitch project ID" },
        screenIds: {
          type: "array",
          items: { type: "string" },
          description: "Screen IDs to export",
        },
        target: {
          type: "string",
          enum: ["claude_code", "vscode", "antigravity", "local_files"],
          description: "Target development tool",
        },
        outputDir: { type: "string", description: "Custom output directory (optional)" },
        includeDesignMd: { type: "boolean", default: true },
        includeScreenshots: { type: "boolean", default: true },
      },
      required: ["projectId", "screenIds", "target"],
    },
  },
  {
    name: "stitch_full_pipeline",
    description:
      "Full pipeline: prompt → generate screen(s) → extract design → export to target tool(s). " +
      "One call does everything. Supports multiple design variants and multiple export targets. " +
      "Example: 'Build a crypto dashboard' → generates 3 variants → exports to Claude Code + Antigravity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: { type: "string", description: "What to build (min 10 chars)" },
        platform: { type: "string", enum: ["web", "mobile"], default: "web" },
        style: { type: "string", description: "Visual style hints" },
        targets: {
          type: "array",
          items: { type: "string", enum: ["claude_code", "vscode", "antigravity", "local_files"] },
          description: "Where to deliver the generated code",
        },
        outputDir: { type: "string", description: "Custom output directory" },
        variants: { type: "number", default: 1, description: "Number of design variants (1-6)" },
      },
      required: ["prompt", "targets"],
    },
  },
  {
    name: "stitch_list_projects",
    description: "List all Stitch projects in your account.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "stitch_list_screens",
    description: "List all screens in a Stitch project.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "Stitch project ID" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "stitch_get_screen_code",
    description: "Fetch the HTML/CSS code for a specific Stitch screen.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectId: { type: "string", description: "Stitch project ID" },
        screenId: { type: "string", description: "Screen ID" },
      },
      required: ["projectId", "screenId"],
    },
  },
  {
    name: "stitch_health_check",
    description:
      "Check connectivity to the Stitch API and verify authentication. " +
      "Run this first to diagnose any setup issues.",
    inputSchema: {
      type: "object" as const,
      properties: {
        verbose: { type: "boolean", default: false },
      },
    },
  },
];

// ═══════════════════════════════════════════════════════
// Server Initialization
// ═══════════════════════════════════════════════════════

async function main() {
  logger.info("server-starting", { version: "1.0.0" });

  // Resolve auth from environment
  const auth = resolveAuth();
  const client = new StitchClient(auth);

  // Create the MCP server
  const server = new Server(
    {
      name: "stitch-design-workflow",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // ─── List Tools Handler ───
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // ─── Call Tool Handler ───
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    logger.info("tool-call", { tool: name });

    try {
      let result: unknown;

      switch (name) {
        case "stitch_generate_screen":
          result = await generateScreen(client, args);
          break;

        case "stitch_extract_design":
          result = await extractDesignContext(client, args);
          break;

        case "stitch_export_to_devtool":
          result = await exportToDevTool(client, args);
          break;

        case "stitch_full_pipeline":
          result = await runFullPipeline(client, args);
          break;

        case "stitch_list_projects":
          result = await client.listProjects();
          break;

        case "stitch_list_screens":
          result = await client.listScreens((args as any).projectId);
          break;

        case "stitch_get_screen_code":
          result = await client.getScreenCode(
            (args as any).projectId,
            (args as any).screenId
          );
          break;

        case "stitch_health_check": {
          const healthy = await client.healthCheck();
          const services = await checkServiceHealth([
            { name: "Stitch API", url: "https://stitch.withgoogle.com" },
            { name: "Stitch MCP", url: "https://stitch.googleapis.com" },
          ]);

          result = {
            stitchApiHealthy: healthy,
            authMethod: auth.method,
            services,
            timestamp: new Date().toISOString(),
          };
          break;
        }

        default:
          return {
            content: [
              {
                type: "text" as const,
                text: `Unknown tool: ${name}. Available: ${TOOLS.map((t) => t.name).join(", ")}`,
              },
            ],
            isError: true,
          };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("tool-call-failed", err instanceof Error ? err : new Error(message), { tool: name });

      return {
        content: [
          {
            type: "text" as const,
            text: `Error in ${name}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // ─── Start the server ───
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("server-ready", { auth: auth.method, tools: TOOLS.length });
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
