import {
  CorruptDataError,
  createEmptySnapshot,
  migrateSnapshot,
  PersistenceError,
  UnsupportedSchemaVersionError,
  type AppRepository,
  type AppSnapshot,
} from "../../../../../packages/domain/src/index";
import { APP_VERSION } from "../../app-version";

const DATA_KEY = "atoqueue:data:v1";
const DRAFT_KEY = "atoqueue:draft:v1";

export interface LocalStorageRepositoryOptions {
  appVersion?: string;
  localDeviceId?: string;
  now?: () => string;
  timeZone?: string;
}

export class LocalStorageRepository implements AppRepository {
  private readonly listeners = new Set<() => void>();
  private readonly appVersion: string;
  private readonly localDeviceId: string;
  private readonly now: () => string;
  private readonly timeZone: string;

  constructor(
    private readonly storage: Storage,
    options: LocalStorageRepositoryOptions = {},
  ) {
    this.appVersion = options.appVersion ?? APP_VERSION;
    this.localDeviceId = options.localDeviceId ?? createDeviceId();
    this.now = options.now ?? (() => new Date().toISOString());
    this.timeZone = options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  async load(): Promise<AppSnapshot> {
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

  async save(next: AppSnapshot): Promise<void> {
    try {
      const existing = this.storage.getItem(DATA_KEY);
      if (existing !== null) this.parseStoredSnapshot(existing);
      const serialized = JSON.stringify(migrateSnapshot(next));
      this.storage.setItem(DATA_KEY, serialized);
    } catch (error) {
      if (
        error instanceof CorruptDataError ||
        error instanceof UnsupportedSchemaVersionError
      ) {
        throw error;
      }
      throw new PersistenceError("Unable to persist application data.", {
        cause: error,
      });
    }
    this.notifyCommittedChange();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === this.storage && (event.key === DATA_KEY || event.key === null)) listener();
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
      throw new PersistenceError("Unable to persist draft data.", { cause: error });
    }
  }

  async clearDraft(): Promise<void> {
    try {
      this.storage.removeItem(DRAFT_KEY);
    } catch (error) {
      throw new PersistenceError("Unable to clear draft data.", { cause: error });
    }
  }

  /** Removes every key owned by this application; unrelated site storage survives. */
  async clearAppData(): Promise<void> {
    try {
      this.storage.removeItem(DATA_KEY);
      this.storage.removeItem(DRAFT_KEY);
    } catch (error) {
      throw new PersistenceError("Unable to clear application data.", {
        cause: error,
      });
    }
    this.notifyCommittedChange();
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
