import {
  markTempalistOpened,
  prepareTempalistRequest,
  validateTempalistState,
  type PreparedTempalistRequest,
  type TempalistDraft,
} from "../../../../packages/domain/src";
import type { TempalistRepository } from "./tempalist-repository";

export interface TempalistLaunchPort {
  open(url: string): void;
}

export interface TempalistTransferService {
  prepare(draft: TempalistDraft): Promise<PreparedTempalistRequest>;
  lastRequest(): Promise<PreparedTempalistRequest | null>;
  open(request: PreparedTempalistRequest): Promise<void>;
}

export function createTempalistTransferService(input: {
  repository: TempalistRepository;
  launcher: TempalistLaunchPort;
  now: () => string;
  requestId: () => string;
}): TempalistTransferService {
  let pending: {
    key: string;
    promise: Promise<PreparedTempalistRequest>;
  } | null = null;

  return {
    prepare(draft) {
      const selection: TempalistDraft = {
        title: draft.title,
        tasks: draft.tasks.map(({ id, title, revision }) => ({
          id,
          title,
          revision,
        })),
      };
      const key = JSON.stringify(selection);
      if (pending) {
        return pending.key === key
          ? pending.promise
          : Promise.reject(
              new Error(
                "確定処理中です。完了してからもう一度操作してください。",
              ),
            );
      }
      // Defer work until the shared Promise has been installed, including ID creation.
      const promise = Promise.resolve()
        .then(async () => {
          const requestId = input.requestId();
          const state = await input.repository.updateTempalist((latest) => ({
            ...latest.tempalist,
            lastRequest: prepareTempalistRequest({
              snapshot: latest,
              draft: selection,
              requestId,
              now: input.now(),
            }),
          }));
          const request = validateTempalistState(state).lastRequest;
          if (!request) throw new Error("確定内容を保存できませんでした。");
          return request;
        })
        .finally(() => {
          pending = null;
        });
      pending = { key, promise };
      return promise;
    },
    async lastRequest() {
      return validateTempalistState((await input.repository.load()).tempalist)
        .lastRequest;
    },
    async open(request) {
      // Validation detaches the entire request synchronously before any await.
      const fixed = validateTempalistState({
        lastRequest: request,
        markers: [],
      }).lastRequest;
      if (!fixed) throw new Error("確定内容を確認できませんでした。");
      fixed.payload.items.forEach(Object.freeze);
      Object.freeze(fixed.payload.items);
      Object.freeze(fixed.payload);
      Object.freeze(fixed);
      await input.repository.updateTempalist((latest) =>
        markTempalistOpened({
          state: latest.tempalist,
          request: fixed,
          existingTaskIds: latest.tasks.map((task) => task.id),
          now: input.now(),
        }),
      );
      try {
        input.launcher.open(fixed.url);
      } catch {
        // Navigation acceptance cannot establish receipt. Keep the persisted marker.
        throw new Error(
          "開く操作を完了できませんでした。同じ内容でもう一度開けます",
        );
      }
    },
  };
}
