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

export type DeviceOperation = "subscription_update" | "device_delete";

export interface IdempotencyOperation {
  deviceId: string;
  operation: DeviceOperation;
  idempotencyKey: string;
  requestFingerprint: string;
  responseStatus: number;
  responseBody: unknown | null;
  createdAt: string;
}

export interface IdempotentOperationInput {
  deviceId: string;
  operation: DeviceOperation;
  idempotencyKey: string;
  requestFingerprint: string;
  subscription?: SubscriptionRecord;
  responseStatus: number;
  responseBody: unknown | null;
  createdAt: string;
}

export type IdempotentOperationResult =
  | { kind: "applied"; responseBody: unknown | null }
  | { kind: "replay"; responseBody: unknown | null }
  | { kind: "conflict" }
  | { kind: "inactive" }
  | { kind: "missing" };

export interface DeviceRepository {
  create(input: DeviceRecord): Promise<void>;
  findByDeviceId(deviceId: string): Promise<DeviceRecord | undefined>;
  updateSubscription(deviceId: string, subscription: SubscriptionRecord, updatedAt: string): Promise<void>;
  deactivateAndCancelPending(deviceId: string, updatedAt: string): Promise<void>;
  findOperation(deviceId: string, operation: DeviceOperation, idempotencyKey: string): Promise<IdempotencyOperation | undefined>;
  createOperation(input: IdempotencyOperation): Promise<void>;
  runIdempotentOperation(input: IdempotentOperationInput): Promise<IdempotentOperationResult>;
}

export class InMemoryDeviceRepository implements DeviceRepository {
  private readonly devices = new Map<string, DeviceRecord>();
  private readonly pendingJobs = new Map<string, Set<string>>();
  private readonly operations = new Map<string, IdempotencyOperation>();

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

  async findOperation(deviceId: string, operation: DeviceOperation, idempotencyKey: string): Promise<IdempotencyOperation | undefined> {
    const found = this.operations.get(`${deviceId}:${operation}:${idempotencyKey}`);
    return found && { ...found };
  }

  async createOperation(input: IdempotencyOperation): Promise<void> {
    this.operations.set(`${input.deviceId}:${input.operation}:${input.idempotencyKey}`, { ...input });
  }

  async runIdempotentOperation(input: IdempotentOperationInput): Promise<IdempotentOperationResult> {
    const record = this.devices.get(input.deviceId);
    if (!record) return { kind: "missing" };
    const existing = await this.findOperation(input.deviceId, input.operation, input.idempotencyKey);
    if (existing) return existing.requestFingerprint === input.requestFingerprint
      ? { kind: "replay", responseBody: existing.responseBody }
      : { kind: "conflict" };
    if (record.status !== "active") return { kind: "inactive" };
    if (input.operation === "subscription_update") {
      if (!input.subscription) throw new Error("subscription update requires a subscription");
      await this.updateSubscription(input.deviceId, input.subscription, input.createdAt);
    } else {
      await this.deactivateAndCancelPending(input.deviceId, input.createdAt);
    }
    await this.createOperation({ ...input });
    return { kind: "applied", responseBody: input.responseBody };
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

  async findOperation(deviceId: string, operation: DeviceOperation, idempotencyKey: string): Promise<IdempotencyOperation | undefined> {
    const result = await this.pool.query<{
      device_id: string; operation: DeviceOperation; idempotency_key: string; request_fingerprint: string;
      response_status: number; response_body: string | null; created_at: string;
    }>(
      "SELECT * FROM device_idempotency_operations WHERE device_id = $1 AND operation = $2 AND idempotency_key = $3",
      [deviceId, operation, idempotencyKey],
    );
    const row = result.rows[0];
    return row && {
      deviceId: row.device_id, operation: row.operation, idempotencyKey: row.idempotency_key,
      requestFingerprint: row.request_fingerprint, responseStatus: row.response_status,
      responseBody: row.response_body === null ? null : JSON.parse(row.response_body), createdAt: row.created_at,
    };
  }

  async createOperation(input: IdempotencyOperation): Promise<void> {
    await this.pool.query(
      `INSERT INTO device_idempotency_operations
       (device_id, operation, idempotency_key, request_fingerprint, response_status, response_body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.deviceId, input.operation, input.idempotencyKey, input.requestFingerprint, input.responseStatus,
        input.responseBody === null ? null : JSON.stringify(input.responseBody), input.createdAt],
    );
  }

  async runIdempotentOperation(input: IdempotentOperationInput): Promise<IdempotentOperationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const device = await client.query<{
        id: string; device_id: string; endpoint: string; p256dh: string; auth: string; secret_hash: string;
        status: DeviceStatus; created_at: string; updated_at: string; last_error_code: string | null;
      }>("SELECT * FROM device_subscriptions WHERE device_id = $1 FOR UPDATE", [input.deviceId]);
      const record = device.rows[0];
      if (!record) {
        await client.query("COMMIT");
        return { kind: "missing" };
      }
      const operation = await client.query<{ request_fingerprint: string; response_body: string | null }>(
        "SELECT * FROM device_idempotency_operations WHERE device_id = $1 AND operation = $2 AND idempotency_key = $3",
        [input.deviceId, input.operation, input.idempotencyKey],
      );
      const existing = operation.rows[0];
      if (existing) {
        await client.query("COMMIT");
        return existing.request_fingerprint === input.requestFingerprint
          ? { kind: "replay", responseBody: existing.response_body === null ? null : JSON.parse(existing.response_body) }
          : { kind: "conflict" };
      }
      if (record.status !== "active") {
        await client.query("COMMIT");
        return { kind: "inactive" };
      }
      if (input.operation === "subscription_update") {
        if (!input.subscription) throw new Error("subscription update requires a subscription");
        await client.query(
          "UPDATE device_subscriptions SET endpoint = $1, p256dh = $2, auth = $3, status = 'active', updated_at = $4 WHERE device_id = $5",
          [input.subscription.endpoint, input.subscription.keys.p256dh, input.subscription.keys.auth, input.createdAt, input.deviceId],
        );
      } else {
        await client.query("UPDATE device_subscriptions SET status = 'disabled', updated_at = $1 WHERE device_id = $2", [input.createdAt, input.deviceId]);
        await client.query("UPDATE reminder_jobs SET status = 'cancelled', updated_at = $1 WHERE device_id = $2 AND status IN ('pending', 'claimed')", [input.createdAt, input.deviceId]);
      }
      await client.query(
        `INSERT INTO device_idempotency_operations
         (device_id, operation, idempotency_key, request_fingerprint, response_status, response_body, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.deviceId, input.operation, input.idempotencyKey, input.requestFingerprint, input.responseStatus,
          input.responseBody === null ? null : JSON.stringify(input.responseBody), input.createdAt],
      );
      await client.query("COMMIT");
      return { kind: "applied", responseBody: input.responseBody };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
