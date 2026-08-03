import { z } from "zod";

export const PushSubscriptionSchema = z
  .object({
    endpoint: z.string().url(),
    expirationTime: z.number().nullable(),
    keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }).strict(),
  })
  .strict();

export const PublicPushKeyResponseSchema = z.object({ publicKey: z.string().min(1) }).strict();

export type PushSubscription = z.infer<typeof PushSubscriptionSchema>;
