import { describe, expect, it } from "vitest";
import {
  AlreadyClassifiedError,
  confirmTask,
  createCapture,
  createEmptySnapshot,
  markAsNote,
  markAsUnneeded,
  resolveDueChoice,
  suggestClassification,
  type LocalCalendar,
} from "./index";

const now = "2026-08-03T09:00:00.000Z";

const calendar: LocalCalendar = {
  addDays: (date, days) => (date === "2026-08-03" && days === 3 ? "2026-08-06" : date),
  atTime: (date) => `${date}T09:00:00.000Z`,
  endOfDay: (date) => `${date}T14:59:00.000Z`,
  isAtOrAfter: () => false,
  nextWeekday: () => "2026-08-09",
  nextSunday: () => "2026-08-09",
  today: () => "2026-08-03",
};

function snapshotWithCapture() {
  return createCapture(
    createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    }),
    "牛乳を買う",
    now,
    "capture-1",
  );
}

describe("classification", () => {
  it("F-005 suggests a task without changing the capture classification", () => {
    const snapshot = snapshotWithCapture();

    expect(suggestClassification(snapshot.captures[0]!.body)).toBe("task");
    expect(snapshot.captures[0]!.classification).toBe("unclassified");
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.notificationOutbox).toHaveLength(1);
    expect(snapshot.reminderMap).toEqual([
      expect.objectContaining({ captureId: "capture-1", kind: "capture_initial" }),
    ]);
  });

  it("F-006 confirms a task once and links the source capture", () => {
    const next = confirmTask({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      taskId: "task-1",
      title: "牛乳を買う",
      due: resolveDueChoice({ choice: { type: "today" }, now, calendar }),
      now,
    });

    expect(next.captures[0]).toMatchObject({
      classification: "task",
      classifiedAt: now,
      linkedTaskId: "task-1",
    });
    expect(next.tasks).toEqual([
      expect.objectContaining({
        id: "task-1",
        sourceCaptureId: "capture-1",
        title: "牛乳を買う",
        dueMode: "scheduled",
      }),
    ]);
    expect(next.actionHistory.map((event) => event.action)).toEqual([
      "capture_created",
      "capture_classified",
      "task_created",
    ]);
  });

  it("F-014 queues the initial and deadline reminders only as anonymous local records when notifications are enabled", () => {
    const snapshot = snapshotWithCapture();
    snapshot.settings.notificationEnabled = true;
    const next = confirmTask({
      snapshot,
      captureId: "capture-1",
      taskId: "task-1",
      title: "SECRET_TASK_CANARY",
      due: { dueMode: "scheduled", dueAt: "2026-08-03T14:59:00.000Z", nextReviewAt: "2026-08-03T14:59:00.000Z" },
      now,
      idFactory: (kind, scheduleKind) => `${kind}-${scheduleKind ?? "event"}`,
    });

    expect(next.notificationOutbox).toHaveLength(5);
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel", taskRevision: 0 }),
    ]));
    expect(next.reminderMap.map((entry) => entry.kind)).toEqual(["initial", "deadline_before", "review"]);
    expect(next.notificationOutbox.filter((item) => item.operation === "upsert" && item.taskRevision === 1).map((item) => ({
      operation: item.operation,
      scheduledAt: item.scheduledAt,
      notificationType: item.notificationType,
    }))).toEqual([
      { operation: "upsert", scheduledAt: "2026-08-03T10:00:00.000Z", notificationType: "task_review" },
      { operation: "upsert", scheduledAt: "2026-08-03T13:59:00.000Z", notificationType: "deadline_review" },
      { operation: "upsert", scheduledAt: "2026-08-03T14:59:00.000Z", notificationType: "deadline_review" },
    ]);
    expect(JSON.stringify(next.notificationOutbox)).not.toContain("SECRET_TASK_CANARY");
    expect(JSON.stringify(next.notificationOutbox)).not.toContain("task-1");
  });

  it("F-006 rejects a second confirmation for the same capture", () => {
    const classified = confirmTask({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      taskId: "task-1",
      title: "牛乳を買う",
      due: resolveDueChoice({ choice: { type: "none" }, now, calendar }),
      now,
    });

    expect(() =>
      confirmTask({
        snapshot: classified,
        captureId: "capture-1",
        taskId: "task-2",
        title: "牛乳を買う",
        due: resolveDueChoice({ choice: { type: "none" }, now, calendar }),
        now,
      }),
    ).toThrow(AlreadyClassifiedError);
  });

  it("F-007 rejects a scheduled task without a due date", () => {
    expect(() =>
      confirmTask({
        snapshot: snapshotWithCapture(),
        captureId: "capture-1",
        taskId: "task-1",
        title: "牛乳を買う",
        due: { dueMode: "scheduled", nextReviewAt: now },
        now,
      }),
    ).toThrow("Scheduled tasks require a due date.");
  });

  it.each(["none", "unset"] as const)(
    "F-007 rejects a %s task that carries a due date",
    (dueMode) => {
      expect(() =>
        confirmTask({
          snapshot: snapshotWithCapture(),
          captureId: "capture-1",
          taskId: "task-1",
          title: "牛乳を買う",
          due: { dueMode, dueAt: "2026-08-03T14:59:00.000Z", nextReviewAt: now },
          now,
        }),
      ).toThrow("Only scheduled tasks can have a due date.");
    },
  );

  it("F-006 records note and unneeded classifications in action history", () => {
    const note = markAsNote({ snapshot: snapshotWithCapture(), captureId: "capture-1", now });
    const unneeded = markAsUnneeded({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });

    expect(note.captures[0]!.classification).toBe("note");
    expect(note.actionHistory.at(-1)).toMatchObject({ action: "capture_classified" });
    expect(unneeded.captures[0]!.classification).toBe("unneeded");
    expect(unneeded.actionHistory.at(-1)).toMatchObject({ action: "capture_classified" });
  });

  it("F-014 cancels an inbox reminder when the capture is resolved as a memo", () => {
    const next = markAsNote({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });

    expect(next.reminderMap).toEqual([]);
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel", taskRevision: 0 }),
    ]));
  });
});
