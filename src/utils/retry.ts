/**
 * Retry with exponential backoff + jitter.
 * Every external API call goes through this. No exceptions.
 * 
 * The jitter prevents thundering herd — if 50 requests fail at once,
 * they don't all retry at the exact same millisecond.
 */

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  retryableErrors?: string[];
}

const DEFAULTS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30_000,
  retryableErrors: [
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "429",        // Rate limited
    "503",        // Service unavailable
    "502",        // Bad gateway
    "ECONNREFUSED",
  ],
};

function isRetryable(error: unknown, retryableErrors: string[]): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return retryableErrors.some((code) => msg.includes(code));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config = { ...DEFAULTS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // If it's the last attempt or the error isn't retryable, give up
      if (attempt === config.maxRetries || !isRetryable(err, config.retryableErrors)) {
        throw err;
      }

      // Exponential backoff: delay = initialDelay * 2^attempt
      // Jitter: random 0-500ms to prevent thundering herd
      const baseDelay = config.initialDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 500;
      const delay = Math.min(baseDelay + jitter, config.maxDelay);

      console.error(
        `[RETRY] Attempt ${attempt + 1}/${config.maxRetries} failed, retrying in ${Math.round(delay)}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
