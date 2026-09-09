export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushClient {
  send(input: {
    appId?: string;
    subscription: PushSubscriptionRecord;
    payload: {
      type: "review_due";
      reminderId: string;
      url: string;
      groupId: string;
    } | import("@atoqueue/contracts").NotificationPushPayloadV2;
  }): Promise<{ statusCode: number }>;
}
