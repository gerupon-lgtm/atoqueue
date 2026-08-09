export type InstallExperienceState =
  "installed" | "ios" | "waiting" | "installable";

export interface InstallExperience {
  getState(): InstallExperienceState;
  install(): Promise<"accepted" | "dismissed">;
  subscribe(listener: () => void): () => void;
}

export interface InstallPromptPreference {
  hasSeen(): boolean;
  markSeen(): void;
}
