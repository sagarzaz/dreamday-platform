/**
 * DreamDay Platform — Standardized API Response Envelope.
 *
 * WHY structured envelopes:
 * - Frontend knows exactly where success/failure data lives (data vs error.message).
 * - No raw Prisma errors, stack traces, or internal details leak to client.
 * - Enables strict contract between frontend and backend; easier testing and mocking.
 * - Facilitates error aggregation and analytics (e.g., "count all BOOKING_CONFLICT errors").
 *
 * WHY code + message in error object:
 * - `code` is machine-readable (e.g., "BOOKING_CONFLICT", "RATE_LIMIT_EXCEEDED").
 * - `message` is human-readable but generic (does not expose internal state).
 * - Frontend can react based on code: show retry button for transient, show form error for validation, etc.
 */

export interface ApiSuccessResponse<T = void> {
  success: true;
  data?: T;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;    // Machine-readable error code (e.g., "BOOKING_CONFLICT")
    message: string; // Safe user-facing message (no internals)
  };
}

export type ApiResponse<T = void> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Helper to build a success response.
 * Usage: res.status(200).json(success({ id: '123', name: 'Hall A' }))
 */
export function success<T>(data?: T): ApiSuccessResponse<T> {
  if (data === undefined) {
    return { success: true };
  }
  return { success: true, data };
}

/**
 * Helper to build an error response.
 * Usage: res.status(409).json(error('BOOKING_CONFLICT', 'This slot is already booked.'))
 */
export function error(code: string, message: string): ApiErrorResponse {
  return {
    success: false,
    error: { code, message },
  };
}

/**
 * Maps error codes to HTTP status codes.
 * Use this to ensure consistent status codes across endpoints.
 */
export const errorStatusMap: Record<string, number> = {
  // 400 — Client errors (validation, bad request)
  'VALIDATION_ERROR': 400,
  'INVALID_REQUEST': 400,
  'INVALID_DATE': 400,

  // 401 — Unauthorized (missing/invalid auth)
  'UNAUTHORIZED': 401,
  'INVALID_TOKEN': 401,
  'TOKEN_EXPIRED': 401,
  'MISSING_AUTH': 401,

  // 403 — Forbidden (authenticated but lack permission)
  'FORBIDDEN': 403,
  'INSUFFICIENT_ROLE': 403,

  // 404 — Not found
  'NOT_FOUND': 404,
  'HALL_NOT_FOUND': 404,
  'USER_NOT_FOUND': 404,

  // 409 — Conflict (state conflict, e.g., double-booking)
  'BOOKING_CONFLICT': 409,
  'DUPLICATE_BOOKING': 409,

  // 429 — Too many requests (rate limit)
  'RATE_LIMIT_EXCEEDED': 429,

  // 500 — Internal server error
  'INTERNAL_ERROR': 500,
  'DATABASE_ERROR': 500,
};

/**
 * Gets HTTP status for a given error code.
 * Defaults to 500 if code is not recognized (unknown errors are treated as critical).
 */
export function getStatusForErrorCode(code: string): number {
  return errorStatusMap[code] ?? 500;
}
