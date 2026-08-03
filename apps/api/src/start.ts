import { loadConfig } from "./config.js";
import { PgReminderRepository } from "./reminders/reminder-repository.js";
import { WebPushClient } from "./push/web-push-client.js";
import { ReminderDispatcher } from "./scheduler/reminder-dispatcher.js";
import { buildProductionApp } from "./server.js";

export interface RunningApi {
  close(): Promise<void>;
}

export function installReminderPoll(dispatcher: Pick<ReminderDispatcher, "dispatchDue">): () => void {
  const timer = setInterval(() => { void dispatcher.dispatchDue(); }, 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function start(input: { version: string; environment?: NodeJS.ProcessEnv } = { version: "0.1.0" }): Promise<RunningApi> {
  const environment = input.environment ?? process.env;
  const config = loadConfig(environment);
  const { app, pool } = await buildProductionApp({ version: input.version, environment });
  const dispatcher = new ReminderDispatcher(
    new PgReminderRepository(pool),
    new WebPushClient({ publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject }),
  );
  await dispatcher.recoverStaleClaims();
  await dispatcher.dispatchDue();
  const stopPolling = installReminderPoll(dispatcher);
  await app.listen({ host: "127.0.0.1", port: config.port });
  return { close: async () => { stopPolling(); await app.close(); await pool.end(); } };
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file:").href) {
  void start().catch(() => { process.stderr.write("Notification API failed to start.\n"); process.exitCode = 1; });
}
