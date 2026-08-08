import {
  CreateDeviceRequestSchema,
  CreateDeviceResponseSchema,
  CreateReminderRequestSchema,
  DeviceSubscriptionResponseSchema,
  ErrorEnvelopeSchema,
  type ErrorCode,
  PublicPushKeyResponseSchema,
  ReminderResponseSchema,
  type PushSubscription,
} from "../../../../../packages/contracts/src";
import type { NotificationOutboxItem } from "../../../../../packages/domain/src";

export interface DeviceCredentials {
  deviceId: string;
  deviceSecret: string;
}

export type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class NotificationApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
    public readonly code?: ErrorCode,
  ) {
    super(`Notification API request failed with ${status}.`);
  }
}

/** Browser adapter for the deliberately small notification API contract. */
export class NotificationApi {
  constructor(
    private readonly origin: string,
    private readonly fetcher: Fetcher = (input, init) =>
      globalThis.fetch(input, init),
  ) {}

  async publicKey(): Promise<string> {
    return PublicPushKeyResponseSchema.parse(
      await this.request("/v1/push/public-key"),
    ).publicKey;
  }

  async register(
    subscription: PushSubscription,
  ): Promise<{ deviceId: string; deviceSecret: string; createdAt: string }> {
    const body = CreateDeviceRequestSchema.parse({ subscription });
    return CreateDeviceResponseSchema.parse(
      await this.request("/v1/devices", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
  }

  async updateSubscription(
    subscription: PushSubscription,
    credentials: DeviceCredentials,
    idempotencyKey: string,
  ): Promise<void> {
    const body = CreateDeviceRequestSchema.parse({ subscription });
    DeviceSubscriptionResponseSchema.parse(
      await this.request(`/v1/devices/${credentials.deviceId}/subscription`, {
        method: "PUT",
        credentials,
        idempotencyKey,
        body: JSON.stringify(body),
      }),
    );
  }

  async upsert(
    item: NotificationOutboxItem,
    credentials: DeviceCredentials,
  ): Promise<void> {
    if (
      item.operation !== "upsert" ||
      !item.scheduledAt ||
      !item.notificationType
    )
      throw new TypeError(
        "An upsert outbox item requires its schedule and type.",
      );
    const body = CreateReminderRequestSchema.parse({
      deviceId: credentials.deviceId,
      scheduledAt: item.scheduledAt,
      notificationType: item.notificationType,
    });
    ReminderResponseSchema.parse(
      await this.request(`/v1/reminders/${item.reminderId}`, {
        method: "PUT",
        credentials,
        idempotencyKey: item.id,
        body: JSON.stringify(body),
      }),
    );
  }

  async cancel(
    item: NotificationOutboxItem,
    credentials: DeviceCredentials,
  ): Promise<void> {
    if (item.operation !== "cancel")
      throw new TypeError("A cancel request requires a cancel outbox item.");
    await this.request(
      `/v1/reminders/${item.reminderId}?deviceId=${encodeURIComponent(credentials.deviceId)}`,
      { method: "DELETE", credentials },
    );
  }

  private async request(
    path: string,
    options: {
      method?: string;
      credentials?: DeviceCredentials;
      idempotencyKey?: string;
      body?: string;
    } = {},
  ): Promise<unknown> {
    const response = await this.fetcher(`${this.origin}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.credentials
          ? { Authorization: `Bearer ${options.credentials.deviceSecret}` }
          : {}),
        ...(options.idempotencyKey
          ? { "Idempotency-Key": options.idempotencyKey }
          : {}),
      },
      ...(options.body ? { body: options.body } : {}),
    });
    if (!response.ok)
      throw new NotificationApiError(
        response.status,
        retryAfterSeconds(response),
        await errorCode(response),
      );
    if (response.status === 204) return undefined;
    return response.json();
  }
}

async function errorCode(response: Response): Promise<ErrorCode | undefined> {
  try {
    return ErrorEnvelopeSchema.safeParse(await response.clone().json()).data
      ?.error.code;
  } catch {
    return undefined;
  }
}

function retryAfterSeconds(response: Response): number | undefined {
  const value = response.headers.get("Retry-After");
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}
