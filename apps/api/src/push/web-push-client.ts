import webpush from "web-push";
import type { PushClient } from "./push-client.js";

export class WebPushClient implements PushClient {
  constructor(input: { publicKey: string; privateKey: string; subject: string }) {
    webpush.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  }

  async send(input: Parameters<PushClient["send"]>[0]): Promise<{ statusCode: number }> {
    const result = await webpush.sendNotification(
      { endpoint: input.subscription.endpoint, keys: { p256dh: input.subscription.p256dh, auth: input.subscription.auth } },
      JSON.stringify(input.payload),
    );
    return { statusCode: result.statusCode };
  }
}
