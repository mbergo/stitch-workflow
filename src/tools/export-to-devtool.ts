/**
 * stitch_export_to_devtool — The Bridge.
 * 
 * This is where the magic converges. We take generated Stitch designs
 * and format + deliver them for the target development tool:
 * 
 * - claude_code: MCP-native delivery. DESIGN.md + components in project root.
 *   Claude Code reads DESIGN.md automatically and uses it for all code generation.
 * 
 * - vscode: Standard file layout. Works with Cline, Continue, or any AI extension.
 *   Files land in the workspace, DESIGN.md provides context.
 * 
 * - antigravity: Agent-first delivery. DESIGN.md in root, code in src/.
 *   Antigravity's agent auto-discovers the design system and applies it.
 * 
 * - local_files: Raw export to a directory. You do what you want with it.
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { StitchClient } from "../connectors/stitch-client.js";
import { createLogger } from "../utils/logger.js";
import { TEMPLATES, interpolateTemplate } from "../prompts/templates.js";
import {
  ExportToDevToolInputSchema,
  type ExportToDevToolInput,
  type ExportResult,
} from "../validators/schemas.js";
import { extractDesignContext } from "./extract-design.js";

const logger = createLogger("stitch_export");

export async function exportToDevTool(
  client: StitchClient,
  rawInput: unknown
): Promise<ExportResult> {
  const input = ExportToDevToolInputSchema.parse(rawInput);

  // Determine output directory based on target
  const outputDir = resolveOutputDir(input.target, input.outputDir);
  ensureDir(outputDir);

  const filesWritten: ExportResult["filesWritten"] = [];

  // Fetch code and screenshots for all requested screens
  for (const screenId of input.screenIds) {
    // Fetch HTML code
    const htmlCode = await client.getScreenCode(input.projectId, screenId);
    const htmlPath = join(outputDir, getCodeDir(input.target), `screen-${screenId}.html`);
    ensureDir(join(outputDir, getCodeDir(input.target)));
    writeFileSync(htmlPath, htmlCode, "utf-8");
    filesWritten.push({
      path: htmlPath,
      size_bytes: Buffer.byteLength(htmlCode),
      type: "html",
    });

    // Fetch screenshot if requested
    if (input.includeScreenshots) {
      try {
        const imageBase64 = await client.getScreenImage(input.projectId, screenId);
        if (imageBase64) {
          const imgPath = join(outputDir, "screenshots", `screen-${screenId}.png`);
          ensureDir(join(outputDir, "screenshots"));
          writeFileSync(imgPath, Buffer.from(imageBase64, "base64"));
          filesWritten.push({
            path: imgPath,
            size_bytes: Buffer.from(imageBase64, "base64").length,
            type: "png",
          });
        }
      } catch {
        logger.warn("screenshot-fetch-failed", { screenId });
      }
    }
  }

  // Generate DESIGN.md if requested
  let designMdPath: string | undefined;
  if (input.includeDesignMd && input.screenIds.length > 0) {
    try {
      const designContext = await extractDesignContext(client, {
        projectId: input.projectId,
        screenId: input.screenIds[0],
      });

      const designMd = generateDesignMd(designContext, input.projectId, input.target);
      designMdPath = join(outputDir, "DESIGN.md");
      writeFileSync(designMdPath, designMd, "utf-8");
      filesWritten.push({
        path: designMdPath,
        size_bytes: Buffer.byteLength(designMd),
        type: "md",
      });
    } catch (err) {
      logger.warn("design-md-generation-failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Generate target-specific config files
  const configFiles = generateTargetConfig(input.target, outputDir, filesWritten);
  filesWritten.push(...configFiles);

  // Build the human-readable instructions
  const instructions = getInstructions(input.target, outputDir, designMdPath);

  return {
    target: input.target,
    filesWritten,
    designMdPath,
    instructions,
  };
}

// ═══════════════════════════════════════════════════════
// Target-specific logic
// ═══════════════════════════════════════════════════════

function resolveOutputDir(target: string, customDir?: string): string {
  if (customDir) return resolve(customDir);

  const base = process.env.HOME || "/tmp";
  switch (target) {
    case "claude_code":
      return join(base, "stitch-export", "claude-code-project");
    case "vscode":
      return join(base, "stitch-export", "vscode-project");
    case "antigravity":
      return join(base, "stitch-export", "antigravity-project");
    case "local_files":
      return join(base, "stitch-export", "raw");
    default:
      return join(base, "stitch-export", target);
  }
}

function getCodeDir(target: string): string {
  switch (target) {
    case "claude_code":
      return "src/components";
    case "vscode":
      return "src/components";
    case "antigravity":
      return "src";
    case "local_files":
      return "html";
    default:
      return "src";
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate DESIGN.md — the agent-friendly design system specification.
 * 
 * This is the critical file that bridges Stitch designs to coding agents.
 * Claude Code, Antigravity, and Cursor all read this format.
 */
