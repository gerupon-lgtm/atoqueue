// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AppRepository,
  AppSnapshot,
} from "../../../../../packages/domain/src/index";
import {
  CorruptDataError,
  PersistenceError,
  UnsupportedSchemaVersionError,
} from "../../../../../packages/domain/src/index";
import { LocalStorageRepository } from "./local-storage-repository";

const DATA_KEY = "atoqueue:data:v1";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-03T00:00:00.000Z"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function repositoryContract(
  _name: string,
  createRepository: () => AppRepository,
): void {
  describe(_name, () => {
    afterEach(() => window.localStorage.clear());

    it("returns an empty version 7 snapshot when storage is missing", async () => {
      const snapshot = await createRepository().load();

      expect(snapshot).toMatchObject({
        schemaVersion: 7,
        captures: [],
        tasks: [],
        actionHistory: [],
      });
    });

    it("preserves Unicode task text and action history after save and load", async () => {
      const repository = createRepository();
      const snapshot = sampleSnapshot();
      snapshot.tasks.push({
        id: "task-1",
        sourceCaptureId: "capture-1",
        title: "牛乳を買う 🥛",
        status: "active",
        dueMode: "unset",
        nextReviewAt: "2026-08-04T00:00:00.000Z",
        undecidedCount: 0,
        dismissCount: 0,
        postponeCount: 0,
        createdAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
        revision: 1,
      });
      snapshot.actionHistory.push({
        id: "event-1",
        entityType: "task",
        entityId: "task-1",
        action: "task_created",
        after: { title: "牛乳を買う 🥛" },
        occurredAt: "2026-08-03T00:00:00.000Z",
      });

      await repository.save(snapshot);

      await expect(repository.load()).resolves.toEqual(snapshot);
    });

    it("writes the snapshot key exactly once per save", async () => {
      const setItem = vi.spyOn(Storage.prototype, "setItem");

      await createRepository().save(sampleSnapshot());

      expect(setItem).toHaveBeenCalledTimes(1);
      expect(setItem).toHaveBeenCalledWith(DATA_KEY, expect.any(String));
    });

    it("backs up malformed JSON before it raises CorruptDataError", async () => {
      window.localStorage.setItem(DATA_KEY, "{not-json");

      await expect(createRepository().load()).rejects.toBeInstanceOf(
        CorruptDataError,
      );

      expect(
        window.localStorage.getItem(
          "atoqueue:corrupt:2026-08-03T00:00:00.000Z",
        ),
      ).toBe("{not-json");
    });

    it("rejects a future schema version without overwriting it", async () => {
      const stored = JSON.stringify({ schemaVersion: 8 });
      window.localStorage.setItem(DATA_KEY, stored);

      await expect(createRepository().load()).rejects.toBeInstanceOf(
        UnsupportedSchemaVersionError,
      );

      expect(window.localStorage.getItem(DATA_KEY)).toBe(stored);
    });
  });
}

repositoryContract(
  "localStorage repository",
  () => new LocalStorageRepository(window.localStorage),
);

