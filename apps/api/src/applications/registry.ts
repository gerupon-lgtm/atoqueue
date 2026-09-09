import { z } from "zod";
import {
  ApplicationIdSchema,
  NotificationKeySchema,
  RouteKeySchema,
} from "@atoqueue/contracts";
const uniqueKeys = (schema: typeof NotificationKeySchema) =>
  z
    .array(schema)
    .min(1)
    .refine((keys) => new Set(keys).size === keys.length);
const ApplicationSchema = z
  .object({
    appId: ApplicationIdSchema.refine((id) => id !== "atoqueue"),
    origins: z.array(z.string()).min(1),
    vapidPublicKey: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    vapidPrivateKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    vapidSubject: z.string().regex(/^mailto:[^\s@]+@[^\s@]+$/),
    notificationKeys: uniqueKeys(NotificationKeySchema),
    routeKeys: uniqueKeys(RouteKeySchema),
  })
  .strict();
export type NotificationApplicationConfig = z.infer<typeof ApplicationSchema>;
export class ApplicationRegistry {
  private readonly entries = new Map<string, NotificationApplicationConfig>();
  constructor(input: unknown = [], development = false) {
    const parsed = z.array(ApplicationSchema).safeParse(input);
    if (!parsed.success)
      throw new Error("Invalid notification application registry.");
    const origins = new Set<string>();
    for (const item of parsed.data) {
      if (this.entries.has(item.appId))
        throw new Error("Duplicate notification application.");
      for (const origin of item.origins) {
        let url: URL;
        try {
          url = new URL(origin);
        } catch {
          throw new Error("Invalid application Origin.");
        }
        if (
          url.origin !== origin ||
          url.username ||
          url.password ||
          !(
            url.protocol === "https:" ||
            (development &&
              url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          ) ||
          origins.has(origin) ||
          origin === "https://atoqueue.sikumilab.com"
        )
          throw new Error("Invalid or duplicate application Origin.");
        origins.add(origin);
      }
      this.entries.set(item.appId, structuredClone(item));
    }
  }
  get(appId: string): NotificationApplicationConfig | undefined {
    const value = this.entries.get(appId);
    return value && structuredClone(value);
  }
}
