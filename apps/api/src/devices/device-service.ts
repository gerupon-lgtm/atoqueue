import { randomBytes, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { ApiError } from "../errors/api-error.js";
import type { DeviceRecord, DeviceRepository, SubscriptionRecord } from "./device-repository.js";

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

  async updateSubscription(deviceId: string, bearer: string | undefined, subscription: SubscriptionRecord) {
    const record = await this.authenticate(deviceId, bearer);
    const updatedAt = this.now();
    await this.repository.updateSubscription(record.deviceId, subscription, updatedAt);
    return { deviceId: record.deviceId, status: "active" as const, updatedAt };
  }

  async deactivate(deviceId: string, bearer: string | undefined): Promise<void> {
    const record = await this.authenticate(deviceId, bearer);
    await this.repository.deactivateAndCancelPending(record.deviceId, this.now());
  }

  private async authenticate(deviceId: string, bearer: string | undefined): Promise<DeviceRecord> {
    const record = await this.repository.findByDeviceId(deviceId);
    if (!record) throw new ApiError(404, "DEVICE_NOT_FOUND", "Device not found.");
    if (!bearer || record.status !== "active" || !(await argon2.verify(record.secretHash, bearer))) {
      throw new ApiError(401, "DEVICE_UNAUTHORIZED", "Device authentication failed.");
    }
    return record;
  }
}
