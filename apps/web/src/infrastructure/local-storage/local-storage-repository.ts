import {
  CorruptDataError,
  createEmptySnapshot,
  migrateSnapshot,
  validateTempalistState,
  PersistenceError,
  UnsupportedSchemaVersionError,
  type AppRepository,
  type AppSnapshot,
  type TempalistState,
} from "../../../../../packages/domain/src/index";
import { APP_VERSION } from "../../app-version";
import type { TempalistRepository } from "../../application/tempalist-repository";
import {
  BrowserSnapshotWriteLock,
  type SnapshotWriteLock,
} from "./snapshot-write-lock";

const DATA_KEY = "atoqueue:data:v1";
const DRAFT_KEY = "atoqueue:draft:v1";

export interface LocalStorageRepositoryOptions {
  appVersion?: string;
  localDeviceId?: string;
  now?: () => string;
  timeZone?: string;
  writeLock?: SnapshotWriteLock;
}

export class LocalStorageRepository
  implements AppRepository, TempalistRepository
{
  private readonly listeners = new Set<() => void>();
  private readonly appVersion: string;
  private readonly localDeviceId: string;
  private readonly now: () => string;
  private readonly timeZone: string;
  private readonly writeLock: SnapshotWriteLock;
  private readonly hasInjectedLock: boolean;

  constructor(
    private readonly storage: Storage,
    options: LocalStorageRepositoryOptions = {},
  ) {
    this.appVersion = options.appVersion ?? APP_VERSION;
    this.localDeviceId = options.localDeviceId ?? createDeviceId();
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeZone =
      options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.writeLock = options.writeLock ?? new BrowserSnapshotWriteLock();
    this.hasInjectedLock = options.writeLock !== undefined;
  }

  async load(): Promise<AppSnapshot> {
    return this.readCurrentSnapshot();
  }

  private readCurrentSnapshot(): AppSnapshot {
    const stored = this.storage.getItem(DATA_KEY);
    if (stored === null) {
      return createEmptySnapshot({
        appVersion: this.appVersion,
        localDeviceId: this.localDeviceId,
        timeZone: this.timeZone,
        now: this.now(),
      });
    }

    return this.parseStoredSnapshot(stored);
  }

  isNotificationSetupHandledAtStartup(): boolean {
    try {
      const stored = this.storage.getItem(DATA_KEY);
      if (stored === null) return false;
      return (
        this.parseStoredSnapshot(stored).device.pushSubscriptionStatus !==
        "not_requested"
      );
    } catch {
      return false;
    }
  }

  async save(
    next: AppSnapshot,
    options?: { replaceTempalist?: boolean },
  ): Promise<void> {
    await this.runSnapshotWrite(() => {
      const latest = this.readCurrentSnapshot();
      const tempalist = options?.replaceTempalist
        ? next.tempalist
        : latest.tempalist;
      const taskIds = new Set(next.tasks.map((task) => task.id));
      this.writeValidatedSnapshot({
        ...next,
        tempalist: {
          ...tempalist,
          markers: tempalist.markers.filter((marker) =>
            taskIds.has(marker.taskId),
          ),
        },
      });
    });
  }

  async updateTempalist(
    update: (latest: AppSnapshot) => TempalistState,
  ): Promise<TempalistState> {
    return this.runSnapshotWrite(() => {
      const latest = this.readCurrentSnapshot();
      const tempalist = validateTempalistState(update(structuredClone(latest)));
      const taskIds = new Set(latest.tasks.map((task) => task.id));
      if (tempalist.markers.some((marker) => !taskIds.has(marker.taskId))) {
        throw new CorruptDataError(
          "Tempalist marker references an unknown task.",
        );
      }
      this.writeValidatedSnapshot({
        ...latest,
        tempalist,
        savedAt: this.now(),
      });
      return structuredClone(tempalist);
    }, true);
  }

  private writeValidatedSnapshot(next: AppSnapshot): void {
    const serialized = JSON.stringify(migrateSnapshot(next));
    this.storage.setItem(DATA_KEY, serialized);
  }

  private async runSnapshotWrite<T>(
    operation: () => T,
    requireLock = false,
  ): Promise<T> {
    try {
      const commit = () => {
        const result = operation();
        this.notifyCommittedChange();
        return result;
      };
      // Legacy task saves remain available when cross-tab exclusion is unsupported.
      if (!requireLock && !this.hasInjectedLock && !globalThis.navigator?.locks)
        return commit();
      return await this.writeLock.run(commit);
    } catch (error) {
      if (
        error instanceof CorruptDataError ||
        error instanceof UnsupportedSchemaVersionError ||
        error instanceof PersistenceError
      )
        throw error;
      throw new PersistenceError("Unable to persist application data.", {
        cause: error,
      });
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === this.storage &&
        (event.key === DATA_KEY || event.key === null)
      )
        listener();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      this.listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  private notifyCommittedChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A display observer cannot turn an already committed write into a save failure.
      }
    }
  }

  async loadDraft(): Promise<string> {
    return this.storage.getItem(DRAFT_KEY) ?? "";
  }

  async saveDraft(value: string): Promise<void> {
    try {
      this.storage.setItem(DRAFT_KEY, value);
    } catch (error) {
      throw new PersistenceError("Unable to persist draft data.", {
        cause: error,
      });
    }
  }

  async clearDraft(): Promise<void> {
    try {
      this.storage.removeItem(DRAFT_KEY);
    } catch (error) {
      throw new PersistenceError("Unable to clear draft data.", {
        cause: error,
      });
    }
  }

  /** Removes every key owned by this application; unrelated site storage survives. */
  async clearAppData(): Promise<void> {
    await this.runSnapshotWrite(() => {
      this.storage.removeItem(DATA_KEY);
      this.storage.removeItem(DRAFT_KEY);
    });
  }

  private backUpCorruptValue(value: string): void {
    try {
      this.storage.setItem(`atoqueue:corrupt:${this.now()}`, value);
    } catch {
      // The original data remains untouched even when its backup cannot be written.
    }
  }

  private parseStoredSnapshot(value: string): AppSnapshot {
    try {
      return migrateSnapshot(JSON.parse(value));
    } catch (error) {
      if (error instanceof CorruptDataError || error instanceof SyntaxError) {
        this.backUpCorruptValue(value);
        throw new CorruptDataError("Stored application data is corrupt.");
      }
      throw error;
    }
  }
}

function createDeviceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`;
}
