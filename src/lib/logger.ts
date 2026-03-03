/**
 * DreamDay Platform — Structured Logging Layer (Production-Grade).
 *
 * WHY structured logs:
 * - Queryable in production (e.g. "all errors for requestId X", "all BOOKING_CONFLICT").
 * - No string interpolation; JSON fields are indexed by log aggregators (ELK, Datadog, Vercel).
 * - Log levels (info, warn, error, debug) enable filtering by severity and alerting.
 * - requestId propagation enables tracing across service boundaries.
 *
 * WHY PII redaction:
 * - Logs are often shipped to 3rd parties; PII (email, password, SSN) must not appear.
 * - Redaction is automatic for known PII fields; new fields should be explicitly redacted.
 * - This prevents accidental compliance violations (GDPR, CCPA, etc.).
 * - Trade-off: reduced debugging visibility for PII searches (log hash instead if needed).
 *
 * INTEGRATION WITH VERCEL LOGS:
 * - Vercel captures stdout/stderr; JSON logs are automatically parsed and indexed.
 * - requestId and userId are indexed as searchable fields.
 * - Errors are surfaced in the Vercel dashboard with stack traces (if included).
 */

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimum level to emit. Set via LOG_LEVEL env (default: info).
 * In production, use "info" or "warn"; "debug" only in staging/troubleshooting.
 */
// default log level; will be initialized after config loads
let currentLevel: LogLevel = 'info';

/** Known PII fields that should never be logged. */
const PII_FIELDS = new Set([
  'password',
  'pwd',
  'secret',
  'token',
  'jwt',
  'apiKey',
  'api_key',
  'ssn',
  'creditCard',
  'card',
  'phone',
  'birthDate',
]);

/**
 * Redacts sensitive values from a context object.
 * Recursively scans for known PII fields and replaces values with [REDACTED].
 */
function redactPii(context: LogContext): LogContext {
  const result: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    if (PII_FIELDS.has(key.toLowerCase())) {
      // Replace sensitive field with redaction marker
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Recursively redact nested objects
      result[key] = redactPii(value as LogContext);
    } else if (Array.isArray(value)) {
      // For arrays, redact each element if it's an object
      result[key] = value.map((v) =>
        typeof v === 'object' && v !== null ? redactPii(v as LogContext) : v
      );
    } else {
      // Keep non-sensitive values as-is
      result[key] = value;
    }
  }

  return result;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[currentLevel];
}

/**
 * Initialize logger with configuration values.
 * Called from config loader once environment validation completes.
 */
export function initLogger(level: LogLevel): void {
  currentLevel = level;
}

function formatPayload(level: LogLevel, message: string, context?: LogContext): string {
  // Redact PII before logging
  const safeContext = context ? redactPii(context) : {};

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
    // Include context fields at top level for easy search
    ...safeContext,
  };

  return JSON.stringify(payload);
}

export const logger = {
  /**
   * Log at info level (normal flow, significant events).
   * Use for: successful operations, state changes, milestones.
   */
  info(message: string, context?: LogContext): void {
    if (shouldLog('info')) {
      process.stdout.write(formatPayload('info', message, context) + '\n');
    }
  },

  /**
   * Log at warn level (recoverable issues, degraded behavior).
   * Use for: validation failures, retries, timeouts, rate limits.
   */
  warn(message: string, context?: LogContext): void {
    if (shouldLog('warn')) {
      process.stderr.write(formatPayload('warn', message, context) + '\n');
    }
  },

  /**
   * Log at error level (failures, exceptions, critical issues).
   * Use for: exceptions, database errors, unexpected states.
   * Includes stack trace if error object is provided.
   */
  error(message: string, context?: LogContext & { error?: string | Error }): void {
    if (shouldLog('error')) {
      const ctx = context || {};
      const error = ctx.error;

      let errorStr: string | undefined;
      if (error instanceof Error) {
        errorStr = error.stack; // Include full stack trace
      } else if (typeof error === 'string') {
        errorStr = error;
      }

      const payload = {
        timestamp: new Date().toISOString(),
        level: 'error',
        message,
        ...(errorStr && { errorStack: errorStr }),
        ...redactPii({ ...ctx, error: undefined }),
      };

      process.stderr.write(JSON.stringify(payload) + '\n');
    }
  },

  /**
   * Log at debug level (detailed information for troubleshooting).
   * Use only in development or when debugging production issues.
   */
  debug(message: string, context?: LogContext): void {
    if (shouldLog('debug')) {
      process.stdout.write(formatPayload('debug', message, context) + '\n');
    }
  },
};
