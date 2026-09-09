import webpush from "web-push";
import type { ApplicationRegistry } from "../applications/registry.js";
import type { PushClient } from "./push-client.js";
/** Pass credentials per send: web-push's process-global VAPID defaults cannot isolate apps. */
export class ApplicationPushClient implements PushClient {
  constructor(
    private readonly legacy: {
      publicKey: string;
      privateKey: string;
      subject: string;
    },
    private readonly applications: ApplicationRegistry,
  ) {}
  async send(
    input: Parameters<PushClient["send"]>[0],
  ): Promise<{ statusCode: number }> {
    const application = input.appId
      ? this.applications.get(input.appId)
      : undefined;
    if (input.appId && !application)
      throw new Error("Application sender unavailable.");
    const vapidDetails = application
      ? {
          publicKey: application.vapidPublicKey,
          privateKey: application.vapidPrivateKey,
          subject: application.vapidSubject,
        }
      : this.legacy;
    try {
      const result = await webpush.sendNotification(
        {
          endpoint: input.subscription.endpoint,
          keys: {
            p256dh: input.subscription.p256dh,
            auth: input.subscription.auth,
          },
        },
        JSON.stringify(input.payload),
        { TTL: 86400, urgency: "high", vapidDetails },
      );
      return { statusCode: result.statusCode };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
      )
        return { statusCode: error.statusCode };
      throw new Error("Push delivery failed.", { cause: error });
    }
  }
}
