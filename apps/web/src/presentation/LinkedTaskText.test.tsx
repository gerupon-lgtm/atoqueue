// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { containsWebUrl, LinkedTaskText } from "./LinkedTaskText";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LinkedTaskText", () => {
  it("F-021 preserves the exact task text and newlines while linking multiple HTTP(S) destinations", () => {
    const text =
      "確認 https://example.com/a?x=1&y=2\n次は HTTP://example.org/docs。";
    const { container } = render(<LinkedTaskText text={text} />);
    expect(container.textContent).toBe(text);
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "https://example.com/a?x=1&y=2",
      "HTTP://example.org/docs",
    ]);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
    expect(container.firstElementChild?.className).toBe("linked-task-text");
  });

  it.each([
    ["https://example.com/docs。", "https://example.com/docs"],
    ["https://example.com/docs。次の作業", "https://example.com/docs"],
    ["https://example.com/docs,", "https://example.com/docs"],
    ["（https://example.com/docs）", "https://example.com/docs"],
    ["[https://example.com/docs]", "https://example.com/docs"],
    ["https://example.com/docs_(part).", "https://example.com/docs_(part)"],
    ["(https://example.com/docs_(part)).", "https://example.com/docs_(part)"],
    ["「https://example.com/資料」", "https://example.com/資料"],
  ])("F-021 keeps sentence punctuation outside the URL in %s", (text, href) => {
    const { container } = render(<LinkedTaskText text={text} />);
    expect(container.textContent).toBe(text);
    expect(screen.getByRole("link").getAttribute("href")).toBe(href);
  });

  it.each([
    "リンクなし\nそのままの記録",
    "javascript:alert(1) data:text/html,test ftp://example.com/file",
    "https:// https://?query https://example.com:99999/",
    "https://user:secret@example.com/path",
    "https://example.com@evil.example/path",
  ])(
    "F-021 leaves unsupported or invalid destinations as ordinary text: %s",
    (text) => {
      const { container } = render(<LinkedTaskText text={text} />);
      expect(container.textContent).toBe(text);
      expect(screen.queryByRole("link")).toBeNull();
      expect(containsWebUrl(text)).toBe(false);
    },
  );

  it("F-021 uses the same URL detection for task-list integration, without effects while rendering", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<LinkedTaskText text="調べる https://example.com/" />);
    expect(containsWebUrl("調べる https://example.com/")).toBe(true);
    expect(containsWebUrl("https://example.com/")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F-021 recognizes URLs separated by Japanese punctuation without spaces", () => {
    const text = "https://example.com/a、https://example.org/b。";
    const { container } = render(<LinkedTaskText text={text} />);
    expect(container.textContent).toBe(text);
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["https://example.com/a", "https://example.org/b"]);
  });

  it.each([false, true])(
    "F-021 confirms the full destination before primary navigation (confirmed=%s)",
    (confirmed) => {
      const url = "https://example.com/path?secret=visible#details";
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(confirmed);
      render(<LinkedTaskText text={`参照 ${url}`} />);
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      screen.getByRole("link").dispatchEvent(event);
      expect(confirm).toHaveBeenCalledOnce();
      expect(confirm).toHaveBeenCalledWith(
        `次のURLをブラウザで開きますか？\n${url}`,
      );
      expect(event.defaultPrevented).toBe(!confirmed);
    },
  );

  it("F-021 confirms middle-click navigation while leaving the context menu available", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<LinkedTaskText text="https://example.com/" />);
    const link = screen.getByRole("link");
    const middle = new MouseEvent("auxclick", {
      bubbles: true,
      cancelable: true,
      button: 1,
    });
    link.dispatchEvent(middle);
    expect(confirm).toHaveBeenCalledOnce();
    expect(middle.defaultPrevented).toBe(true);
    fireEvent.contextMenu(link);
    fireEvent(
      link,
      new MouseEvent("auxclick", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
    expect(confirm).toHaveBeenCalledOnce();
  });
});
