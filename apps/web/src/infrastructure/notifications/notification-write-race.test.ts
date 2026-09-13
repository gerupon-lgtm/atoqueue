import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCapture,
  modifyTask,
  PersistenceError,
} from "../../../../../packages/domain/src";
import { createReviewCalendar } from "../review-calendar/review-calendar";
import { makeTempalistFixture } from "../../../../../packages/domain/src/tempalist-test-fixture";
import { LocalStorageRepository } from "../local-storage/local-storage-repository";
import type { SnapshotWriteLock } from "../local-storage/snapshot-write-lock";
import { flushOutbox } from "./outbox-sync";
import { NotificationApiError } from "./notification-api";
import { reconcileMissingNotifications } from "./outbox-bootstrap";
import { enableNotifications } from "./push-subscription";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class DelayedLock implements SnapshotWriteLock {
  pending: Array<() => void> = [];
  run<T>(operation: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      this.pending.push(() => {
        try {
          resolve(operation());
        } catch (error) {
          reject(error);
        }
      });
    });
  }
  release() {
    this.pending.shift()!();
  }
}

function setup() {
  const input = makeTempalistFixture();
  input.snapshot.device.pushDeviceId = "registered-device";
  input.snapshot.device.pushDeviceSecret = "device-secret";
  input.snapshot.device.pushSubscriptionStatus = "granted";
  input.snapshot.settings.notificationEnabled = true;
  input.snapshot.notificationOutbox = [
    {
      id: "in-flight",
      operation: "upsert",
      reminderId: "reminder",
      scheduledAt: input.now,
      notificationType: "task_review",
      taskRevision: 1,
      attemptCount: 0,
      nextAttemptAt: input.now,
      createdAt: input.now,
    },
  ];
  input.snapshot.reminderMap = [
    {
      reminderId: "reminder",
      taskId: "task-0",
      taskRevision: 1,
      kind: "review",
      createdAt: input.now,
    },
  ];
  localStorage.setItem("atoqueue:data:v1", JSON.stringify(input.snapshot));
  const lock = new DelayedLock();
  const repository = new LocalStorageRepository(localStorage, {
    writeLock: lock,
    now: () => input.now,
  });
  return { ...input, lock, repository };
}

beforeEach(() => localStorage.clear());

