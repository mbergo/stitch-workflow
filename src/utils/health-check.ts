/**
 * Health Check — pre-flight verification before any workflow runs.
 * 
 * The principle: never fire a workflow into a dead service.
 * Check everything first, fail fast with a clear diagnostic.
 */

import { withRetry } from "./retry.js";

interface ServiceCheck {
  name: string;
  url: string;
  timeout?: number;
}

interface HealthResult {
  name: string;
  healthy: boolean;
  latency_ms: number;
  error?: string;
}

/**
 * Ping each service endpoint. Return a structured health report.
 * Uses a single retry — if the first ping fails, try once more before declaring it down.
 */
export async function checkServiceHealth(
  services: ServiceCheck[]
): Promise<HealthResult[]> {
  const results = await Promise.all(
    services.map(async (svc): Promise<HealthResult> => {
      const start = performance.now();
      try {
        await withRetry(
          async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(
              () => controller.abort(),
              svc.timeout ?? 10_000
            );
            try {
              const res = await fetch(svc.url, {
                method: "HEAD",
                signal: controller.signal,
              });
              if (!res.ok && res.status !== 405) {
                // 405 = Method Not Allowed is fine — the service is alive, just doesn't support HEAD
                throw new Error(`HTTP ${res.status}`);
              }
            } finally {
              clearTimeout(timeoutId);
            }
          },
          { maxRetries: 1, initialDelay: 500 }
        );
        return {
          name: svc.name,
          healthy: true,
          latency_ms: Math.round(performance.now() - start),
        };
      } catch (err) {
        return {
          name: svc.name,
          healthy: false,
          latency_ms: Math.round(performance.now() - start),
          error: err instanceof Error ? err.message : String(err),
        };
      }
    })
  );

  return results;
}

/**
 * Check if all critical services are healthy. Throws with diagnostic if any fail.
 */
export async function assertServicesHealthy(services: ServiceCheck[]): Promise<void> {
  const results = await checkServiceHealth(services);
  const failed = results.filter((r) => !r.healthy);

  if (failed.length > 0) {
    const diagnostics = failed
      .map((f) => `  - ${f.name}: ${f.error} (${f.latency_ms}ms)`)
      .join("\n");
    throw new Error(
      `Pre-flight check failed. ${failed.length} service(s) unreachable:\n${diagnostics}`
    );
  }
}
