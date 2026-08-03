export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_SCHEDULE"
  | "DEVICE_UNAUTHORIZED"
  | "DEVICE_NOT_FOUND"
  | "REMINDER_NOT_FOUND"
  | "IDEMPOTENCY_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "PUSH_UNAVAILABLE";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Array<{ path: string; reason: string }>,
  ) {
    super(message);
  }
}
