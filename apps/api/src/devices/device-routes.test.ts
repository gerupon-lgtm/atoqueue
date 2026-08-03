import { describe, expect, it } from "vitest";
import { buildApp } from "../server.js";
import { InMemoryDeviceRepository } from "./device-repository.js";

const subscription = {
  endpoint: "https://push.example/private-endpoint",
  expirationTime: null,
  keys: { p256dh: "private-p256dh", auth: "private-auth" },
};

describe("device registration routes", () => {
  it("returns the configured public VAPID key", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/push/public-key",
      headers: { origin: "https://atoqueue.sikumilab.com" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ publicKey: "BEl-test" });
    expect(response.headers["access-control-allow-origin"]).toBe("https://atoqueue.sikumilab.com");
    await app.close();
  });

  it("returns a secret only on registration and persists only its hash", async () => {
    const repository = new InMemoryDeviceRepository();
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test", repository });
    const response = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.deviceSecret).toEqual(expect.any(String));
    const stored = repository.get(body.deviceId);
    expect(stored?.secretHash).not.toBe(body.deviceSecret);
    expect(JSON.stringify(stored)).not.toContain(body.deviceSecret);
    await app.close();
  });

  it("requires its bearer secret to update and deactivate a device", async () => {
    const repository = new InMemoryDeviceRepository();
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test", repository });
    const created = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json();
    const unauthorized = await app.inject({
      method: "PUT",
      url: `/v1/devices/${deviceId}/subscription`,
      headers: { "idempotency-key": "unauthorized-update" },
      payload: { subscription },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json().error.code).toBe("DEVICE_UNAUTHORIZED");
    const updated = await app.inject({
      method: "PUT",
      url: `/v1/devices/${deviceId}/subscription`,
      headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "update-key-1" },
      payload: { subscription: { ...subscription, endpoint: "https://push.example/updated" } },
    });
    expect(updated.statusCode).toBe(200);
    repository.addPendingJob(deviceId, "reminder-1");
    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "delete-key-1" },
    });
    expect(deleted.statusCode).toBe(204);
    expect(repository.get(deviceId)?.status).toBe("disabled");
    expect(repository.pendingJobsFor(deviceId)).toHaveLength(0);
    await app.close();
  });

  it("uses the stable rate-limit envelope after ten registrations from one IP", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/devices",
        remoteAddress: "203.0.113.8",
        payload: { subscription: { ...subscription, endpoint: `https://push.example/${index}` } },
      });
      expect(response.statusCode).toBe(201);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/devices",
      remoteAddress: "203.0.113.8",
      payload: { subscription: { ...subscription, endpoint: "https://push.example/limited" } },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: "RATE_LIMITED", requestId: expect.stringMatching(/^req_/) });
    expect(limited.headers["retry-after"]).toBeDefined();
    await app.close();
  });

  it("uses the forwarded client address from Caddy and keeps its registration bucket separate", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/devices",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": "198.51.100.10" },
        payload: { subscription: { ...subscription, endpoint: `https://push.example/first-client-${index}` } },
      });
      expect(response.statusCode).toBe(201);
    }
    const secondClient = await app.inject({
      method: "POST",
      url: "/v1/devices",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.11" },
      payload: { subscription: { ...subscription, endpoint: "https://push.example/second-client" } },
    });
    expect(secondClient.statusCode).toBe(201);
    await app.close();
  });

  it("does not trust a forwarded address supplied by an untrusted client", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/devices",
        remoteAddress: "203.0.113.90",
        headers: { "x-forwarded-for": `198.51.100.${index + 50}` },
        payload: { subscription: { ...subscription, endpoint: `https://push.example/untrusted-${index}` } },
      });
      expect(response.statusCode).toBe(201);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/devices",
      remoteAddress: "203.0.113.90",
      headers: { "x-forwarded-for": "198.51.100.99" },
      payload: { subscription: { ...subscription, endpoint: "https://push.example/untrusted-limited" } },
    });
    expect(limited.statusCode).toBe(429);
    await app.close();
  });

  it("limits registrations by endpoint even when they come from different client addresses", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    for (let index = 0; index < 3; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/devices",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": `198.51.100.${index + 20}` },
        payload: { subscription: { ...subscription, endpoint: "https://push.example/shared-endpoint" } },
      });
      expect(response.statusCode).toBe(201);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/devices",
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": "198.51.100.24" },
      payload: { subscription: { ...subscription, endpoint: "https://push.example/shared-endpoint" } },
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    await app.close();
  });

  it("returns INVALID_REQUEST for malformed JSON", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({ code: "INVALID_REQUEST", message: "Request validation failed." });
    await app.close();
  });

  it("requires an idempotency key for subscription updates", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const created = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json();
    const response = await app.inject({
      method: "PUT",
      url: `/v1/devices/${deviceId}/subscription`,
      headers: { authorization: `Bearer ${deviceSecret}` },
      payload: { subscription },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
    await app.close();
  });

  it("does not consume a device rate-limit slot until bearer authentication succeeds", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const created = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json();
    for (let index = 0; index < 61; index += 1) {
      const rejected = await app.inject({
        method: "PUT",
        url: `/v1/devices/${deviceId}/subscription`,
        headers: { authorization: "Bearer invalid", "idempotency-key": `attacker-${index}` },
        payload: { subscription },
      });
      expect(rejected.statusCode).toBe(401);
    }
    const valid = await app.inject({
      method: "PUT",
      url: `/v1/devices/${deviceId}/subscription`,
      headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "valid-after-attack" },
      payload: { subscription: { ...subscription, endpoint: "https://push.example/valid-after-attack" } },
    });
    expect(valid.statusCode).toBe(200);
    await app.close();
  }, 15_000);

  it("replays a lost delete response when the idempotency key is repeated", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const created = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json();
    const request = {
      method: "DELETE" as const,
      url: `/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "delete-key-1" },
    };
    expect((await app.inject(request)).statusCode).toBe(204);
    expect((await app.inject(request)).statusCode).toBe(204);
    await app.close();
  });

  it("replays a subscription update and rejects a changed request with the same key", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const created = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json();
    const request = {
      method: "PUT" as const,
      url: `/v1/devices/${deviceId}/subscription`,
      headers: { authorization: `Bearer ${deviceSecret}`, "idempotency-key": "update-replay-key" },
      payload: { subscription: { ...subscription, endpoint: "https://push.example/first-update" } },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    const conflict = await app.inject({
      ...request,
      payload: { subscription: { ...subscription, endpoint: "https://push.example/second-update" } },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    await app.close();
  });

  it("requires an idempotency key for deletion", async () => {
    const app = buildApp({ version: "0.1.0", publicPushKey: "BEl-test" });
    const created = await app.inject({ method: "POST", url: "/v1/devices", payload: { subscription } });
    const { deviceId, deviceSecret } = created.json();
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/devices/${deviceId}`,
      headers: { authorization: `Bearer ${deviceSecret}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
    await app.close();
  });

  it("uses stable validation and payload-size error envelopes without logging secrets", async () => {
    const logs: string[] = [];
    const app = buildApp({
      version: "0.1.0",
      publicPushKey: "BEl-test",
      logger: { write: (line) => logs.push(line) },
    });
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/devices",
      payload: { subscription: { ...subscription, title: "SECRET_TASK_CANARY" } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error).toMatchObject({ code: "INVALID_REQUEST", message: "Request validation failed." });
    expect(invalid.json().error.requestId).toMatch(/^req_/);
    const oversized = await app.inject({
      method: "POST",
      url: "/v1/devices",
      payload: { subscription: { ...subscription, endpoint: `https://push.example/${"a".repeat(17_000)}` } },
      headers: { authorization: "Bearer private-bearer" },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("PAYLOAD_TOO_LARGE");
    const output = logs.join("\n");
    const records = logs.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: expect.stringMatching(/^req_/), method: "POST", statusCode: 400, durationMs: expect.any(Number) }),
      expect.objectContaining({ requestId: expect.stringMatching(/^req_/), method: "POST", statusCode: 413, durationMs: expect.any(Number) }),
    ]));
    for (const secret of [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, "private-bearer", "SECRET_TASK_CANARY"]) {
      expect(output).not.toContain(secret);
    }
    await app.close();
  });
});
