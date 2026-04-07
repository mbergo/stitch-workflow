/**
 * Validation Schemas — every piece of data that crosses a boundary gets validated.
 * 
 * No unvalidated data enters or leaves the pipeline.
 * This is the single source of truth for all data shapes.
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════
// Authentication & Configuration
// ═══════════════════════════════════════════════════════

export const AuthConfigSchema = z.object({
  method: z.enum(["api_key", "oauth", "gcloud_adc"]).describe(
    "Authentication method. api_key is simplest; gcloud_adc uses Application Default Credentials"
  ),
  apiKey: z.string().optional().describe("Stitch API key from stitch.withgoogle.com settings"),
  accessToken: z.string().optional().describe("OAuth2 access token"),
  projectId: z.string().optional().describe("Google Cloud project ID"),
}).refine(
  (data) => {
    if (data.method === "api_key") return !!data.apiKey;
    if (data.method === "oauth") return !!data.accessToken;
    if (data.method === "gcloud_adc") return true; // ADC handles it
    return false;
  },
  { message: "Credentials must match the selected auth method" }
);

// ═══════════════════════════════════════════════════════
// Stitch Project & Screen Models
// ═══════════════════════════════════════════════════════

export const StitchProjectSchema = z.object({
  id: z.string().describe("Stitch project ID"),
  name: z.string().describe("Human-readable project name"),
  createdAt: z.string().datetime().optional(),
  screenCount: z.number().int().nonnegative().optional(),
});

export const StitchScreenSchema = z.object({
  id: z.string().describe("Screen ID within the project"),
  name: z.string().optional(),
  projectId: z.string(),
  htmlContent: z.string().optional().describe("Generated HTML/CSS code"),
  imageBase64: z.string().optional().describe("Screenshot as base64 PNG"),
  metadata: z.record(z.unknown()).optional(),
});

// ═══════════════════════════════════════════════════════
// Tool Input Schemas
// ═══════════════════════════════════════════════════════

/** Generate a new UI screen from a text prompt */
export const GenerateScreenInputSchema = z.object({
  projectId: z.string().optional().describe("Existing project ID, or omit to create new"),
  prompt: z.string().min(10).describe("Natural language description of the UI to generate"),
  platform: z.enum(["web", "mobile"]).default("web"),
  style: z.string().optional().describe("Visual style hints: 'dark theme', 'minimal', 'glassmorphism', etc."),
  designSystemUrl: z.string().url().optional().describe("URL to extract design system from"),
});

/** Extract design context (fonts, colors, layout DNA) from a screen */
export const ExtractDesignContextInputSchema = z.object({
  projectId: z.string(),
  screenId: z.string(),
});

/** Fetch the generated frontend code for a screen */
export const FetchScreenCodeInputSchema = z.object({
  projectId: z.string(),
  screenId: z.string(),
  format: z.enum(["html", "react", "tailwind"]).default("html"),
});

/** Build a multi-page site from a Stitch project */
export const BuildSiteInputSchema = z.object({
  projectId: z.string(),
  routes: z.array(z.object({
    screenId: z.string(),
    route: z.string().describe("URL path, e.g. '/' or '/about'"),
  })).min(1),
  outputFormat: z.enum(["html_bundle", "react_app", "nextjs"]).default("html_bundle"),
});

/** Export designs to development tools */
export const ExportToDevToolInputSchema = z.object({
  projectId: z.string(),
  screenIds: z.array(z.string()).min(1),
  target: z.enum([
    "claude_code",
    "vscode",
    "antigravity",
    "figma",
    "local_files",
  ]),
  outputDir: z.string().optional().describe("Local directory to write files (for local_files target)"),
  includeDesignMd: z.boolean().default(true).describe("Include DESIGN.md design system file"),
  includeScreenshots: z.boolean().default(true),
});

/** Full pipeline: prompt → generate → extract code → export */
export const FullPipelineInputSchema = z.object({
  prompt: z.string().min(10).describe("What to build"),
  platform: z.enum(["web", "mobile"]).default("web"),
  style: z.string().optional(),
  targets: z.array(z.enum([
    "claude_code",
    "vscode",
    "antigravity",
    "local_files",
  ])).min(1).describe("Where to deliver the generated code"),
  outputDir: z.string().optional(),
  variants: z.number().int().min(1).max(6).default(1).describe("How many design variants to generate"),
});

/** Health check input */
export const HealthCheckInputSchema = z.object({
  verbose: z.boolean().default(false),
});

// ═══════════════════════════════════════════════════════
// Tool Output Schemas
// ═══════════════════════════════════════════════════════

export const GenerateScreenOutputSchema = z.object({
  projectId: z.string(),
  screenId: z.string(),
  previewUrl: z.string().url().optional(),
  htmlSnippet: z.string().optional().describe("First 500 chars of generated HTML for quick preview"),
  generationTime_ms: z.number(),
});

export const DesignContextOutputSchema = z.object({
  fonts: z.array(z.string()),
  colors: z.record(z.string()).describe("Named color tokens, e.g. { primary: '#4F46E5', bg: '#0F172A' }"),
  spacing: z.record(z.string()).optional(),
  components: z.array(z.string()).optional().describe("Detected component types: 'navbar', 'card', 'modal', etc."),
  layoutType: z.string().optional().describe("Grid, flex, sidebar, etc."),
});

export const ExportResultSchema = z.object({
  target: z.string(),
  filesWritten: z.array(z.object({
    path: z.string(),
    size_bytes: z.number(),
    type: z.enum(["html", "css", "jsx", "tsx", "md", "png", "json"]),
  })),
  designMdPath: z.string().optional(),
  instructions: z.string().describe("Human-readable next steps for the target tool"),
});

export const PipelineResultSchema = z.object({
  projectId: z.string(),
  screens: z.array(z.object({
    screenId: z.string(),
    variant: z.number(),
    previewUrl: z.string().optional(),
  })),
  exports: z.array(ExportResultSchema),
  totalDuration_ms: z.number(),
  summary: z.string(),
});

// Type exports for use across the codebase
export type AuthConfig = z.infer<typeof AuthConfigSchema>;
export type StitchProject = z.infer<typeof StitchProjectSchema>;
export type StitchScreen = z.infer<typeof StitchScreenSchema>;
export type GenerateScreenInput = z.infer<typeof GenerateScreenInputSchema>;
export type ExtractDesignContextInput = z.infer<typeof ExtractDesignContextInputSchema>;
export type FetchScreenCodeInput = z.infer<typeof FetchScreenCodeInputSchema>;
export type BuildSiteInput = z.infer<typeof BuildSiteInputSchema>;
export type ExportToDevToolInput = z.infer<typeof ExportToDevToolInputSchema>;
export type FullPipelineInput = z.infer<typeof FullPipelineInputSchema>;
export type GenerateScreenOutput = z.infer<typeof GenerateScreenOutputSchema>;
export type DesignContextOutput = z.infer<typeof DesignContextOutputSchema>;
export type ExportResult = z.infer<typeof ExportResultSchema>;
export type PipelineResult = z.infer<typeof PipelineResultSchema>;