describe("F-003 notification completion while ordinary saves await Web Locks", () => {
  it.each(["capture", "task"] as const)(
    "keeps a successfully committed %s when the API completion queues behind its save",
    async (kind) => {
      const { repository, lock, now } = setup();
      const started = deferred();
      const response = deferred();
      const flushing = flushOutbox({
        repository,
        now: () => now,
        api: {
          upsert: async () => {
            started.resolve();
            await response.promise;
          },
          cancel: async () => {},
        },
      });
      await started.promise;
      const original = await repository.load();
      const next =
        kind === "capture"
          ? createCapture(original, "保存を失わない", now, "new-capture")
          : modifyTask({
              snapshot: original,
              taskId: "task-0",
              change: { type: "edit", title: "保存したタスク" },
              now,
              calendar: createReviewCalendar("Asia/Tokyo"),
            });
      const saving = repository.save(next);
      response.resolve();
      await vi.waitFor(() => expect(lock.pending).toHaveLength(2));
      lock.release();
      await saving;
      lock.release();
      await flushing;
      const saved = await repository.load();
      expect(saved.captures).toEqual(next.captures);
      expect(saved.tasks).toEqual(next.tasks);
      expect(saved.actionHistory).toEqual(next.actionHistory);
      expect(
        saved.notificationOutbox.some((item) => item.id === "in-flight"),
      ).toBe(false);
    },
  );

  it.each(["delivered", "retry", "registration"] as const)(
    "rejects an ordinary save queued after %s response instead of reviving obsolete notification state",
    async (outcome) => {
      const { repository, lock, now } = setup();
      const started = deferred();
      const response = deferred();
      const flushing = flushOutbox({
        repository,
        now: () => now,
        api: {
          upsert: async () => {
            started.resolve();
            await response.promise;
            if (outcome === "retry") throw new Error("offline");
            if (outcome === "registration")
              throw new NotificationApiError(
                401,
                undefined,
                "DEVICE_NOT_FOUND",
              );
          },
          cancel: async () => {},
        },
      });
      await started.promise;
      const next = createCapture(
        await repository.load(),
        "再試行する入力",
        now,
        "new-capture",
      );
      response.resolve();
      await vi.waitFor(() => expect(lock.pending).toHaveLength(1));
      const saving = repository.save(next);
      const rejected = expect(saving).rejects.toThrow(PersistenceError);
      lock.release();
      await flushing;
      const committed = localStorage.getItem("atoqueue:data:v1");
      lock.release();
      await rejected;
      expect(localStorage.getItem("atoqueue:data:v1")).toBe(committed);
      expect(next.captures.at(-1)!.body).toBe("再試行する入力");
    },
  );

  it.each(["bootstrap", "registration", "denied"] as const)(
    "applies %s background updates to the task state committed ahead of its lock",
    async (operation) => {
      const { repository, lock, now } = setup();
      const next = createCapture(
        await repository.load(),
        "裏側の更新で消さない",
        now,
        "new-capture",
      );
      const saving = repository.save(next);
      const updating =
        operation === "bootstrap"
          ? reconcileMissingNotifications({ repository, now: () => now })
          : enableNotifications({
              repository,
              now: () => now,
              browser: {
                isAvailable: () => true,
                requestPermission: async () =>
                  operation === "denied" ? "denied" : "granted",
                subscribe: async () => ({
                  endpoint: "https://push.example",
                  expirationTime: null,
                  keys: { p256dh: "key", auth: "auth" },
                }),
              },
              api: {
                publicKey: async () => "key",
                register: async () => ({
                  deviceId: "new-device",
                  deviceSecret: "secret",
                  createdAt: now,
                }),
                updateSubscription: async () => {},
              },
            });
      await vi.waitFor(() => expect(lock.pending).toHaveLength(2));
      lock.release();
      await saving;
      lock.release();
      await updating;
      expect((await repository.load()).captures).toEqual(next.captures);
      expect((await repository.load()).tasks).toEqual(next.tasks);
    },
  );

  it("allows a metadata-only commit including savedAt changes while an ordinary save waits", async () => {
    const { repository, lock, snapshot, now, requestId } = setup();
    snapshot.savedAt = "2026-09-10T00:00:00.000Z";
    localStorage.setItem("atoqueue:data:v1", JSON.stringify(snapshot));
    const marker = { taskId: "task-0", requestId, lastOpenedAt: now };
    const marking = repository.updateTempalist((latest) => ({
      ...latest.tempalist,
      markers: [marker],
    }));
    const saving = repository.save(
      createCapture(
        await repository.load(),
        "連携履歴と両立",
        now,
        "new-capture",
      ),
    );
    lock.release();
    await marking;
    lock.release();
    await saving;
    expect((await repository.load()).tempalist.markers).toEqual([marker]);
    expect((await repository.load()).captures.at(-1)!.id).toBe("new-capture");
  });

  it("allows explicit restore to replace state while suppressing rejected-save success events", async () => {
    const { repository, lock, snapshot } = setup();
    const notify = vi.fn();
    const unsubscribe = repository.subscribe(notify);
    const background = repository.updateSnapshot((latest) => ({
      ...latest,
      notificationOutbox: [],
    }));
    const ordinary = repository.save(snapshot);
    const rejected = expect(ordinary).rejects.toThrow(/もう一度保存/);
    const restoring = repository.save(snapshot, { replaceTempalist: true });
    lock.release();
    await background;
    expect(notify).toHaveBeenCalledTimes(1);
    lock.release();
    await rejected;
    expect(notify).toHaveBeenCalledTimes(1);
    lock.release();
    await restoring;
    expect((await repository.load()).notificationOutbox).toEqual(
      snapshot.notificationOutbox,
    );
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
