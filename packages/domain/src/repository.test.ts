import { describe, expect, it } from "vitest";
import {
  CorruptDataError,
  createEmptySnapshot,
  migrateSnapshot,
  UnsupportedSchemaVersionError,
} from "./index";

describe("domain repository model", () => {
  it("creates a version 2 empty snapshot from the supplied device context", () => {
    expect(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
    ).toMatchObject({
      schemaVersion: 2,
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
    expect(() => migrateSnapshot({ schemaVersion: 3 })).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it("migrates a complete version 1 snapshot to version 2 with empty review event ownership", () => {
    const v1: unknown = {
      ...createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
      schemaVersion: 1,
      reviewSessions: [{
        id: "session-1",
        localDate: "2026-08-03",
        orderedTaskIds: ["task-1"],
        currentIndex: 0,
        visitedTaskIds: [],
        answeredTaskIds: [],
        startedAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    };

    expect(migrateSnapshot(v1)).toMatchObject({
      schemaVersion: 2,
      reviewSessions: [{ id: "session-1", actionEventIds: [] }],
    });
  });

  it("validates that version 2 review sessions own an action-event ID array", () => {
    const v2WithoutOwnership: unknown = {
      ...createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
      schemaVersion: 2,
      reviewSessions: [{
        id: "session-1",
        localDate: "2026-08-03",
        orderedTaskIds: [],
        currentIndex: 0,
        visitedTaskIds: [],
        answeredTaskIds: [],
        startedAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    };

    expect(() => migrateSnapshot(v2WithoutOwnership)).toThrow(CorruptDataError);
  });

  it("rejects a version 2 no-due task that still carries a dueAt", () => {
    const invalidNoDue: unknown = {
      ...createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
      tasks: [{
        id: "task-1",
        sourceCaptureId: "capture-1",
        title: "買い物",
        status: "active",
        dueMode: "none",
        dueAt: "2026-08-03T23:59:00.000Z",
        nextReviewAt: "2026-08-10T18:00:00.000Z",
        undecidedCount: 0,
        dismissCount: 0,
        postponeCount: 0,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        revision: 1,
      }],
    };

    expect(() => migrateSnapshot(invalidNoDue)).toThrow(CorruptDataError);
  });
});
