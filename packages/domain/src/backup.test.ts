import { describe, expect, it } from "vitest";
import {
  createBackup,
  createEmptySnapshot,
  inspectBackup,
  restoreBackup,
  type AppSnapshot,
} from "./index";

const now = "2026-08-04T09:00:00.000Z";

function snapshot(): AppSnapshot {
  const value = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "local-device",
    timeZone: "Asia/Tokyo",
    now,
  });
  value.device.pushDeviceId = "server-device";
  value.device.pushDeviceSecret = "secret";
  value.device.registeredAt = now;
  value.device.pushSubscriptionStatus = "granted";
  value.settings.notificationEnabled = true;
  value.captures = [{ id: "capture-1", body: "買い物", classification: "task", createdAt: now, updatedAt: now, classifiedAt: now, linkedTaskId: "task-1" }];
  value.tasks = [{ id: "task-1", sourceCaptureId: "capture-1", title: "牛乳を買う", status: "active", dueMode: "scheduled", dueAt: "2026-08-05T09:00:00.000Z", nextReviewAt: "2026-08-05T09:00:00.000Z", undecidedCount: 0, dismissCount: 0, postponeCount: 0, createdAt: now, updatedAt: now, revision: 3 }];
  value.actionHistory = [{ id: "action-1", entityType: "task", entityId: "task-1", action: "task_created", occurredAt: now }];
  value.reviewSessions = [{ id: "review-1", localDate: "2026-08-04", orderedTaskIds: ["task-1"], currentIndex: 0, visitedTaskIds: ["task-1"], answeredTaskIds: ["task-1"], actionEventIds: ["action-1"], startedAt: now, updatedAt: now }];
  value.notificationOutbox = [{ id: "old-outbox", operation: "upsert", reminderId: "old-reminder", scheduledAt: value.tasks[0]!.nextReviewAt, notificationType: "deadline_review", taskRevision: 3, attemptCount: 0, nextAttemptAt: now, createdAt: now }];
  value.reminderMap = [{ reminderId: "old-reminder", taskId: "task-1", taskRevision: 3, createdAt: now }];
  return value;
}

describe("local backup", () => {
  it("F-017 round-trips user data while excluding push credentials and notification delivery state", async () => {
    const original = snapshot();
    const backup = await createBackup(original);
    const parsed = JSON.parse(backup) as Record<string, unknown>;

    expect(backup).not.toContain("secret");
    expect(backup).not.toContain("server-device");
    expect(parsed).not.toHaveProperty("device");
    expect(backup).not.toContain("old-outbox");
    expect(backup).not.toContain("old-reminder");

    const restored = await restoreBackup({ current: createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "new-local", timeZone: "Asia/Tokyo", now }), serialized: backup, now, idFactory: (kind) => `new-${kind}` });
    expect(restored.captures).toEqual(original.captures);
    expect(restored.tasks).toEqual(original.tasks);
    expect(restored.reviewSessions).toEqual(original.reviewSessions);
    expect(restored.actionHistory).toEqual([...original.actionHistory, expect.objectContaining({ action: "backup_restored" })]);
    expect(restored.settings).toEqual(original.settings);
    expect(restored.device.localDeviceId).toBe("new-local");
    expect(restored.notificationOutbox).toEqual([expect.objectContaining({ id: "new-outbox", reminderId: "new-reminder", taskRevision: 3 })]);
    expect(restored.reminderMap).toEqual([expect.objectContaining({ reminderId: "new-reminder", taskId: "task-1" })]);
  });

  it("F-018 rejects an altered backup before a replacement can happen", async () => {
    const original = snapshot();
    const backup = await createBackup(original);
    const corrupted = backup.replace("牛乳を買う", "卵を買う");

    await expect(inspectBackup(corrupted)).rejects.toThrow("checksum");
    await expect(restoreBackup({ current: original, serialized: corrupted, now })).rejects.toThrow("checksum");
    expect(original).toEqual(snapshot());
  });

  it("F-018 rejects unknown formats and broken entity references before showing counts", async () => {
    const backup = await createBackup(snapshot());
    await expect(inspectBackup(backup.replace("atoqueue-backup", "unknown"))).rejects.toThrow("format");

    const document = JSON.parse(backup) as { data: { tasks: Array<{ sourceCaptureId: string }> } };
    document.data.tasks[0]!.sourceCaptureId = "missing-capture";
    const invalidReferences = JSON.stringify(document);
    await expect(inspectBackup(invalidReferences)).rejects.toThrow("checksum");
  });
});
