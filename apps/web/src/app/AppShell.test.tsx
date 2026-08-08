import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
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
});
