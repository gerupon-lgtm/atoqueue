import { describe, expect, it } from "vitest";
import {
  AlreadyClassifiedError,
  confirmTask,
  createCapture,
  createEmptySnapshot,
  deleteUnneededCapture,
  deleteUnneededCaptures,
  getUnneededCaptureSource,
  markAsNote,
  markNoteAsUnneeded,
  markAsUnneeded,
  promoteNoteToTask,
  restoreUnneededCapture,
  restoreUnneededCaptures,
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
    expect(snapshot.notificationOutbox).toHaveLength(4);
    expect(snapshot.reminderMap).toEqual([
      expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
      expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
      expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
      expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
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

    expect(next.notificationOutbox.filter((item) => item.operation === "upsert")).toHaveLength(3);
    expect(next.notificationOutbox.filter((item) => item.operation === "cancel")).toHaveLength(4);
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

    expect(next.reminderMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "memo" }),
    ]));
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel", taskRevision: 0 }),
    ]));
  });

  it("F-006 promotes a memo only when the user later confirms its task candidate", () => {
    const noted = markAsNote({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });

    const next = promoteNoteToTask({
      snapshot: noted,
      captureId: "capture-1",
      taskId: "task-1",
      title: "牛乳を買う",
      due: resolveDueChoice({ choice: { type: "none" }, now, calendar }),
      now: "2026-08-03T10:00:00.000Z",
    });

    expect(next.captures[0]).toMatchObject({
      classification: "task",
      linkedTaskId: "task-1",
    });
    expect(next.tasks).toEqual([
      expect.objectContaining({ id: "task-1", sourceCaptureId: "capture-1" }),
    ]);
    expect(next.reminderMap.some((entry) => entry.scope === "memo")).toBe(false);
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel", taskRevision: 0 }),
    ]));
  });

  it("F-006 marks a memo unneeded and removes its global memo reservations", () => {
    const noted = markAsNote({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });
    const next = markNoteAsUnneeded({
      snapshot: noted,
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });

    expect(next.captures[0]!.classification).toBe("unneeded");
    expect(next.reminderMap.some((entry) => entry.scope === "memo")).toBe(false);
    expect(next.notificationOutbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "cancel" }),
    ]));
  });

  it("F-006 restores an unneeded capture to the inbox and rebuilds its reminder series", () => {
    const unneeded = markAsUnneeded({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });
    const restoredAt = "2026-08-03T10:00:00.000Z";

    const next = restoreUnneededCapture({
      snapshot: unneeded,
      captureId: "capture-1",
      now: restoredAt,
    });

    expect(next.captures[0]).toEqual({
      id: "capture-1",
      body: "牛乳を買う",
      classification: "unclassified",
      createdAt: now,
      updatedAt: restoredAt,
    });
    expect(next.reminderMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: "inbox", kind: "capture_initial" }),
    ]));
    expect(next.actionHistory.at(-1)).toMatchObject({
      action: "capture_classified",
      after: { classification: "unclassified" },
    });
  });

  it("F-006 permanently deletes an unneeded capture and only its capture history", () => {
    const unneeded = markAsUnneeded({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });
    unneeded.actionHistory.push({
      id: "other:capture_created",
      entityType: "capture",
      entityId: "other",
      action: "capture_created",
      occurredAt: now,
    });

    const next = deleteUnneededCapture({
      snapshot: unneeded,
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });

    expect(next.captures).toEqual([]);
    expect(next.actionHistory).toEqual([
      expect.objectContaining({ entityId: "other" }),
    ]);
    expect(next.reminderMap.some((entry) => entry.scope === "inbox")).toBe(false);
  });

  it("F-014 cancels every inbox reservation when the last unresolved capture becomes unneeded", () => {
    const next = markAsUnneeded({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now,
    });

    expect(next.reminderMap.some((entry) => entry.scope === "inbox")).toBe(false);
    expect(next.notificationOutbox).toHaveLength(4);
    expect(next.notificationOutbox.every((item) => item.operation === "cancel")).toBe(true);
  });

  it("F-006 only restores or deletes captures already marked unneeded", () => {
    const snapshot = snapshotWithCapture();

    expect(() => restoreUnneededCapture({ snapshot, captureId: "capture-1", now }))
      .toThrow(AlreadyClassifiedError);
    expect(() => deleteUnneededCapture({ snapshot, captureId: "capture-1", now }))
      .toThrow(AlreadyClassifiedError);
  });

  it("F-006 derives the current unneeded origin from classification history", () => {
    const direct = markAsUnneeded({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });
    const noted = markAsNote({
      snapshot: snapshotWithCapture(),
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });
    const fromNote = markNoteAsUnneeded({
      snapshot: noted,
      captureId: "capture-1",
      now: "2026-08-03T11:00:00.000Z",
    });
    const restored = restoreUnneededCapture({
      snapshot: fromNote,
      captureId: "capture-1",
      now: "2026-08-03T12:00:00.000Z",
    });
    const directAfterRestore = markAsUnneeded({
      snapshot: restored,
      captureId: "capture-1",
      now: "2026-08-03T13:00:00.000Z",
    });

    expect(getUnneededCaptureSource(direct, "capture-1")).toBe(
      "unclassified",
    );
    expect(getUnneededCaptureSource(fromNote, "capture-1")).toBe("note");
    expect(getUnneededCaptureSource(directAfterRestore, "capture-1")).toBe(
      "unclassified",
    );
  });

  it("F-006 restores every selected unneeded capture in one snapshot update", () => {
    let snapshot = createCapture(
      snapshotWithCapture(),
      "返却する",
      "2026-08-03T09:05:00.000Z",
      "capture-2",
    );
    snapshot = markAsUnneeded({
      snapshot,
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });
    snapshot = markAsUnneeded({
      snapshot,
      captureId: "capture-2",
      now: "2026-08-03T10:05:00.000Z",
    });

    const next = restoreUnneededCaptures({
      snapshot,
      captureIds: ["capture-1", "capture-2"],
      now: "2026-08-03T11:00:00.000Z",
    });

    expect(next.captures).toEqual([
      expect.objectContaining({
        id: "capture-1",
        classification: "unclassified",
      }),
      expect.objectContaining({
        id: "capture-2",
        classification: "unclassified",
      }),
    ]);
    expect(
      next.actionHistory
        .filter(
          (event) =>
            event.action === "capture_classified" &&
            event.occurredAt === "2026-08-03T11:00:00.000Z",
        )
        .map(({ entityId }) => entityId),
    ).toEqual(["capture-1", "capture-2"]);
    expect(next.reminderMap.filter(({ scope }) => scope === "inbox")).toHaveLength(
      4,
    );
  });

  it("F-006 validates every selected capture before a batch restore", () => {
    const snapshot = markAsUnneeded({
      snapshot: createCapture(
        snapshotWithCapture(),
        "返却する",
        "2026-08-03T09:05:00.000Z",
        "capture-2",
      ),
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });
    const before = structuredClone(snapshot);

    expect(() =>
      restoreUnneededCaptures({
        snapshot,
        captureIds: ["capture-1", "capture-2"],
        now: "2026-08-03T11:00:00.000Z",
      }),
    ).toThrow(AlreadyClassifiedError);
    expect(snapshot).toEqual(before);
  });

  it("F-006 permanently deletes every selected unneeded capture and only their history", () => {
    let snapshot = createCapture(
      snapshotWithCapture(),
      "返却する",
      "2026-08-03T09:05:00.000Z",
      "capture-2",
    );
    snapshot = markAsUnneeded({
      snapshot,
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });
    snapshot = markAsUnneeded({
      snapshot,
      captureId: "capture-2",
      now: "2026-08-03T10:05:00.000Z",
    });
    snapshot.actionHistory.push({
      id: "kept",
      entityType: "backup",
      entityId: "kept",
      action: "backup_exported",
      occurredAt: now,
    });

    const next = deleteUnneededCaptures({
      snapshot,
      captureIds: ["capture-1", "capture-2"],
      now: "2026-08-03T11:00:00.000Z",
    });

    expect(next.captures).toEqual([]);
    expect(next.actionHistory).toEqual([
      expect.objectContaining({ id: "kept" }),
    ]);
    expect(next.reminderMap.some(({ scope }) => scope === "inbox")).toBe(false);
  });

  it("F-006 validates every selected capture before a batch deletion", () => {
    const snapshot = markAsUnneeded({
      snapshot: createCapture(
        snapshotWithCapture(),
        "返却する",
        "2026-08-03T09:05:00.000Z",
        "capture-2",
      ),
      captureId: "capture-1",
      now: "2026-08-03T10:00:00.000Z",
    });
    const before = structuredClone(snapshot);

    expect(() =>
      deleteUnneededCaptures({
        snapshot,
        captureIds: ["capture-1", "capture-2"],
        now: "2026-08-03T11:00:00.000Z",
      }),
    ).toThrow(AlreadyClassifiedError);
    expect(snapshot).toEqual(before);
  });
});
