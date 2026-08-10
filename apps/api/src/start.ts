import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadConfig } from "./config.js";
import { PgReminderRepository } from "./reminders/reminder-repository.js";
import { WebPushClient } from "./push/web-push-client.js";
import { ReminderDispatcher } from "./scheduler/reminder-dispatcher.js";
import { buildProductionApp } from "./server.js";

export const API_VERSION = "mvp-1.7.0";

export interface RunningApi {
  close(): Promise<void>;
}

export function installReminderPoll(
  dispatcher: Pick<ReminderDispatcher, "dispatchDue">,
  reportFailure: (error: unknown) => void = () => undefined,
): () => void {
  const timer = setInterval(() => {
    void dispatcher.dispatchDue().catch(reportFailure);
  }, 5 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}

export async function startServer(input: {
  app: {
    listen(options: { host: string; port: number }): Promise<unknown>;
    close(): Promise<unknown>;
  };
  pool: { end(): Promise<unknown> };
  dispatcher: Pick<ReminderDispatcher, "recoverStaleClaims" | "dispatchDue">;
  port: number;
  reportFailure?: (error: unknown) => void;
}): Promise<RunningApi> {
  const reportFailure = input.reportFailure ?? (() => undefined);
  let stopPolling: (() => void) | undefined;
  try {
    await input.dispatcher.recoverStaleClaims();
    await input.dispatcher.dispatchDue();
    stopPolling = installReminderPoll(input.dispatcher, reportFailure);
    await input.app.listen({ host: "127.0.0.1", port: input.port });
    return {
      close: async () => {
        stopPolling?.();
        try {
          await input.app.close();
        } finally {
          await input.pool.end();
        }
      },
    };
  } catch (error) {
    stopPolling?.();
    await input.app.close().catch(reportFailure);
    await input.pool.end().catch(reportFailure);
    throw error;
  }
}

export async function start(
  input: { version: string; environment?: NodeJS.ProcessEnv } = {
    version: API_VERSION,
  },
): Promise<RunningApi> {
  const environment = input.environment ?? process.env;
  const config = loadConfig(environment);
  const { app, pool } = await buildProductionApp({
    version: input.version,
    environment,
  });
  const dispatcher = new ReminderDispatcher(
    new PgReminderRepository(pool),
    new WebPushClient({
      publicKey: config.vapidPublicKey,
      privateKey: config.vapidPrivateKey,
      subject: config.vapidSubject,
    }),
    () => new Date(),
    config.deadlineDeliveryLeadSeconds,
  );
  return startServer({
    app,
    pool,
    dispatcher,
    port: config.port,
    reportFailure: () => {
      process.stderr.write("Reminder dispatch failed.\n");
    },
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  void start().catch(() => {
    process.stderr.write("Notification API failed to start.\n");
    process.exitCode = 1;
  });
}
