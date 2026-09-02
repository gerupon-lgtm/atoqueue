import { createHash } from "node:crypto";
import argon2 from "argon2";
import { ApiError } from "../errors/api-error.js";
import type { DeviceRateLimiter } from "../plugins/security.js";
import type { DeviceRepository } from "../devices/device-repository.js";
import type { ReminderRepository } from "./reminder-repository.js";
import type { RepeatCadence } from "@atoqueue/contracts";

export class ReminderService {
  constructor(
    private readonly devices: DeviceRepository,
    private readonly reminders: ReminderRepository,
    private readonly now = () => new Date().toISOString(),
    private readonly rateLimiter?: DeviceRateLimiter,
  ) {}

  async upsert(input: { deviceId: string; bearer: string | undefined; reminderId: string; scheduledAt: string; notificationType: "inbox_review" | "task_review" | "deadline_review" | "unset_due_review"; repeatCadence?: RepeatCadence; idempotencyKey: string }) {
    await this.authenticate(input.deviceId, input.bearer);
    this.rateLimiter?.consumeDevice(input.deviceId);
    const now = this.now();
    const result = await this.reminders.upsert({ id: input.reminderId, deviceId: input.deviceId, scheduledAt: input.scheduledAt, notificationType: input.notificationType, repeatCadence: input.repeatCadence ?? null, idempotencyKey: input.idempotencyKey, now });
    if (!("record" in result)) {
      if (result.kind === "invalid_schedule") throw new ApiError(400, "INVALID_SCHEDULE", "Scheduled time is too far in the past.");
      if (result.kind === "conflict") throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency key conflicts with a different request.");
      throw new ApiError(404, "REMINDER_NOT_FOUND", "Reminder not found.");
    }
    const record = result.record;
    return { created: result.kind === "created" || (result.kind === "replay" && record.createdAt === record.updatedAt), response: { reminderId: record.id, status: "pending" as const, scheduledAt: record.scheduledAt, repeatCadence: record.repeatCadence, updatedAt: record.updatedAt } };
  }

  async cancel(input: { deviceId: string; bearer: string | undefined; reminderId: string }): Promise<void> {
    await this.authenticate(input.deviceId, input.bearer);
    this.rateLimiter?.consumeDevice(input.deviceId);
    const result = await this.reminders.cancel(input.deviceId, input.reminderId, this.now());
    if (result === "missing") throw new ApiError(404, "REMINDER_NOT_FOUND", "Reminder not found.");
  }

  private async authenticate(deviceId: string, bearer: string | undefined): Promise<void> {
    const device = await this.devices.findByDeviceId(deviceId);
    if (!device) throw new ApiError(404, "DEVICE_NOT_FOUND", "Device not found.");
    if (!bearer || !(await argon2.verify(device.secretHash, bearer)) || device.status !== "active") throw new ApiError(401, "DEVICE_UNAUTHORIZED", "Device authentication failed.");
  }
}

export function reminderFingerprint(input: Pick<{ reminderId: string; scheduledAt: string; notificationType: "inbox_review" | "task_review" | "deadline_review" | "unset_due_review"; repeatCadence: RepeatCadence | null }, "reminderId" | "scheduledAt" | "notificationType" | "repeatCadence">): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
