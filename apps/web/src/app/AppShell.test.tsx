import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createEmptySnapshot, type AppRepository } from "../../../../packages/domain/src";
import { AppShell } from "./AppShell";

const navigation = [
  ["/", "記録"],
  ["/inbox", "受信箱"],
  ["/today", "今日"],
  ["/tasks", "タスク"],
  ["/settings", "設定"],
] as const;

describe("AppShell", () => {
  afterEach(cleanup);

  it.each(navigation)(
    "shows the complete labeled primary navigation on %s and identifies %s as current",
    (path, currentLabel) => {
      render(
        <MemoryRouter initialEntries={[path]}>
          <AppShell />
        </MemoryRouter>,
      );

      const nav = screen.getByRole("navigation", {
        name: "主要ナビゲーション",
      });
      const links = screen.getAllByRole("link");

      expect(links.map((link) => link.getAttribute("aria-label"))).toEqual(
        navigation.map(([, label]) => label),
      );
      expect(
        screen
          .getByRole("link", { name: currentLabel })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(nav.getAttribute("aria-label")).toBe("主要ナビゲーション");
      const icon = screen
        .getByRole("link", { name: currentLabel })
        .querySelector<SVGElement>("svg[data-icon]");
      expect(icon?.getAttribute("stroke-width")).toBe("2.5");
    },
  );

  it("keeps keyboard tab order aligned with the visual navigation order", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    for (const [, label] of navigation) {
      await user.tab();
      expect(document.activeElement?.getAttribute("aria-label")).toBe(label);
    }
  });

  it("shows a quiet app wordmark without changing the page navigation", () => {
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );

    const wordmark = screen.getByText("あとキュー");
    expect(wordmark.classList).toContain("app-shell__wordmark");
  });

  it("F-014 reads the overdue task count from the injected repository for the task navigation badge", async () => {
    const snapshot = createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "UTC",
      now: "2026-08-03T09:00:00.000Z",
    });
    snapshot.tasks = [{
      id: "overdue", sourceCaptureId: "capture-1", title: "期限切れ", status: "active",
      dueMode: "scheduled", dueAt: "2026-08-02T23:59:00.000Z", nextReviewAt: "2026-08-10T00:00:00.000Z",
      undecidedCount: 0, dismissCount: 0, postponeCount: 0,
      createdAt: "2026-08-01T00:00:00.000Z", updatedAt: "2026-08-01T00:00:00.000Z", revision: 1,
    }];
    const repository: AppRepository = {
      load: async () => snapshot, save: async () => undefined,
      loadDraft: async () => "", saveDraft: async () => undefined, clearDraft: async () => undefined,
    };

    render(<MemoryRouter><AppShell repository={repository} now={() => "2026-08-03T09:00:00.000Z"} /></MemoryRouter>);

    expect(await screen.findByLabelText("期限超過のタスク: 1件")).toBeTruthy();
  });
});
