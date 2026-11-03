import { describe, expect, it, vi } from "vitest";
import { createEmptySnapshot } from "../../../../packages/domain/src";
import { resetDeviceData } from "./device-data-reset-service";

describe("device data reset service", () => {
  it("deactivates the anonymous push destination before clearing local data", async () => {
    const repository = memory({
      pushDeviceId: "11111111-1111-4111-8111-111111111111",
      pushDeviceSecret: "secret",
    });
    const deactivate = vi.fn().mockResolvedValue(undefined);
    const unsubscribe = vi.fn().mockResolvedValue(undefined);

    await resetDeviceData({
      repository,
      api: { deactivate },
      unsubscribeBrowserPush: unsubscribe,
      idempotencyKey: () => "delete-device-key",
    });

    expect(deactivate).toHaveBeenCalledWith(
      {
        deviceId: "11111111-1111-4111-8111-111111111111",
        deviceSecret: "secret",
      },
      "delete-device-key",
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(repository.clearAppData).toHaveBeenCalledOnce();
    expect(
      (repository.clearAppData as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      deactivate.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps local data intact when the server cannot deactivate a registered device", async () => {
    const repository = memory({
      pushDeviceId: "11111111-1111-4111-8111-111111111111",
      pushDeviceSecret: "secret",
    });

    await expect(
      resetDeviceData({
        repository,
        api: { deactivate: async () => { throw new Error("offline"); } },
      }),
    ).rejects.toThrow("offline");
    expect(repository.clearAppData).not.toHaveBeenCalled();
  });
});

function memory(device: Partial<Awaited<ReturnType<typeof createEmptySnapshot>>["device"]>) {
  const snapshot = createEmptySnapshot({
    appVersion: "test",
    localDeviceId: "local",
    timeZone: "Asia/Tokyo",
    now: "2026-08-08T10:00:00.000Z",
  });
  snapshot.device = { ...snapshot.device, ...device };
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    clearAppData: vi.fn().mockResolvedValue(undefined),
  };
}
