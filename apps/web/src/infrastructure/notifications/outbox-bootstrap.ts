import {
  backfillMissingNotifications,
  type AppRepository,
} from "../../../../../packages/domain/src";

/** Installs exactly one best-effort retry hook for app startup and reconnection. */
export function installOutboxFlush(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, flush: () => Promise<unknown>): () => void {
  let pending = Promise.resolve();
  const run = () => {
    pending = pending.then(flush, flush).then(() => undefined, () => undefined);
  };
  target.addEventListener("online", run);
  run();
  return () => target.removeEventListener("online", run);
}

/** Persists notification mappings missing from the current local state before startup delivery. */
export async function reconcileMissingNotifications(input: {
  repository: AppRepository;
  now?: () => string;
}): Promise<boolean> {
  const snapshot = await input.repository.load();
  const savedAt = input.now?.() ?? new Date().toISOString();
  const delivery = backfillMissingNotifications({
    snapshot,
    now: savedAt,
  });
  if (!delivery) return false;
  const latest = await input.repository.load();
  const latestDelivery = backfillMissingNotifications({
    snapshot: latest,
    now: savedAt,
  });
  if (!latestDelivery) return false;
  await input.repository.save({ ...latest, ...latestDelivery, savedAt });
  return true;
}
