import { describe, expect, it, vi } from "vitest";
import {
  createNotificationClient,
  createServiceWorkerHelpers,
  NotificationClientError,
} from "./index.js";

const deviceId = "a1f0f85e-8da5-4bfb-8fc4-938067ca9984";
const reminderId = "0997f1d8-90b4-4b18-8b7d-b9bb07925564";
const operationId = "ec54e45e-84ac-4df6-b433-389e9a928a8e";
const time = "2026-09-10T03:00:00.000Z";
const credentials = { deviceId, deviceSecret: "test-secret" };
const subscription = {
  endpoint: "https://push.example/subscription",
  expirationTime: null,
  keys: { p256dh: "key", auth: "auth" },
};
const request = {
  deviceId,
  scheduledAt: time,
  notificationKey: "review_due",
  routeKey: "review",
};
const device = {
  appId: "sample-app",
  deviceId,
  deviceSecret: "test-secret",
  protocolVersion: 2,
  createdAt: time,
};
const reminder = {
  reminderId,
  scheduledAt: time,
  repeatCadence: null,
  status: "pending",
  updatedAt: time,
};
function setup(responses: Response[] = []) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const response of responses) fetch.mockResolvedValueOnce(response);
  return {
    fetch,
    client: createNotificationClient({
      apiOrigin: "https://api.example",
      appId: "sample-app",
      fetch,
    }),
  };
}
const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });

