/**
 * DreamDay Platform — Global API response contract.
 *
 * WHY: Clients (web, mobile, partners) need a stable envelope to distinguish
 * success payloads from domain/validation/system errors. A single shape reduces
 * client-side branching and enables consistent error handling and logging.
 */

export interface ApiErrorPayload {
  code: string;
  message: string;
}

export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Type guard for success responses. Use in handlers when narrowing after checks.
 */
export function isSuccessResponse<T>(r: ApiResponse<T>): r is ApiSuccessResponse<T> {
  return r.success === true;
}
