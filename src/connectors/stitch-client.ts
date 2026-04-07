/**
 * Stitch Client Connector — the bridge to Google's Stitch API.
 * 
 * Wraps the @google/stitch-sdk with:
 * - Retry + exponential backoff on all calls
 * - Structured logging
 * - Auth resolution (API key → OAuth → gcloud ADC)
 * - Timeout handling (screen generation can take 2-10 minutes)
 * 
 * This connector is the ONLY place that talks to Stitch.
 * Every other module in the system goes through this.
 */

import { createLogger, type Logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";
import type { AuthConfig } from "../validators/schemas.js";

// ═══════════════════════════════════════════════════════
// Types for the Stitch SDK interactions
// ═══════════════════════════════════════════════════════

interface StitchProject {
  id: string;
  name: string;
  createdAt?: string;
  screenCount?: number;
}

interface StitchScreen {
  id: string;
  name?: string;
  projectId: string;
  htmlContent?: string;
  imageBase64?: string;
}

interface GenerateOptions {
  prompt: string;
  projectId?: string;
  platform?: "web" | "mobile";
  style?: string;
  model?: "gemini-3-flash" | "gemini-3.1-pro";
}

// ═══════════════════════════════════════════════════════
// Client Class
// ═══════════════════════════════════════════════════════

export class StitchClient {
  private logger: Logger;
  private baseUrl = "https://stitch.googleapis.com/mcp";
  private apiKey?: string;
  private accessToken?: string;
  private projectId?: string;

  constructor(auth: AuthConfig) {
    this.logger = createLogger("stitch-client");
    this.resolveAuth(auth);
  }

  /**
   * Resolve authentication. Priority: API Key > OAuth > gcloud ADC.
   * For gcloud ADC, we shell out to `gcloud auth print-access-token`
   * which is how every Stitch MCP server in the ecosystem does it.
   */
  private resolveAuth(auth: AuthConfig): void {
    if (auth.method === "api_key" && auth.apiKey) {
      this.apiKey = auth.apiKey;
      this.logger.info("auth-resolved", { method: "api_key" });
    } else if (auth.method === "oauth" && auth.accessToken) {
      this.accessToken = auth.accessToken;
      this.projectId = auth.projectId;
      this.logger.info("auth-resolved", { method: "oauth" });
    } else if (auth.method === "gcloud_adc") {
      // ADC resolution happens lazily on first request
      this.projectId = auth.projectId ?? process.env.GOOGLE_CLOUD_PROJECT;
      this.logger.info("auth-resolved", { method: "gcloud_adc" });
    }
  }

  /**
   * Get auth headers. For ADC, resolves the token from gcloud CLI.
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (this.apiKey) {
      return { "x-goog-api-key": this.apiKey };
    }

    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }

    // gcloud ADC fallback — shell out to get a fresh token
    const { execSync } = await import("child_process");
    try {
      const token = execSync("gcloud auth print-access-token", {
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();
      this.accessToken = token;
      return { Authorization: `Bearer ${token}` };
    } catch (err) {
      throw new Error(
        "Failed to get gcloud access token. Run: gcloud auth application-default login"
      );
    }
  }

  /**
   * Low-level JSON-RPC call to the Stitch MCP endpoint.
   * All higher-level methods delegate here.
   */
  private async rpcCall<T>(
    method: string,
    params: Record<string, unknown>
  ): Promise<T> {
    return this.logger.timed(`rpc:${method}`, params, async () => {
      return withRetry(async () => {
        const headers = await this.getAuthHeaders();
        const body = JSON.stringify({
          jsonrpc: "2.0",
          id: Date.now().toString(),
          method: "tools/call",
          params: { name: method, arguments: params },
        });

        const res = await fetch(this.baseUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...headers,
          },
          body,
          signal: AbortSignal.timeout(
            method === "generate_screen_from_text" ? 600_000 : 30_000
          ),
        });

        if (!res.ok) {
          const errorText = await res.text().catch(() => "unknown");
          throw new Error(`Stitch API ${res.status}: ${errorText}`);
        }

        const json = await res.json();
        if (json.error) {
          throw new Error(`Stitch RPC error: ${JSON.stringify(json.error)}`);
        }

        // Extract the actual result from the MCP tool response
        const content = json.result?.content;
        if (Array.isArray(content) && content.length > 0) {
          const textBlock = content.find((c: any) => c.type === "text");
          if (textBlock?.text) {
            try {
              return JSON.parse(textBlock.text) as T;
            } catch {
              return textBlock.text as T;
            }
          }
        }
        return json.result as T;
      });
    });
  }

  // ═══════════════════════════════════════════════════════
  // Public API — clean, typed, logged
  // ═══════════════════════════════════════════════════════

  async listProjects(): Promise<StitchProject[]> {
    return this.rpcCall<StitchProject[]>("list_projects", {});
  }

  async getProject(projectId: string): Promise<StitchProject> {
    return this.rpcCall<StitchProject>("get_project", { projectId });
  }

  async createProject(name: string): Promise<StitchProject> {
    return this.rpcCall<StitchProject>("create_project", { name });
  }

  async listScreens(projectId: string): Promise<StitchScreen[]> {
    return this.rpcCall<StitchScreen[]>("list_screens", { projectId });
  }

  /**
   * Generate a new UI screen from text prompt.
   * This is the core Stitch capability. Takes 2-10 minutes.
   * Timeout is set to 10 minutes accordingly.
   */
  async generateScreen(options: GenerateOptions): Promise<StitchScreen> {
    this.logger.info("generate-screen-start", { prompt: options.prompt.slice(0, 100) });

    const params: Record<string, unknown> = {
      prompt: options.prompt,
    };
    if (options.projectId) params.projectId = options.projectId;

    const result = await this.rpcCall<any>("generate_screen_from_text", params);

    this.logger.info("generate-screen-complete", { screenId: result?.id || result?.screenId });
    return {
      id: result.id || result.screenId,
      name: result.name,
      projectId: options.projectId || result.projectId,
    };
  }

  /**
   * Fetch the HTML/CSS code for a generated screen.
   */
  async getScreenCode(projectId: string, screenId: string): Promise<string> {
    const result = await this.rpcCall<any>("fetch_screen_code", {
      projectId,
      screenId,
    });
    return typeof result === "string" ? result : result.html || result.code || JSON.stringify(result);
  }

  /**
   * Fetch the screenshot image for a screen as base64.
   */
  async getScreenImage(projectId: string, screenId: string): Promise<string> {
    const result = await this.rpcCall<any>("fetch_screen_image", {
      projectId,
      screenId,
    });
    return typeof result === "string" ? result : result.image || result.base64 || "";
  }

  /**
   * Extract design context (fonts, colors, layout DNA) from a screen.
   */
  async extractDesignContext(projectId: string, screenId: string): Promise<Record<string, unknown>> {
    return this.rpcCall<Record<string, unknown>>("extract_design_context", {
      projectId,
      screenId,
    });
  }

  /**
   * Build a multi-page site from a Stitch project.
   * Maps screens to URL routes and returns bundled HTML.
   */
  async buildSite(
    projectId: string,
    routes: Array<{ screenId: string; route: string }>
  ): Promise<Record<string, string>> {
    return this.rpcCall<Record<string, string>>("build_site", {
      projectId,
      routes,
    });
  }

  /**
   * Check if the Stitch API is reachable and authenticated.
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.listProjects();
      return true;
    } catch {
      return false;
    }
  }
}
