import type { AppSnapshot } from "./model";

/** Marks the local first-use guide as read without sharing any user data. */
export function completeOnboarding(
  snapshot: AppSnapshot,
  now: string,
): AppSnapshot {
  return {
    ...snapshot,
    settings: { ...snapshot.settings, onboardingCompletedAt: now },
    savedAt: now,
  };
}
