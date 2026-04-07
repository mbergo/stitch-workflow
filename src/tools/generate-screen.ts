/**
 * stitch_generate_screen — Generate UI screens from text prompts via Stitch.
 * 
 * This is Act I of the pipeline. The user describes what they want,
 * Stitch renders it, and we hand back the screen metadata.
 * 
 * The screen generation itself takes 2-10 minutes on the Stitch backend
 * (they're running Gemini 3 Pro / Flash under the hood). Our timeout
 * accounts for this.
 */

import { StitchClient } from "../connectors/stitch-client.js";
import { createLogger } from "../utils/logger.js";
import {
  GenerateScreenInputSchema,
  type GenerateScreenInput,
  type GenerateScreenOutput,
} from "../validators/schemas.js";

const logger = createLogger("stitch_generate_screen");

export async function generateScreen(
  client: StitchClient,
  rawInput: unknown
): Promise<GenerateScreenOutput> {
  // Validate input — no unvalidated data enters the pipeline
  const input = GenerateScreenInputSchema.parse(rawInput);

  const start = performance.now();

  // If no project ID provided, create a new project
  let projectId = input.projectId;
  if (!projectId) {
    logger.info("creating-new-project");
    const project = await client.createProject(
      `stitch-workflow-${Date.now()}`
    );
    projectId = project.id;
  }

  // Compose the full prompt with style and platform context
  let fullPrompt = input.prompt;
  if (input.platform === "mobile") {
    fullPrompt = `Design a mobile app screen: ${fullPrompt}`;
  }
  if (input.style) {
    fullPrompt += `. Style: ${input.style}`;
  }
  if (input.designSystemUrl) {
    fullPrompt += `. Use design system from: ${input.designSystemUrl}`;
  }

  // Fire the generation — this is the long-running call
  const screen = await client.generateScreen({
    prompt: fullPrompt,
    projectId,
    platform: input.platform,
    style: input.style,
  });

  // Fetch a quick preview of the HTML for the response
  let htmlSnippet: string | undefined;
  try {
    const code = await client.getScreenCode(projectId, screen.id);
    htmlSnippet = code.slice(0, 500);
  } catch {
    logger.warn("snippet-fetch-failed", { screenId: screen.id });
  }

  const duration = Math.round(performance.now() - start);

  return {
    projectId,
    screenId: screen.id,
    previewUrl: `https://stitch.withgoogle.com/project/${projectId}/screen/${screen.id}`,
    htmlSnippet,
    generationTime_ms: duration,
  };
}
