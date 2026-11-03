import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CorruptDataError,
  PersistenceError,
  UnsupportedSchemaVersionError,
} from "../../../../../packages/domain/src";
import { makeTempalistFixture } from "../../../../../packages/domain/src/tempalist-test-fixture";
import { prepareTempalistRequest } from "../../../../../packages/domain/src/tempalist-transfer";
import { LocalStorageRepository } from "./local-storage-repository";
import type { SnapshotWriteLock } from "./snapshot-write-lock";

const key = "atoqueue:data:v1";
function setup() {
  const input = makeTempalistFixture();
  let tail = Promise.resolve();
  const writeLock: SnapshotWriteLock = {
    run<T>(operation: () => T): Promise<T> {
      const result = tail.then(operation);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const options = { writeLock, now: () => input.now };
  const repository = new LocalStorageRepository(localStorage, options);
  const other = new LocalStorageRepository(localStorage, options);
  const marker = {
    taskId: input.snapshot.tasks[0]!.id,
    requestId: input.requestId,
    lastOpenedAt: input.now,
  };
  return { ...input, repository, other, marker };
}
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("F-003/F-020 locked namespace persistence", () => {
  it("preserves the latest metadata when another tab saves a stale snapshot", async () => {
    const { snapshot, repository, other, marker } = setup();
    await repository.save(snapshot);
    const stale = await other.load();
    await repository.updateTempalist((latest) => ({
      ...latest.tempalist,
      markers: [marker],
    }));
    await other.save(stale);
    expect((await repository.load()).tempalist.markers).toEqual([marker]);
  });
  it("reads latest task edits in the lock and only writes the metadata namespace", async () => {
    const { snapshot, repository, other, marker } = setup();
    await repository.save(snapshot);
    const edited = await other.load();
    edited.tasks[0]!.title = "新しいタイトル";
    edited.tasks[0]!.revision++;
    await other.save(edited);
    await repository.updateTempalist((latest) => {
      expect(latest.tasks[0]!.title).toBe("新しいタイトル");
      latest.tasks = []; // the updater cannot mutate the stored task namespace
      return { ...latest.tempalist, markers: [marker] };
    });
    expect(await repository.load()).toEqual({
      ...edited,
      tempalist: { lastRequest: null, markers: [marker] },
    });
  });
  it("serializes cross-tab updates and returns detached state", async () => {
    const { snapshot, repository, other, marker } = setup();
    await repository.save(snapshot);
    const results = await Promise.all([
      repository.updateTempalist((latest) => ({
        ...latest.tempalist,
        markers: [...latest.tempalist.markers, marker],
      })),
      other.updateTempalist((latest) => ({
        ...latest.tempalist,
        markers: [...latest.tempalist.markers, { ...marker, taskId: "task-1" }],
      })),
    ]);
    results[1]!.markers.length = 0;
    expect((await repository.load()).tempalist.markers).toHaveLength(2);
  });
  it("merges metadata inside the lock even when a stale ordinary save is already queued", async () => {
    const { snapshot, repository, other, marker } = setup();
    await repository.save(snapshot);
    const stale = await other.load();
    await Promise.all([
      repository.updateTempalist((latest) => ({
        ...latest.tempalist,
        markers: [marker],
      })),
      other.save(stale),
    ]);
    expect((await repository.load()).tempalist.markers).toEqual([marker]);
  });
  it("prunes deleted task markers while keeping the exact prepared retry request", async () => {
    const input = setup();
    await input.repository.save(input.snapshot);
    const request = prepareTempalistRequest(input);
    await input.repository.updateTempalist(() => ({
      lastRequest: request,
      markers: [input.marker],
    }));
    const next = await input.repository.load();
    next.tasks.shift();
    await input.repository.save(next);
    expect((await input.repository.load()).tempalist).toEqual({
      lastRequest: request,
      markers: [],
    });
  });
  it("only explicit restore replaces metadata and stale saves cannot revive pre-restore state", async () => {
    const { snapshot, repository, other, marker } = setup();
    await repository.save(snapshot);
    await repository.updateTempalist((latest) => ({
      ...latest.tempalist,
      markers: [marker],
    }));
    const stale = await other.load();
    await repository.save(snapshot, { replaceTempalist: true });
    await other.save(stale);
    expect((await repository.load()).tempalist).toEqual({
      lastRequest: null,
      markers: [],
    });
  });
  it("clears under the same lock and stale task saves cannot revive cleared metadata", async () => {
    const { snapshot, repository, other, marker } = setup();
    await repository.save(snapshot);
    await repository.updateTempalist((latest) => ({
      ...latest.tempalist,
      markers: [marker],
    }));
    const stale = await other.load();
    await repository.saveDraft("下書き");
    await repository.clearAppData();
    expect((await repository.load()).tempalist.markers).toEqual([]);
    expect(await repository.loadDraft()).toBe("");
    await other.save(stale);
    expect((await repository.load()).tempalist.markers).toEqual([]);
  });
  it("keeps the original and emits no committed event on quota failure", async () => {
    const { snapshot, repository, marker } = setup();
    await repository.save(snapshot);
    const original = localStorage.getItem(key);
    const notify = vi.fn();
    const unsubscribe = repository.subscribe(notify);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await expect(
      repository.updateTempalist((latest) => ({
        ...latest.tempalist,
        markers: [marker],
      })),
    ).rejects.toBeInstanceOf(PersistenceError);
    expect(localStorage.getItem(key)).toBe(original);
    expect(notify).not.toHaveBeenCalled();
    unsubscribe();
  });
  it.each(["corrupt", "future", "missing-namespace"])(
    "does not overwrite %s current data",
    async (reason) => {
      const { snapshot, repository } = setup();
      const original =
        reason === "corrupt"
          ? "bad-json"
          : reason === "future"
            ? JSON.stringify({ schemaVersion: 99 })
            : JSON.stringify({ ...snapshot, tempalist: undefined });
      localStorage.setItem(key, original);
      const error =
        reason === "future" ? UnsupportedSchemaVersionError : CorruptDataError;
      await expect(repository.save(snapshot)).rejects.toBeInstanceOf(error);
      await expect(
        repository.updateTempalist((latest) => latest.tempalist),
      ).rejects.toBeInstanceOf(error);
      expect(localStorage.getItem(key)).toBe(original);
    },
  );
  it("rejects invalid next metadata without replacing valid data", async () => {
    const { snapshot, repository, marker } = setup();
    await repository.save(snapshot);
    const original = localStorage.getItem(key);
    await expect(
      repository.updateTempalist(() => ({
        lastRequest: null,
        markers: [{ ...marker, lastOpenedAt: "bad" }],
      })),
    ).rejects.toThrow();
    expect(localStorage.getItem(key)).toBe(original);
  });
  it("fails handoff explicitly without Web Locks but leaves ordinary task saves working", async () => {
    vi.stubGlobal("navigator", {});
    const { snapshot } = makeTempalistFixture();
    const repository = new LocalStorageRepository(localStorage);
    await expect(repository.save(snapshot)).resolves.toBeUndefined();
    await expect(
      repository.updateTempalist((latest) => latest.tempalist),
    ).rejects.toThrow(/ロック|lock/i);
  });
  it("uses one origin-wide Web Lock name for saves, metadata, restore and deletion", async () => {
    const request = vi.fn(async (_name: string, operation: () => unknown) =>
      operation(),
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const { snapshot } = makeTempalistFixture();
    const repository = new LocalStorageRepository(localStorage);
    await repository.save(snapshot);
    await repository.updateTempalist((latest) => latest.tempalist);
    await repository.updateSnapshot((latest) => latest);
    await repository.save(snapshot, { replaceTempalist: true });
    await repository.clearAppData();
    expect(request.mock.calls.map((call) => call[0])).toEqual(
      Array(5).fill("atoqueue:snapshot-write"),
    );
  });
});
