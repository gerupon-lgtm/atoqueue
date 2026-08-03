import { z } from "zod";

export const PWA_ORIGIN = "https://atoqueue.sikumilab.com";
export const API_ORIGIN = "https://api.atoqueue.sikumilab.com";

const ConfigSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    VAPID_PUBLIC_KEY: z.string().min(1),
    VAPID_PRIVATE_KEY: z.string().min(1),
    VAPID_SUBJECT: z.string().startsWith("mailto:"),
  })
  .strict();

export type ApiConfig = {
  databaseUrl: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  pwaOrigin: typeof PWA_ORIGIN;
  apiOrigin: typeof API_ORIGIN;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = ConfigSchema.parse({
    DATABASE_URL: environment.DATABASE_URL,
    VAPID_PUBLIC_KEY: environment.VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: environment.VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: environment.VAPID_SUBJECT,
  });
  return {
    databaseUrl: parsed.DATABASE_URL,
    vapidPublicKey: parsed.VAPID_PUBLIC_KEY,
    vapidPrivateKey: parsed.VAPID_PRIVATE_KEY,
    vapidSubject: parsed.VAPID_SUBJECT,
    pwaOrigin: PWA_ORIGIN,
    apiOrigin: API_ORIGIN,
  };
}
