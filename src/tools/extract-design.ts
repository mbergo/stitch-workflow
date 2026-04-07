/**
 * stitch_extract_design — Extract design tokens and context from Stitch screens.
 * 
 * This tool does two things:
 * 1. Calls Stitch's native extract_design_context endpoint
 * 2. If that returns sparse data, falls back to AI-based HTML analysis
 * 
 * The output feeds into DESIGN.md generation and code export.
 */

import { StitchClient } from "../connectors/stitch-client.js";
import { createLogger } from "../utils/logger.js";
import { TEMPLATES, interpolateTemplate } from "../prompts/templates.js";
import {
  ExtractDesignContextInputSchema,
  type ExtractDesignContextInput,
  type DesignContextOutput,
} from "../validators/schemas.js";

const logger = createLogger("stitch_extract_design");

export async function extractDesignContext(
  client: StitchClient,
  rawInput: unknown
): Promise<DesignContextOutput> {
  const input = ExtractDesignContextInputSchema.parse(rawInput);

  // Try the native Stitch design context extraction first
  let context: Record<string, unknown> | null = null;
  try {
    context = await client.extractDesignContext(input.projectId, input.screenId);
    logger.info("native-extraction-success", { screenId: input.screenId });
  } catch (err) {
    logger.warn("native-extraction-failed", {
      screenId: input.screenId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // If native extraction returned usable data, normalize and return
  if (context && hasMinimumDesignData(context)) {
    return normalizeDesignContext(context);
  }

  // Fallback: fetch the HTML and analyze it
  logger.info("falling-back-to-html-analysis", { screenId: input.screenId });
  const htmlContent = await client.getScreenCode(input.projectId, input.screenId);

  // Parse the HTML ourselves for design tokens
  // This is deterministic — no AI needed for basic CSS extraction
  return extractFromHtml(htmlContent);
}

/**
 * Check if the Stitch API returned enough design data to be useful.
 * If it only returned an ID and nothing else, we need to do our own analysis.
 */
function hasMinimumDesignData(context: Record<string, unknown>): boolean {
  const hasColors = context.colors && Object.keys(context.colors as object).length > 0;
  const hasFonts = Array.isArray(context.fonts) && (context.fonts as unknown[]).length > 0;
  return !!(hasColors || hasFonts);
}

/**
 * Normalize whatever shape Stitch returns into our standardized schema.
 */
function normalizeDesignContext(raw: Record<string, unknown>): DesignContextOutput {
  return {
    fonts: Array.isArray(raw.fonts)
      ? (raw.fonts as string[])
      : typeof raw.fontFamily === "string"
        ? [raw.fontFamily]
        : [],
    colors: (raw.colors as Record<string, string>) ?? {},
    spacing: (raw.spacing as Record<string, string>) ?? undefined,
    components: Array.isArray(raw.components)
      ? (raw.components as string[])
      : undefined,
    layoutType: typeof raw.layoutType === "string"
      ? raw.layoutType
      : typeof raw.layout === "string"
        ? raw.layout
        : undefined,
  };
}

/**
 * Extract design tokens directly from HTML/CSS.
 * This is the deterministic fallback — no API calls, no AI.
 * Pure regex and parsing. Fast and reliable.
 */
function extractFromHtml(html: string): DesignContextOutput {
  const fonts = new Set<string>();
  const colors: Record<string, string> = {};
  const components = new Set<string>();

  // Extract font-family declarations
  const fontMatches = html.matchAll(/font-family\s*:\s*([^;}"]+)/gi);
  for (const match of fontMatches) {
    const fontList = match[1].split(",").map((f) => f.trim().replace(/["']/g, ""));
    for (const font of fontList) {
      if (font && !font.startsWith("var(") && font !== "inherit" && font !== "sans-serif" && font !== "serif") {
        fonts.add(font);
      }
    }
  }

  // Extract hex colors
  const hexMatches = html.matchAll(/#([0-9a-fA-F]{3,8})\b/g);
  const hexCounts: Record<string, number> = {};
  for (const match of hexMatches) {
    const hex = `#${match[1].toUpperCase()}`;
    hexCounts[hex] = (hexCounts[hex] || 0) + 1;
  }

  // Assign semantic names to the most-used colors
  const sortedColors = Object.entries(hexCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const colorNames = ["primary", "secondary", "background", "surface", "text", "textSecondary", "accent", "border"];
  sortedColors.forEach(([hex], i) => {
    if (i < colorNames.length) {
      colors[colorNames[i]] = hex;
    }
  });

  // Detect component types by HTML element patterns
  const componentPatterns: Array<[RegExp, string]> = [
    [/<nav[\s>]/i, "navbar"],
    [/<header[\s>]/i, "header"],
    [/<footer[\s>]/i, "footer"],
    [/<button[\s>]/i, "button"],
    [/<form[\s>]/i, "form"],
    [/<input[\s>]/i, "input"],
    [/<table[\s>]/i, "table"],
    [/class="[^"]*card[^"]*"/i, "card"],
    [/class="[^"]*modal[^"]*"/i, "modal"],
    [/class="[^"]*sidebar[^"]*"/i, "sidebar"],
    [/class="[^"]*hero[^"]*"/i, "hero"],
    [/class="[^"]*grid[^"]*"/i, "grid"],
  ];

  for (const [pattern, name] of componentPatterns) {
    if (pattern.test(html)) {
      components.add(name);
    }
  }

  // Detect layout type
  let layoutType = "flex";
  if (html.includes("display: grid") || html.includes("display:grid")) layoutType = "grid";
  if (components.has("sidebar")) layoutType = "sidebar";

  return {
    fonts: Array.from(fonts),
    colors,
    components: Array.from(components),
    layoutType,
  };
}
