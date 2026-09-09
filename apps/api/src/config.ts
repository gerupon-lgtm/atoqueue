import { z } from "zod";
import { ApplicationRegistry } from "./applications/registry.js";

export const PWA_ORIGIN = "https://atoqueue.sikumilab.com";
export const API_ORIGIN = "https://api.atoqueue.sikumilab.com";

const ConfigSchema = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65_535).default(3030),
    DATABASE_URL: z.string().min(1),
    VAPID_PUBLIC_KEY: z.string().min(1),
    VAPID_PRIVATE_KEY: z.string().min(1),
    VAPID_SUBJECT: z.literal("mailto:gerupon@gmail.com"),
    ALLOWED_ORIGIN: z.literal(PWA_ORIGIN),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    DEADLINE_DELIVERY_LEAD_SECONDS: z.coerce.number().int().min(0).max(3_600).default(300),
  })
  .strict();

export type ApiConfig = {
  applications: ApplicationRegistry;
  v2Enabled: boolean;
  port: number;
  databaseUrl: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  allowedOrigin: typeof PWA_ORIGIN;
  pwaOrigin: typeof PWA_ORIGIN;
  apiOrigin: typeof API_ORIGIN;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  deadlineDeliveryLeadSeconds: number;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  if (environment.NOTIFICATION_V2_ENABLED !== undefined && !["true", "false"].includes(environment.NOTIFICATION_V2_ENABLED)) throw new Error("Invalid notification v2 switch.");
  let registryInput: unknown;
  try { registryInput = JSON.parse(environment.NOTIFICATION_APPLICATIONS_JSON ?? "[]"); } catch { throw new Error("Invalid notification application registry."); }
  const applications = new ApplicationRegistry(registryInput, environment.NODE_ENV === "development");
  const parsed = ConfigSchema.parse({
    PORT: environment.PORT,
    DATABASE_URL: environment.DATABASE_URL,
    VAPID_PUBLIC_KEY: environment.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: environment.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: environment.VAPID_SUBJECT,
    ALLOWED_ORIGIN: environment.ALLOWED_ORIGIN,
    LOG_LEVEL: environment.LOG_LEVEL,
    DEADLINE_DELIVERY_LEAD_SECONDS: environment.DEADLINE_DELIVERY_LEAD_SECONDS,
  });
  return {
    applications,
    v2Enabled: environment.NOTIFICATION_V2_ENABLED === "true",
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    vapidPublicKey: parsed.VAPID_PUBLIC_KEY,
    vapidPrivateKey: parsed.VAPID_PRIVATE_KEY,
    vapidSubject: parsed.VAPID_SUBJECT,
    allowedOrigin: parsed.ALLOWED_ORIGIN,
    pwaOrigin: PWA_ORIGIN,
    apiOrigin: API_ORIGIN,
    logLevel: parsed.LOG_LEVEL,
    deadlineDeliveryLeadSeconds: parsed.DEADLINE_DELIVERY_LEAD_SECONDS,
  };
}
