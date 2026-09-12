// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { makeTempalistFixture } from "../../../../../packages/domain/src/tempalist-test-fixture";
import { prepareTempalistRequest } from "../../../../../packages/domain/src";
import type { TempalistTransferService } from "../../application/tempalist-transfer-service";
import { TempalistTransferPanel } from "./TempalistTransferPanel";
import userEvent from "@testing-library/user-event";

afterEach(cleanup);

it("F-020 retries an open failure with the identical prepared request and clears the error", async () => {
  const open = vi
    .fn()
    .mockRejectedValueOnce(new Error("private payload"))
    .mockResolvedValueOnce(undefined);
  const { service, request } = setup({ open });
  fireEvent.click(screen.getByRole("button", { name: "内容を確定" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "テンパリストで開く" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "同じ内容でもう一度開いてください",
  );
  expect(document.body.textContent).not.toContain("private payload");
  fireEvent.click(screen.getByRole("button", { name: "テンパリストで開く" }));
  expect(
    await screen.findByText(
      "開く操作を受け付けました。同じ内容でもう一度開けます。",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(service.prepare).toHaveBeenCalledTimes(1);
  expect(open.mock.calls).toEqual([[request], [request]]);
});
function setup(overrides: Partial<TempalistTransferService> = {}) {
  const fixture = makeTempalistFixture();
  const request = prepareTempalistRequest(fixture);
  const service = {
    prepare: vi.fn(async () => request),
    open: vi.fn(async () => undefined),
    lastRequest: vi.fn(async () => null),
    ...overrides,
  };
  const cancel = vi.fn();
  function Harness() {
    const [draft, onChange] = useState(fixture.draft);
    return (
      <TempalistTransferPanel
        draft={draft}
        onChange={onChange}
        onCancel={cancel}
        service={service}
      />
    );
  }
  render(<Harness />);
  return { service, request, cancel };
}

it("F-020 edits ordered readonly items and title before explicit prepare and repeated open", async () => {
  const { service, request } = setup();
  fireEvent.click(screen.getByRole("button", { name: "電池を買うを上へ" }));
  expect(
    screen
      .getAllByTestId("transfer-item")
      .map((item) => item.textContent?.slice(0, 5)),
  ).toEqual(["電池を買う", "牛乳を買う"]);
  fireEvent.click(screen.getByRole("button", { name: "牛乳を買うを除外" }));
  fireEvent.change(screen.getByRole("textbox", { name: "リスト名" }), {
    target: { value: "週末" },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確定" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "テンパリストで開く" }),
  );
  await waitFor(() => expect(service.open).toHaveBeenCalledWith(request));
  fireEvent.click(
    await screen.findByRole("button", { name: "テンパリストで開く" }),
  );
  await waitFor(() => expect(service.open).toHaveBeenCalledTimes(2));
  expect(service.prepare).toHaveBeenCalledTimes(1);
  expect(service.prepare).toHaveBeenCalledWith({
    title: "週末",
    tasks: [{ id: "task-1", title: "電池を買う", revision: 1 }],
  });
  fireEvent.click(screen.getByRole("button", { name: "編集に戻る" }));
  expect(
    screen.queryByRole("button", { name: "テンパリストで開く" }),
  ).toBeNull();
});

it("F-020 holds edits during saving and retains input after a safe failure", async () => {
  let reject!: (reason: Error) => void;
  const { cancel } = setup({
    prepare: () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確定" }));
  expect(screen.getByRole("textbox", { name: "リスト名" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "選択に戻る" }));
  expect(cancel).not.toHaveBeenCalled();
  reject(new Error("PRIVATE https://tempalist.sikumilab.com/#create=secret"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "確定内容を保存できませんでした",
  );
  expect(document.body.textContent).not.toContain("PRIVATE");
  expect(screen.getByRole("textbox", { name: "リスト名" })).toHaveValue(
    "買い物",
  );
});

it("F-020 blocks blank names and over-limit URLs with an exact actionable count", () => {
  setup();
  fireEvent.change(screen.getByRole("textbox", { name: "リスト名" }), {
    target: { value: " " },
  });
  expect(screen.getByRole("button", { name: "内容を確定" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "リスト名" }), {
    target: { value: "あ".repeat(2200) },
  });
  expect(screen.getByRole("button", { name: "内容を確定" })).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "項目を分けて送ってください",
  );
  expect(screen.getByText(/URL文字数: \d+ \/ 8000/)).toBeTruthy();
});

it("F-020 gives a safe selection recovery for changed tasks", async () => {
  setup({
    prepare: async () => {
      throw new Error(
        "選択したタスクが変更または削除されています。内容を確認し直してください。",
      );
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "内容を確定" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "「選択に戻る」で選び直してください",
  );
  expect(screen.getAllByRole("button", { name: /除外/ })).toHaveLength(2);
});

it("NF-006 reaches and edits the name using the keyboard", async () => {
  setup();
  const user = userEvent.setup();
  await user.tab();
  expect(
    screen.getByRole("button", { name: "テンパリストとの連携について" }),
  ).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("textbox", { name: "リスト名" })).toHaveFocus();
  await user.clear(screen.getByRole("textbox", { name: "リスト名" }));
  await user.keyboard("週末");
  await user.tab();
  expect(
    screen.getByRole("button", { name: "牛乳を買うを下へ" }),
  ).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getAllByTestId("transfer-item")[0]).toHaveTextContent(
    "電池を買う",
  );
});
