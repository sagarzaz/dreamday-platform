/**
 * DreamDay Platform — Domain-specific error hierarchy.
 *
 * WHY domain errors instead of generic "Error" or HTTP-only status codes:
 * - Clients can map error.code to i18n and UX (e.g. "HALL_NOT_FOUND" → "Venue no longer available").
 * - Middleware can map to consistent HTTP status and log with correct severity.
 * - Support and debugging use codes for search and metrics; messages can be user-facing.
 * - Prevents leaking internal details (stack, DB messages) to the client.
 */

export const DomainErrorCodes = {
  // Auth
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',

  // Validation (business rules, not schema)
  VALIDATION_FAILED: 'VALIDATION_FAILED',

  // Hall / discovery
  HALL_NOT_FOUND: 'HALL_NOT_FOUND',
  HALL_INACTIVE: 'HALL_INACTIVE',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',

  // Booking
  BOOKING_CONFLICT: 'BOOKING_CONFLICT',   // unique constraint: hall+date already taken
  BOOKING_NOT_FOUND: 'BOOKING_NOT_FOUND',
  INVALID_BOOKING_STATE: 'INVALID_BOOKING_STATE',

  // User
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  EMAIL_ALREADY_EXISTS: 'EMAIL_ALREADY_EXISTS',

  // Rate limit / abuse
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',

  // Generic server
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type DomainErrorCode = (typeof DomainErrorCodes)[keyof typeof DomainErrorCodes];

/**
 * Base domain error. All API-facing errors should extend this so the
 * error-handler middleware can recognize them and return the standard envelope.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly isOperational: boolean = true
  ) {
    super(message);
    // maintain correct prototype chain for instanceof checks
    // use new.target so subclasses are handled automatically
    const actualProto = new.target.prototype;
    this.name = actualProto.constructor.name || 'DomainError';
    Object.setPrototypeOf(this, actualProto);
  }
}

/** 401 — Missing or invalid auth (token expired, malformed). */
export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Authentication required') {
    super(DomainErrorCodes.UNAUTHORIZED, message, 401);
    this.name = 'UnauthorizedError';
  }
}

/** 403 — Authenticated but not allowed (role, resource ownership). */
export class ForbiddenError extends DomainError {
  constructor(message: string = 'Access denied') {
    super(DomainErrorCodes.FORBIDDEN, message, 403);
    this.name = 'ForbiddenError';
  }
}

/** 404 — Resource not found. */
export class NotFoundError extends DomainError {
  constructor(code: DomainErrorCode, message: string) {
    super(code, message, 404);
    this.name = 'NotFoundError';
  }
}

/** 409 — Conflict with current state (e.g. double booking). */
export class ConflictError extends DomainError {
  constructor(code: DomainErrorCode, message: string) {
    super(code, message, 409);
    this.name = 'ConflictError';
  }
}

/** 422 — Business rule or input validation failed. */
export class ValidationError extends DomainError {
  constructor(message: string, public readonly details?: Record<string, string[]>) {
    super(DomainErrorCodes.VALIDATION_FAILED, message, 422);
    this.name = 'ValidationError';
  }
}

/** 429 — Rate limit exceeded. */
export class RateLimitError extends DomainError {
  constructor(message: string = 'Too many requests') {
    super(DomainErrorCodes.RATE_LIMIT_EXCEEDED, message, 429);
    this.name = 'RateLimitError';
  }
}

/** 500 — Unhandled/internal; not expected in normal flow. */
export class InternalError extends DomainError {
  constructor(message: string = 'An unexpected error occurred') {
    super(DomainErrorCodes.INTERNAL_ERROR, message, 500, false);
    this.name = 'InternalError';
  }
}
