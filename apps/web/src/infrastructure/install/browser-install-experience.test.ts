import { describe, expect, it, vi } from "vitest";
import {
  createBrowserInstallExperience,
  createInstallPromptPreference,
} from "./browser-install-experience";

describe("createBrowserInstallExperience", () => {
  it("captures Chromium's install event and invokes its prompt after the user action", async () => {
    const target = Object.assign(new EventTarget(), {
      matchMedia: () => ({ matches: false }),
      navigator: {
        maxTouchPoints: 0,
        platform: "Win32",
        userAgent: "Mozilla/5.0 Chrome/151.0.0.0",
      },
    });
    const prompt = vi.fn(async () => undefined);
    const event = Object.assign(
      new Event("beforeinstallprompt", { cancelable: true }),
      {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" as const }),
      },
    );
    const experience = createBrowserInstallExperience(target);
    const changed = vi.fn();
    experience.subscribe(changed);

    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(experience.getState()).toBe("installable");
    expect(changed).toHaveBeenCalledOnce();

    await expect(experience.install()).resolves.toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
    expect(experience.getState()).toBe("installed");
  });

  it("remembers that the startup guidance was already shown in this browser", () => {
    const values = new Map<string, string>();
    const preference = createInstallPromptPreference({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    });

    expect(preference.hasSeen()).toBe(false);
    preference.markSeen();
    expect(preference.hasSeen()).toBe(true);
  });

  it("does not block app startup when browser storage is unavailable", () => {
    const preference = createInstallPromptPreference({
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    });

    expect(preference.hasSeen()).toBe(false);
    expect(() => preference.markSeen()).not.toThrow();
  });
});
