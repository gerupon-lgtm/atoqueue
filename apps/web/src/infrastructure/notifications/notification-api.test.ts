import { describe, expect, it, vi } from "vitest";
import { NotificationApi, NotificationApiError } from "./notification-api";

const subscription = {
  endpoint: "https://push.example.test/subscription",
  expirationTime: null,
  keys: { p256dh: "public-key", auth: "auth-key" },
};
const credentials = {
  deviceId: "11111111-1111-4111-8111-111111111111",
  deviceSecret: "device-secret",
};

describe("NotificationApi", () => {
  it("sends an upsert made only from an outbox item and device credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      jsonResponse(201, {
        reminderId: "22222222-2222-4222-8222-222222222222",
        status: "pending",
        scheduledAt: "2026-08-04T09:00:00.000Z",
        updatedAt: "2026-08-04T08:00:00.000Z",
      }),
    );
    const api = new NotificationApi("https://api.example.test", fetcher);

    await api.upsert(
      {
        id: "outbox",
        operation: "upsert",
        reminderId: "22222222-2222-4222-8222-222222222222",
        scheduledAt: "2026-08-04T09:00:00.000Z",
        notificationType: "task_review",
        taskRevision: 3,
        attemptCount: 0,
        nextAttemptAt: "2026-08-04T08:00:00.000Z",
        createdAt: "2026-08-04T08:00:00.000Z",
      },
      credentials,
    );

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.example.test/v1/reminders/22222222-2222-4222-8222-222222222222",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({
          Authorization: "Bearer device-secret",
        }),
        body: JSON.stringify({
          deviceId: credentials.deviceId,
          scheduledAt: "2026-08-04T09:00:00.000Z",
          notificationType: "task_review",
        }),
      }),
    );
    expect(fetcher.mock.calls[0][1].body).not.toContain("task title");
  });

  it("reports retry metadata for a rate-limited request", async () => {
    const api = new NotificationApi(
      "https://api.example.test",
      vi
        .fn()
        .mockResolvedValue(
          new Response("", { status: 429, headers: { "Retry-After": "90" } }),
        ),
    );
    await expect(
      api.cancel(
        {
          id: "outbox",
          operation: "cancel",
          reminderId: "22222222-2222-4222-8222-222222222222",
          taskRevision: 3,
          attemptCount: 0,
          nextAttemptAt: "2026-08-04T08:00:00.000Z",
          createdAt: "2026-08-04T08:00:00.000Z",
        },
        credentials,
      ),
    ).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 90,
    } satisfies Partial<NotificationApiError>);
  });

  it("retains the API error code needed for Outbox recovery decisions", async () => {
    const api = new NotificationApi(
      "https://api.example.test",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: {
            code: "DEVICE_NOT_FOUND",
            message: "Device not found.",
            requestId: "request-1",
          },
        }),
      ),
    );

    await expect(
      api.cancel(
        {
          id: "outbox",
          operation: "cancel",
          reminderId: "22222222-2222-4222-8222-222222222222",
          taskRevision: 3,
          attemptCount: 0,
          nextAttemptAt: "2026-08-04T08:00:00.000Z",
          createdAt: "2026-08-04T08:00:00.000Z",
        },
        credentials,
      ),
    ).rejects.toMatchObject({
      status: 404,
      code: "DEVICE_NOT_FOUND",
    } satisfies Partial<NotificationApiError>);
  });

  it("registers once then updates an existing device subscription", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(201, {
          deviceId: credentials.deviceId,
          deviceSecret: credentials.deviceSecret,
          createdAt: "2026-08-04T08:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          deviceId: credentials.deviceId,
          status: "active",
          updatedAt: "2026-08-04T08:00:00.000Z",
        }),
      );
    const api = new NotificationApi("https://api.example.test", fetcher);

    await api.register(subscription);
    await api.updateSubscription(subscription, credentials, "update-1");

    expect(
      fetcher.mock.calls.map(([url, init]) => [
        url,
        (init as RequestInit).method,
      ]),
    ).toEqual([
      ["https://api.example.test/v1/devices", "POST"],
      [
        `https://api.example.test/v1/devices/${credentials.deviceId}/subscription`,
        "PUT",
      ],
    ]);
  });

  it("calls the browser fetch function with its global receiver when no fetcher is injected", async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(jsonResponse(200, { publicKey: "public-key" }));
    });
    vi.stubGlobal("fetch", browserFetch);

    try {
      await expect(
        new NotificationApi("https://api.example.test").publicKey(),
      ).resolves.toBe("public-key");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

function jsonResponse(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
