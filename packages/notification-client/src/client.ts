import { z } from "zod";
import {
  ApplicationIdSchema,
  CreateDeviceRequestV2Schema,
  CreateDeviceResponseV2Schema,
  CreateReminderRequestV2Schema,
  DeviceIdSchema,
  DeviceSubscriptionResponseV2Schema,
  ErrorEnvelopeSchema,
  PublicPushKeyResponseSchema,
  ReminderResponseV2Schema,
  type CreateDeviceRequest,
  type CreateReminderRequestV2,
  type ErrorCode,
} from "@atoqueue/contracts";

export type NotificationErrorKind =
  "validation" | "protocol" | "network" | "http";
export class NotificationClientError extends Error {
  readonly name = "NotificationClientError";
  readonly retryable: boolean;
  constructor(
    readonly kind: NotificationErrorKind,
    readonly status?: number,
    readonly code?: ErrorCode,
    readonly requestId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super("Notification request failed.");
    this.retryable =
      kind === "network" ||
      (kind === "http" &&
        (status === 429 || (status !== undefined && status >= 500)));
  }
}

function validate<T>(
  schema: z.ZodType<T>,
  input: unknown,
  kind: "validation" | "protocol" = "validation",
): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new NotificationClientError(kind);
  return result.data;
}

/** Origin only; HTTPS or HTTP loopback for local development. */
export function validateNotificationOrigin(input: string): string {
  try {
    const url = new URL(input);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        ))
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new NotificationClientError("validation");
  }
}

export interface DeviceCredentials {
  deviceId: string;
  deviceSecret: string;
}
const CredentialsSchema = z
  .object({
    deviceId: DeviceIdSchema,
    deviceSecret: z
      .string()
      .min(1)
      .regex(/^[\x21-\x7e]+$/),
  })
  .strict();

function retryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value.trim())) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  // Only accept HTTP-date, not Date.parse's permissive numeric/date shorthands.
  if (
    !/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(
      value,
    )
  )
    return undefined;
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.max(0, Math.ceil((date - Date.now()) / 1000))
    : undefined;
}

export interface NotificationClientOptions {
  apiOrigin: string;
  appId: string;
  fetch?: typeof globalThis.fetch;
}

export function createNotificationClient(options: NotificationClientOptions) {
  const origin = validateNotificationOrigin(options.apiOrigin);
  const appId = validate(ApplicationIdSchema, options.appId);
  const base = `${origin}/v2/apps/${appId}`;
  const fetchRequest = options.fetch ?? globalThis.fetch.bind(globalThis);

  function headers(
    credentials?: DeviceCredentials,
    operationId?: string,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    if (credentials)
      result.Authorization = `Bearer ${validate(CredentialsSchema, credentials).deviceSecret}`;
    if (operationId !== undefined)
      result["Idempotency-Key"] = validate(DeviceIdSchema, operationId);
    return result;
  }
  async function send(
    method: string,
    path: string,
    statuses: number[],
    requestHeaders: Record<string, string> = {},
    body?: unknown,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await fetchRequest(`${base}${path}`, {
        method,
        headers:
          body === undefined
            ? requestHeaders
            : { ...requestHeaders, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        credentials: "omit",
        redirect: "error",
      });
    } catch {
      throw new NotificationClientError("network");
    }
    if (!response.ok) {
      const envelope = ErrorEnvelopeSchema.safeParse(
        await response.json().catch(() => undefined),
      );
      throw new NotificationClientError(
        "http",
        response.status,
        envelope.success ? envelope.data.error.code : undefined,
        envelope.success ? envelope.data.error.requestId : undefined,
        retryAfter(response.headers.get("Retry-After")),
      );
    }
    if (!statuses.includes(response.status))
      throw new NotificationClientError("protocol", response.status);
    return response;
  }
  async function read<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new NotificationClientError("protocol", response.status);
    }
    return validate(schema, body, "protocol");
  }
  return {
    async getPublicKey() {
      return read(
        await send("GET", "/push/public-key", [200]),
        PublicPushKeyResponseSchema,
      );
    },
    async registerDevice(request: CreateDeviceRequest) {
      const body = validate(CreateDeviceRequestV2Schema, request);
      const result = await read(
        await send("POST", "/devices", [201], {}, body),
        CreateDeviceResponseV2Schema,
      );
      if (result.appId !== appId) throw new NotificationClientError("protocol");
      return result;
    },
    async updateSubscription(
      credentials: DeviceCredentials,
      request: CreateDeviceRequest,
      operationId: string,
    ) {
      const auth = headers(credentials, validate(DeviceIdSchema, operationId));
      const expectedDeviceId = credentials.deviceId;
      const body = validate(CreateDeviceRequestV2Schema, request);
      const result = await read(
        await send(
          "PUT",
          `/devices/${expectedDeviceId}/subscription`,
          [200],
          auth,
          body,
        ),
        DeviceSubscriptionResponseV2Schema,
      );
      if (result.appId !== appId || result.deviceId !== expectedDeviceId)
        throw new NotificationClientError("protocol");
      return result;
    },
    async disableDevice(
      credentials: DeviceCredentials,
      operationId: string,
    ): Promise<void> {
      const auth = headers(credentials, validate(DeviceIdSchema, operationId));
      await send("DELETE", `/devices/${credentials.deviceId}`, [204], auth);
    },
    async upsertReminder(
      credentials: DeviceCredentials,
      reminderId: string,
      request: CreateReminderRequestV2,
      operationId: string,
    ) {
      const auth = headers(credentials, validate(DeviceIdSchema, operationId));
      const id = validate(DeviceIdSchema, reminderId);
      const body = validate(CreateReminderRequestV2Schema, request);
      if (body.deviceId !== credentials.deviceId)
        throw new NotificationClientError("validation");
      const result = await read(
        await send("PUT", `/reminders/${id}`, [200, 201], auth, body),
        ReminderResponseV2Schema,
      );
      if (result.reminderId !== id)
        throw new NotificationClientError("protocol");
      return result;
    },
    async cancelReminder(
      credentials: DeviceCredentials,
      reminderId: string,
    ): Promise<void> {
      const auth = headers(credentials);
      const id = validate(DeviceIdSchema, reminderId);
      await send(
        "DELETE",
        `/reminders/${id}?deviceId=${credentials.deviceId}`,
        [204],
        auth,
      );
    },
  };
}
export type NotificationClient = ReturnType<typeof createNotificationClient>;
