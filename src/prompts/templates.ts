/**
 * Prompt Templates — the AI brain of the pipeline.
 * 
 * Every AI call uses a structured, versioned template.
 * These are NOT freestyle prompts. They're contracts.
 * 
 * Each template specifies:
 * - System context (what role the AI plays)
 * - Input format (what it receives)
 * - Output format (JSON schema it must return)
 * - Guardrails (what it must NOT do)
 */

export const TEMPLATES = {
  /**
   * Analyzes a Stitch-generated screen and produces a structured design context.
   * This feeds into the DESIGN.md generator and code export pipeline.
   */
  DESIGN_ANALYSIS: {
    id: "design-analysis-v1",
    system: `You are a design system analysis engine in an automated pipeline.
Your job is to analyze HTML/CSS code from a UI design and extract structured design tokens.
You receive raw HTML content. You return a JSON object with design tokens. Nothing else.

CRITICAL RULES:
- Extract actual values from the code — never invent colors, fonts, or spacings
- If a value cannot be determined, omit it rather than guessing
- Always return valid JSON — the pipeline breaks on invalid output
- Never include explanatory text outside the JSON structure
- Focus on reusable tokens, not one-off values`,

    user: `Analyze this UI code and extract the design system tokens.

HTML/CSS CODE:
{{htmlContent}}

Return a JSON object with this exact structure:
{
  "fonts": ["font-family-1", "font-family-2"],
  "colors": {
    "primary": "#hex",
    "secondary": "#hex",
    "background": "#hex",
    "surface": "#hex",
    "text": "#hex",
    "textSecondary": "#hex",
    "accent": "#hex",
    "border": "#hex"
  },
  "spacing": {
    "xs": "value",
    "sm": "value",
    "md": "value",
    "lg": "value",
    "xl": "value"
  },
  "components": ["component-type-1", "component-type-2"],
  "layoutType": "grid|flex|sidebar|full-width|split",
  "borderRadius": "value",
  "shadows": ["shadow-value-1"]
}

Only include keys where you found actual values in the code.`,
  },

  /**
   * Generates a DESIGN.md file — the agent-friendly design system specification.
   * Stitch introduced this format as a bridge between design and coding tools.
   */
  DESIGN_MD_GENERATOR: {
    id: "design-md-v1",
    system: `You are a DESIGN.md generator for the Stitch design system format.
Your job is to produce a well-structured markdown file that captures a project's
design system in a format that AI coding agents can parse and apply.

The DESIGN.md format is an agent-friendly specification used by Stitch, Antigravity,
Claude Code, and other tools to maintain design consistency across generated code.

CRITICAL RULES:
- Output ONLY the markdown content, no wrapping or explanation
- Use the exact section headers shown in the template
- Include concrete values, not placeholders
- The file must be self-contained — an agent reading only this file should be able
  to reproduce the visual style`,

    user: `Generate a DESIGN.md file based on these design tokens:

DESIGN TOKENS:
{{designTokens}}

PROJECT NAME: {{projectName}}
PLATFORM: {{platform}}

Use this structure:

# Design System — {{projectName}}

## Colors
(List all color tokens as CSS custom properties)

## Typography
(Font families, sizes, weights, line-heights)

## Spacing
(Spacing scale)

## Components
(List detected components with their styling rules)

## Layout
(Grid/flex system, breakpoints, container widths)

## Notes
(Any additional design decisions or constraints)`,
  },

  /**
   * Converts HTML/CSS to React/Tailwind components.
   * This is the bridge from Stitch's output to Claude Code / VS Code workflow.
   */
  HTML_TO_REACT: {
    id: "html-to-react-v1",
    system: `You are a code transformation engine that converts HTML/CSS to React + Tailwind CSS.
You receive raw HTML with inline or embedded CSS. You return clean React functional components
using Tailwind utility classes.

CRITICAL RULES:
- Convert ALL inline styles and CSS classes to Tailwind utilities
- Use functional components with TypeScript
- Extract repeated patterns into reusable sub-components
- Use semantic HTML elements (nav, main, section, article)
- Add TypeScript interfaces for any props
- Never import external CSS — everything is Tailwind
- Return ONLY the code, no explanations`,

    user: `Convert this HTML/CSS to a React + Tailwind component:

HTML/CSS:
{{htmlContent}}

COMPONENT NAME: {{componentName}}

Return a single TypeScript React file (.tsx) with:
- Default export of the main component
- Any sub-components defined in the same file
- All styles as Tailwind utility classes
- Proper TypeScript types`,
  },

  /**
   * Generates structured instructions for exporting to specific dev tools.
   * Each target has different conventions — this prompt adapts.
   */
  EXPORT_INSTRUCTIONS: {
    id: "export-instructions-v1",
    system: `You are a developer workflow assistant. You generate precise, actionable
instructions for integrating generated UI code into a specific development tool.

CRITICAL RULES:
- Instructions must be copy-paste executable
- Include exact file paths and commands
- Never assume the developer knows the tool's setup — be explicit
- Return instructions as a structured JSON object`,

    user: `Generate integration instructions for this target:

TARGET TOOL: {{target}}
FILES GENERATED: {{filesList}}
PROJECT TYPE: {{platform}}
DESIGN SYSTEM FILE: {{designMdPath}}

Return a JSON object:
{
  "tool": "tool_name",
  "setup_commands": ["command1", "command2"],
  "file_placement": [
    { "source": "generated_file", "destination": "target_path" }
  ],
  "post_setup": ["any final steps"],
  "tips": ["tool-specific optimization tips"]
}

TOOL-SPECIFIC CONTEXT:
- claude_code: Uses MCP, reads DESIGN.md from project root, run with 'claude' CLI
- vscode: Standard file structure, use VS Code tasks/settings, Cline/Continue extension for AI
- antigravity: Agent-first IDE, uses missions, place DESIGN.md in root, agent auto-reads it
- local_files: Simple file export to a directory`,
  },
} as const;

/**
 * Template interpolation — replaces {{placeholders}} with actual values.
 * Simple and deterministic. No magic.
 */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string>
): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template
  );
}
