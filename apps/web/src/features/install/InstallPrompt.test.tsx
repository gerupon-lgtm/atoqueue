import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InstallPrompt,
  type InstallExperience,
  type InstallPromptPreference,
} from "./InstallPrompt";

describe("InstallPrompt", () => {
  afterEach(cleanup);

  it("guides a first-time iOS visitor to Safari's Add to Home Screen action", async () => {
    const user = userEvent.setup();
    const markSeen = vi.fn();
    const experience: InstallExperience = {
      getState: () => "ios",
      install: async () => "dismissed",
      subscribe: () => () => undefined,
    };
    const preference: InstallPromptPreference = {
      hasSeen: () => false,
      markSeen,
    };

    render(<InstallPrompt experience={experience} preference={preference} />);

    expect(
      screen.getByRole("dialog", { name: "あとキューをホーム画面に追加" }),
    ).toBeTruthy();
    expect(screen.getByText(/Safari.*共有.*ホーム画面に追加/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "わかりました" }));

    expect(markSeen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the browser install flow only after Chromium reports that the app is installable", async () => {
    const user = userEvent.setup();
    let state: ReturnType<InstallExperience["getState"]> = "waiting";
    let notify: () => void = () => undefined;
    const install = vi.fn(async () => "accepted" as const);
    const markSeen = vi.fn();
    const experience: InstallExperience = {
      getState: () => state,
      install,
      subscribe: (listener) => {
        notify = listener;
        return () => undefined;
      },
    };

    render(
      <InstallPrompt
        experience={experience}
        preference={{ hasSeen: () => false, markSeen }}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    state = "installable";
    notify();

    expect(
      await screen.findByRole("dialog", {
        name: "あとキューをインストール",
      }),
    ).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "インストール" }));

    expect(install).toHaveBeenCalledOnce();
    expect(markSeen).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
