/**
 * Custom Error Types for NotebookLM MCP Server
 */

/**
 * Default message for an exhausted usage limit. Since the 2026-09 "Gemini
 * Notebook" rebrand, usage is metered (a rolling window that resets every few
 * hours plus a weekly limit) instead of a fixed 50 queries/day.
 */
export const RATE_LIMIT_MESSAGE =
  "NotebookLM usage limit reached (rolling window resets every few hours; " +
  "there is also a weekly limit — call `get_usage` for exact reset times)";

/**
 * Error thrown when NotebookLM rate limit is exceeded
 *
 * This error indicates the user should:
 * - Check `get_usage` for the reset time and wait
 * - Use re_auth tool to switch Google accounts
 * - Upgrade to Google AI Pro/Ultra for higher limits
 */
export class RateLimitError extends Error {
  constructor(message: string = RATE_LIMIT_MESSAGE) {
    super(message);
    this.name = "RateLimitError";

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, RateLimitError);
    }
  }
}

/**
 * Error thrown when authentication fails
 *
 * This error can suggest cleanup workflow for persistent issues.
 * Especially useful when upgrading from old installation (notebooklm-mcp-nodejs).
 */
export class AuthenticationError extends Error {
  suggestCleanup: boolean;

  constructor(message: string, suggestCleanup: boolean = false) {
    super(message);
    this.name = "AuthenticationError";
    this.suggestCleanup = suggestCleanup;

    // Maintain proper stack trace for where error was thrown (V8 only)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AuthenticationError);
    }
  }
}
