import { createHash, randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { ApiError } from "../errors/api-error.js";
import type { DeviceOperation, DeviceRecord, DeviceRepository, SubscriptionRecord } from "./device-repository.js";

export class DeviceService {
  constructor(private readonly repository: DeviceRepository, private readonly now = () => new Date().toISOString()) {}

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
    const fingerprint = fingerprintFor({ subscription });
    const replay = await this.replay(record, "subscription_update", idempotencyKey, fingerprint);
    if (replay) return replay as { deviceId: string; status: "active"; updatedAt: string };
    this.ensureActive(record);
    const updatedAt = this.now();
    await this.repository.updateSubscription(record.deviceId, subscription, updatedAt);
    const response = { deviceId: record.deviceId, status: "active" as const, updatedAt };
    await this.repository.createOperation({ deviceId, operation: "subscription_update", idempotencyKey, requestFingerprint: fingerprint, responseStatus: 200, responseBody: response, createdAt: updatedAt });
    return response;
  }

  async deactivate(deviceId: string, bearer: string | undefined, idempotencyKey: string): Promise<void> {
    const record = await this.authenticate(deviceId, bearer);
    const fingerprint = fingerprintFor({ delete: true });
    const replay = await this.replay(record, "device_delete", idempotencyKey, fingerprint);
    if (replay) return;
    this.ensureActive(record);
    const updatedAt = this.now();
    await this.repository.deactivateAndCancelPending(record.deviceId, updatedAt);
    await this.repository.createOperation({ deviceId, operation: "device_delete", idempotencyKey, requestFingerprint: fingerprint, responseStatus: 204, responseBody: null, createdAt: updatedAt });
  }

  private async authenticate(deviceId: string, bearer: string | undefined): Promise<DeviceRecord> {
    const record = await this.repository.findByDeviceId(deviceId);
    if (!record) throw new ApiError(404, "DEVICE_NOT_FOUND", "Device not found.");
    if (!bearer || !(await argon2.verify(record.secretHash, bearer))) {
      throw new ApiError(401, "DEVICE_UNAUTHORIZED", "Device authentication failed.");
    }
    return record;
  }

  private ensureActive(record: DeviceRecord): void {
    if (record.status !== "active") throw new ApiError(401, "DEVICE_UNAUTHORIZED", "Device authentication failed.");
  }

  private async replay(record: DeviceRecord, operation: DeviceOperation, idempotencyKey: string, fingerprint: string): Promise<unknown | undefined> {
    const existing = await this.repository.findOperation(record.deviceId, operation, idempotencyKey);
    if (!existing) return undefined;
    if (existing.requestFingerprint !== fingerprint) {
      throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key conflicts with a different request.");
    }
    return existing.responseBody ?? {};
  }
}

function fingerprintFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
