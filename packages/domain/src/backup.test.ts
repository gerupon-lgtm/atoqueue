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
    const backup = await createBackup(original, "2026-08-04T10:00:00.000Z");
    const parsed = JSON.parse(backup) as Record<string, unknown>;

    expect(parsed).toMatchObject({
      format: "atoqueue-backup",
      version: 1,
      exportedAt: "2026-08-04T10:00:00.000Z",
      appVersion: "0.1.0",
    });
    expect(parsed).toHaveProperty("payload");
    expect(parsed).not.toHaveProperty("data");
    expect(parsed).toHaveProperty("payload.device", { localDeviceId: "local-device" });
    expect(backup).not.toContain("secret");
    expect(backup).not.toContain("server-device");
    expect(parsed).not.toHaveProperty("device");
    expect(backup).not.toContain("pushDeviceId");
    expect(backup).not.toContain("pushDeviceSecret");
    expect(backup).not.toContain("pushSubscriptionStatus");
    expect(backup).not.toContain("old-outbox");
    expect(backup).not.toContain("old-reminder");

    const current = snapshot();
    current.device.localDeviceId = "destination-device";
    let id = 0;
    const restored = await restoreBackup({
      current,
      serialized: backup,
      now,
      idFactory: (kind) => `new-${kind}-${++id}`,
    });
    expect(restored.captures).toEqual(original.captures);
    expect(restored.tasks).toEqual(original.tasks);
    expect(restored.reviewSessions).toEqual(original.reviewSessions);
    expect(restored.actionHistory).toEqual([...original.actionHistory, expect.objectContaining({ action: "backup_restored" })]);
    expect(restored.settings).toEqual(original.settings);
    expect(restored.device.localDeviceId).toBe("destination-device");
    expect(restored.notificationOutbox).toEqual([
      expect.objectContaining({ id: "new-outbox-1", operation: "cancel", reminderId: "old-reminder", taskRevision: 3 }),
      expect.objectContaining({ id: "new-outbox-3", operation: "upsert", reminderId: "new-reminder-2", taskRevision: 3 }),
    ]);
    expect(JSON.stringify(restored.notificationOutbox)).not.toContain("task-1");
    expect(JSON.stringify(restored.notificationOutbox)).not.toContain("牛乳を買う");
    expect(restored.reminderMap).toEqual([expect.objectContaining({ reminderId: "new-reminder-2", taskId: "task-1" })]);
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

    const document = JSON.parse(backup) as { payload: { tasks: Array<{ sourceCaptureId: string }> } };
    document.payload.tasks[0]!.sourceCaptureId = "missing-capture";
    const invalidReferences = JSON.stringify(document);
    await expect(inspectBackup(invalidReferences)).rejects.toThrow("checksum");
  });

  it("F-018 rejects duplicate entity IDs before restoring a checksum-valid backup", async () => {
    const invalidCapture = snapshot();
    invalidCapture.captures.push({ ...invalidCapture.captures[0]! });
    const invalidTask = snapshot();
    invalidTask.tasks.push({ ...invalidTask.tasks[0]! });
    const invalidSession = snapshot();
    invalidSession.reviewSessions.push({ ...invalidSession.reviewSessions[0]! });

    for (const [invalid, message] of [
      [invalidCapture, "Duplicate capture ID"],
      [invalidTask, "Duplicate task ID"],
      [invalidSession, "Duplicate review session ID"],
    ] as const) {
      const backup = await createBackup(invalid);
      await expect(inspectBackup(backup)).rejects.toThrow(message);
      await expect(restoreBackup({ current: snapshot(), serialized: backup, now })).rejects.toThrow(message);
    }
  });

  it("F-018 rejects non-date timestamps before restoring a checksum-valid backup", async () => {
    const invalid = snapshot();
    invalid.tasks[0] = { ...invalid.tasks[0]!, nextReviewAt: "not-a-date" };
    const backup = await createBackup(invalid);

    await expect(inspectBackup(backup)).rejects.toThrow("Task next review time");
    await expect(restoreBackup({ current: snapshot(), serialized: backup, now })).rejects.toThrow("Task next review time");
  });

  it("F-017 rejects checksum-valid backups that violate capture and task invariants before mutation", async () => {
    const taskCaptureWithoutLink = snapshot();
    delete taskCaptureWithoutLink.captures[0]!.linkedTaskId;

    const duplicateTaskCapture = snapshot();
    duplicateTaskCapture.tasks.push({ ...duplicateTaskCapture.tasks[0]!, id: "task-2", title: "同じ入力からの重複タスク" });

    const blankCaptureBody = snapshot();
    blankCaptureBody.captures[0] = { ...blankCaptureBody.captures[0]!, body: "  \t " };

    for (const [invalid, message] of [
      [taskCaptureWithoutLink, "Task-classified capture must link to a task"],
      [duplicateTaskCapture, "Task source capture ID must be unique"],
      [blankCaptureBody, "Capture body must contain 1 to 280 characters"],
    ] as const) {
      const backup = await createBackup(invalid);
      const current = snapshot();

      await expect(inspectBackup(backup)).rejects.toThrow(message);
      await expect(restoreBackup({ current, serialized: backup, now })).rejects.toThrow(message);
      expect(current).toEqual(snapshot());
    }
  });
});
