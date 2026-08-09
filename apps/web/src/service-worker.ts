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

export interface PushPayload { type: "review_due"; reminderId: string; url: string; }
export interface WorkerClients { matchAll(options?: ClientQueryOptions): Promise<Array<{ url: string; focus(): Promise<unknown> | unknown }>>; openWindow(url: string): Promise<unknown> | unknown; }

/** Ignores malformed or private payload fields before rendering OS-visible text. */
export async function handlePush(raw: string, showNotification: (title: string, options: NotificationOptions) => Promise<unknown> | unknown): Promise<void> {
  const payload = parsePayload(raw);
  const url = payload?.url ?? "/today";
  await showNotification(genericNotification.title, { body: genericNotification.body, tag: genericNotification.tag, data: payload ? { url, reminderId: payload.reminderId } : { url } });
}

export async function handleNotificationClick(data: Partial<Pick<PushPayload, "url" | "reminderId">>, clients: WorkerClients): Promise<void> {
  const url = validReminderUrl(data.url, data.reminderId) ? data.url : "/today";
  const existing = (await clients.matchAll({ type: "window", includeUncontrolled: true })).find((client) => sameOriginPath(client.url, url));
  if (existing) { await existing.focus(); return; }
  await clients.openWindow(url);
}

function parsePayload(raw: string): PushPayload | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const record = value as Record<string, unknown>;
    if (Object.keys(record).length !== 3 || record.type !== "review_due" || typeof record.reminderId !== "string" || typeof record.url !== "string" || !validReminderUrl(record.url, record.reminderId)) return undefined;
    return record as unknown as PushPayload;
  } catch { return undefined; }
}

function validReminderUrl(url: unknown, reminderId: unknown): url is string {
  if (typeof url !== "string" || typeof reminderId !== "string" || !isUuid(reminderId)) return false;
  try {
    const parsed = new URL(url, "https://atoqueue.invalid");
    return parsed.origin === "https://atoqueue.invalid"
      && (parsed.pathname === "/today" || parsed.pathname === "/inbox")
      && parsed.searchParams.size === 1
      && parsed.searchParams.get("reminder") === reminderId;
  } catch { return false; }
}
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
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
  registration?: { showNotification(title: string, options: NotificationOptions): Promise<void> };
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