function generateDesignMd(
  context: Record<string, unknown>,
  projectId: string,
  target: string
): string {
  const colors = (context.colors as Record<string, string>) || {};
  const fonts = (context.fonts as string[]) || [];
  const components = (context.components as string[]) || [];
  const layoutType = (context.layoutType as string) || "flex";

  let md = `# Design System\n\n`;
  md += `> Auto-generated from Stitch project \`${projectId}\`\n`;
  md += `> Target: ${target}\n\n`;

  // Colors
  md += `## Colors\n\n\`\`\`css\n:root {\n`;
  for (const [name, value] of Object.entries(colors)) {
    md += `  --color-${name}: ${value};\n`;
  }
  md += `}\n\`\`\`\n\n`;

  // Typography
  md += `## Typography\n\n`;
  if (fonts.length > 0) {
    md += `Primary font: \`${fonts[0]}\`\n`;
    if (fonts.length > 1) md += `Secondary font: \`${fonts[1]}\`\n`;
  }
  md += `\n`;

  // Components
  if (components.length > 0) {
    md += `## Components\n\n`;
    md += `Detected components: ${components.join(", ")}\n\n`;
  }

  // Layout
  md += `## Layout\n\n`;
  md += `Layout system: \`${layoutType}\`\n\n`;

  // Target-specific notes
  md += `## Integration Notes\n\n`;
  switch (target) {
    case "claude_code":
      md += `This file is read by Claude Code's MCP context. Place it in the project root.\n`;
      md += `Claude Code will automatically use these tokens when generating new components.\n`;
      break;
    case "antigravity":
      md += `Antigravity's agent auto-discovers this file from the project root.\n`;
      md += `The design agent will apply these tokens to all generated code.\n`;
      md += `Use the Agent Manager to run parallel design iterations.\n`;
      break;
    case "vscode":
      md += `Open this file alongside your components for AI-assisted development.\n`;
      md += `Extensions like Cline, Continue, or Copilot will use it as context.\n`;
      break;
    default:
      md += `Import these tokens into your project's CSS/theme configuration.\n`;
  }

  return md;
}

/**
 * Generate target-specific configuration files.
 * Each tool has different conventions for project setup.
 */
