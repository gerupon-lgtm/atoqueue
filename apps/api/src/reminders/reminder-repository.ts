import type { Pool, PoolClient } from "pg";
import type { PushSubscriptionRecord } from "../push/push-client.js";
import type { RepeatCadence } from "@atoqueue/contracts";

export type ReminderStatus = "pending" | "claimed" | "sent" | "cancelled" | "failed";

export interface ReminderRecord {
  id: string;
  deviceId: string;
  scheduledAt: string;
  notificationType: "inbox_review" | "task_review" | "deadline_review" | "unset_due_review";
  repeatCadence: RepeatCadence | null;
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
  | { kind: "conflict" | "missing" | "invalid_schedule" };

export interface ReminderRepository {
  upsert(input: Omit<ReminderRecord, "status" | "attemptCount" | "claimedAt" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & { now: string }): Promise<UpsertResult>;
  cancel(deviceId: string, reminderId: string, now: string): Promise<"cancelled" | "missing">;
  claimDue(now: string, limit: number, dueBefore?: string): Promise<DueReminder[]>;
  markSent(reminderId: string, claimedAt: string, now: string): Promise<void>;
  rescheduleAfterSend(reminderId: string, claimedAt: string, nextScheduledAt: string, now: string): Promise<void>;
  retry(reminderId: string, claimedAt: string, scheduledAt: string, attemptCount: number, now: string, errorCode: string): Promise<void>;
  fail(reminderId: string, claimedAt: string, attemptCount: number, now: string, errorCode: string): Promise<void>;
  disableDeviceAndFailPending(deviceId: string, reminderId: string, claimedAt: string, now: string, errorCode: string): Promise<void>;
  recoverStaleClaims(before: string, now: string): Promise<void>;
}

export class InMemoryReminderRepository implements ReminderRepository {
  private readonly jobs = new Map<string, ReminderRecord>();
  private readonly operations = new Map<string, { fingerprint: string; record: ReminderRecord }>();
  private readonly devices = new Map<string, { status: "active" | "disabled"; subscription: PushSubscriptionRecord }>();

  seedDevice(input: { deviceId: string; status: "active" | "disabled"; subscription: PushSubscriptionRecord }): void { this.devices.set(input.deviceId, { ...input }); }
  seed(input: Omit<ReminderRecord, "idempotencyKey" | "repeatCadence" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & Partial<Pick<ReminderRecord, "idempotencyKey" | "repeatCadence" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt">>): void {
    this.jobs.set(input.id, { idempotencyKey: "seed", repeatCadence: null, sentAt: null, lastErrorCode: null, createdAt: nowIso(), updatedAt: nowIso(), ...input });
  }
  get(id: string): ReminderRecord | undefined { const job = this.jobs.get(id); return job && { ...job }; }
  device(deviceId: string): { status: "active" | "disabled"; subscription: PushSubscriptionRecord } | undefined { const device = this.devices.get(deviceId); return device && { ...device, subscription: { ...device.subscription } }; }

  async upsert(input: Omit<ReminderRecord, "status" | "attemptCount" | "claimedAt" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & { now: string }): Promise<UpsertResult> {
    const operation = this.operations.get(operationKey(input));
    if (operation) return operation.fingerprint === fingerprint(input) ? { kind: "replay", record: { ...operation.record } } : { kind: "conflict" };
    for (const job of this.jobs.values()) {
      if (job.deviceId !== input.deviceId || job.idempotencyKey !== input.idempotencyKey) continue;
      if (job.id === input.id && job.scheduledAt === input.scheduledAt && job.notificationType === input.notificationType && job.repeatCadence === input.repeatCadence) return { kind: "replay", record: { ...job } };
      return { kind: "conflict" };
    }
    if (isExpiredNewSchedule(input)) return { kind: "invalid_schedule" };
    const previous = this.jobs.get(input.id);
    if (previous && previous.deviceId !== input.deviceId) return { kind: "missing" };
    const record: ReminderRecord = {
      id: input.id, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: input.repeatCadence,
      idempotencyKey: input.idempotencyKey, status: "pending", attemptCount: 0, claimedAt: null, sentAt: null,
      lastErrorCode: null, createdAt: previous?.createdAt ?? input.now, updatedAt: input.now,
    };
    this.jobs.set(record.id, record);
    this.operations.set(operationKey(input), { fingerprint: fingerprint(input), record: { ...record } });
    return { kind: previous ? "updated" : "created", record: { ...record } };
  }

