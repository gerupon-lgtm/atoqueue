import type { AppRepository } from "../../../../../packages/domain/src";
import type { PushSubscription } from "../../../../../packages/contracts/src";
import type { DeviceCredentials } from "./notification-api";

export interface PushBrowser {
  isAvailable(): boolean;
  requestPermission(): Promise<NotificationPermission>;
  subscribe(applicationServerKey: string): Promise<PushSubscription>;
}
export interface PushRegistrationApi {
  publicKey(): Promise<string>;
  register(
    subscription: PushSubscription,
  ): Promise<{ deviceId: string; deviceSecret: string; createdAt: string }>;
  updateSubscription(
    subscription: PushSubscription,
    credentials: DeviceCredentials,
    idempotencyKey: string,
  ): Promise<void>;
}
export type NotificationSetupErrorReason =
  "subscription" | "registration" | "rate_limited" | "storage";

export type NotificationSetupResult =
  | { state: "granted" | "denied" | "unavailable" }
  | { state: "error"; reason: NotificationSetupErrorReason };

export async function enableNotifications(input: {
  repository: AppRepository;
  api: PushRegistrationApi;
  browser: PushBrowser;
  now?: () => string;
  idempotencyKey?: () => string;
}): Promise<NotificationSetupResult> {
  const {
    repository,
    api,
    browser,
    now = () => new Date().toISOString(),
    idempotencyKey = () => crypto.randomUUID(),
  } = input;
  if (!browser.isAvailable()) return saveState(repository, "unavailable");

  let permission: NotificationPermission;
  try {
    permission = await browser.requestPermission();
  } catch {
    return saveSetupFailure(repository, "subscription");
  }
  if (permission !== "granted") return saveState(repository, "denied");

  let subscription: PushSubscription;
  try {
    subscription = await browser.subscribe(await api.publicKey());
  } catch {
    return saveSetupFailure(repository, "subscription");
  }

  let snapshot;
  try {
    snapshot = await repository.load();
  } catch {
    return saveSetupFailure(repository, "storage");
  }
  const credentials =
    snapshot.device.pushDeviceId && snapshot.device.pushDeviceSecret
      ? {
          deviceId: snapshot.device.pushDeviceId,
          deviceSecret: snapshot.device.pushDeviceSecret,
        }
      : undefined;

  let registered:
    { deviceId: string; deviceSecret: string; createdAt: string } | undefined;
  try {
    if (credentials)
      await api.updateSubscription(subscription, credentials, idempotencyKey());
    registered = credentials ? undefined : await api.register(subscription);
  } catch (error) {
    return saveSetupFailure(
      repository,
      isRateLimited(error) ? "rate_limited" : "registration",
    );
  }

  try {
    await repository.save({
      ...snapshot,
      device: {
        ...snapshot.device,
        pushSubscriptionStatus: "granted",
        ...(registered
          ? {
              pushDeviceId: registered.deviceId,
              pushDeviceSecret: registered.deviceSecret,
              registeredAt: registered.createdAt,
            }
          : {}),
      },
      settings: { ...snapshot.settings, notificationEnabled: true },
      savedAt: now(),
    });
    return { state: "granted" };
  } catch {
    return { state: "error", reason: "storage" };
  }
}

function isRateLimited(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 429 &&
    "code" in error &&
    error.code === "RATE_LIMITED"
  );
}

async function saveSetupFailure(
  repository: AppRepository,
  reason: NotificationSetupErrorReason,
): Promise<NotificationSetupResult> {
  try {
    await saveSetupError(repository);
  } catch {
    // The UI still identifies the original failed stage without exposing private values.
  }
  return { state: "error", reason };
}

async function saveSetupError(repository: AppRepository): Promise<void> {
  const snapshot = await repository.load();
  await repository.save({
    ...snapshot,
    settings: { ...snapshot.settings, notificationEnabled: false },
  });
}

async function saveState(
  repository: AppRepository,
  state: "denied" | "unavailable",
): Promise<NotificationSetupResult> {
  const snapshot = await repository.load();
  await repository.save({
    ...snapshot,
    device: { ...snapshot.device, pushSubscriptionStatus: state },
    settings: { ...snapshot.settings, notificationEnabled: false },
  });
  return { state };
}

export function createBrowserPushAdapter(): PushBrowser {
  return {
    isAvailable: () =>
      "Notification" in window &&
      "serviceWorker" in navigator &&
      "PushManager" in window,
    requestPermission: () => Notification.requestPermission(),
    async subscribe(applicationServerKey) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(
          applicationServerKey,
        ) as unknown as BufferSource,
      });
      const json = subscription.toJSON();
      return {
        endpoint: subscription.endpoint,
        expirationTime: subscription.expirationTime,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      };
    },
  };
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
