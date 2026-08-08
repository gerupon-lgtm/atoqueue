import type { AppRepository } from "../../../../packages/domain/src";
import { flushOutbox, type FlushOutboxInput, type OutboxApi } from "../infrastructure/notifications/outbox-sync";

export interface NotificationSyncService {
  flush(): Promise<void>;
  flushAfterRestore(): Promise<void>;
}

export interface CreateNotificationSyncServiceInput {
  repository: AppRepository;
  api: OutboxApi;
  flush?: (input: FlushOutboxInput) => Promise<unknown>;
}

/** Application boundary that keeps notification transport out of screen components. */
export function createNotificationSyncService({ repository, api, flush = flushOutbox }: CreateNotificationSyncServiceInput): NotificationSyncService {
  return {
    async flush(): Promise<void> {
      await flush({ repository, api });
    },
    async flushAfterRestore(): Promise<void> {
      await flush({ repository, api });
    },
  };
}
