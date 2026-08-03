import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { ApiError } from "../errors/api-error.js";
import type { DeviceRateLimiter } from "../plugins/security.js";
import type { DeviceRecord, DeviceRepository, SubscriptionRecord } from "./device-repository.js";

export class DeviceService {
  constructor(
    private readonly repository: DeviceRepository,
    private readonly now = () => new Date().toISOString(),
    private readonly rateLimiter?: DeviceRateLimiter,
  ) {}

  async register(subscription: SubscriptionRecord): Promise<{ deviceId: string; deviceSecret: string; createdAt: string }> {
    const deviceId = randomUUID();
    const deviceSecret = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const record: DeviceRecord = {
      id: randomUUID(), deviceId, endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
      secretHash: await argon2.hash(deviceSecret, { type: argon2.argon2id }), status: "active", createdAt, updatedAt: createdAt, lastErrorCode: null,
    };
    await this.repository.create(record);
    return { deviceId, deviceSecret, createdAt };
  }

  async updateSubscription(deviceId: string, bearer: string | undefined, subscription: SubscriptionRecord, idempotencyKey: string) {
    const record = await this.authenticate(deviceId, bearer);
    this.rateLimiter?.consumeDevice(record.deviceId);
    const fingerprint = fingerprintFor({ subscription });
    const updatedAt = this.now();
    const response = { deviceId: record.deviceId, status: "active" as const, updatedAt };
    const result = await this.repository.runIdempotentOperation({ deviceId, operation: "subscription_update", idempotencyKey, requestFingerprint: fingerprint, subscription, responseStatus: 200, responseBody: response, createdAt: updatedAt });
    return this.responseFrom(result, response) as { deviceId: string; status: "active"; updatedAt: string };
  }

  async deactivate(deviceId: string, bearer: string | undefined, idempotencyKey: string): Promise<void> {
    const record = await this.authenticate(deviceId, bearer);
    this.rateLimiter?.consumeDevice(record.deviceId);
    const fingerprint = fingerprintFor({ delete: true });
    const updatedAt = this.now();
    const result = await this.repository.runIdempotentOperation({ deviceId, operation: "device_delete", idempotencyKey, requestFingerprint: fingerprint, responseStatus: 204, responseBody: null, createdAt: updatedAt });
    this.responseFrom(result, null);
  }

  private async authenticate(deviceId: string, bearer: string | undefined): Promise<DeviceRecord> {
    const record = await this.repository.findByDeviceId(deviceId);
    if (!record) throw new ApiError(404, "DEVICE_NOT_FOUND", "Device not found.");
    if (!bearer || !(await argon2.verify(record.secretHash, bearer))) {
      throw new ApiError(401, "DEVICE_UNAUTHORIZED", "Device authentication failed.");
    }
    return record;
  }

  private responseFrom(result: Awaited<ReturnType<DeviceRepository["runIdempotentOperation"]>>, fallback: unknown): unknown {
    if (result.kind === "conflict") throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key conflicts with a different request.");
    if (result.kind === "missing") throw new ApiError(404, "DEVICE_NOT_FOUND", "Device not found.");
    if (result.kind === "inactive") throw new ApiError(401, "DEVICE_UNAUTHORIZED", "Device authentication failed.");
    return result.responseBody ?? fallback;
  }
}

function fingerprintFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
