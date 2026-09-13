import type { Capture } from "./model";

export type CaptureHistoryTab = Exclude<Capture["classification"], "task">;

export function listCaptures(
  captures: readonly Capture[],
  tab: CaptureHistoryTab,
): Capture[] {
  return captures
    .filter((capture) => capture.classification === tab)
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
