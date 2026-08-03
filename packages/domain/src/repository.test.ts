import { describe, expect, it } from "vitest";
import {
  createEmptySnapshot,
  migrateSnapshot,
  UnsupportedSchemaVersionError,
} from "./index";

describe("domain repository model", () => {
  it("creates a version 1 empty snapshot from the supplied device context", () => {
    expect(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
    ).toMatchObject({
      schemaVersion: 1,
      appVersion: "0.1.0",
      device: {
        localDeviceId: "device-1",
        pushSubscriptionStatus: "not_requested",
      },
      settings: {
        locale: "ja-JP",
        timeZone: "Asia/Tokyo",
        notificationEnabled: false,
        weeklyReviewDay: 0,
      },
      captures: [],
      tasks: [],
      reviewSessions: [],
      actionHistory: [],
      notificationOutbox: [],
      reminderMap: [],
      savedAt: "2026-08-03T00:00:00.000Z",
    });
  });

  it("rejects a stored future schema version", () => {
    expect(() => migrateSnapshot({ schemaVersion: 2 })).toThrow(
      UnsupportedSchemaVersionError,
    );
  });
});