  async cancel(deviceId: string, reminderId: string, now: string): Promise<"cancelled" | "missing"> {
    const job = this.jobs.get(reminderId);
    if (!job || job.deviceId !== deviceId) return "missing";
    if (job.status === "pending" || job.status === "claimed") this.jobs.set(reminderId, { ...job, status: "cancelled", updatedAt: now });
    return "cancelled";
  }

  async claimDue(now: string, limit: number, dueBefore = now): Promise<DueReminder[]> {
    const claimed: DueReminder[] = [];
    for (const job of this.jobs.values()) {
      const device = this.devices.get(job.deviceId);
      if (claimed.length === limit || job.status !== "pending" || job.scheduledAt > dueBefore || !device || device.status !== "active") continue;
      const record = { ...job, status: "claimed" as const, claimedAt: now, updatedAt: now };
      this.jobs.set(job.id, record);
      claimed.push({ ...record, subscription: { ...device.subscription } });
    }
    return claimed;
  }

  async markSent(reminderId: string, claimedAt: string, now: string): Promise<void> { this.updateClaim(reminderId, claimedAt, { status: "sent", sentAt: now, claimedAt: null, updatedAt: now, lastErrorCode: null }); }
  async rescheduleAfterSend(reminderId: string, claimedAt: string, nextScheduledAt: string, now: string): Promise<void> {
    const job = this.jobs.get(reminderId);
    if (!job || this.devices.get(job.deviceId)?.status !== "active") return;
    this.updateClaim(reminderId, claimedAt, { status: "pending", scheduledAt: nextScheduledAt, claimedAt: null, sentAt: now, updatedAt: now, lastErrorCode: null });
  }
  async retry(reminderId: string, claimedAt: string, scheduledAt: string, attemptCount: number, now: string, errorCode: string): Promise<void> {
    const job = this.jobs.get(reminderId);
    if (!job || this.devices.get(job.deviceId)?.status !== "active") return;
    this.updateClaim(reminderId, claimedAt, { status: "pending", scheduledAt, attemptCount, claimedAt: null, updatedAt: now, lastErrorCode: errorCode });
  }
  async fail(reminderId: string, claimedAt: string, attemptCount: number, now: string, errorCode: string): Promise<void> { this.updateClaim(reminderId, claimedAt, { status: "failed", attemptCount, claimedAt: null, updatedAt: now, lastErrorCode: errorCode }); }
  async disableDeviceAndFailPending(deviceId: string, reminderId: string, claimedAt: string, now: string, errorCode: string): Promise<void> {
    const claimed = this.jobs.get(reminderId);
    if (!claimed || claimed.deviceId !== deviceId || claimed.status !== "claimed" || claimed.claimedAt !== claimedAt) return;
    const device = this.devices.get(deviceId); if (device) this.devices.set(deviceId, { ...device, status: "disabled" });
    for (const job of this.jobs.values()) if (job.deviceId === deviceId && (job.status === "pending" || job.status === "claimed")) this.update(job.id, { status: "failed", claimedAt: null, updatedAt: now, lastErrorCode: errorCode });
  }
  async recoverStaleClaims(before: string, now: string): Promise<void> { for (const job of this.jobs.values()) if (this.devices.get(job.deviceId)?.status === "active" && job.status === "claimed" && job.claimedAt && job.claimedAt < before) this.update(job.id, { status: "pending", claimedAt: null, updatedAt: now }); }
  private update(id: string, patch: Partial<ReminderRecord>): void { const job = this.jobs.get(id); if (job) this.jobs.set(id, { ...job, ...patch }); }
  private updateClaim(id: string, claimedAt: string, patch: Partial<ReminderRecord>): void { const job = this.jobs.get(id); if (job?.status === "claimed" && job.claimedAt === claimedAt) this.jobs.set(id, { ...job, ...patch }); }
}

export class PgReminderRepository implements ReminderRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(input: Omit<ReminderRecord, "status" | "attemptCount" | "claimedAt" | "sentAt" | "lastErrorCode" | "createdAt" | "updatedAt"> & { now: string }): Promise<UpsertResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const priorOperation = await client.query<{ request_fingerprint: string; response_body: string }>("SELECT request_fingerprint, response_body FROM reminder_idempotency_operations WHERE device_id=$1 AND reminder_id=$2 AND idempotency_key=$3 FOR UPDATE", [input.deviceId, input.id, input.idempotencyKey]);
      const prior = priorOperation.rows[0];
      if (prior) { await client.query("COMMIT"); return matchesFingerprint(prior.request_fingerprint, input) ? { kind: "replay", record: normalizeRecord(JSON.parse(prior.response_body) as ReminderRecord) } : { kind: "conflict" }; }
      const existingKey = await client.query<Row>("SELECT * FROM reminder_jobs WHERE device_id = $1 AND idempotency_key = $2 FOR UPDATE", [input.deviceId, input.idempotencyKey]);
      const sameKey = existingKey.rows[0];
      if (sameKey) {
        await client.query("COMMIT");
        const record = rowToRecord(sameKey);
        return record.id === input.id && record.scheduledAt === input.scheduledAt && record.notificationType === input.notificationType && record.repeatCadence === input.repeatCadence ? { kind: "replay", record } : { kind: "conflict" };
      }
      if (isExpiredNewSchedule(input)) { await client.query("COMMIT"); return { kind: "invalid_schedule" }; }
      const inserted = await client.query<Row>(
        `INSERT INTO reminder_jobs (id, device_id, scheduled_at, notification_type, repeat_cadence, status, idempotency_key, attempt_count, claimed_at, sent_at, last_error_code, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,0,NULL,NULL,NULL,$7,$7)
         ON CONFLICT DO NOTHING RETURNING *`, [input.id, input.deviceId, input.scheduledAt, input.notificationType, input.repeatCadence, input.idempotencyKey, input.now],
      );
      if (inserted.rows[0]) { const record = rowToRecord(inserted.rows[0]); await this.recordOperation(client, input, record); await client.query("COMMIT"); return { kind: "created", record }; }
      const keyAfterConflict = await client.query<Row>("SELECT * FROM reminder_jobs WHERE device_id = $1 AND idempotency_key = $2 FOR UPDATE", [input.deviceId, input.idempotencyKey]);
      const replay = keyAfterConflict.rows[0];
      if (replay) { await client.query("COMMIT"); return matchesRequest(replay, input) ? { kind: "replay", record: rowToRecord(replay) } : { kind: "conflict" }; }
      const existing = await client.query<Row>("SELECT * FROM reminder_jobs WHERE id = $1 FOR UPDATE", [input.id]);
      const previous = existing.rows[0];
      if (!previous || previous.device_id !== input.deviceId) { await client.query("COMMIT"); return { kind: "missing" }; }
      const result = await client.query<Row>(
        `UPDATE reminder_jobs SET scheduled_at=$1, notification_type=$2, repeat_cadence=$3, status='pending', idempotency_key=$4, attempt_count=0, claimed_at=NULL, sent_at=NULL, last_error_code=NULL, updated_at=$5
         WHERE id=$6 AND device_id=$7 RETURNING *`, [input.scheduledAt, input.notificationType, input.repeatCadence, input.idempotencyKey, input.now, input.id, input.deviceId],
      );
      const record = rowToRecord(result.rows[0]!);
      await this.recordOperation(client, input, record);
      await client.query("COMMIT");
      return { kind: "updated", record };
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error)) return this.resolveUniqueConflict(input);
      throw error;
    } finally { client.release(); }
  }
  async cancel(deviceId: string, reminderId: string, now: string): Promise<"cancelled" | "missing"> {
    const result = await this.pool.query("UPDATE reminder_jobs SET status='cancelled', updated_at=$1 WHERE id=$2 AND device_id=$3 AND status IN ('pending','claimed')", [now, reminderId, deviceId]);
    if (result.rowCount) return "cancelled";
    const owned = await this.pool.query("SELECT 1 FROM reminder_jobs WHERE id=$1 AND device_id=$2", [reminderId, deviceId]);
    return owned.rowCount ? "cancelled" : "missing";
  }
  async claimDue(now: string, limit: number, dueBefore = now): Promise<DueReminder[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row & DeviceRow>(
        `WITH due AS (SELECT job.id FROM reminder_jobs job JOIN device_subscriptions device ON device.device_id=job.device_id WHERE job.status='pending' AND job.scheduled_at <= $2 AND device.status='active' ORDER BY job.scheduled_at FOR UPDATE OF job SKIP LOCKED LIMIT $3)
         UPDATE reminder_jobs job SET status='claimed', claimed_at=$1, updated_at=$1 FROM due, device_subscriptions device
         WHERE job.id=due.id AND device.device_id=job.device_id
         RETURNING job.*, device.endpoint, device.p256dh, device.auth`, [now, dueBefore, limit],
      );
      await client.query("COMMIT");
      return result.rows.map((row) => ({ ...rowToRecord(row), subscription: { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth } }));
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async markSent(id: string, claimedAt: string, now: string): Promise<void> { await this.pool.query("UPDATE reminder_jobs SET status='sent', sent_at=$1, claimed_at=NULL, last_error_code=NULL, updated_at=$1 WHERE id=$2 AND status='claimed' AND claimed_at=$3", [now, id, claimedAt]); }
  async rescheduleAfterSend(id: string, claimedAt: string, nextScheduledAt: string, now: string): Promise<void> { await this.withActiveDeviceLock(id, (client) => client.query("UPDATE reminder_jobs SET status='pending', scheduled_at=$1, sent_at=$2, claimed_at=NULL, last_error_code=NULL, updated_at=$2 WHERE id=$3 AND status='claimed' AND claimed_at=$4", [nextScheduledAt, now, id, claimedAt]).then(() => undefined)); }
  async retry(id: string, claimedAt: string, scheduledAt: string, attemptCount: number, now: string, errorCode: string): Promise<void> { await this.withActiveDeviceLock(id, (client) => client.query("UPDATE reminder_jobs SET status='pending', scheduled_at=$1, attempt_count=$2, claimed_at=NULL, last_error_code=$3, updated_at=$4 WHERE id=$5 AND status='claimed' AND claimed_at=$6", [scheduledAt, attemptCount, errorCode, now, id, claimedAt]).then(() => undefined)); }
  async fail(id: string, claimedAt: string, attemptCount: number, now: string, errorCode: string): Promise<void> { await this.pool.query("UPDATE reminder_jobs SET status='failed', attempt_count=$1, claimed_at=NULL, last_error_code=$2, updated_at=$3 WHERE id=$4 AND status='claimed' AND claimed_at=$5", [attemptCount, errorCode, now, id, claimedAt]); }
  async disableDeviceAndFailPending(deviceId: string, reminderId: string, claimedAt: string, now: string, errorCode: string): Promise<void> { const client = await this.pool.connect(); try { await client.query("BEGIN"); const device = await client.query<{ status: "active" | "disabled" }>("SELECT status FROM device_subscriptions WHERE device_id=$1 FOR UPDATE", [deviceId]); if (device.rows[0]?.status !== "active") { await client.query("COMMIT"); return; } const claimed = await client.query("UPDATE reminder_jobs SET status='failed', claimed_at=NULL, last_error_code=$1, updated_at=$2 WHERE id=$3 AND device_id=$4 AND status='claimed' AND claimed_at=$5", [errorCode, now, reminderId, deviceId, claimedAt]); if (claimed.rowCount) { await client.query("UPDATE device_subscriptions SET status='disabled', last_error_code=$1, updated_at=$2 WHERE device_id=$3", [errorCode, now, deviceId]); await client.query("UPDATE reminder_jobs SET status='failed', claimed_at=NULL, last_error_code=$1, updated_at=$2 WHERE device_id=$3 AND status IN ('pending','claimed')", [errorCode, now, deviceId]); } await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }
  async recoverStaleClaims(before: string, now: string): Promise<void> { const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("SELECT device.device_id FROM device_subscriptions device WHERE device.status='active' AND EXISTS (SELECT 1 FROM reminder_jobs job WHERE job.device_id=device.device_id AND job.status='claimed' AND job.claimed_at < $1) FOR UPDATE", [before]); await client.query("UPDATE reminder_jobs job SET status='pending', claimed_at=NULL, updated_at=$1 FROM device_subscriptions device WHERE job.device_id=device.device_id AND device.status='active' AND job.status='claimed' AND job.claimed_at < $2", [now, before]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); } }

  private async withActiveDeviceLock(id: string, update: (client: PoolClient) => Promise<void>): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const device = await client.query<{ status: "active" | "disabled" }>("SELECT device.status FROM reminder_jobs job JOIN device_subscriptions device ON device.device_id=job.device_id WHERE job.id=$1 FOR UPDATE OF device", [id]);
      if (device.rows[0]?.status === "active") await update(client);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  private async resolveUniqueConflict(input: Parameters<ReminderRepository["upsert"]>[0]): Promise<UpsertResult> {
    const operation = await this.pool.query<{ request_fingerprint: string; response_body: string }>("SELECT request_fingerprint, response_body FROM reminder_idempotency_operations WHERE device_id=$1 AND reminder_id=$2 AND idempotency_key=$3", [input.deviceId, input.id, input.idempotencyKey]);
    const operationRow = operation.rows[0];
    if (operationRow) return matchesFingerprint(operationRow.request_fingerprint, input) ? { kind: "replay", record: normalizeRecord(JSON.parse(operationRow.response_body) as ReminderRecord) } : { kind: "conflict" };
    const sameKey = await this.pool.query<Row>("SELECT * FROM reminder_jobs WHERE device_id=$1 AND idempotency_key=$2", [input.deviceId, input.idempotencyKey]);
    const keyRecord = sameKey.rows[0];
    if (keyRecord) return matchesRequest(keyRecord, input) ? { kind: "replay", record: rowToRecord(keyRecord) } : { kind: "conflict" };
    const sameId = await this.pool.query<Row>("SELECT * FROM reminder_jobs WHERE id=$1", [input.id]);
    const idRecord = sameId.rows[0];
    if (!idRecord || idRecord.device_id !== input.deviceId) return { kind: "missing" };
    return matchesRequest(idRecord, input) ? { kind: "replay", record: rowToRecord(idRecord) } : { kind: "conflict" };
  }

  private async recordOperation(client: { query(sql: string, values: unknown[]): Promise<unknown> }, input: Parameters<ReminderRepository["upsert"]>[0], record: ReminderRecord): Promise<void> {
    await client.query("INSERT INTO reminder_idempotency_operations (device_id, reminder_id, idempotency_key, request_fingerprint, response_body, created_at) VALUES ($1,$2,$3,$4,$5,$6)", [input.deviceId, input.id, input.idempotencyKey, fingerprint(input), JSON.stringify(record), input.now]);
  }
}

