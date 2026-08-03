import type { PushClient } from "../push/push-client.js";
import type { ReminderRepository } from "../reminders/reminder-repository.js";

const RETRY_MINUTES = [5, 15, 60] as const;

export class ReminderDispatcher {
  constructor(private readonly repository: ReminderRepository, private readonly push: PushClient, private readonly clock = () => new Date()) {}

  async recoverStaleClaims(): Promise<void> {
    const now = this.clock();
    await this.repository.recoverStaleClaims(new Date(now.getTime() - 15 * 60_000).toISOString(), now.toISOString());
  }

  async dispatchDue(): Promise<void> {
    const now = this.clock();
    const jobs = await this.repository.claimDue(now.toISOString(), 100);
    await Promise.all(jobs.map((job) => this.send(job, now)));
  }

  private async send(job: Awaited<ReturnType<ReminderRepository["claimDue"]>>[number], now: Date): Promise<void> {
    try {
      const result = await this.push.send({ subscription: job.subscription, payload: { type: "review_due", reminderId: job.id, url: `/today?reminder=${job.id}` } });
      if (result.statusCode >= 200 && result.statusCode < 300) { await this.repository.markSent(job.id, now.toISOString()); return; }
      if (result.statusCode === 404 || result.statusCode === 410) { await this.repository.disableDeviceAndFailPending(job.deviceId, now.toISOString(), `push_${result.statusCode}`); return; }
      await this.handleTemporary(job.id, job.attemptCount, now, `push_${result.statusCode}`);
    } catch {
      await this.handleTemporary(job.id, job.attemptCount, now, "push_error");
    }
  }

  private async handleTemporary(id: string, currentAttempts: number, now: Date, code: string): Promise<void> {
    const attemptCount = currentAttempts + 1;
    if (attemptCount > 3) { await this.repository.fail(id, attemptCount, now.toISOString(), code); return; }
    const minutes = RETRY_MINUTES[currentAttempts]!;
    await this.repository.retry(id, new Date(now.getTime() + minutes * 60_000).toISOString(), attemptCount, now.toISOString(), code);
  }
}
