import {
  backfillMissingOverdueTaskNotifications,
  type AppRepository,
} from "../../../../../packages/domain/src";

/** Installs exactly one best-effort retry hook for app startup and reconnection. */
export function installOutboxFlush(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, flush: () => Promise<unknown>): () => void {
  const run = () => { void flush(); };
  target.addEventListener("online", run);
  run();
  return () => target.removeEventListener("online", run);
}

/** Persists the new v9 task-owned reminder series before the startup flush. */
export async function backfillOverdueTaskNotifications(input: {
  repository: AppRepository;
  now?: () => string;
}): Promise<boolean> {
  const snapshot = await input.repository.load();
  const savedAt = input.now?.() ?? new Date().toISOString();
  const delivery = backfillMissingOverdueTaskNotifications({
    snapshot,
    now: savedAt,
  });
  if (!delivery) return false;
  await input.repository.save({ ...snapshot, ...delivery, savedAt });
  return true;
}
