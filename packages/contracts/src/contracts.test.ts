import { describe, expect, it } from "vitest";
import {
  CreateDeviceRequestSchema,
  CreateDeviceResponseSchema,
  CreateReminderRequestSchema,
  DeviceSubscriptionResponseSchema,
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  PublicPushKeyResponseSchema,
} from "./index.js";

const deviceId = "a1f0f85e-8da5-4bfb-8fc4-938067ca9984";
const scheduledAt = "2026-08-06T09:00:00.000Z";

describe("notification API contracts", () => {
  it("parses every documented request and response example", () => {
    expect(
      CreateDeviceRequestSchema.parse({
        subscription: {
          endpoint: "https://push.example/subscription",
          expirationTime: null,
          keys: { p256dh: "base64url-p256dh", auth: "base64url-auth" },
        },
      }),
    ).toBeDefined();
    expect(
      CreateDeviceResponseSchema.parse({
        deviceId,
        deviceSecret: "one-time-secret",
        createdAt: "2026-08-03T09:00:00.000Z",
      }),
    ).toBeDefined();
    expect(
      DeviceSubscriptionResponseSchema.parse({
        deviceId,
        status: "active",
        updatedAt: "2026-08-03T09:30:00.000Z",
      }),
    ).toBeDefined();
    expect(PublicPushKeyResponseSchema.parse({ publicKey: "BEl..." })).toBeDefined();
    expect(
      HealthResponseSchema.parse({
        status: "ok",
        version: "0.1.0",
        time: "2026-08-03T09:00:00.000Z",
      }),
    ).toBeDefined();
    expect(
      ErrorEnvelopeSchema.parse({
        error: {
          code: "INVALID_REQUEST",
          message: "Request validation failed.",
          requestId: "req_01...",
          details: [{ path: "scheduledAt", reason: "must be an ISO 8601 UTC timestamp" }],
        },
      }),
    ).toBeDefined();
  });

  it.each(["body", "title", "taskId", "category"])(
    "rejects task data key %s from a reminder request",
    (forbiddenKey) => {
      expect(() =>
        CreateReminderRequestSchema.parse({
          deviceId,
          scheduledAt,
          notificationType: "task_review",
          [forbiddenKey]: "task-like-private-data",
        }),
      ).toThrow();
    },
  );

  it.each(["daily", "weekly", "monthly"])("accepts the %s anonymous reminder cadence", (repeatCadence) => {
    expect(CreateReminderRequestSchema.parse({ deviceId, scheduledAt, notificationType: "task_review", repeatCadence })).toMatchObject({ repeatCadence });
  });

  it.each([
    { repeatCadence: null },
    { repeatCadence: "hourly" },
    { owner: "private-owner" },
    { captureId: "private-capture" },
    { scope: "private-scope" },
  ])("rejects non-anonymous or invalid cadence payloads %#", (payload) => {
    expect(() => CreateReminderRequestSchema.parse({ deviceId, scheduledAt, notificationType: "task_review", ...payload })).toThrow();
  });
});
