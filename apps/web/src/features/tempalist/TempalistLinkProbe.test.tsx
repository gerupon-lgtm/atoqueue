import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => vi.stubGlobal("matchMedia", () => ({ matches: false })));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("F-020 keeps the development route and fixed synthetic link copy", async () => {
  vi.stubEnv("DEV", true);
  window.history.replaceState({}, "", "/dev/tempalist-link");
  const { router } = await import("../../app/router");
  try {
    render(<RouterProvider router={router} />);
    expect(
      await screen.findByRole("heading", {
        name: "テンパリスト連携の実機試験",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("固定の合成データ2件だけをテンパリストへ渡します。"),
    ).toBeVisible();
    expect(
      screen.getByText("受信先で作成前の内容確認画面が表示されます。"),
    ).toBeVisible();
    const link = screen.getByRole("link", { name: "試験用リストを開く" });
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin + url.pathname).toBe("https://tempalist.sikumilab.com/");
    expect(url.search).toBe("");
    expect(
      JSON.parse(Buffer.from(url.hash.slice(8), "base64url").toString("utf8")),
    ).toEqual({
      schemaVersion: 1,
      kind: "checklist-create",
      source: "atoqueue",
      requestId: "11111111-1111-4111-8111-111111111111",
      title: "試験用の買い物リスト",
      items: [
        { sourceTaskId: "probe-task-1", label: "牛乳🥛\n2本" },
        { sourceTaskId: "probe-task-2", label: "単三電池" },
      ],
    });
    expect(link).not.toHaveAttribute("target");
  } finally {
    router.dispose();
  }
});

it("F-020 omits the probe route from production configuration", async () => {
  vi.stubEnv("DEV", false);
  window.history.replaceState({}, "", "/");
  const { router } = await import("../../app/router");
  try {
    expect(
      router.routes[0]!.children?.some(
        (route) => route.path === "dev/tempalist-link",
      ),
    ).toBe(false);
  } finally {
    router.dispose();
  }
});
