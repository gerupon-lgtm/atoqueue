import { z } from "zod";
import {
  CreateDeviceRequestSchema,
  CreateDeviceResponseSchema,
  DeviceSubscriptionResponseSchema,
} from "./devices.js";
import {
  CreateReminderRequestSchema,
  ReminderResponseSchema,
} from "./reminders.js";
export const ApplicationIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const NotificationKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const RouteKeySchema = NotificationKeySchema;
export const CreateDeviceRequestV2Schema = CreateDeviceRequestSchema;
export const CreateDeviceResponseV2Schema = CreateDeviceResponseSchema.extend({
  appId: ApplicationIdSchema,
  protocolVersion: z.literal(2),
}).strict();
export const DeviceSubscriptionResponseV2Schema =
  DeviceSubscriptionResponseSchema.extend({
    appId: ApplicationIdSchema,
  }).strict();
export const CreateReminderRequestV2Schema = CreateReminderRequestSchema.omit({
  notificationType: true,
})
  .extend({ notificationKey: NotificationKeySchema, routeKey: RouteKeySchema })
  .strict();
export const ReminderResponseV2Schema = ReminderResponseSchema;
export const NotificationPushPayloadV2Schema = z
  .object({
    version: z.literal(2),
    appId: ApplicationIdSchema,
    type: z.literal("reminder_due"),
    reminderId: z.string().uuid(),
    notificationKey: NotificationKeySchema,
    routeKey: RouteKeySchema,
    groupId: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();
export type NotificationPushPayloadV2 = z.infer<
  typeof NotificationPushPayloadV2Schema
>;
export type CreateReminderRequestV2 = z.infer<
  typeof CreateReminderRequestV2Schema
>;
export type CreateDeviceResponseV2 = z.infer<
  typeof CreateDeviceResponseV2Schema
>;
