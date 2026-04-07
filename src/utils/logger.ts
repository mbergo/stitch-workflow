/**
 * Structured Logger — every tool call gets timestamped, tagged, and measured.
 * No silent failures. No guessing what happened.
 */

import { createHash } from "crypto";

// The shape of every log entry. Consistent. Parseable. Auditable.
interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  tool: string;
  action: string;
  duration_ms?: number;
  input_hash?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Hash inputs for traceability without logging sensitive data.
 * You want to correlate logs across stages without echoing API keys.
 */
function hashInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 12);
}

function formatEntry(entry: LogEntry): string {
  const parts = [
    `[${entry.timestamp}]`,
    `[${entry.level.toUpperCase()}]`,
    `[${entry.tool}]`,
    entry.action,
    entry.success ? "✓" : "✗",
  ];
  if (entry.duration_ms !== undefined) parts.push(`(${entry.duration_ms}ms)`);
  if (entry.input_hash) parts.push(`hash:${entry.input_hash}`);
  if (entry.error) parts.push(`error: ${entry.error}`);
  return parts.join(" ");
}

export function createLogger(toolName: string) {
  const log = (level: LogEntry["level"], action: string, success: boolean, extra?: Partial<LogEntry>) => {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      tool: toolName,
      action,
      success,
      ...extra,
    };
    const line = formatEntry(entry);

    // Route to stderr so MCP stdout stays clean for protocol messages
    if (level === "error") {
      console.error(line);
    } else {
      console.error(line);
    }
    return entry;
  };

  return {
    info: (action: string, meta?: Record<string, unknown>) =>
      log("info", action, true, { metadata: meta }),

    warn: (action: string, meta?: Record<string, unknown>) =>
      log("warn", action, true, { metadata: meta }),

    error: (action: string, err: Error | string, meta?: Record<string, unknown>) =>
      log("error", action, false, {
        error: err instanceof Error ? err.message : err,
        metadata: meta,
      }),

    /**
     * The workhorse: wraps an async function, logs timing + result automatically.
     * Use this around every external call.
     */
    timed: async <T>(action: string, input: unknown, fn: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      const inputHash = hashInput(input);
      try {
        const result = await fn();
        const duration = Math.round(performance.now() - start);
        log("info", action, true, { duration_ms: duration, input_hash: inputHash });
        return result;
      } catch (err) {
        const duration = Math.round(performance.now() - start);
        log("error", action, false, {
          duration_ms: duration,
          input_hash: inputHash,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
