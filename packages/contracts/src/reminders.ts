import { z } from "zod";
import { DeviceIdSchema } from "./devices.js";

const UtcTimestampSchema = z
  .string()
  .datetime({ offset: true })
  .refine((value) => value.endsWith("Z"), "must be an ISO 8601 UTC timestamp");

export const NotificationTypeSchema = z.enum(["inbox_review", "task_review", "deadline_review", "unset_due_review"]);

export const CreateReminderRequestSchema = z
  .object({
    deviceId: DeviceIdSchema,
    scheduledAt: UtcTimestampSchema,
    notificationType: NotificationTypeSchema,
  })
  .strict();

export const ReminderResponseSchema = z
  .object({
    reminderId: z.string().uuid(),
    status: z.literal("pending"),
    scheduledAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
  })
  .strict();