describe("v2 HTTP public boundary", () => {
  it("generates all six requests and validates success before acknowledging", async () => {
    const { client, fetch } = setup([
      json({ publicKey: "public" }),
      json(device, 201),
      json({
        appId: "sample-app",
        deviceId,
        status: "active",
        updatedAt: time,
      }),
      new Response(null, { status: 204 }),
      json(reminder, 201),
      new Response(null, { status: 204 }),
    ]);
    expect(await client.getPublicKey()).toEqual({ publicKey: "public" });
    expect(await client.registerDevice({ subscription })).toEqual(device);
    await client.updateSubscription(credentials, { subscription }, operationId);
    await client.disableDevice(credentials, operationId);
    expect(
      await client.upsertReminder(
        credentials,
        reminderId,
        request,
        operationId,
      ),
    ).toEqual(reminder);
    await client.cancelReminder(credentials, reminderId);
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["https://api.example/v2/apps/sample-app/push/public-key", "GET"],
      ["https://api.example/v2/apps/sample-app/devices", "POST"],
      [
        `https://api.example/v2/apps/sample-app/devices/${deviceId}/subscription`,
        "PUT",
      ],
      [`https://api.example/v2/apps/sample-app/devices/${deviceId}`, "DELETE"],
      [`https://api.example/v2/apps/sample-app/reminders/${reminderId}`, "PUT"],
      [
        `https://api.example/v2/apps/sample-app/reminders/${reminderId}?deviceId=${deviceId}`,
        "DELETE",
      ],
    ]);
    expect(fetch.mock.calls[4][1]).toMatchObject({
      headers: {
        Authorization: "Bearer test-secret",
        "Idempotency-Key": operationId,
      },
      body: JSON.stringify(request),
      credentials: "omit",
      redirect: "error",
    });
    expect(fetch.mock.calls[5][1]?.headers).not.toHaveProperty(
      "Idempotency-Key",
    );
  });
  it("retains caller operation and reminder IDs across replay", async () => {
    const { client, fetch } = setup([json(reminder), json(reminder)]);
    await client.upsertReminder(credentials, reminderId, request, operationId);
    await client.upsertReminder(credentials, reminderId, request, operationId);
    expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
  });
  it("rejects private fields, mismatched credentials, and malformed IDs before sending", async () => {
    const { client, fetch } = setup();
    await expect(
      client.registerDevice({ subscription, title: "private" } as never),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.upsertReminder(
        credentials,
        reminderId,
        { ...request, taskId: "private" } as never,
        operationId,
      ),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.upsertReminder(
        credentials,
        reminderId,
        { ...request, deviceId: reminderId },
        operationId,
      ),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.disableDevice(credentials, "invalid"),
    ).rejects.toMatchObject({ kind: "validation" });
    await expect(
      client.cancelReminder(credentials, "../secret"),
    ).rejects.toMatchObject({ kind: "validation" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "https://api.example/path",
    "https://user:pass@api.example",
    "//evil.example",
    "javascript:alert(1)",
  ])("rejects unsafe API origin %s", (apiOrigin) => {
    expect(() =>
      createNotificationClient({ apiOrigin, appId: "sample-app" }),
    ).toThrow(NotificationClientError);
  });
  it.each([
    { ...device, appId: "other-app" },
    { ...device, private: "hidden" },
    { ...device, protocolVersion: 1 },
  ])("rejects unrelated or malformed registration response", async (body) => {
    const { client } = setup([json(body, 201)]);
    await expect(client.registerDevice({ subscription })).rejects.toMatchObject(
      { kind: "protocol", retryable: false },
    );
  });
  it("rejects wrong subscription owner and reminder response identity", async () => {
    const { client } = setup([
      json({
        appId: "sample-app",
        deviceId: reminderId,
        status: "active",
        updatedAt: time,
      }),
      json({ ...reminder, reminderId: deviceId }),
    ]);
    await expect(
      client.updateSubscription(credentials, { subscription }, operationId),
    ).rejects.toMatchObject({ kind: "protocol" });
    await expect(
      client.upsertReminder(credentials, reminderId, request, operationId),
    ).rejects.toMatchObject({ kind: "protocol" });
  });
  it("rejects unexpected success status and malformed JSON", async () => {
    const { client } = setup([
      json({}, 200),
      new Response("broken", { status: 200 }),
      json({ publicKey: "key", title: "private" }),
    ]);
    await expect(
      client.disableDevice(credentials, operationId),
    ).rejects.toMatchObject({ kind: "protocol" });
    await expect(client.getPublicKey()).rejects.toMatchObject({
      kind: "protocol",
    });
    await expect(client.getPublicKey()).rejects.toMatchObject({
      kind: "protocol",
    });
  });
  it.each([
    [400, "INVALID_REQUEST", false],
    [401, "DEVICE_UNAUTHORIZED", false],
    [403, "APP_ORIGIN_FORBIDDEN", false],
    [404, "APP_NOT_FOUND", false],
    [409, "IDEMPOTENCY_CONFLICT", false],
    [413, "PAYLOAD_TOO_LARGE", false],
    [429, "RATE_LIMITED", true],
    [500, "INTERNAL_ERROR", true],
    [503, "PUSH_UNAVAILABLE", true],
  ])("classifies HTTP %s", async (status, code, retryable) => {
    const { client } = setup([
      json(
        {
          error: {
            code,
            message: "server text is not logged",
            requestId: "req-1",
          },
        },
        status as number,
        { "Retry-After": "60" },
      ),
    ]);
    await expect(client.getPublicKey()).rejects.toMatchObject({
      kind: "http",
      status,
      code,
      retryable,
      retryAfterSeconds: 60,
      requestId: "req-1",
    });
  });
  it("handles untrusted error bodies and network failure without leaking raw data", async () => {
    const { client, fetch } = setup([
      json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "private",
            requestId: "req",
            extra: "private",
          },
        },
        500,
      ),
    ]);
    await expect(client.getPublicKey()).rejects.toMatchObject({
      kind: "http",
      code: undefined,
      retryable: true,
    });
    fetch.mockRejectedValueOnce(new Error("secret endpoint"));
    await expect(client.getPublicKey()).rejects.toMatchObject({
      kind: "network",
      retryable: true,
      message: "Notification request failed.",
    });
  });
  it("validates subscription response against the device at dispatch time", async () => {
    const current = { ...credentials };
    const { client, fetch } = setup();
    let resolve!: (response: Response) => void;
    fetch.mockReturnValueOnce(
      new Promise<Response>((done) => {
        resolve = done;
      }),
    );
    const pending = client.updateSubscription(
      current,
      { subscription },
      operationId,
    );
    current.deviceId = reminderId;
    resolve(
      json({
        appId: "sample-app",
        deviceId: reminderId,
        status: "active",
        updatedAt: time,
      }),
    );
    await expect(pending).rejects.toMatchObject({ kind: "protocol" });
  });
  it.each(["-1", "1.5", "invalid"])(
    "ignores malformed Retry-After %s",
    async (value) => {
      const { client } = setup([json({}, 429, { "Retry-After": value })]);
      await expect(client.getPublicKey()).rejects.toMatchObject({
        retryAfterSeconds: undefined,
      });
    },
  );
  it("converts an HTTP-date Retry-After to remaining seconds", async () => {
    const now = vi
      .spyOn(Date, "now")
      .mockReturnValue(Date.parse("2026-09-09T00:00:00Z"));
    try {
      const { client } = setup([
        json({}, 503, { "Retry-After": "Wed, 09 Sep 2026 00:01:00 GMT" }),
      ]);
      await expect(client.getPublicKey()).rejects.toMatchObject({
        retryAfterSeconds: 60,
      });
    } finally {
      now.mockRestore();
    }
  });
});

