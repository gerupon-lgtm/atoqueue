import { useEffect, useState } from "react";
import type {
  AppRepository,
  AppSnapshot,
} from "../../../../packages/domain/src";

export const currentTime = () => new Date().toISOString();

/** Read-only display updates: never change a review session or notification schedule. */
export function useTaskSnapshot(
  repository: AppRepository | undefined,
  now = currentTime,
  refreshKey = "",
) {
  const [value, setValue] = useState<{
    snapshot?: AppSnapshot;
    timestamp?: string;
    error?: boolean;
  }>({});
  useEffect(() => {
    let active = true;
    let generation = 0;
    if (!repository) return;
    const refresh = async () => {
      const request = ++generation;
      try {
        const snapshot = await repository.load();
        if (active && request === generation)
          setValue({ snapshot, timestamp: now() });
      } catch {
        if (active && request === generation) setValue({ error: true });
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const unsubscribe = repository.subscribe?.(refresh);
    void refresh();
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      unsubscribe?.();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [repository, now, refreshKey]);
  return value;
}

/** Refresh time-dependent emphasis without reloading or discarding an editing form. */
export function useDisplayTime(now = currentTime): string {
  const [timestamp, setTimestamp] = useState(now);
  useEffect(() => {
    const refresh = () => setTimestamp(now());
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [now]);
  return timestamp;
}
