import type {
  InstallExperience,
  InstallExperienceState,
  InstallPromptPreference,
} from "../../application/install-experience";

const INSTALL_PROMPT_SEEN_KEY = "atoqueue:install-prompt-seen:v1";

type InstallTarget = Pick<EventTarget, "addEventListener"> & {
  matchMedia(query: string): { matches: boolean };
  navigator: {
    maxTouchPoints: number;
    platform: string;
    standalone?: boolean;
    userAgent: string;
  };
};

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isIos(target: InstallTarget): boolean {
  const { maxTouchPoints, platform, userAgent } = target.navigator;
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && maxTouchPoints > 1)
  );
}

function isInstalled(target: InstallTarget): boolean {
  return (
    target.matchMedia("(display-mode: standalone)").matches ||
    target.navigator.standalone === true
  );
}

export function createBrowserInstallExperience(
  target: InstallTarget,
): InstallExperience {
  let state: InstallExperienceState = isInstalled(target)
    ? "installed"
    : isIos(target)
      ? "ios"
      : "waiting";
  let deferredPrompt: BeforeInstallPromptEvent | undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  target.addEventListener("beforeinstallprompt", (rawEvent) => {
    const event = rawEvent as BeforeInstallPromptEvent;
    event.preventDefault();
    deferredPrompt = event;
    state = "installable";
    notify();
  });

  target.addEventListener("appinstalled", () => {
    deferredPrompt = undefined;
    state = "installed";
    notify();
  });

  return {
    getState: () => state,
    install: async () => {
      if (!deferredPrompt) return "dismissed";
      const prompt = deferredPrompt;
      deferredPrompt = undefined;
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      state = outcome === "accepted" ? "installed" : "waiting";
      notify();
      return outcome;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createInstallPromptPreference(
  storage: Pick<Storage, "getItem" | "setItem">,
): InstallPromptPreference {
  return {
    hasSeen: () => {
      try {
        return storage.getItem(INSTALL_PROMPT_SEEN_KEY) === "seen";
      } catch {
        return false;
      }
    },
    markSeen: () => {
      try {
        storage.setItem(INSTALL_PROMPT_SEEN_KEY, "seen");
      } catch {
        // The install flow remains usable even when this optional preference cannot persist.
      }
    },
  };
}
