import { z } from "zod";

export const ErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "INVALID_SCHEDULE",
  "DEVICE_UNAUTHORIZED",
  "DEVICE_NOT_FOUND",
  "REMINDER_NOT_FOUND",
  "IDEMPOTENCY_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "PUSH_UNAVAILABLE",
]);

export const ErrorDetailSchema = z
  .object({ path: z.string(), reason: z.string() })
  .strict();

export const ErrorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: ErrorCodeSchema,
        message: z.string(),
        requestId: z.string(),
        details: z.array(ErrorDetailSchema).optional(),
      })
      .strict(),
  })
  .strict();

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
