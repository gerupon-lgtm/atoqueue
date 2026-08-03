import { describe, expect, it } from "vitest";
import { createEmptySnapshot } from "../../../../../packages/domain/src";
import { resolveReminderTaskId } from "./reminder-navigation";

describe("resolveReminderTaskId", () => {
  it("resolves an active local reminder mapping only after a snapshot is available", () => {
    const snapshot = createEmptySnapshot({ appVersion: "test", localDeviceId: "local", timeZone: "Asia/Tokyo", now: "2026-08-04T08:00:00.000Z" });
    snapshot.reminderMap = [{ reminderId: "reminder", taskId: "task", taskRevision: 1, createdAt: "2026-08-04T08:00:00.000Z" }];
    snapshot.tasks = [{ id: "task", sourceCaptureId: "capture", title: "private title", status: "active", dueMode: "none", nextReviewAt: "2026-08-04T08:00:00.000Z", undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: "2026-08-04T08:00:00.000Z", updatedAt: "2026-08-04T08:00:00.000Z", revision: 1 }];

    expect(resolveReminderTaskId(snapshot, "reminder")).toBe("task");
    snapshot.tasks[0].status = "completed";
    expect(resolveReminderTaskId(snapshot, "reminder")).toBeUndefined();
  });
});
