import { validReminderUrl } from "./notification-link";

export const genericNotification = {
  title: "あとキュー",
  body: "確認したい項目があります",
  tag: "atoqueue-review",
} as const;

type PrecacheEntry = { url: string; revision?: string | null };
declare const self: { __WB_MANIFEST: PrecacheEntry[] };
// Workbox replaces this marker during the PWA build. The cache contains only public app assets.
const precacheEntries = self.__WB_MANIFEST;
const precacheName = "atoqueue-public-shell-v1";

export interface PushPayload {
  type: "review_due";
  reminderId: string;
  url: string;
  groupId?: string;
}
type WebNotificationOptions = NotificationOptions & { vibrate?: number[] };
interface WorkerWindow {
  url: string;
  focus(): Promise<unknown> | unknown;
  postMessage?(message: unknown, transfer: Transferable[]): void;
}
export interface WorkerClients { matchAll(options?: ClientQueryOptions): Promise<WorkerWindow[]>; openWindow(url: string): Promise<unknown> | unknown; }

/** Ignores malformed or private payload fields before rendering OS-visible text. */
export async function handlePush(raw: string, showNotification: (title: string, options: WebNotificationOptions) => Promise<unknown> | unknown): Promise<void> {
  const payload = parsePayload(raw);
  const url = payload?.url ?? "/today";
  const tag = payload?.groupId
    ? `${genericNotification.tag}-${payload.groupId}`
    : genericNotification.tag;
  await showNotification(genericNotification.title, {
    body: genericNotification.body,
    tag,
    vibrate: [200, 100, 200],
    data: payload ? { url, reminderId: payload.reminderId } : { url },
  });
}

export async function handleNotificationClick(data: Partial<Pick<PushPayload, "url" | "reminderId">>, clients: WorkerClients): Promise<void> {
  const url = validReminderUrl(data.url, data.reminderId) ? data.url : "/today";
  const existing = (await clients.matchAll({ type: "window", includeUncontrolled: true })).find((client) => sameOriginPath(client.url, url));
  if (existing) {
    if (url.startsWith("/inbox?")) {
      // SPA navigation preserves body drafts; focus alone would drop the reminder.
      if (await notifyOpenInbox(existing, url, data.reminderId!)) {
        try {
          await existing.focus();
          return;
        } catch {
          // The window may close after acknowledging; open the link normally.
        }
      }
    } else {
      await existing.focus();
      return;
    }
  }
  await clients.openWindow(url);
}

async function notifyOpenInbox(client: WorkerWindow, url: string, reminderId: string): Promise<boolean> {
  if (!client.postMessage) return false;
  const channel = new MessageChannel();
  return new Promise(resolve => {
    const finish = (handled: boolean) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      resolve(handled);
    };
    const timeout = setTimeout(() => finish(false), 1000);
    channel.port1.onmessage = event => { if (event.data === "handled") finish(true); };
    try { client.postMessage!({ type: "atoqueue:notification-click", url, reminderId }, [channel.port2]); }
    catch { finish(false); }
  });
}

function parsePayload(raw: string): PushPayload | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      (keys.length !== 3 && keys.length !== 4)
      || record.type !== "review_due"
      || typeof record.reminderId !== "string"
      || typeof record.url !== "string"
      || (keys.length === 4 && !validGroupId(record.groupId))
      || (keys.length === 3 && record.groupId !== undefined)
      || !validReminderUrl(record.url, record.reminderId)
    ) return undefined;
    return record as unknown as PushPayload;
  } catch { return undefined; }
}

function validGroupId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}
function sameOriginPath(clientUrl: string, target: string): boolean {
  try {
    const client = new URL(clientUrl);
    const scopeOrigin = globalThis.location?.origin;
    return (!scopeOrigin || scopeOrigin === "null" || client.origin === scopeOrigin)
      && client.pathname === new URL(target, client.origin).pathname;
  } catch { return false; }
}

interface ServiceWorkerEvent {
  waitUntil(promise: Promise<unknown>): void;
  data?: { text(): string };
  notification?: { close(): void; data?: unknown };
  request?: Request;
  respondWith?(response: Promise<Response>): void;
}

const worker = globalThis as unknown as {
  addEventListener?: (type: string, listener: (event: ServiceWorkerEvent) => void) => void;
  registration?: { showNotification(title: string, options: WebNotificationOptions): Promise<void> };
  clients?: WorkerClients;
  caches?: CacheStorage;
  fetch?: typeof fetch;
};
if (worker.registration && worker.clients && worker.addEventListener) {
  if (worker.caches && worker.fetch) {
    worker.addEventListener("install", (event) => {
      event.waitUntil(precachePublicShell(worker.caches!, precacheEntries));
    });
    worker.addEventListener("fetch", (event) => {
      if (!event.request || event.request.method !== "GET" || !event.respondWith) return;
      event.respondWith(loadPublicShell(event.request, worker.caches!, worker.fetch!));
    });
  }
  worker.addEventListener("push", (event) => event.waitUntil(handlePush(event.data?.text() ?? "", (title, options) => worker.registration!.showNotification(title, options))));
  worker.addEventListener("notificationclick", (event) => {
    const notification = event.notification;
    if (!notification) return;
    notification.close();
    event.waitUntil(handleNotificationClick(notification.data ?? {}, worker.clients!));
  });
}

async function precachePublicShell(cacheStorage: CacheStorage, entries: PrecacheEntry[]): Promise<void> {
  const cache = await cacheStorage.open(precacheName);
  await cache.addAll(entries.map(({ url }) => url));
}

async function loadPublicShell(request: Request, cacheStorage: CacheStorage, networkFetch: typeof fetch): Promise<Response> {
  const cached = await cacheStorage.match(request, { ignoreVary: true });
  if (cached) return cached;
  try {
    return await networkFetch(request);
  } catch (error) {
    if (request.mode === "navigate") {
      const fallback = await cacheStorage.match("/index.html", { ignoreVary: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}
