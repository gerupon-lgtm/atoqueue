export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushClient {
  send(input: {
    subscription: PushSubscriptionRecord;
    payload: { type: "review_due"; reminderId: string; url: string };
  }): Promise<{ statusCode: number }>;
}
