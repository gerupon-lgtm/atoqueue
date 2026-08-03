import type { Pool } from "pg";
import type { PushSubscriptionRecord } from "../push/push-client.js";

export type ReminderStatus = "pending" | "claimed" | "sent" | "cancelled" | "failed";

export interface ReminderRecord {
  id: string;
  deviceId: string;
  scheduledAt: string;
  notificationType: "task_review" | "deadline_review" | "unset_due_review";
  status: ReminderStatus;
  idempotencyKey: string;
  attemptCount: number;
  claimedAt: string | null;
  sentAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DueReminder extends ReminderRecord {
  subscription: PushSubscriptionRecord;
}

export type UpsertResult =
  | { kind: "created" | "updated"; record: ReminderRecord }
  | { kind: "replay"; record: ReminderRecord }
  | { kind: "conflict" };

export interface ReminderRepository {
  upsert(input: Omit<ReminderRecord, "status" | "attemptCount" | "claimedAt" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & { now: string }): Promise<UpsertResult>;
  cancel(deviceId: string, reminderId: string, now: string): Promise<"cancelled" | "missing">;
  claimDue(now: string, limit: number): Promise<DueReminder[]>;
  markSent(reminderId: string, now: string): Promise<void>;
  retry(reminderId: string, scheduledAt: string, attemptCount: number, now: string, errorCode: string): Promise<void>;
  fail(reminderId: string, attemptCount: number, now: string, errorCode: string): Promise<void>;
  disableDeviceAndFailPending(deviceId: string, now: string, errorCode: string): Promise<void>;
  recoverStaleClaims(before: string, now: string): Promise<void>;
}

export class InMemoryReminderRepository implements ReminderRepository {
  private readonly jobs = new Map<string, ReminderRecord>();
  private readonly devices = new Map<string, { status: "active" | "disabled"; subscription: PushSubscriptionRecord }>();

  seedDevice(input: { deviceId: string; status: "active" | "disabled"; subscription: PushSubscriptionRecord }): void { this.devices.set(input.deviceId, { ...input }); }
  seed(input: Omit<ReminderRecord, "idempotencyKey" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & Partial<Pick<ReminderRecord, "idempotencyKey" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt">>): void {
    this.jobs.set(input.id, { idempotencyKey: "seed", sentAt: null, lastErrorCode: null, createdAt: nowIso(), updatedAt: nowIso(), ...input });
  }
  get(id: string): ReminderRecord | undefined { const job = this.jobs.get(id); return job && { ...job }; }
  device(deviceId: string): { status: "active" | "disabled"; subscription: PushSubscriptionRecord } | undefined { const device = this.devices.get(deviceId); return device && { ...device, subscription: { ...device.subscription } }; }

  async upsert(input: Omit<ReminderRecord, "status" | "attemptCount" | "claimedAt" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & { now: string }): Promise<UpsertResult> {
    for (const job of this.jobs.values()) {
      if (job.deviceId !== input.deviceId || job.idempotencyKey !== input.idempotencyKey) continue;
      if (job.id === input.id && job.scheduledAt === input.scheduledAt && job.notificationType === input.notificationType) return { kind: "replay", record: { ...job } };
      return { kind: "conflict" };
    }
    const previous = this.jobs.get(input.id);
    if (previous && previous.deviceId !== input.deviceId) return { kind: "conflict" };
    const record: ReminderRecord = {
      id: input.id, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType,
      idempotencyKey: input.idempotencyKey, status: "pending", attemptCount: 0, claimedAt: null, sentAt: null,
      lastErrorCode: null, createdAt: previous?.createdAt ?? input.now, updatedAt: input.now,
    };
    this.jobs.set(record.id, record);
    return { kind: previous ? "updated" : "created", record: { ...record } };
  }

  async cancel(deviceId: string, reminderId: string, now: string): Promise<"cancelled" | "missing"> {
    const job = this.jobs.get(reminderId);
    if (!job || job.deviceId !== deviceId) return "missing";
    if (job.status === "pending" || job.status === "claimed") this.jobs.set(reminderId, { ...job, status: "cancelled", updatedAt: now });
    return "cancelled";
  }

