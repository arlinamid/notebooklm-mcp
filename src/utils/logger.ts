/**
 * Console logging utilities with colors and formatting
 * Similar to Python's rich.console
 */

export type LogLevel = "info" | "success" | "warning" | "error" | "debug" | "dim";

interface LogStyle {
  prefix: string;
  color: string;
}

const STYLES: Record<LogLevel, LogStyle> = {
  info: { prefix: "ℹ️", color: "\x1b[36m" }, // Cyan
  success: { prefix: "✅", color: "\x1b[32m" }, // Green
  warning: { prefix: "⚠️", color: "\x1b[33m" }, // Yellow
  error: { prefix: "❌", color: "\x1b[31m" }, // Red
  debug: { prefix: "🔍", color: "\x1b[35m" }, // Magenta
  dim: { prefix: "  ", color: "\x1b[2m" }, // Dim
};

const RESET = "\x1b[0m";

/**
 * Logger class for consistent console output
 */
export class Logger {
  private enabled: boolean;
  /** Optional second destination (the MCP client via notifications/message). */
  private sink?: (level: LogLevel, message: string) => void;

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  /** Forward every log line to `sink` in addition to stderr. */
  setSink(sink: ((level: LogLevel, message: string) => void) | undefined): void {
    this.sink = sink;
  }

  /**
   * Log a message with a specific style
   */
  log(message: string, level: LogLevel = "info"): void {
    if (!this.enabled) return;

    const style = STYLES[level];
    const timestamp = new Date().toISOString().split("T")[1].slice(0, 8);
    const formattedMessage = `${style.color}${style.prefix}  [${timestamp}] ${message}${RESET}`;

    // Use stderr for logs to keep stdout clean for MCP JSON-RPC
    console.error(formattedMessage);
    if (this.sink) {
      try {
        this.sink(level, message);
      } catch {
        /* a failing sink must never break logging */
      }
    }
  }

  /**
   * Log info message
   */
  info(message: string): void {
    this.log(message, "info");
  }

  /**
   * Log success message
   */
  success(message: string): void {
    this.log(message, "success");
  }

  /**
   * Log warning message
   */
  warning(message: string): void {
    this.log(message, "warning");
  }

  /**
   * Log error message
   */
  error(message: string): void {
    this.log(message, "error");
  }

  /**
   * Log debug message
   */
  debug(message: string): void {
    this.log(message, "debug");
  }

  /**
   * Log dim message (for less important info)
   */
  dim(message: string): void {
    this.log(message, "dim");
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

/**
 * Global logger instance
 */
export const logger = new Logger();

/**
 * Convenience functions for quick logging
 */
export const log = {
  info: (msg: string) => logger.info(msg),
  success: (msg: string) => logger.success(msg),
  warning: (msg: string) => logger.warning(msg),
  error: (msg: string) => logger.error(msg),
  debug: (msg: string) => logger.debug(msg),
  dim: (msg: string) => logger.dim(msg),
};