const payload = {
  version: 2,
  appId: "sample-app",
  type: "reminder_due",
  reminderId,
  notificationKey: "review_due",
  routeKey: "review",
  groupId: "0123456789abcdef",
};
function sw(route = "/review") {
  return createServiceWorkerHelpers({
    appId: "sample-app",
    origin: "https://sample.example",
    defaultPath: "/home",
    notifications: {
      review_due: {
        title: "Sample",
        body: "Please review",
        tagPrefix: "sample-review",
      },
    },
    routes: { review: route },
  });
}
describe("Service Worker public boundary", () => {
  it("validates JSON and resolves only fixed text, anonymous tag and notification data", () => {
    const helpers = sw();
    expect(helpers.parsePayload(JSON.stringify(payload))).toEqual(payload);
    expect(helpers.notification(payload)).toEqual({
      title: "Sample",
      options: {
        body: "Please review",
        tag: "sample-review-0123456789abcdef",
        data: { reminderId, routeKey: "review" },
      },
    });
    expect(
      helpers.notification({ ...payload, groupId: "1123456789abcdef" }).options
        .tag,
    ).not.toBe(helpers.notification(payload).options.tag);
    expect(helpers.resolveClick({ reminderId, routeKey: "review" })).toBe(
      `https://sample.example/review?reminder=${reminderId}`,
    );
  });
  it.each([
    null,
    "broken",
    [],
    { ...payload, appId: "other" },
    { ...payload, reminderId: "bad" },
    { ...payload, groupId: "ABCDEF" },
    { ...payload, body: "private" },
    { ...payload, routeKey: "constructor" },
    { ...payload, notificationKey: "constructor" },
    { ...payload, version: 1 },
    { ...payload, routeKey: "unknown" },
  ])("falls back safely for invalid payload %j", (input) => {
    const helpers = sw();
    expect(helpers.parsePayload(input)).toBeNull();
    const display = helpers.notification(input);
    expect(display.title).toBe("通知");
    expect(display.options.body).toBe("アプリを開いて確認してください。");
    expect(helpers.resolveClick(display.options.data)).toBe(
      "https://sample.example/home",
    );
  });
  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "\\evil.example",
    "/%5cevil.example",
    "/\nevil",
    "relative",
  ])("rejects unsafe fixed route %s", (route) => {
    expect(sw(route).parsePayload(payload)).toBeNull();
    expect(sw(route).resolveClick({ reminderId, routeKey: "review" })).toBe(
      "https://sample.example/home",
    );
  });
  it("rejects unsafe default path and invalid click data", () => {
    expect(() =>
      createServiceWorkerHelpers({
        appId: "sample-app",
        origin: "https://sample.example",
        defaultPath: "//evil.example",
        notifications: {},
        routes: {},
      }),
    ).toThrow();
    expect(sw().resolveClick({ reminderId, routeKey: "constructor" })).toBe(
      "https://sample.example/home",
    );
    expect(
      sw().resolveClick({
        reminderId,
        routeKey: "review",
        url: "https://evil.example",
      }),
    ).toBe("https://sample.example/home");
  });
  it("focuses only existing same-origin/path, otherwise opens validated route", async () => {
    const foreign = { url: "https://evil.example/review", focus: vi.fn() };
    const existing = {
      url: "https://sample.example/review?old=1",
      focus: vi.fn().mockResolvedValue(undefined),
    };
    const clients = {
      matchAll: vi.fn().mockResolvedValue([foreign, existing]),
      openWindow: vi.fn(),
    };
    await sw().openNotification({ reminderId, routeKey: "review" }, clients);
    expect(existing.focus).toHaveBeenCalledOnce();
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
    clients.matchAll.mockResolvedValue([foreign]);
    await sw().openNotification({ reminderId, routeKey: "review" }, clients);
    expect(clients.openWindow).toHaveBeenCalledWith(
      `https://sample.example/review?reminder=${reminderId}`,
    );
  });
});
