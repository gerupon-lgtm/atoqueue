import { z } from "zod";
import {
  ApplicationIdSchema,
  DeviceIdSchema,
  NotificationPushPayloadV2Schema,
  RouteKeySchema,
  type NotificationPushPayloadV2,
} from "@atoqueue/contracts";
import {
  NotificationClientError,
  validateNotificationOrigin,
} from "./client.js";

export interface FixedNotification {
  title: string;
  body: string;
  tagPrefix: string;
}
export interface ServiceWorkerHelperOptions {
  appId: string;
  origin: string;
  defaultPath: string;
  notifications: Readonly<Record<string, FixedNotification>>;
  routes: Readonly<Record<string, string>>;
}
export interface NotificationDisplay {
  title: string;
  options: {
    body: string;
    tag?: string;
    data: { reminderId: string; routeKey: string } | null;
  };
}
export interface NotificationWindowClient {
  url: string;
  focus(): Promise<unknown>;
}
export interface NotificationWindowClients {
  matchAll(options: {
    type: "window";
    includeUncontrolled: boolean;
  }): Promise<readonly NotificationWindowClient[]>;
  openWindow(url: string): Promise<unknown>;
}

// Reject URL-parser-normalized control characters as well as backslashes.
// eslint-disable-next-line no-control-regex
const unsafePathCharacters = /[\\\x00-\x20\x7f]/;
function safePath(path: unknown, origin: string): URL | null {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    unsafePathCharacters.test(path)
  )
    return null;
  try {
    const decoded = decodeURIComponent(path);
    if (decoded.startsWith("//") || unsafePathCharacters.test(decoded))
      return null;
    const url = new URL(path, origin);
    return url.origin === origin && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}
const ClickDataSchema = z
  .object({ reminderId: DeviceIdSchema, routeKey: RouteKeySchema })
  .strict();
const FixedNotificationSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().min(1),
    tagPrefix: z.string().min(1),
  })
  .strict();

export function createServiceWorkerHelpers(
  options: ServiceWorkerHelperOptions,
) {
  const origin = validateNotificationOrigin(options.origin);
  const appId = ApplicationIdSchema.safeParse(options.appId);
  const fallback = safePath(options.defaultPath, origin);
  if (!appId.success || !fallback)
    throw new NotificationClientError("validation");
  // Snapshot own values, so callers cannot change a validated configuration later.
  const routes = new Map(
    Object.entries(options.routes).map(([key, value]) => [
      key,
      safePath(value, origin),
    ]),
  );
  const notifications = new Map(
    Object.entries(options.notifications).flatMap(([key, value]) => {
      const result = FixedNotificationSchema.safeParse(value);
      return result.success ? [[key, result.data] as const] : [];
    }),
  );

  function parsePayload(input: unknown): NotificationPushPayloadV2 | null {
    let value: unknown = input;
    if (typeof input === "string") {
      try {
        value = JSON.parse(input);
      } catch {
        return null;
      }
    }
    const parsed = NotificationPushPayloadV2Schema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.appId !== appId.data ||
      !notifications.has(parsed.data.notificationKey) ||
      !routes.get(parsed.data.routeKey)
    )
      return null;
    return parsed.data;
  }
  function notification(input: unknown): NotificationDisplay {
    const parsed = parsePayload(input);
    const fixed = parsed && notifications.get(parsed.notificationKey);
    if (!parsed || !fixed)
      return {
        title: "通知",
        options: { body: "アプリを開いて確認してください。", data: null },
      };
    return {
      title: fixed.title,
      options: {
        body: fixed.body,
        tag: `${fixed.tagPrefix}-${parsed.groupId}`,
        data: { reminderId: parsed.reminderId, routeKey: parsed.routeKey },
      },
    };
  }
  function resolveClick(input: unknown): string {
    const parsed = ClickDataSchema.safeParse(input);
    const route = parsed.success && routes.get(parsed.data.routeKey);
    if (!parsed.success || !route) return fallback!.href;
    const url = new URL(route.href);
    url.searchParams.set("reminder", parsed.data.reminderId);
    return url.href;
  }
  async function openNotification(
    input: unknown,
    clients: NotificationWindowClients,
  ): Promise<void> {
    const target = new URL(resolveClick(input));
    const windows = await clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    for (const client of windows) {
      let url: URL;
      try {
        url = new URL(client.url);
      } catch {
        continue;
      }
      if (url.origin === origin && url.pathname === target.pathname) {
        await client.focus();
        return;
      }
    }
    await clients.openWindow(target.href);
  }
  return { parsePayload, notification, resolveClick, openNotification };
}