function generateTargetConfig(
  target: string,
  outputDir: string,
  existingFiles: ExportResult["filesWritten"]
): ExportResult["filesWritten"] {
  const configs: ExportResult["filesWritten"] = [];

  switch (target) {
    case "claude_code": {
      // .claude/settings.json — tell Claude Code about the design system
      const claudeConfig = {
        designSystem: "./DESIGN.md",
        componentDir: "./src/components",
        preferredFramework: "react",
        preferredStyling: "tailwind",
      };
      const configPath = join(outputDir, ".claude", "settings.json");
      ensureDir(join(outputDir, ".claude"));
      writeFileSync(configPath, JSON.stringify(claudeConfig, null, 2));
      configs.push({ path: configPath, size_bytes: Buffer.byteLength(JSON.stringify(claudeConfig)), type: "json" });
      break;
    }

    case "antigravity": {
      // .antigravity/rules.md — agent instructions for Antigravity
      const rules = `# Agent Rules

## Design System
Always read DESIGN.md before generating any UI code.
Apply the color tokens and typography defined there.

## Code Standards
- Use React + TypeScript + Tailwind CSS
- Components go in src/components/
- Follow the design tokens in DESIGN.md for all styling
- Test every component in the browser agent before marking complete

## Workflow
1. Read DESIGN.md
2. Generate component code
3. Launch in browser
4. Verify against screenshots/
5. Iterate if needed
`;
      const rulesPath = join(outputDir, ".antigravity", "rules.md");
      ensureDir(join(outputDir, ".antigravity"));
      writeFileSync(rulesPath, rules);
      configs.push({ path: rulesPath, size_bytes: Buffer.byteLength(rules), type: "md" });
      break;
    }

    case "vscode": {
      // .vscode/settings.json — workspace settings for VS Code
      const vscodeSettings = {
        "editor.defaultFormatter": "esbenp.prettier-vscode",
        "tailwindCSS.experimental.classRegex": [
          ["clsx\\(([^)]*)\\)", "(?:'|\"|`)([^']*)(?:'|\"|`)"],
        ],
        "files.associations": {
          "DESIGN.md": "markdown",
        },
      };
      const settingsPath = join(outputDir, ".vscode", "settings.json");
      ensureDir(join(outputDir, ".vscode"));
      writeFileSync(settingsPath, JSON.stringify(vscodeSettings, null, 2));
      configs.push({ path: settingsPath, size_bytes: Buffer.byteLength(JSON.stringify(vscodeSettings)), type: "json" });
      break;
    }
  }

  return configs;
}

/**
 * Generate human-readable next-step instructions specific to each target.
 */
function getInstructions(target: string, outputDir: string, designMdPath?: string): string {
  switch (target) {
    case "claude_code":
      return [
        `✅ Files exported to: ${outputDir}`,
        ``,
        `Next steps for Claude Code:`,
        `  1. cd ${outputDir}`,
        `  2. claude   (or: claude "Build a React app from these Stitch designs")`,
        `  3. Claude Code will auto-read DESIGN.md and use it for all generation`,
        ``,
        `The .claude/settings.json tells Claude Code where to find components and design tokens.`,
        `You can also add the Stitch MCP server to Claude Code for live design regeneration:`,
        `  claude mcp add stitch -- npx @_davideast/stitch-mcp proxy`,
      ].join("\n");

    case "vscode":
      return [
        `✅ Files exported to: ${outputDir}`,
        ``,
        `Next steps for VS Code:`,
        `  1. code ${outputDir}   (opens the project in VS Code)`,
        `  2. Install recommended extensions: Tailwind CSS IntelliSense, Prettier`,
        `  3. If using Cline/Continue: DESIGN.md is auto-indexed as context`,
        ``,
        `To add live Stitch integration as MCP in VS Code:`,
        `  Add to .vscode/mcp.json:`,
        `  { "stitch": { "command": "npx", "args": ["-y", "stitch-mcp-server@latest"],`,
        `    "env": { "STITCH_API_KEY": "your-key" } } }`,
      ].join("\n");

    case "antigravity":
      return [
        `✅ Files exported to: ${outputDir}`,
        ``,
        `Next steps for Antigravity:`,
        `  1. Open Antigravity: agy ${outputDir}`,
        `  2. The agent will auto-discover DESIGN.md and .antigravity/rules.md`,
        `  3. Start a mission: "Build a React app from the Stitch designs in src/"`,
        `  4. The agent reads screenshots/, builds code, tests in browser — autonomous loop.`,
        ``,
        `Stitch → Antigravity is a native integration. You can also:`,
        `  - Export directly from stitch.withgoogle.com → Antigravity button`,
        `  - Use the Stitch MCP in Antigravity's MCP catalog`,
      ].join("\n");

    case "local_files":
      return [
        `✅ Files exported to: ${outputDir}`,
        ``,
        `Raw files ready. DESIGN.md included for reference.`,
        `Open any HTML file in a browser to preview.`,
      ].join("\n");

    default:
      return `Files exported to: ${outputDir}`;
  }
}
