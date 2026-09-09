import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { buildApp } from "../server.js";
import { InMemoryDeviceRepository } from "../devices/device-repository.js";
import { InMemoryReminderRepository } from "../reminders/reminder-repository.js";
import { ApplicationRegistry } from "../applications/registry.js";
import { ReminderDispatcher } from "../scheduler/reminder-dispatcher.js";
const config = (appId: string) => ({
  appId,
  origins: [`https://${appId}.example`],
  vapidPublicKey: "B".repeat(87),
  vapidPrivateKey: "A".repeat(43),
  vapidSubject: "mailto:test@example.com",
  notificationKeys: ["review_due"],
  routeKeys: ["review", "home"],
});
const subscription = {
  endpoint: "https://push.example/test",
  expirationTime: null,
  keys: { p256dh: "p", auth: "a" },
};
describe("F-019 v2 platform", () => {
  it("rejects invalid registry entries without exposing secrets", () => {
    expect(
      () => new ApplicationRegistry([config("sample"), config("sample")]),
    ).toThrow();
    expect(
      () =>
        new ApplicationRegistry([
          { ...config("sample"), origins: ["https://sample.example/path"] },
        ]),
    ).toThrow();
    expect(
      () =>
        new ApplicationRegistry([
          { ...config("sample"), notificationKeys: ["private title"] },
        ]),
    ).toThrow();
  });
  it("enforces origins, app ownership, strict body, UUID keys and immutable replay", async () => {
    let now = "2026-09-09T00:00:00.000Z";
    const repository = new InMemoryDeviceRepository();
    const reminders = new InMemoryReminderRepository();
    const logs: string[] = [];
    const app = buildApp({
      version: "test",
      repository,
      reminderRepository: reminders,
      applications: new ApplicationRegistry([
        config("sample"),
        config("other"),
      ]),
      v2Enabled: true,
      now: () => now,
      logger: { write: (line) => logs.push(line) },
    });
    const base = "/v2/apps/sample";
    const headers = { origin: "https://sample.example" };
    try {
      expect(
        (await app.inject({ url: base + "/push/public-key", headers })).json(),
      ).toEqual({ publicKey: config("sample").vapidPublicKey });
      expect(
        (await app.inject({ url: base + "/push/public-key" })).statusCode,
      ).toBe(403);
      expect(
        (await app.inject({ url: "/v2/apps/missing/push/public-key", headers }))
          .statusCode,
      ).toBe(404);
      const registered = await app.inject({
        method: "POST",
        url: base + "/devices",
        headers,
        payload: { subscription },
      });
      expect(registered.statusCode).toBe(201);
      const device = registered.json();
      expect(device).toMatchObject({ appId: "sample", protocolVersion: 2 });
      expect(repository.get(device.deviceId)?.secretHash).toMatch(
        /^\$argon2id\$/,
      );
      const auth = {
        ...headers,
        authorization: `Bearer ${device.deviceSecret}`,
        "idempotency-key": randomUUID(),
      };
      const id = randomUUID();
      const payload = {
        deviceId: device.deviceId,
        scheduledAt: now,
        notificationKey: "review_due",
        routeKey: "review",
        repeatCadence: "daily",
      };
      const put = () =>
        app.inject({
          method: "PUT",
          url: base + "/reminders/" + id,
          headers: auth,
          payload,
        });
      const first = await put();
      expect(first.statusCode).toBe(201);
      now = "2026-09-10T00:00:00.000Z";
      expect((await put()).json()).toEqual(first.json());
      expect(
        (
          await app.inject({
            method: "PUT",
            url: base + "/reminders/" + id,
            headers: auth,
            payload: { ...payload, routeKey: "home" },
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await app.inject({
            method: "PUT",
            url: base + "/reminders/" + id,
            headers: auth,
            payload: { ...payload, body: "SECRET_PRIVATE_TEXT" },
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/v2/apps/other/devices/${device.deviceId}`,
            headers: { ...auth, origin: "https://other.example" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/v1/devices/${device.deviceId}`,
            headers: auth,
          })
        ).statusCode,
      ).toBe(404);
      for (let n = 0; n < 2; n++)
        expect(
          (
            await app.inject({
              method: "DELETE",
              url: `${base}/reminders/${id}?deviceId=${device.deviceId}`,
              headers: auth,
            })
          ).statusCode,
        ).toBe(204);
      expect(logs.join()).not.toContain("SECRET_PRIVATE_TEXT");
      expect(logs.join()).not.toContain(device.deviceSecret);
    } finally {
      await app.close();
    }
  });
  it("uses protocol-specific payload and isolates missing app sender", async () => {
    const repo = new InMemoryReminderRepository();
    const now = "2026-09-09T00:00:00.000Z";
    for (const [appId, protocolVersion] of [
      ["atoqueue", 1],
      ["sample", 2],
    ] as const) {
      repo.seedDevice({
        deviceId: appId,
        status: "active",
        subscription: {
          endpoint: "https://push.example/" + appId,
          p256dh: "p",
          auth: "a",
        },
        appId,
        protocolVersion,
      });
      repo.seed({
        id: randomUUID(),
        deviceId: appId,
        scheduledAt: now,
        notificationType: "review_due",
        routeKey: protocolVersion === 2 ? "review" : null,
        status: "pending",
        attemptCount: 0,
        claimedAt: null,
      });
    }
    const sent: unknown[] = [];
    const dispatcher = new ReminderDispatcher(
      repo,
      {
        send: async (input) => {
          sent.push(input.payload);
          return { statusCode: 201 };
        },
      },
      () => new Date(now),
      0,
      new ApplicationRegistry([config("sample")]),
    );
    await dispatcher.dispatchDue();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({
      type: "review_due",
      url: expect.any(String),
    });
    expect(sent[1]).toMatchObject({
      version: 2,
      appId: "sample",
      type: "reminder_due",
      notificationKey: "review_due",
      routeKey: "review",
    });
    expect(sent[1]).not.toHaveProperty("url");
  });
  it("isolates preflight, registration limits and the v2 kill switch", async () => {
    const registry = new ApplicationRegistry([
      config("sample"),
      config("other"),
    ]);
    const app = buildApp({
      version: "test",
      applications: registry,
      v2Enabled: true,
    });
    const disabled = buildApp({
      version: "test",
      applications: registry,
      v2Enabled: false,
    });
    try {
      const good = await app.inject({
        method: "OPTIONS",
        url: "/v2/apps/sample/devices",
        headers: {
          origin: "https://sample.example",
          "access-control-request-method": "POST",
        },
      });
      expect(good.statusCode).toBe(204);
      expect(good.headers["access-control-allow-origin"]).toBe(
        "https://sample.example",
      );
      const bad = await app.inject({
        method: "OPTIONS",
        url: "/v2/apps/other/devices",
        headers: {
          origin: "https://sample.example",
          "access-control-request-method": "POST",
        },
      });
      expect(bad.statusCode).toBe(403);
      expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
      for (let i = 0; i < 3; i++)
        expect(
          (
            await app.inject({
              method: "POST",
              url: "/v2/apps/sample/devices",
              headers: { origin: "https://sample.example" },
              payload: { subscription },
            })
          ).statusCode,
        ).toBe(201);
      const limited = await app.inject({
        method: "POST",
        url: "/v2/apps/sample/devices",
        headers: { origin: "https://sample.example" },
        payload: { subscription },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.headers["retry-after"]).toBeDefined();
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/v2/apps/other/devices",
            headers: { origin: "https://other.example" },
            payload: { subscription },
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await disabled.inject({
            url: "/v2/apps/sample/push/public-key",
            headers: { origin: "https://sample.example" },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await disabled.inject({ url: "/v1/push/public-key" })).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
      await disabled.close();
    }
  });
  it("continues v1 dispatch when another app is absent from registry", async () => {
    const repo = new InMemoryReminderRepository();
    const now = "2026-09-09T00:00:00.000Z";
    for (const [appId, protocolVersion] of [
      ["atoqueue", 1],
      ["missing", 2],
    ] as const) {
      repo.seedDevice({
        deviceId: appId,
        appId,
        protocolVersion,
        status: "active",
        subscription: {
          endpoint: "https://push.example/" + appId,
          p256dh: "p",
          auth: "a",
        },
      });
      repo.seed({
        id: appId,
        deviceId: appId,
        scheduledAt: now,
        notificationType: "task_review",
        routeKey: "review",
        status: "pending",
        attemptCount: 0,
        claimedAt: null,
      });
    }
    let count = 0;
    await new ReminderDispatcher(
      repo,
      {
        send: async () => {
          count++;
          return { statusCode: 201 };
        },
      },
      () => new Date(now),
      0,
      new ApplicationRegistry(),
    ).dispatchDue();
    expect(count).toBe(1);
    expect(repo.get("atoqueue")?.status).toBe("sent");
    expect(repo.get("missing")).toMatchObject({
      status: "pending",
      attemptCount: 1,
      lastErrorCode: "push_error",
    });
  });
});
