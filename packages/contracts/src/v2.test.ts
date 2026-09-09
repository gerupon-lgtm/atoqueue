import { expect, it } from "vitest";
import {
  CreateReminderRequestV2Schema,
  NotificationPushPayloadV2Schema,
} from "./v2.js";
it("F-019 accepts opaque v2 reminders and rejects every private/unknown field", () => {
  const body = {
    deviceId: "a1f0f85e-8da5-4bfb-8fc4-938067ca9984",
    scheduledAt: "2026-09-09T00:00:00.000Z",
    notificationKey: "review_due",
    routeKey: "review",
  };
  expect(CreateReminderRequestV2Schema.parse(body)).toEqual(body);
  for (const field of [
    "title",
    "body",
    "url",
    "taskId",
    "captureId",
    "category",
    "appId",
    "owner",
  ])
    expect(
      CreateReminderRequestV2Schema.safeParse({ ...body, [field]: "PRIVATE" })
        .success,
    ).toBe(false);
  expect(
    NotificationPushPayloadV2Schema.safeParse({
      version: 2,
      appId: "sample",
      type: "reminder_due",
      reminderId: body.deviceId,
      notificationKey: "review_due",
      routeKey: "review",
      groupId: "0123456789abcdef",
    }).success,
  ).toBe(true);
});
