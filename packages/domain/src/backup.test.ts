import { describe, expect, it } from "vitest";
import {
  createBackup,
  createEmptySnapshot,
  inspectBackup,
  restoreBackup,
  type AppSnapshot,
} from "./index";

const now = "2026-08-04T09:00:00.000Z";
const captureId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const actionId = "33333333-3333-4333-8333-333333333333";
const reviewId = "44444444-4444-4444-8444-444444444444";
const localDeviceId = "55555555-5555-4555-8555-555555555555";

function snapshot(): AppSnapshot {
  const value = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId,
    timeZone: "Asia/Tokyo",
    now,
  });
  value.device.pushDeviceId = "server-device";
  value.device.pushDeviceSecret = "secret";
  value.device.registeredAt = now;
  value.device.pushSubscriptionStatus = "granted";
  value.settings.notificationEnabled = true;
  value.captures = [
    {
      id: captureId,
      body: "買い物",
      classification: "task",
      createdAt: now,
      updatedAt: now,
      classifiedAt: now,
      linkedTaskId: taskId,
    },
  ];
  value.tasks = [
    {
      id: taskId,
      sourceCaptureId: captureId,
      title: "牛乳を買う",
      status: "active",
      dueMode: "scheduled",
      dueAt: "2026-08-05T09:00:00.000Z",
      nextReviewAt: "2026-08-05T09:00:00.000Z",
      undecidedCount: 0,
      dismissCount: 0,
      postponeCount: 0,
      createdAt: now,
      updatedAt: now,
      revision: 3,
    },
  ];
  value.actionHistory = [
    {
      id: actionId,
      entityType: "task",
      entityId: taskId,
      action: "task_created",
      occurredAt: now,
    },
  ];
  value.reviewSessions = [
    {
      id: reviewId,
      localDate: "2026-08-04",
      orderedTaskIds: [taskId],
      currentIndex: 0,
      visitedTaskIds: [taskId],
      answeredTaskIds: [taskId],
      actionEventIds: [actionId],
      startedAt: now,
      updatedAt: now,
    },
  ];
  value.notificationOutbox = [
    {
      id: "old-outbox",
      operation: "upsert",
      reminderId: "old-reminder",
      scheduledAt: value.tasks[0]!.nextReviewAt,
      notificationType: "deadline_review",
      taskRevision: 3,
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
    },
  ];
  value.reminderMap = [
    { reminderId: "old-reminder", taskId, taskRevision: 3, createdAt: now },
  ];
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
    expect(parsed).toHaveProperty("payload.device", { localDeviceId });
    expect(backup).not.toContain("secret");
    expect(backup).not.toContain("server-device");
    expect(parsed).not.toHaveProperty("device");
    expect(backup).not.toContain("pushDeviceId");
    expect(backup).not.toContain("pushDeviceSecret");
    expect(backup).not.toContain("pushSubscriptionStatus");
    expect(backup).not.toContain("old-outbox");
    expect(backup).not.toContain("old-reminder");

    const current = snapshot();
    current.device.localDeviceId = "66666666-6666-4666-8666-666666666666";
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
    expect(restored.actionHistory).toEqual([
      ...original.actionHistory,
      expect.objectContaining({ action: "backup_restored" }),
    ]);
    expect(restored.settings).toEqual(original.settings);
    expect(restored.device.localDeviceId).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(restored.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "new-outbox-1",
          operation: "cancel",
          reminderId: "old-reminder",
          taskRevision: 3,
        }),
        expect.objectContaining({
          operation: "upsert",
          notificationType: "task_review",
          scheduledAt: "2026-08-04T10:00:00.000Z",
          taskRevision: 3,
        }),
        expect.objectContaining({
          operation: "upsert",
          notificationType: "deadline_review",
          scheduledAt: "2026-08-05T08:00:00.000Z",
          taskRevision: 3,
        }),
        expect.objectContaining({
          operation: "upsert",
          notificationType: "deadline_review",
          scheduledAt: "2026-08-05T09:00:00.000Z",
          taskRevision: 3,
        }),
      ]),
    );
    expect(restored.notificationOutbox).toHaveLength(4);
    expect(JSON.stringify(restored.notificationOutbox)).not.toContain(taskId);
    expect(JSON.stringify(restored.notificationOutbox)).not.toContain(
      "牛乳を買う",
    );
    expect(restored.reminderMap.map((entry) => entry.kind)).toEqual([
      "initial",
      "deadline_before",
      "review",
    ]);
  });

  it("F-018 rejects an altered backup before a replacement can happen", async () => {
    const original = snapshot();
    const backup = await createBackup(original);
    const corrupted = backup.replace("牛乳を買う", "卵を買う");

    await expect(inspectBackup(corrupted)).rejects.toThrow("checksum");
    await expect(
      restoreBackup({ current: original, serialized: corrupted, now }),
    ).rejects.toThrow("checksum");
    expect(original).toEqual(snapshot());
  });

  it("F-018 rejects unknown formats and broken entity references before showing counts", async () => {
    const backup = await createBackup(snapshot());
    await expect(
      inspectBackup(backup.replace("atoqueue-backup", "unknown")),
    ).rejects.toThrow("format");

    const document = JSON.parse(backup) as {
      payload: { tasks: Array<{ sourceCaptureId: string }> };
    };
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
    invalidSession.reviewSessions.push({
      ...invalidSession.reviewSessions[0]!,
    });

    for (const [invalid, message] of [
      [invalidCapture, "Duplicate capture ID"],
      [invalidTask, "Duplicate task ID"],
      [invalidSession, "Duplicate review session ID"],
    ] as const) {
      const backup = await createBackup(invalid);
      await expect(inspectBackup(backup)).rejects.toThrow(message);
      await expect(
        restoreBackup({ current: snapshot(), serialized: backup, now }),
      ).rejects.toThrow(message);
    }
  });

  it("F-018 rejects non-date timestamps before restoring a checksum-valid backup", async () => {
    const invalid = snapshot();
    invalid.tasks[0] = { ...invalid.tasks[0]!, nextReviewAt: "not-a-date" };
    const backup = await createBackup(invalid);

    await expect(inspectBackup(backup)).rejects.toThrow(
      "Task next review time",
    );
    await expect(
      restoreBackup({ current: snapshot(), serialized: backup, now }),
    ).rejects.toThrow("Task next review time");
  });

  it("F-017 rejects checksum-valid backups that violate capture and task invariants before mutation", async () => {
    const taskCaptureWithoutLink = snapshot();
    delete taskCaptureWithoutLink.captures[0]!.linkedTaskId;

    const duplicateTaskCapture = snapshot();
    duplicateTaskCapture.tasks.push({
      ...duplicateTaskCapture.tasks[0]!,
      id: "55555555-5555-4555-8555-555555555555",
      title: "同じ入力からの重複タスク",
    });

    const blankCaptureBody = snapshot();
    blankCaptureBody.captures[0] = {
      ...blankCaptureBody.captures[0]!,
      body: "  \t ",
    };

    for (const [invalid, message] of [
      [taskCaptureWithoutLink, "Task-classified capture must link to a task"],
      [duplicateTaskCapture, "Task source capture ID must be unique"],
      [blankCaptureBody, "Capture body must contain 1 to 280 characters"],
    ] as const) {
      const backup = await createBackup(invalid);
      const current = snapshot();

      await expect(inspectBackup(backup)).rejects.toThrow(message);
      await expect(
        restoreBackup({ current, serialized: backup, now }),
      ).rejects.toThrow(message);
      expect(current).toEqual(snapshot());
    }
  });

  it("F-017 rejects non-UUID entity IDs and references before preview or mutation", async () => {
    const invalidDeviceId = snapshot();
    invalidDeviceId.device.localDeviceId = "not-a-uuid";
    const invalidCaptureId = snapshot();
    invalidCaptureId.captures[0] = {
      ...invalidCaptureId.captures[0]!,
      id: "not-a-uuid",
    };
    const invalidTaskReference = snapshot();
    invalidTaskReference.tasks[0] = {
      ...invalidTaskReference.tasks[0]!,
      sourceCaptureId: "not-a-uuid",
    };

    for (const invalid of [
      invalidDeviceId,
      invalidCaptureId,
      invalidTaskReference,
    ]) {
      const backup = await createBackup(invalid);
      const current = snapshot();
      await expect(inspectBackup(backup)).rejects.toThrow("UUID");
      await expect(
        restoreBackup({ current, serialized: backup, now }),
      ).rejects.toThrow("UUID");
      expect(current).toEqual(snapshot());
    }
  });

  it("F-017 recomputes imported active task review schedules from the current local clock", async () => {
    const imported = snapshot();
    imported.settings.timeZone = "Asia/Tokyo";
    const staleTask = {
      ...imported.tasks[0]!,
      dueMode: "none" as const,
      nextReviewAt: "2026-01-01T09:00:00.000Z",
      dismissCount: 1,
    };
    delete staleTask.dueAt;
    imported.tasks[0] = staleTask;
    const backup = await createBackup(imported);

    const restored = await restoreBackup({
      current: snapshot(),
      serialized: backup,
      now,
    });
    expect(restored.tasks[0]?.nextReviewAt).toBe("2026-08-07T09:00:00.000Z");
    const reviewReminderId = restored.reminderMap.find(
      (entry) => entry.kind === "review",
    )?.reminderId;
    expect(
      restored.notificationOutbox.find(
        (item) =>
          item.operation === "upsert" && item.reminderId === reviewReminderId,
      )?.scheduledAt,
    ).toBe("2026-08-07T09:00:00.000Z");
    expect(
      restored.notificationOutbox.find((item) => item.operation === "upsert")
        ?.scheduledAt,
    ).not.toBe("2026-01-01T09:00:00.000Z");
  });

  it("F-017 rebuilds task, inbox, and memo reminder schedules on the destination device", async () => {
    const imported = snapshot();
    imported.settings.inboxReminderFrequency = "gentle";
    imported.settings.memoReviewFrequency = "weekly";
    imported.captures.push(
      {
        id: "77777777-7777-4777-8777-777777777777",
        body: "あとで整理する記録",
        classification: "unclassified",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "88888888-8888-4888-8888-888888888888",
        body: "残しておくメモ",
        classification: "note",
        createdAt: now,
        updatedAt: now,
        classifiedAt: now,
      },
    );
    const backup = await createBackup(imported);

    const restored = await restoreBackup({
      current: snapshot(),
      serialized: backup,
      now,
    });

    expect(
      restored.reminderMap.filter((entry) => entry.taskId === taskId),
    ).toHaveLength(3);
    expect(
      restored.reminderMap.filter((entry) => entry.scope === "inbox").length,
    ).toBeGreaterThan(0);
    expect(
      restored.reminderMap.filter((entry) => entry.scope === "memo").length,
    ).toBeGreaterThan(0);
    expect(restored.notificationOutbox).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "upsert",
          notificationType: "inbox_review",
        }),
      ]),
    );
  });

  it("F-018 replaces from the same backup repeatedly without duplicating user entities", async () => {
    const imported = snapshot();
    imported.settings.customTaskCategories = ["冷蔵庫"];
    const backup = await createBackup(imported);
    const first = await restoreBackup({
      current: snapshot(),
      serialized: backup,
      now,
    });

    const second = await restoreBackup({
      current: first,
      serialized: backup,
      now,
    });

    expect(second.captures).toEqual(imported.captures);
    expect(second.tasks).toEqual(imported.tasks);
    expect(second.reviewSessions).toEqual(imported.reviewSessions);
    expect(second.settings.customTaskCategories).toEqual(["冷蔵庫"]);
    expect(
      second.actionHistory.filter(
        (event) => event.action !== "backup_restored",
      ),
    ).toEqual(imported.actionHistory);
    expect(
      second.actionHistory.filter(
        (event) => event.action === "backup_restored",
      ),
    ).toHaveLength(1);
  });
});
