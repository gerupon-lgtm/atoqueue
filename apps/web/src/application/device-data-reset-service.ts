import type { AppSnapshot } from "../../../../packages/domain/src";
import type { DeviceCredentials } from "../infrastructure/notifications/notification-api";

export interface DeviceDataResetRepository {
  load(): Promise<AppSnapshot>;
  clearAppData(): Promise<void>;
}

export interface DeviceDeactivationApi {
  deactivate(credentials: DeviceCredentials, idempotencyKey: string): Promise<void>;
}

/**
 * Removes the server-side anonymous push destination before the local secret
 * is discarded, so old generic reminders cannot outlive a device reset.
 */
export async function resetDeviceData(input: {
  repository: DeviceDataResetRepository;
  api: DeviceDeactivationApi;
  unsubscribeBrowserPush?: () => Promise<void>;
  idempotencyKey?: () => string;
}): Promise<void> {
  const snapshot = await input.repository.load();
  const credentials = credentialsOf(snapshot);
  if (credentials) {
    await input.api.deactivate(
      credentials,
      (input.idempotencyKey ?? (() => crypto.randomUUID()))(),
    );
  }

  try {
    await input.unsubscribeBrowserPush?.();
  } catch {
    // The API deactivation above is the delivery boundary. Browser cleanup is best effort.
  }

  await input.repository.clearAppData();
}

function credentialsOf(snapshot: AppSnapshot): DeviceCredentials | undefined {
  const { pushDeviceId: deviceId, pushDeviceSecret: deviceSecret } = snapshot.device;
  return deviceId && deviceSecret ? { deviceId, deviceSecret } : undefined;
}
