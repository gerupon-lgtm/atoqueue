// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapture, createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
import { InboxPage } from "./InboxPage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithCaptures(): AppRepository {
  let snapshot = createEmptySnapshot({
    appVersion: "0.1.0",
    localDeviceId: "device-1",
    timeZone: "Asia/Tokyo",
    now,
  });
  snapshot = createCapture(snapshot, "古い記録", "2026-08-01T09:00:00.000Z", "capture-old");
  snapshot = createCapture(snapshot, "新しい記録", "2026-08-02T09:00:00.000Z", "capture-new");

  return {
    load: vi.fn().mockImplementation(async () => snapshot),
    save: vi.fn().mockImplementation(async (next) => {
      snapshot = next;
    }),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
  };
}

describe("InboxPage", () => {
  afterEach(cleanup);

  it("F-004 shows unclassified captures newest first with exactly three actions", async () => {
    render(<InboxPage repository={repositoryWithCaptures()} />);

    const items = await screen.findAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("新しい記録"),
      expect.stringContaining("古い記録"),
    ]);
    expect(screen.getAllByRole("button", { name: "タスクかも" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "メモ" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "不要" })).toHaveLength(2);
  });

  it("F-006 saves a memo classification locally", async () => {
    const repository = repositoryWithCaptures();
    render(<InboxPage now={() => now} repository={repository} />);

    const memoButtons = await screen.findAllByRole("button", { name: "メモ" });
    fireEvent.click(memoButtons[0]!);

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("新しい記録")).toBeNull();
  });

  it("F-004 persists an inline edit through the repository without changing classification", async () => {
    const repository = repositoryWithCaptures();
    render(<InboxPage now={() => now} repository={repository} />);

    const body = await screen.findByDisplayValue("新しい記録");
    fireEvent.change(body, { target: { value: "編集した記録" } });
    fireEvent.click(screen.getByRole("button", { name: "新しい記録の本文を保存" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect((repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].captures).toContainEqual(
      expect.objectContaining({ body: "編集した記録", classification: "unclassified" }),
    );
  });

  it("F-004 disables the whole list during a classification to prevent a concurrent lost update", async () => {
    const repository = repositoryWithCaptures();
    render(<InboxPage now={() => now} repository={repository} />);

    const memoButtons = await screen.findAllByRole("button", { name: "メモ" });
    fireEvent.click(memoButtons[0]!);

    expect(memoButtons[1]!.hasAttribute("disabled")).toBe(true);
    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    const finalSnapshot = (repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(finalSnapshot.captures.map((capture: { classification: string }) => capture.classification)).toEqual([
      "unclassified",
      "note",
    ]);
  });
});
