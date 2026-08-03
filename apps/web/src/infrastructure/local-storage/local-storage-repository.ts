import {
  CorruptDataError,
  createEmptySnapshot,
  migrateSnapshot,
  PersistenceError,
  type AppRepository,
  type AppSnapshot,
} from "../../../../../packages/domain/src/index";

const DATA_KEY = "atoqueue:data:v1";
const DRAFT_KEY = "atoqueue:draft:v1";

export interface LocalStorageRepositoryOptions {
  appVersion?: string;
  localDeviceId?: string;
  now?: () => string;
  timeZone?: string;
}

export class LocalStorageRepository implements AppRepository {
  private readonly appVersion: string;
  private readonly localDeviceId: string;
  private readonly now: () => string;
  private readonly timeZone: string;

  constructor(
    private readonly storage: Storage,
    options: LocalStorageRepositoryOptions = {},
  ) {
    this.appVersion = options.appVersion ?? "0.1.0";
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

    try {
      return migrateSnapshot(JSON.parse(stored));
    } catch (error) {
      if (error instanceof CorruptDataError || error instanceof SyntaxError) {
        this.backUpCorruptValue(stored);
        throw new CorruptDataError("Stored application data is corrupt.");
      }
      throw error;
    }
  }

  async save(next: AppSnapshot): Promise<void> {
    try {
      const serialized = JSON.stringify(migrateSnapshot(next));
      this.storage.setItem(DATA_KEY, serialized);
    } catch (error) {
      if (error instanceof CorruptDataError) throw error;
      throw new PersistenceError("Unable to persist application data.", {
        cause: error,
      });
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

  private backUpCorruptValue(value: string): void {
    try {
      this.storage.setItem(`atoqueue:corrupt:${this.now()}`, value);
    } catch {
      // The original data remains untouched even when its backup cannot be written.
    }
  }
}

function createDeviceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`;
}