describe("LocalStorageRepository persistence failures", () => {
  afterEach(() => window.localStorage.clear());

  it("keeps the existing snapshot when a quota write failure occurs", async () => {
    const existing = JSON.stringify(sampleSnapshot());
    window.localStorage.setItem(DATA_KEY, existing);
    const repository = new LocalStorageRepository(window.localStorage);
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      });

    await expect(repository.save(sampleSnapshot())).rejects.toBeInstanceOf(
      PersistenceError,
    );

    setItem.mockRestore();
    expect(window.localStorage.getItem(DATA_KEY)).toBe(existing);
  });

  it("backs up and preserves malformed existing data when save is attempted", async () => {
    const existing = "{not-json";
    window.localStorage.setItem(DATA_KEY, existing);

    await expect(
      new LocalStorageRepository(window.localStorage).save(sampleSnapshot()),
    ).rejects.toBeInstanceOf(CorruptDataError);

    expect(window.localStorage.getItem(DATA_KEY)).toBe(existing);
    expect(
      window.localStorage.getItem("atoqueue:corrupt:2026-08-03T00:00:00.000Z"),
    ).toBe(existing);
  });

  it("preserves an unknown existing schema version when save is attempted", async () => {
    const existing = JSON.stringify({ schemaVersion: 8 });
    window.localStorage.setItem(DATA_KEY, existing);

    await expect(
      new LocalStorageRepository(window.localStorage).save(sampleSnapshot()),
    ).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);

    expect(window.localStorage.getItem(DATA_KEY)).toBe(existing);
  });

  it("does not re-persist derived or unknown fields from stored snapshots", async () => {
    const storedSnapshot = {
      ...sampleSnapshot(),
      overdue: true,
      unrecognizedRootValue: "remove me",
      tasks: [
        {
          id: "task-1",
          sourceCaptureId: "capture-1",
          title: "買い物",
          status: "active",
          dueMode: "scheduled",
          dueAt: "2026-08-02T00:00:00.000Z",
          nextReviewAt: "2026-08-03T00:00:00.000Z",
          undecidedCount: 0,
          dismissCount: 0,
          postponeCount: 0,
          createdAt: "2026-08-01T00:00:00.000Z",
          updatedAt: "2026-08-01T00:00:00.000Z",
          revision: 1,
          neglectLevel: 3,
          unrecognizedTaskValue: "remove me",
        },
      ],
    };
    window.localStorage.setItem(DATA_KEY, JSON.stringify(storedSnapshot));
    const repository = new LocalStorageRepository(window.localStorage);

    await repository.save(await repository.load());

    const persisted = JSON.parse(
      window.localStorage.getItem(DATA_KEY) ?? "",
    ) as {
      overdue?: unknown;
      unrecognizedRootValue?: unknown;
      tasks: Array<{ neglectLevel?: unknown; unrecognizedTaskValue?: unknown }>;
    };
    expect(persisted.overdue).toBeUndefined();
    expect(persisted.unrecognizedRootValue).toBeUndefined();
    expect(persisted.tasks[0]?.neglectLevel).toBeUndefined();
    expect(persisted.tasks[0]?.unrecognizedTaskValue).toBeUndefined();
  });

  it("removes derived values from action history while preserving valid metadata", async () => {
    const storedSnapshot = {
      ...sampleSnapshot(),
      actionHistory: [
        {
          id: "event-1",
          entityType: "task",
          entityId: "task-1",
          action: "task_edited",
          before: { overdue: true, title: "変更前" },
          after: { neglectLevel: 3, title: "変更後" },
          occurredAt: "2026-08-03T00:00:00.000Z",
        },
      ],
    };
    window.localStorage.setItem(DATA_KEY, JSON.stringify(storedSnapshot));
    const repository = new LocalStorageRepository(window.localStorage);

    await repository.save(await repository.load());

    const persisted = JSON.parse(
      window.localStorage.getItem(DATA_KEY) ?? "",
    ) as {
      actionHistory: Array<{
        before?: { overdue?: unknown; title?: unknown };
        after?: { neglectLevel?: unknown; title?: unknown };
      }>;
    };
    expect(persisted.actionHistory[0]?.before?.overdue).toBeUndefined();
    expect(persisted.actionHistory[0]?.after?.neglectLevel).toBeUndefined();
    expect(persisted.actionHistory[0]?.before?.title).toBe("変更前");
    expect(persisted.actionHistory[0]?.after?.title).toBe("変更後");
  });

  it("removes only this application's snapshot and draft keys when device data is cleared", async () => {
    window.localStorage.setItem(DATA_KEY, JSON.stringify(sampleSnapshot()));
    window.localStorage.setItem("atoqueue:draft:v1", "private draft");
    window.localStorage.setItem("another-app", "keep");

    await new LocalStorageRepository(window.localStorage).clearAppData();

    expect(window.localStorage.getItem(DATA_KEY)).toBeNull();
    expect(window.localStorage.getItem("atoqueue:draft:v1")).toBeNull();
    expect(window.localStorage.getItem("another-app")).toBe("keep");
  });
});

function sampleSnapshot(): AppSnapshot {
  return {
    schemaVersion: 7,
    appVersion: "0.1.0",
    device: {
      localDeviceId: "device-1",
      pushSubscriptionStatus: "not_requested",
    },
    settings: {
      locale: "ja-JP",
      timeZone: "Asia/Tokyo",
      notificationEnabled: false,
      initialReminderDelayMinutes: 60,
      deadlineReminderLeadMinutes: 60,
      defaultDeadlineTime: "23:59",
      weeklyReviewDay: 0,
      inboxReminderFrequency: "none",
      memoReviewFrequency: "none",
      enterSavesCapture: true,
    },
    captures: [],
    tasks: [],
    reviewSessions: [],
    actionHistory: [],
    notificationOutbox: [],
    reminderMap: [],
    savedAt: "2026-08-03T00:00:00.000Z",
  };
}
