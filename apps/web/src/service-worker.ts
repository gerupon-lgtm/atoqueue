export const genericNotification = {
  title: "あとキュー",
  body: "確認したい項目があります",
  tag: "atoqueue-review",
} as const;

declare const self: { __WB_MANIFEST: unknown[] };
// Workbox replaces this marker during the PWA build. Runtime caching is not a source of task data.
void self.__WB_MANIFEST;

export interface PushPayload { type: "task_review" | "deadline_review" | "unset_due_review"; reminderId: string; url: string; }
export interface WorkerClients { matchAll(options?: ClientQueryOptions): Promise<Array<{ url: string; focus(): Promise<unknown> | unknown }>>; openWindow(url: string): Promise<unknown> | unknown; }

/** Ignores malformed or private payload fields before rendering OS-visible text. */
export async function handlePush(raw: string, showNotification: (title: string, options: NotificationOptions) => Promise<unknown> | unknown): Promise<void> {
  const payload = parsePayload(raw);
  const url = payload?.url ?? "/today";
  await showNotification(genericNotification.title, { body: genericNotification.body, tag: genericNotification.tag, data: { url } });
}

export async function handleNotificationClick(data: Partial<Pick<PushPayload, "url">>, clients: WorkerClients): Promise<void> {
  const url = validTodayUrl(data.url) ? data.url! : "/today";
  const existing = (await clients.matchAll({ type: "window", includeUncontrolled: true })).find((client) => sameOriginPath(client.url, url));
  if (existing) { await existing.focus(); return; }
  await clients.openWindow(url);
}

function parsePayload(raw: string): PushPayload | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || typeof record.reminderId !== "string" || typeof record.url !== "string" || !["task_review", "deadline_review", "unset_due_review"].includes(String(record.type)) || !validTodayUrl(record.url)) return undefined;
    return record as unknown as PushPayload;
  } catch { return undefined; }
}

function validTodayUrl(url: unknown): url is string { return typeof url === "string" && url.startsWith("/today") && !url.includes("://"); }
function sameOriginPath(clientUrl: string, target: string): boolean {
  try {
    const client = new URL(clientUrl);
    const scopeOrigin = globalThis.location?.origin;
    return (!scopeOrigin || scopeOrigin === "null" || client.origin === scopeOrigin)
      && client.pathname === new URL(target, client.origin).pathname;
  } catch { return false; }
}

const worker = globalThis as unknown as { addEventListener?: (type: string, listener: (event: any) => void) => void; registration?: { showNotification(title: string, options: NotificationOptions): Promise<void> }; clients?: WorkerClients };
if (worker.registration && worker.clients && worker.addEventListener) {
  worker.addEventListener("push", (event) => event.waitUntil(handlePush(event.data?.text() ?? "", (title, options) => worker.registration!.showNotification(title, options))));
  worker.addEventListener("notificationclick", (event) => { event.notification.close(); event.waitUntil(handleNotificationClick(event.notification.data ?? {}, worker.clients!)); });
}
