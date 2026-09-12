// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import {
  type AppRepository,
  type AppSnapshot,
  prepareTempalistRequest,
  markTempalistOpened,
} from "../../../../packages/domain/src";
import { makeTempalistFixture } from "../../../../packages/domain/src/tempalist-test-fixture";
import { TaskListPage } from "../features/tasks/TaskListPage";
import { TaskDetailPage } from "../features/tasks/TaskDetailPage";
import { TodayReviewPage } from "../features/review/TodayReviewPage";

const label = "!=テンパリストへ開く操作済み";
afterEach(cleanup);
function setup() {
  const fixture = makeTempalistFixture();
  let state = fixture.snapshot;
  const listeners = new Set<() => void>();
  const repository: AppRepository = {
    load: async () => state,
    save: vi.fn(async (next: AppSnapshot) => {
      state = { ...next, tempalist: state.tempalist };
      listeners.forEach((listener) => listener());
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    loadDraft: async () => "",
    saveDraft: async () => undefined,
    clearDraft: async () => undefined,
  };
  const request = prepareTempalistRequest({
    ...fixture,
    draft: { ...fixture.draft, tasks: [fixture.draft.tasks[0]] },
  });
  async function publish(open: boolean) {
    await act(async () => {
      state = {
        ...state,
        tempalist: open
          ? markTempalistOpened({
              state: state.tempalist,
              request,
              existingTaskIds: state.tasks.map((task) => task.id),
              now: fixture.now,
            })
          : { ...state.tempalist, lastRequest: request },
      };
      listeners.forEach((listener) => listener());
    });
  }
  return { repository, publish, now: () => fixture.now, state: () => state };
}

it("F-020 list matches task IDs, ignores prepare-only and never multiplies labels on reopen", async () => {
  const context = setup();
  render(
    <MemoryRouter>
      <TaskListPage {...context} />
    </MemoryRouter>,
  );
  await screen.findByRole("link", { name: "牛乳を買う" });
  await context.publish(false);
  expect(screen.queryByLabelText(label)).toBeNull();
  const original = structuredClone(context.state().tasks);
  await context.publish(true);
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
  expect(
    within(
      screen.getByRole("link", { name: "電池を買う" }).closest("li")!,
    ).queryByLabelText(label),
  ).toBeNull();
  await context.publish(true);
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
  expect(context.state().tasks).toEqual(original);
  expect(context.repository.save).not.toHaveBeenCalled();
});

it("F-020 detail refresh preserves unsaved editing and the badge survives edit, complete and reopen", async () => {
  const context = setup();
  render(<TaskDetailPage {...context} taskId="task-0" />);
  await screen.findByLabelText("タイトル");
  expect(screen.queryByLabelText(label)).toBeNull();
  fireEvent.change(screen.getByLabelText("タイトル"), {
    target: { value: "編集中の牛乳" },
  });
  await context.publish(true);
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
  expect((screen.getByLabelText("タイトル") as HTMLInputElement).value).toBe(
    "編集中の牛乳",
  );
  expect(context.repository.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "内容を保存" }));
  await screen.findByText("内容を保存しました。");
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "完了" }));
  await screen.findByRole("button", { name: "再開" });
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "再開" }));
  await screen.findByRole("button", { name: "完了" });
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
});

it("F-020 review metadata refresh preserves session position and an open deadline editor", async () => {
  const context = setup();
  render(<TodayReviewPage {...context} />);
  await screen.findByRole("heading", { name: "牛乳を買う" });
  fireEvent.click(screen.getByRole("button", { name: "日付を変える" }));
  fireEvent.change(screen.getByLabelText("新しい期限"), {
    target: { value: "2026-09-20" },
  });
  const sessions = structuredClone(context.state().reviewSessions);
  vi.mocked(context.repository.save).mockClear();
  await context.publish(true);
  expect(screen.getAllByLabelText(label)).toHaveLength(1);
  expect((screen.getByLabelText("新しい期限") as HTMLInputElement).value).toBe(
    "2026-09-20",
  );
  expect(context.state().reviewSessions).toEqual(sessions);
  expect(context.repository.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "次のタスク" }));
  await screen.findByRole("heading", { name: "電池を買う" });
  expect(screen.queryByLabelText(label)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "前のタスク" }));
  await waitFor(() => expect(screen.getAllByLabelText(label)).toHaveLength(1));
});
