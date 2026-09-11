import { createEmptySnapshot } from "./repository";

export function makeTempalistFixture() {
  const now = "2026-09-11T00:00:00.000Z";
  const requestId = "11111111-1111-4111-8111-111111111111";
  const snapshot = createEmptySnapshot({
    appVersion: "mvp-1.28.0",
    localDeviceId: requestId,
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot.tasks = ["牛乳を買う", "電池を買う"].map((title, index) => ({
    id: `task-${index}`,
    sourceCaptureId: `capture-${index}`,
    title,
    status: "active",
    dueMode: "unset",
    nextReviewAt: now,
    undecidedCount: 0,
    dismissCount: 0,
    postponeCount: 0,
    createdAt: now,
    updatedAt: now,
    revision: 1,
  }));
  snapshot.captures = snapshot.tasks.map((task) => ({
    id: task.sourceCaptureId,
    body: "送信禁止の元記録",
    classification: "task",
    linkedTaskId: task.id,
    createdAt: now,
    updatedAt: now,
    classifiedAt: now,
  }));
  const draft = {
    title: "買い物",
    tasks: snapshot.tasks.map(({ id, title, revision }) => ({
      id,
      title,
      revision,
    })),
  };
  return { snapshot, draft, requestId, now };
}
