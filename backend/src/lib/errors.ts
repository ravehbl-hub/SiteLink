/**
 * SiteLink back end — typed application errors + the standard error envelope
 * (Architecture §3.2 / §8). Routes/services throw AppError; the error-handler
 * plugin maps it to `{ error: { code, message, details? } }` + a status code.
 *
 * No sensitive detail (keys, connection strings, stack traces) is ever placed in
 * `message`/`details` for client-facing errors.
 */

export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'USER_EMAIL_EXISTS'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  USER_EMAIL_EXISTS: 409,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = details;
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', message);
  }
  static forbidden(message = 'Forbidden'): AppError {
    // Deliberately terse — no data leak on 403 (FR-X-RBAC-4).
    return new AppError('FORBIDDEN', message);
  }
  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', message);
  }
  static validation(message = 'Validation failed', details?: unknown): AppError {
    return new AppError('VALIDATION', message, details);
  }
  static conflict(message = 'Conflict'): AppError {
    return new AppError('CONFLICT', message);
  }
  static internal(message = 'Internal server error'): AppError {
    return new AppError('INTERNAL', message);
  }
}

/** The wire shape of every error response. */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}
