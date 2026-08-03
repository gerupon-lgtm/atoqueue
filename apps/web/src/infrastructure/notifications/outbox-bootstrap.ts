/** Installs exactly one best-effort retry hook for app startup and reconnection. */
export function installOutboxFlush(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, flush: () => Promise<unknown>): () => void {
  const run = () => { void flush(); };
  target.addEventListener("online", run);
  run();
  return () => target.removeEventListener("online", run);
}
