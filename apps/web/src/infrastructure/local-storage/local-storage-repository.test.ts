// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRepository, AppSnapshot } from "../../../../../packages/domain/src/index";
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

    it("returns an empty version 1 snapshot when storage is missing", async () => {
      const snapshot = await createRepository().load();

      expect(snapshot).toMatchObject({
        schemaVersion: 1,
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

      expect(window.localStorage.getItem("atoqueue:corrupt:2026-08-03T00:00:00.000Z")).toBe(
        "{not-json",
      );
    });

    it("rejects a future schema version without overwriting it", async () => {
      const stored = JSON.stringify({ schemaVersion: 2 });
      window.localStorage.setItem(DATA_KEY, stored);

      await expect(createRepository().load()).rejects.toBeInstanceOf(
        UnsupportedSchemaVersionError,
      );

      expect(window.localStorage.getItem(DATA_KEY)).toBe(stored);
    });
  });
}

repositoryContract("localStorage repository", () =>
  new LocalStorageRepository(window.localStorage),
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
});

function sampleSnapshot(): AppSnapshot {
  return {
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
  };
}
