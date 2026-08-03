import { describe, expect, it, vi } from "vitest";
import { createEmptySnapshot } from "../../../../packages/domain/src";
import { createNotificationSyncService } from "./notification-sync-service";

describe("notification sync service", () => {
  it("delegates a post-restore flush to the notification infrastructure", async () => {
    const repository = memory();
    const flush = vi.fn(async () => ({ settingsError: false, registrationStale: false }));
    const api = { upsert: async () => undefined, cancel: async () => undefined };
    const service = createNotificationSyncService({ repository, api, flush });

    await service.flushAfterRestore();

    expect(flush).toHaveBeenCalledWith({ repository, api });
  });
});

function memory() {
  const snapshot = createEmptySnapshot({ appVersion: "0.1.0", localDeviceId: "local", timeZone: "Asia/Tokyo", now: "2026-08-04T09:00:00.000Z" });
  return { load: async () => snapshot, save: async () => undefined, loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined };
}
