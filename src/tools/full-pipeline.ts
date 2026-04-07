/**
 * stitch_full_pipeline — The Full Monty.
 * 
 * One tool call: prompt → generate screen(s) → extract design → export to target(s).
 * This is the "I don't want to think about intermediate steps" tool.
 * 
 * It composes the individual tools (generate, extract, export) into a single
 * orchestrated flow with proper error handling at each stage.
 */

import { StitchClient } from "../connectors/stitch-client.js";
import { createLogger } from "../utils/logger.js";
import {
  FullPipelineInputSchema,
  type FullPipelineInput,
  type PipelineResult,
  type ExportResult,
} from "../validators/schemas.js";
import { generateScreen } from "./generate-screen.js";
import { exportToDevTool } from "./export-to-devtool.js";

const logger = createLogger("stitch_full_pipeline");

export async function runFullPipeline(
  client: StitchClient,
  rawInput: unknown
): Promise<PipelineResult> {
  const input = FullPipelineInputSchema.parse(rawInput);
  const pipelineStart = performance.now();

  logger.info("pipeline-start", {
    prompt: input.prompt.slice(0, 100),
    targets: input.targets,
    variants: input.variants,
  });

  // ─────────────────────────────────────────────
  // Stage 1: Generate screen(s)
  // ─────────────────────────────────────────────
  const screens: Array<{ screenId: string; variant: number; previewUrl?: string }> = [];
  let projectId: string | undefined;

  for (let variant = 1; variant <= input.variants; variant++) {
    const variantPrompt =
      input.variants > 1
        ? `${input.prompt} (Variant ${variant} of ${input.variants} — try a different layout/approach)`
        : input.prompt;

    try {
      const result = await generateScreen(client, {
        prompt: variantPrompt,
        projectId, // Reuse project after first generation
        platform: input.platform,
        style: input.style,
      });

      // Lock in the project ID from the first successful generation
      if (!projectId) projectId = result.projectId;

      screens.push({
        screenId: result.screenId,
        variant,
        previewUrl: result.previewUrl,
      });

      logger.info(`variant-${variant}-complete`, {
        screenId: result.screenId,
        duration_ms: result.generationTime_ms,
      });
    } catch (err) {
      logger.error(`variant-${variant}-failed`, err instanceof Error ? err : new Error(String(err)));
      // Continue with other variants — partial success is better than total failure
    }
  }

  if (screens.length === 0 || !projectId) {
    throw new Error("Pipeline failed: no screens were generated successfully");
  }

  // ─────────────────────────────────────────────
  // Stage 2: Export to each target
  // ─────────────────────────────────────────────
  const exports: ExportResult[] = [];
  const screenIds = screens.map((s) => s.screenId);

  for (const target of input.targets) {
    try {
      const result = await exportToDevTool(client, {
        projectId,
        screenIds,
        target,
        outputDir: input.outputDir,
        includeDesignMd: true,
        includeScreenshots: true,
      });
      exports.push(result);
      logger.info(`export-${target}-complete`, {
        filesWritten: result.filesWritten.length,
      });
    } catch (err) {
      logger.error(`export-${target}-failed`, err instanceof Error ? err : new Error(String(err)));
      // Continue with other targets
    }
  }

  // ─────────────────────────────────────────────
  // Stage 3: Compile results
  // ─────────────────────────────────────────────
  const totalDuration = Math.round(performance.now() - pipelineStart);

  const summary = buildSummary(input, screens, exports, totalDuration);

  logger.info("pipeline-complete", {
    screens: screens.length,
    exports: exports.length,
    totalDuration_ms: totalDuration,
  });

  return {
    projectId,
    screens,
    exports,
    totalDuration_ms: totalDuration,
    summary,
  };
}

/**
 * Build a human-readable summary of the pipeline run.
 * This is what the user sees in the MCP response.
 */
function buildSummary(
  input: FullPipelineInput,
  screens: PipelineResult["screens"],
  exports: ExportResult[],
  totalDuration_ms: number
): string {
  const parts: string[] = [];

  parts.push(`🎨 Stitch Pipeline Complete (${(totalDuration_ms / 1000).toFixed(1)}s)`);
  parts.push(``);
  parts.push(`Generated ${screens.length}/${input.variants} design variant(s)`);

  for (const screen of screens) {
    parts.push(`  Variant ${screen.variant}: ${screen.previewUrl || screen.screenId}`);
  }

  parts.push(``);
  parts.push(`Exported to ${exports.length}/${input.targets.length} target(s):`);

  for (const exp of exports) {
    parts.push(`  ${exp.target}: ${exp.filesWritten.length} files`);
    if (exp.instructions) {
      // Show just the first line of instructions
      parts.push(`    → ${exp.instructions.split("\n")[0]}`);
    }
  }

  return parts.join("\n");
}
