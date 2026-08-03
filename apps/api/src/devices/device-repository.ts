import type { Pool } from "pg";

export type DeviceStatus = "active" | "disabled";

export interface SubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface DeviceRecord {
  id: string;
  deviceId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  secretHash: string;
  status: DeviceStatus;
  createdAt: string;
  updatedAt: string;
  lastErrorCode: string | null;
}

export interface DeviceRepository {
  create(input: DeviceRecord): Promise<void>;
  findByDeviceId(deviceId: string): Promise<DeviceRecord | undefined>;
  updateSubscription(deviceId: string, subscription: SubscriptionRecord, updatedAt: string): Promise<void>;
  deactivateAndCancelPending(deviceId: string, updatedAt: string): Promise<void>;
}

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly pendingJobs = new Map<string, Set<string>>();

  async create(input: DeviceRecord): Promise<void> {
    this.devices.set(input.deviceId, { ...input });
  }

  async findByDeviceId(deviceId: string): Promise<DeviceRecord | undefined> {
    const record = this.devices.get(deviceId);
    return record ? { ...record } : undefined;
  }

  async updateSubscription(deviceId: string, subscription: SubscriptionRecord, updatedAt: string): Promise<void> {
    const record = this.devices.get(deviceId);
    if (!record) return;
    this.devices.set(deviceId, {
      ...record,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      status: "active",
      updatedAt,
    });
  }

  async deactivateAndCancelPending(deviceId: string, updatedAt: string): Promise<void> {
    const record = this.devices.get(deviceId);
    if (record) this.devices.set(deviceId, { ...record, status: "disabled", updatedAt });
    this.pendingJobs.delete(deviceId);
  }

  get(deviceId: string): DeviceRecord | undefined {
    const record = this.devices.get(deviceId);
    return record ? { ...record } : undefined;
  }

  addPendingJob(deviceId: string, reminderId: string): void {
    const jobs = this.pendingJobs.get(deviceId) ?? new Set<string>();
    jobs.add(reminderId);
    this.pendingJobs.set(deviceId, jobs);
  }

  pendingJobsFor(deviceId: string): string[] {
    return [...(this.pendingJobs.get(deviceId) ?? [])];
  }
}

export class PgDeviceRepository implements DeviceRepository {
  constructor(private readonly pool: Pool) {}

  async create(input: DeviceRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_subscriptions
       (id, device_id, endpoint, p256dh, auth, secret_hash, status, created_at, updated_at, last_error_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [input.id, input.deviceId, input.endpoint, input.p256dh, input.auth, input.secretHash, input.status, input.createdAt, input.updatedAt, input.lastErrorCode],
    );
  }

  async findByDeviceId(deviceId: string): Promise<DeviceRecord | undefined> {
    const result = await this.pool.query<{
      id: string; device_id: string; endpoint: string; p256dh: string; auth: string; secret_hash: string;
      status: DeviceStatus; created_at: string; updated_at: string; last_error_code: string | null;
    }>("SELECT * FROM device_subscriptions WHERE device_id = $1", [deviceId]);
    const row = result.rows[0];
    return row && {
      id: row.id, deviceId: row.device_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth,
      secretHash: row.secret_hash, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
      lastErrorCode: row.last_error_code,
    };
  }

  async updateSubscription(deviceId: string, subscription: SubscriptionRecord, updatedAt: string): Promise<void> {
    await this.pool.query(
      "UPDATE device_subscriptions SET endpoint = $1, p256dh = $2, auth = $3, status = 'active', updated_at = $4 WHERE device_id = $5",
      [subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, updatedAt, deviceId],
    );
  }

  async deactivateAndCancelPending(deviceId: string, updatedAt: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE device_subscriptions SET status = 'disabled', updated_at = $1 WHERE device_id = $2", [updatedAt, deviceId]);
      await client.query("UPDATE reminder_jobs SET status = 'cancelled', updated_at = $1 WHERE device_id = $2 AND status IN ('pending', 'claimed')", [updatedAt, deviceId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
