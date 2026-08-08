import { describe, expect, it, vi } from "vitest";
import {
  createEmptySnapshot,
  type AppRepository,
} from "../../../../../packages/domain/src";
import { enableNotifications } from "./push-subscription";

describe("enableNotifications", () => {
  it("persists a newly registered device only after an explicit granted permission result", async () => {
    const repository = memory();
    const register = vi.fn().mockResolvedValue({
      deviceId: "11111111-1111-4111-8111-111111111111",
      deviceSecret: "secret",
      createdAt: "2026-08-04T08:00:00.000Z",
    });
    const result = await enableNotifications({
      repository,
      api: {
        publicKey: async () => "AQID",
        register,
        updateSubscription: async () => undefined,
      },
      browser: grantedBrowser(),
      now: () => "2026-08-04T08:00:00.000Z",
      idempotencyKey: () => "key",
    });

    expect(result).toEqual({ state: "granted" });
    expect(register).toHaveBeenCalledTimes(1);
    expect((await repository.load()).device).toMatchObject({
      pushDeviceId: "11111111-1111-4111-8111-111111111111",
      pushDeviceSecret: "secret",
      pushSubscriptionStatus: "granted",
    });
  });

  it("updates instead of registering a device that already has local credentials", async () => {
    const repository = memory({
      deviceId: "11111111-1111-4111-8111-111111111111",
      deviceSecret: "secret",
    });
    const register = vi.fn();
    const updateSubscription = vi.fn().mockResolvedValue(undefined);
    await enableNotifications({
      repository,
      api: { publicKey: async () => "AQID", register, updateSubscription },
      browser: grantedBrowser(),
      now: () => "2026-08-04T08:00:00.000Z",
      idempotencyKey: () => "key",
    });

    expect(register).not.toHaveBeenCalled();
    expect(updateSubscription).toHaveBeenCalledOnce();
  });

  it("reports a browser subscription failure without attempting API registration", async () => {
    const repository = memory();
    const register = vi.fn();
    const result = await enableNotifications({
      repository,
      api: {
        publicKey: async () => "AQID",
        register,
        updateSubscription: async () => undefined,
      },
      browser: {
        ...grantedBrowser(),
        subscribe: async () => {
          throw new Error("subscription failed");
        },
      },
    });

    expect(result).toEqual({ state: "error", reason: "subscription" });
    expect(register).not.toHaveBeenCalled();
    expect((await repository.load()).settings.notificationEnabled).toBe(false);
  });

  it("distinguishes a public-key request failure from a browser subscription failure", async () => {
    const repository = memory();
    const subscribe = vi.fn();
    const result = await enableNotifications({
      repository,
      api: {
        publicKey: async () => {
          throw new Error("public key failed");
        },
        register: async () => ({
          deviceId: "11111111-1111-4111-8111-111111111111",
          deviceSecret: "secret",
          createdAt: "2026-08-04T08:00:00.000Z",
        }),
        updateSubscription: async () => undefined,
      },
      browser: { ...grantedBrowser(), subscribe },
    });

    expect(result).toEqual({ state: "error", reason: "public_key" });
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("reports a rate-limited API registration without exposing its response body", async () => {
    const repository = memory();
    const result = await enableNotifications({
      repository,
      api: {
        publicKey: async () => "AQID",
        register: async () => {
          throw { status: 429, code: "RATE_LIMITED" };
        },
        updateSubscription: async () => undefined,
      },
      browser: grantedBrowser(),
    });

    expect(result).toEqual({ state: "error", reason: "rate_limited" });
    expect((await repository.load()).device.pushDeviceSecret).toBeUndefined();
  });
});

function memory(credentials?: {
  deviceId: string;
  deviceSecret: string;
}): AppRepository {
  let value = createEmptySnapshot({
    appVersion: "test",
    localDeviceId: "local",
    timeZone: "Asia/Tokyo",
    now: "2026-08-04T08:00:00.000Z",
  });
  if (credentials)
    value = {
      ...value,
      device: {
        ...value.device,
        pushDeviceId: credentials.deviceId,
        pushDeviceSecret: credentials.deviceSecret,
      },
    };
  return {
    load: async () => structuredClone(value),
    save: async (next) => {
      value = structuredClone(next);
    },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
}

function grantedBrowser() {
  return {
    isAvailable: () => true,
    requestPermission: async () => "granted" as const,
    subscribe: async () => ({
      endpoint: "https://push.example.test/sub",
      expirationTime: null,
      keys: { p256dh: "public", auth: "auth" },
    }),
  };
}
