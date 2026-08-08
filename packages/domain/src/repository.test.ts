import { describe, expect, it } from "vitest";
import {
  CorruptDataError,
  createEmptySnapshot,
  migrateSnapshot,
  UnsupportedSchemaVersionError,
} from "./index";

function snapshotWithReviewActionOwnership(): Record<string, unknown> {
  const now = "2026-08-03T00:00:00.000Z";
  return {
    ...createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "device-1", timeZone: "Asia/Tokyo", now }),
    tasks: [{
      id: "task-1",
      sourceCaptureId: "capture-1",
      title: "private task",
      status: "active",
      dueMode: "none",
      nextReviewAt: "2026-08-10T18:00:00.000Z",
      undecidedCount: 0,
      dismissCount: 0,
      postponeCount: 0,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }],
    reviewSessions: [{
      id: "session-1",
      localDate: "2026-08-03",
      orderedTaskIds: ["task-1"],
      currentIndex: 1,
      visitedTaskIds: ["task-1"],
      answeredTaskIds: ["task-1"],
      actionEventIds: ["event-1"],
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    }],
    actionHistory: [{
      id: "event-1",
      entityType: "task",
      entityId: "task-1",
      action: "task_completed",
      occurredAt: now,
    }],
  };
}

describe("domain repository model", () => {
  it("creates a version 3 empty snapshot from the supplied device context", () => {
    expect(
      createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
    ).toMatchObject({
      schemaVersion: 3,
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

  it("migrates version 2 notification records to explicit timing preferences and schedule kinds", () => {
    const v2: unknown = {
      ...createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
      schemaVersion: 2,
      reminderMap: [{
        reminderId: "reminder-1",
        taskId: "task-1",
        taskRevision: 1,
        createdAt: "2026-08-03T00:00:00.000Z",
      }],
    };

    expect(migrateSnapshot(v2)).toMatchObject({
      schemaVersion: 3,
      settings: { initialReminderDelayMinutes: 60, deadlineReminderLeadMinutes: 60 },
      reminderMap: [{ kind: "review" }],
    });
  });

  it("rejects a stored future schema version", () => {
    expect(() => migrateSnapshot({ schemaVersion: 4 })).toThrow(
      UnsupportedSchemaVersionError,
    );
  });

  it("migrates a complete version 1 snapshot through current schema with empty review event ownership", () => {
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
      schemaVersion: 3,
      reviewSessions: [{ id: "session-1", actionEventIds: [] }],
    });
  });

  it("rejects a version 1 review session whose answered task was not ordered", () => {
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
        answeredTaskIds: ["foreign-task"],
        startedAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    };

    expect(() => migrateSnapshot(v1)).toThrow(CorruptDataError);
    expect(() => migrateSnapshot(v1)).toThrow("answeredTaskIds must be a subset of orderedTaskIds");
  });

  it.each([
    ["orderedTaskIds", {}],
    ["orderedTaskIds", "task-1"],
    ["orderedTaskIds", null],
    ["orderedTaskIds", 1],
    ["orderedTaskIds", ["task-1", 1]],
    ["answeredTaskIds", {}],
    ["answeredTaskIds", "task-1"],
    ["answeredTaskIds", null],
    ["answeredTaskIds", 1],
    ["answeredTaskIds", ["task-1", 1]],
  ] as const)("rejects a version 1 review session with invalid %s", (field, value) => {
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
        [field]: value,
      }],
    };

    expect(() => migrateSnapshot(v1)).toThrow(CorruptDataError);
  });

  it("migrates non-empty version 1 answered task IDs and supplies empty event ownership", () => {
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
        orderedTaskIds: ["task-1", "task-2"],
        currentIndex: 1,
        visitedTaskIds: ["task-1"],
        answeredTaskIds: ["task-1"],
        startedAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      }],
    };

    expect(migrateSnapshot(v1)).toMatchObject({
      schemaVersion: 3,
      reviewSessions: [{
        orderedTaskIds: ["task-1", "task-2"],
        answeredTaskIds: ["task-1"],
        actionEventIds: [],
      }],
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

  it.each([
    ["completed", "completedAt"],
    ["archived", "archivedAt"],
  ] as const)("rejects a version 2 %s task without %s", (status, missingField) => {
    const invalidTerminalTask: unknown = {
      ...createEmptySnapshot({
        appVersion: "0.1.0",
        localDeviceId: "device-1",
        timeZone: "Asia/Tokyo",
        now: "2026-08-03T00:00:00.000Z",
      }),
      tasks: [{
        id: "task-1",
        sourceCaptureId: "capture-1",
        title: "private task",
        status,
        dueMode: "none",
        nextReviewAt: "2026-08-10T18:00:00.000Z",
        undecidedCount: 0,
        dismissCount: 0,
        postponeCount: 0,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        revision: 1,
      }],
    };

    expect(() => migrateSnapshot(invalidTerminalTask)).toThrow(CorruptDataError);
    expect(() => migrateSnapshot(invalidTerminalTask)).toThrow(missingField);
  });

  it.each([
    ["references no event", (snapshot: Record<string, unknown>) => {
      (snapshot.reviewSessions as Array<Record<string, unknown>>)[0]!.actionEventIds = ["missing-event"];
    }],
    ["references a non-task event", (snapshot: Record<string, unknown>) => {
      (snapshot.actionHistory as Array<Record<string, unknown>>)[0]!.entityType = "capture";
    }],
    ["references an event for an unanswered task", (snapshot: Record<string, unknown>) => {
      (snapshot.actionHistory as Array<Record<string, unknown>>)[0]!.entityId = "task-2";
    }],
    ["claims one event from two sessions", (snapshot: Record<string, unknown>) => {
      (snapshot.reviewSessions as Array<Record<string, unknown>>).push({
        ...(snapshot.reviewSessions as Array<Record<string, unknown>>)[0]!,
        id: "session-2",
      });
    }],
  ] as const)("rejects a version 2 review session that %s", (_reason, corrupt) => {
    const snapshot = snapshotWithReviewActionOwnership();
    corrupt(snapshot);

    expect(() => migrateSnapshot(snapshot)).toThrow(CorruptDataError);
  });

  it("rejects a version 2 review session whose answered task was not ordered", () => {
    const snapshot = snapshotWithReviewActionOwnership();
    (snapshot.reviewSessions as Array<Record<string, unknown>>)[0]!.answeredTaskIds = ["task-2"];

    expect(() => migrateSnapshot(snapshot)).toThrow(CorruptDataError);
    expect(() => migrateSnapshot(snapshot)).toThrow("answeredTaskIds must be a subset of orderedTaskIds");
  });

  it("rejects a version 2 review session that owns an action for an unordered task", () => {
    const snapshot = snapshotWithReviewActionOwnership();
    (snapshot.actionHistory as Array<Record<string, unknown>>)[0]!.entityId = "task-2";

    expect(() => migrateSnapshot(snapshot)).toThrow(CorruptDataError);
    expect(() => migrateSnapshot(snapshot)).toThrow("action event task must be within orderedTaskIds");
  });
});
