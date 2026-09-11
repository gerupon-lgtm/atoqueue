// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TempalistLinkedBadge } from "./TempalistLinkedBadge";

afterEach(cleanup);
it("F-020 renders a non-interactive badge only when linked with a stable accessible label", () => {
  const view = render(<TempalistLinkedBadge linked={false} />);
  expect(view.container.childElementCount).toBe(0);
  view.rerender(<TempalistLinkedBadge linked />);
  const badge = screen.getByLabelText("テンパリストへ開く操作済み");
  expect(badge.textContent).toBe("連携済");
  expect(badge.tagName).toBe("SPAN");
  expect(screen.queryByRole("button")).toBeNull();
  expect(view.container.querySelector("img")?.getAttribute("src")).toBeTruthy();
  view.rerender(<TempalistLinkedBadge linked iconSrc="/provided-icon.svg" />);
  expect(screen.getByLabelText("テンパリストへ開く操作済み").textContent).toBe(
    "連携済",
  );
  expect(view.container.querySelector("img")?.getAttribute("alt")).toBe("");
});
