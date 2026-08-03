import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

const navigation = [
  ["/", "險倬鹸"],
  ["/inbox", "蜿嶺ｿ｡邂ｱ"],
  ["/today", "莉頑律"],
  ["/tasks", "繧ｿ繧ｹ繧ｯ"],
  ["/settings", "險ｭ螳啻"],
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

      const nav = screen.getByRole("navigation", { name: "主要ナビゲーション" });
      const links = screen.getAllByRole("link");

      expect(links.map((link) => link.textContent)).toEqual(
        navigation.map(([, label]) => label),
      );
      expect(
        screen.getByRole("link", { name: currentLabel }).getAttribute(
          "aria-current",
        ),
      ).toBe("page");
      expect(nav.getAttribute("aria-label")).toBe("主要ナビゲーション");
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
      expect(document.activeElement?.textContent).toBe(label);
    }
  });
});
