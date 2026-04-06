/**
 * Structured logging utility for the Nobulex SDK.
 *
 * Provides a simple, zero-dependency structured logger that outputs
 * JSON log entries. Supports log levels, contextual fields, and
 * child loggers for component-scoped logging.
 *
 * @packageDocumentation
 */

// ─── Log levels ─────────────────────────────────────────────────────────────────

/**
 * Numeric log levels used to control verbosity.
 *
 * A log entry is emitted only when its level is greater than or equal to
 * the logger's current threshold.  Setting the level to {@link SILENT}
 * suppresses all output.
 */
export enum LogLevel {
  /** Fine-grained diagnostic information. */
  DEBUG = 0,
  /** General operational information. */
  INFO = 1,
  /** Potentially harmful situations. */
  WARN = 2,
  /** Error events that might still allow the application to continue. */
  ERROR = 3,
  /** Suppress all logging output. */
  SILENT = 4,
}

// ─── Types ──────────────────────────────────────────────────────────────────────

/**
 * A single structured log entry.
 *
 * The `level`, `message`, and `timestamp` fields are always present.
 * Additional contextual fields may be attached via the index signature.
 */
export interface LogEntry {
  /** Human-readable level name (e.g. "DEBUG", "INFO"). */
  level: string;
  /** Log message. */
  message: string;
  /** ISO 8601 timestamp of when the entry was created. */
  timestamp: string;
  /** Optional component name for scoped logging. */
  component?: string;
  /** Arbitrary contextual fields. */
  [key: string]: unknown;
}

/**
 * A function that receives a formatted {@link LogEntry} for output.
 *
 * The default output writes `JSON.stringify(entry)` to `console.log`.
 * Provide a custom implementation to route logs elsewhere (file, network, etc.).
 */
export type LogOutput = (entry: LogEntry) => void;

// ─── Helpers ────────────────────────────────────────────────────────────────────

/** Map numeric log level to its human-readable name. */
const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
  [LogLevel.SILENT]: 'SILENT',
};

/** Default output: JSON to stdout. */
const defaultOutput: LogOutput = (entry: LogEntry): void => {
  console.log(JSON.stringify(entry));
};

// ─── Logger options ─────────────────────────────────────────────────────────────

/** Configuration options accepted by the {@link Logger} constructor. */
export interface LoggerOptions {
  /** Minimum level to emit. Defaults to {@link LogLevel.INFO}. */
  level?: LogLevel;
  /** Component name prepended to child logger components. */
  component?: string;
  /** Custom output sink. Defaults to JSON via `console.log`. */
  output?: LogOutput;
}

// ─── Logger class ───────────────────────────────────────────────────────────────

/**
 * Structured logger with level filtering, contextual fields, and child loggers.
 *
 * ```ts
 * const log = new Logger({ level: LogLevel.DEBUG, component: 'core' });
 * log.info('system started', { version: '1.0.0' });
 * const child = log.child('storage');
 * child.warn('disk nearly full', { usedPct: 92 });
 * ```
 */
export class Logger {
  private level: LogLevel;
  private readonly component: string | undefined;
  private readonly output: LogOutput;

  constructor(options?: LoggerOptions) {
    this.level = options?.level ?? LogLevel.INFO;
    this.component = options?.component;
    this.output = options?.output ?? defaultOutput;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Emit a {@link LogLevel.DEBUG} entry. */
  debug(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, fields);
  }

  /** Emit a {@link LogLevel.INFO} entry. */
  info(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, fields);
  }

  /** Emit a {@link LogLevel.WARN} entry. */
  warn(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, fields);
  }

  /** Emit a {@link LogLevel.ERROR} entry. */
  error(message: string, fields?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, fields);
  }

  /**
   * Create a child logger that inherits this logger's level and output
   * but adds (or extends) the component prefix.
   *
   * @param component - Component name for the child logger.  If this logger
   *   already has a component, the child's component is `parent.child`.
   */
  child(component: string): Logger {
    const childComponent = this.component
      ? `${this.component}.${component}`
      : component;

    return new Logger({
      level: this.level,
      component: childComponent,
      output: this.output,
    });
  }

  /** Change the minimum log level at runtime. */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /** Return the current minimum log level. */
  getLevel(): LogLevel {
    return this.level;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Core logging method.  Constructs a {@link LogEntry} and forwards it to
   * the configured output sink if the entry's level meets the threshold.
   */
  private log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (level < this.level) {
      return;
    }

    const entry: LogEntry = {
      level: LEVEL_NAMES[level],
      message,
      timestamp: new Date().toISOString(),
      ...(this.component !== undefined ? { component: this.component } : {}),
      ...fields,
    };

    this.output(entry);
  }
}

// ─── Factory & default instance ─────────────────────────────────────────────────

/**
 * Create a new {@link Logger} instance.
 *
 * Convenience wrapper around `new Logger(options)`.
 */
export function createLogger(options?: LoggerOptions): Logger {
  return new Logger(options);
}

/**
 * Pre-configured logger at {@link LogLevel.INFO} with default JSON output.
 *
 * Suitable for quick, import-and-go usage:
 * ```ts
 * import { defaultLogger } from '@nobulex/types';
 * defaultLogger.info('hello');
 * ```
 */
export const defaultLogger: Logger = createLogger();