type Row = { id: string; device_id: string; scheduled_at: string; notification_type: ReminderRecord["notificationType"]; repeat_cadence: RepeatCadence | null; status: ReminderStatus; idempotency_key: string; attempt_count: number; claimed_at: string | null; sent_at: string | null; last_error_code: string | null; created_at: string; updated_at: string };
type DeviceRow = { endpoint: string; p256dh: string; auth: string };
function rowToRecord(row: Row): ReminderRecord { return { id: row.id, deviceId: row.device_id, scheduledAt: row.scheduled_at, notificationType: row.notification_type, repeatCadence: row.repeat_cadence, status: row.status, idempotencyKey: row.idempotency_key, attemptCount: row.attempt_count, claimedAt: row.claimed_at, sentAt: row.sent_at, lastErrorCode: row.last_error_code, createdAt: row.created_at, updatedAt: row.updated_at }; }
function normalizeRecord(record: ReminderRecord): ReminderRecord { return { ...record, repeatCadence: record.repeatCadence ?? null }; }
function nowIso(): string { return new Date().toISOString(); }
function matchesRequest(row: Row, input: Parameters<ReminderRepository["upsert"]>[0]): boolean { return row.id === input.id && row.scheduled_at === input.scheduledAt && row.notification_type === input.notificationType && row.repeat_cadence === input.repeatCadence; }
function isUniqueViolation(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "23505"; }
function fingerprint(input: Parameters<ReminderRepository["upsert"]>[0]): string { return JSON.stringify({ id: input.id, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: input.repeatCadence }); }
function legacyFingerprint(input: Parameters<ReminderRepository["upsert"]>[0]): string { return JSON.stringify({ id: input.id, scheduledAt: input.scheduledAt, notificationType: input.notificationType }); }
function matchesFingerprint(stored: string, input: Parameters<ReminderRepository["upsert"]>[0]): boolean { return stored === fingerprint(input) || (input.repeatCadence === null && stored === legacyFingerprint(input)); }
function operationKey(input: Parameters<ReminderRepository["upsert"]>[0]): string { return `${input.deviceId}:${input.id}:${input.idempotencyKey}`; }
/** A replay acknowledges an existing operation even after dispatch advanced its time. */
function isExpiredNewSchedule(input: Parameters<ReminderRepository["upsert"]>[0]): boolean { return Date.parse(input.scheduledAt) < Date.parse(input.now) - 5 * 60_000; }
