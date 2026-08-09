import type { PushClient } from "../push/push-client.js";
import type { ReminderRepository } from "../reminders/reminder-repository.js";

const RETRY_MINUTES = [5, 15, 60] as const;

export class ReminderDispatcher {
  constructor(
    private readonly repository: ReminderRepository,
    private readonly push: PushClient,
    private readonly clock = () => new Date(),
    private readonly deliveryLeadSeconds = 0,
  ) {}

  async recoverStaleClaims(): Promise<void> {
    const now = this.clock();
    await this.repository.recoverStaleClaims(new Date(now.getTime() - 15 * 60_000).toISOString(), now.toISOString());
  }

  async dispatchDue(): Promise<void> {
    const now = this.clock();
    const claimedAt = now.toISOString();
    const dueBefore = new Date(now.getTime() + this.deliveryLeadSeconds * 1_000).toISOString();
    const jobs = await this.repository.claimDue(claimedAt, 100, dueBefore);
    await Promise.all(jobs.map((job) => this.send(job, now)));
  }

  private async send(job: Awaited<ReturnType<ReminderRepository["claimDue"]>>[number], now: Date): Promise<void> {
    const claimedAt = job.claimedAt;
    if (!claimedAt) return;
    try {
      const path = job.notificationType === "inbox_review" ? "/inbox" : "/today";
      const result = await this.push.send({ subscription: job.subscription, payload: { type: "review_due", reminderId: job.id, url: `${path}?reminder=${job.id}` } });
      if (result.statusCode >= 200 && result.statusCode < 300) {
        if (job.repeatCadence) await this.repository.rescheduleAfterSend(job.id, claimedAt, nextScheduledAt(now, job.repeatCadence), now.toISOString());
        else await this.repository.markSent(job.id, claimedAt, now.toISOString());
        return;
      }
      if (result.statusCode === 404 || result.statusCode === 410) { await this.repository.disableDeviceAndFailPending(job.deviceId, job.id, claimedAt, now.toISOString(), `push_${result.statusCode}`); return; }
      await this.handleTemporary(job.id, claimedAt, job.attemptCount, now, `push_${result.statusCode}`);
    } catch {
      await this.handleTemporary(job.id, claimedAt, job.attemptCount, now, "push_error");
    }
  }

  private async handleTemporary(id: string, claimedAt: string, currentAttempts: number, now: Date, code: string): Promise<void> {
    const attemptCount = currentAttempts + 1;
    if (attemptCount > 3) { await this.repository.fail(id, claimedAt, attemptCount, now.toISOString(), code); return; }
    const minutes = RETRY_MINUTES[currentAttempts]!;
    await this.repository.retry(id, claimedAt, new Date(now.getTime() + minutes * 60_000).toISOString(), attemptCount, now.toISOString(), code);
  }
}

function nextScheduledAt(now: Date, cadence: "weekly" | "monthly"): string {
  if (cadence === "weekly") return new Date(now.getTime() + 7 * 24 * 60 * 60_000).toISOString();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(now.getUTCDate(), lastDay), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds())).toISOString();
}
