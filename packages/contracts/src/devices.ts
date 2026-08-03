import { z } from "zod";
import { PushSubscriptionSchema } from "./push.js";

const UtcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "must be an ISO 8601 UTC timestamp");

export const DeviceIdSchema = z.string().uuid();

export const CreateDeviceRequestSchema = z.object({ subscription: PushSubscriptionSchema }).strict();

export const CreateDeviceResponseSchema = z
  .object({
    deviceId: DeviceIdSchema,
    deviceSecret: z.string().min(1),
    createdAt: UtcTimestampSchema,
  })
  .strict();

export const UpdateDeviceSubscriptionRequestSchema = CreateDeviceRequestSchema;

export const DeviceSubscriptionResponseSchema = z
  .object({
    deviceId: DeviceIdSchema,
    status: z.literal("active"),
    updatedAt: UtcTimestampSchema,
  })
  .strict();

export const HealthResponseSchema = z
  .object({ status: z.literal("ok"), version: z.string(), time: UtcTimestampSchema })
  .strict();

export type CreateDeviceRequest = z.infer<typeof CreateDeviceRequestSchema>;
export type CreateDeviceResponse = z.infer<typeof CreateDeviceResponseSchema>;
export type DeviceSubscriptionResponse = z.infer<typeof DeviceSubscriptionResponseSchema>;
