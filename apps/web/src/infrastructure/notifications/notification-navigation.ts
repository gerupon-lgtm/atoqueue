import { validReminderUrl } from "../../notification-link";

/** Route inside the running app, preserving unsaved screen state. */
export function installNotificationNavigation(
  target: Pick<EventTarget, "addEventListener" | "removeEventListener">,
  navigate: (url: string) => void | Promise<unknown>,
): () => void {
  const onMessage = (event: Event) => {
    const message = (event as MessageEvent).data as unknown;
    if (!message || typeof message !== "object") return;
    const data = message as Record<string, unknown>;
    if (data.type !== "atoqueue:notification-click" || !validReminderUrl(data.url, data.reminderId)) return;
    // Acknowledge only after the router has accepted the navigation.
    void Promise.resolve().then(() => navigate(data.url as string)).then(() => {
      (event as MessageEvent).ports?.[0]?.postMessage("handled");
    }).catch(() => undefined);
  };
  target.addEventListener("message", onMessage);
  return () => target.removeEventListener("message", onMessage);
}