  async claimDue(now: string, limit: number): Promise<DueReminder[]> {
    const claimed: DueReminder[] = [];
    for (const job of this.jobs.values()) {
      const device = this.devices.get(job.deviceId);
      if (claimed.length === limit || job.status !== "pending" || job.scheduledAt > now || !device || device.status !== "active") continue;
      const record = { ...job, status: "claimed" as const, claimedAt: now, updatedAt: now };
      this.jobs.set(job.id, record);
      claimed.push({ ...record, subscription: { ...device.subscription } });
    }
    return claimed;
  }

  async markSent(reminderId: string, now: string): Promise<void> { this.update(reminderId, { status: "sent", sentAt: now, claimedAt: null, updatedAt: now, lastErrorCode: null }); }
  async retry(reminderId: string, scheduledAt: string, attemptCount: number, now: string, errorCode: string): Promise<void> { this.update(reminderId, { status: "pending", scheduledAt, attemptCount, claimedAt: null, updatedAt: now, lastErrorCode: errorCode }); }
  async fail(reminderId: string, attemptCount: number, now: string, errorCode: string): Promise<void> { this.update(reminderId, { status: "failed", attemptCount, claimedAt: null, updatedAt: now, lastErrorCode: errorCode }); }
  async disableDeviceAndFailPending(deviceId: string, now: string, errorCode: string): Promise<void> {
    const device = this.devices.get(deviceId); if (device) this.devices.set(deviceId, { ...device, status: "disabled" });
    for (const job of this.jobs.values()) if (job.deviceId === deviceId && (job.status === "pending" || job.status === "claimed")) this.update(job.id, { status: "failed", claimedAt: null, updatedAt: now, lastErrorCode: errorCode });
  }
  async recoverStaleClaims(before: string, now: string): Promise<void> { for (const job of this.jobs.values()) if (job.status === "claimed" && job.claimedAt && job.claimedAt < before) this.update(job.id, { status: "pending", claimedAt: null, updatedAt: now }); }
  private update(id: string, patch: Partial<ReminderRecord>): void { const job = this.jobs.get(id); if (job) this.jobs.set(id, { ...job, ...patch }); }
}

export class PgReminderRepository implements ReminderRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(input: Omit<ReminderRecord, "status" | "attemptCount" | "claimedAt" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & { now: string }): Promise<UpsertResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingKey = await client.query<Row>("SELECT * FROM reminder_jobs WHERE device_id = $1 AND idempotency_key = $2 FOR UPDATE", [input.deviceId, input.idempotencyKey]);
      const sameKey = existingKey.rows[0];
      if (sameKey) {
        await client.query("COMMIT");
        const record = rowToRecord(sameKey);
        return record.id === input.id && record.scheduledAt === input.scheduledAt && record.notificationType === input.notificationType ? { kind: "replay", record } : { kind: "conflict" };
      }
      const existing = await client.query<Row>("SELECT * FROM reminder_jobs WHERE id = $1 FOR UPDATE", [input.id]);
      const previous = existing.rows[0];
      if (previous && previous.device_id !== input.deviceId) { await client.query("COMMIT"); return { kind: "conflict" }; }
      const status = previous ? "updated" : "created";
      const result = await client.query<Row>(
        `INSERT INTO reminder_jobs (id, device_id, scheduled_at, notification_type, status, idempotency_key, attempt_count, claimed_at, sent_at, last_error_code, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'pending',$5,0,NULL,NULL,NULL,$6,$6)
         ON CONFLICT (id) DO UPDATE SET scheduled_at=EXCLUDED.scheduled_at, notification_type=EXCLUDED.notification_type, status='pending', idempotency_key=EXCLUDED.idempotency_key, attempt_count=0, claimed_at=NULL, sent_at=NULL, last_error_code=NULL, updated_at=EXCLUDED.updated_at
         RETURNING *`, [input.id, input.deviceId, input.scheduledAt, input.notificationType, input.idempotencyKey, input.now],
      );
      await client.query("COMMIT");
      return { kind: status, record: rowToRecord(result.rows[0]!) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async cancel(deviceId: string, reminderId: string, now: string): Promise<"cancelled" | "missing"> {
    const result = await this.pool.query("UPDATE reminder_jobs SET status='cancelled', updated_at=$1 WHERE id=$2 AND device_id=$3 AND status IN ('pending','claimed')", [now, reminderId, deviceId]);
    if (result.rowCount) return "cancelled";
    const owned = await this.pool.query("SELECT 1 FROM reminder_jobs WHERE id=$1 AND device_id=$2", [reminderId, deviceId]);
    return owned.rowCount ? "cancelled" : "missing";
  }
  async claimDue(now: string, limit: number): Promise<DueReminder[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row & DeviceRow>(
        `WITH due AS (SELECT id FROM reminder_jobs WHERE status='pending' AND scheduled_at <= $1 ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT $2)
         UPDATE reminder_jobs job SET status='claimed', claimed_at=$1, updated_at=$1 FROM due, device_subscriptions device
         WHERE job.id=due.id AND device.device_id=job.device_id AND device.status='active'
         RETURNING job.*, device.endpoint, device.p256dh, device.auth`, [now, limit],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({ ...rowToRecord(row), subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth } }));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async markSent(id: string, now: string): Promise<void> { await this.pool.query("UPDATE reminder_jobs SET status='sent', sent_at=$1, claimed_at=NULL, last_error_code=NULL, updated_at=$1 WHERE id=$2 AND status='claimed'", [now, id]); }
  async retry(id: string, scheduledAt: string, attemptCount: number, now: string, errorCode: string): Promise<void> { await this.pool.query("UPDATE reminder_jobs SET status='pending', scheduled_at=$1, attempt_count=$2, claimed_at=NULL, last_error_code=$3, updated_at=$4 WHERE id=$5 AND status='claimed'", [scheduledAt, attemptCount, errorCode, now, id]); }
  async fail(id: string, attemptCount: number, now: string, errorCode: string): Promise<void> { await this.pool.query("UPDATE reminder_jobs SET status='failed', attempt_count=$1, claimed_at=NULL, last_error_code=$2, updated_at=$3 WHERE id=$4 AND status='claimed'", [attemptCount, errorCode, now, id]); }
  async disableDeviceAndFailPending(deviceId: string, now: string, errorCode: string): Promise<void> { const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE device_subscriptions SET status='disabled', last_error_code=$1, updated_at=$2 WHERE device_id=$3", [errorCode, now, deviceId]); await client.query("UPDATE reminder_jobs SET status='failed', claimed_at=NULL, last_error_code=$1, updated_at=$2 WHERE device_id=$3 AND status IN ('pending','claimed')", [errorCode, now, deviceId]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async recoverStaleClaims(before: string, now: string): Promise<void> { await this.pool.query("UPDATE reminder_jobs SET status='pending', claimed_at=NULL, updated_at=$1 WHERE status='claimed' AND claimed_at < $2", [now, before]); }
}

type Row = { id: string; device_id: string; scheduled_at: string; notification_type: ReminderRecord["notificationType"]; status: ReminderStatus; idempotency_key: string; attempt_count: number; claimed_at: string | null; sent_at: string | null; last_error_code: string | null; created_at: string; updated_at: string };
type DeviceRow = { endpoint: string; p256dh: string; auth: string };
function rowToRecord(row: Row): ReminderRecord { return { id: row.id, deviceId: row.device_id, scheduledAt: row.scheduled_at, notificationType: row.notification_type, status: row.status, idempotencyKey: row.idempotency_key, attemptCount: row.attempt_count, claimedAt: row.claimed_at, sentAt: row.sent_at, lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at }; }
function nowIso(): string { return new Date().toISOString(); }
