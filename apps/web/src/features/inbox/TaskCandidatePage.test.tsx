// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapture, createEmptySnapshot, type AppRepository } from "../../../../../packages/domain/src";
import { TaskCandidatePage } from "./TaskCandidatePage";

const now = "2026-08-03T09:00:00.000Z";

function repositoryWithCapture(): AppRepository {
  const snapshot = createCapture(
    createEmptySnapshot({
      appVersion: "0.1.0",
      localDeviceId: "device-1",
      timeZone: "Asia/Tokyo",
      now,
    }),
    "牛乳を買う",
    now,
    "capture-1",
  );
  return {
    load: vi.fn().mockResolvedValue(snapshot),
    save: vi.fn().mockResolvedValue(undefined),
    loadDraft: vi.fn().mockResolvedValue(""),
    saveDraft: vi.fn().mockResolvedValue(undefined),
    clearDraft: vi.fn().mockResolvedValue(undefined),
  };
}

describe("TaskCandidatePage", () => {
  afterEach(cleanup);

  it("F-005 creates no task until the user presses タスクにする", async () => {
    const repository = repositoryWithCapture();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        createId={() => "task-1"}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    expect(repository.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "タスクにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect((repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].tasks).toEqual([
      expect.objectContaining({ id: "task-1", sourceCaptureId: "capture-1" }),
    ]);
  });

  it("F-005 offers an optional category and persists the user-selected candidate", async () => {
    const repository = repositoryWithCapture();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        createId={() => "task-1"}
        now={() => now}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.change(screen.getByLabelText("カテゴリ"), { target: { value: "shopping" } });
    fireEvent.click(screen.getByRole("button", { name: "タスクにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect((repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].tasks[0]).toMatchObject({
      category: "shopping",
    });
  });

  it("F-006 changes the capture to a memo only after メモにする and returns", async () => {
    const repository = repositoryWithCapture();
    const onReturn = vi.fn();
    render(
      <TaskCandidatePage
        captureId="capture-1"
        now={() => now}
        onReturn={onReturn}
        repository={repository}
      />,
    );

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "メモにする" }));

    await waitFor(() => expect(repository.save).toHaveBeenCalledTimes(1));
    expect((repository.save as ReturnType<typeof vi.fn>).mock.calls[0]![0].captures[0]).toMatchObject({
      classification: "note",
    });
    expect(onReturn).toHaveBeenCalledOnce();
  });

  it("F-004 returns to the inbox without classifying when 受信箱へ戻る is pressed", async () => {
    const repository = repositoryWithCapture();
    const onReturn = vi.fn();
    render(<TaskCandidatePage captureId="capture-1" onReturn={onReturn} repository={repository} />);

    await screen.findByDisplayValue("牛乳を買う");
    fireEvent.click(screen.getByRole("button", { name: "受信箱へ戻る" }));

    expect(repository.save).not.toHaveBeenCalled();
    expect(onReturn).toHaveBeenCalledOnce();
  });
});
