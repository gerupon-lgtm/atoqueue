import { CorruptDataError } from "./errors";
import type { AppSnapshot } from "./model";
import {
  buildTempalistUrl,
  validateTempalistPayload,
  type TempalistPayload,
} from "./tempalist-link";

export interface TempalistDraft {
  title: string;
  tasks: Array<{ id: string; title: string; revision: number }>;
}

export interface PreparedTempalistRequest {
  payload: TempalistPayload;
  url: string;
  preparedAt: string;
}

export interface TempalistMarker {
  taskId: string;
  requestId: string;
  lastOpenedAt: string;
}

export interface TempalistState {
  lastRequest: PreparedTempalistRequest | null;
  markers: TempalistMarker[];
}

export function emptyTempalistState(): TempalistState {
  return { lastRequest: null, markers: [] };
}

/** Strict validation also detaches every nested value from its source. */
export function validateTempalistState(value: unknown): TempalistState {
  const state = record(value, ["lastRequest", "markers"]);
  const lastRequest =
    state.lastRequest === null ? null : validateRequest(state.lastRequest);
  if (!Array.isArray(state.markers)) throw invalid();
  const seen = new Set<string>();
  const markers = state.markers.map((value) => {
    const marker = record(value, ["taskId", "requestId", "lastOpenedAt"]);
    if (
      typeof marker.taskId !== "string" ||
      !marker.taskId.trim() ||
      seen.has(marker.taskId)
    )
      throw invalid();
    if (
      typeof marker.requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        marker.requestId,
      )
    )
      throw invalid();
    seen.add(marker.taskId);
    return {
      taskId: marker.taskId,
      requestId: marker.requestId,
      lastOpenedAt: timestamp(marker.lastOpenedAt),
    };
  });
  return { lastRequest, markers };
}

export function prepareTempalistRequest(input: {
  snapshot: AppSnapshot;
  draft: TempalistDraft;
  requestId: string;
  now: string;
}): PreparedTempalistRequest {
  const current = new Map(input.snapshot.tasks.map((task) => [task.id, task]));
  const items = input.draft.tasks.map((selected) => {
    const task = current.get(selected.id);
    if (
      !task ||
      task.title !== selected.title ||
      task.revision !== selected.revision
    ) {
      throw new Error(
        "選択したタスクが変更または削除されています。内容を確認し直してください。",
      );
    }
    return { sourceTaskId: task.id, label: task.title };
  });
  const payload = validateTempalistPayload({
    schemaVersion: 1,
    kind: "checklist-create",
    source: "atoqueue",
    requestId: input.requestId,
    title: input.draft.title,
    items,
  });
  return {
    payload,
    url: buildTempalistUrl(payload),
    preparedAt: timestamp(input.now),
  };
}

export function markTempalistOpened(input: {
  state: TempalistState;
  request: PreparedTempalistRequest;
  existingTaskIds: readonly string[];
  now: string;
}): TempalistState {
  const state = validateTempalistState(input.state);
  const request = validateRequest(input.request);
  const now = timestamp(input.now);
  const existing = new Set(input.existingTaskIds);
  const targeted = new Set(
    request.payload.items.map((item) => item.sourceTaskId),
  );
  return {
    // Accepting an older open operation must never roll back a newer preparation.
    lastRequest: state.lastRequest,
    markers: [
      ...state.markers.filter((marker) => !targeted.has(marker.taskId)),
      ...request.payload.items
        .filter((item) => existing.has(item.sourceTaskId))
        .map((item) => ({
          taskId: item.sourceTaskId,
          requestId: request.payload.requestId,
          lastOpenedAt: now,
        })),
    ],
  };
}

function validateRequest(value: unknown): PreparedTempalistRequest {
  const request = record(value, ["payload", "url", "preparedAt"]);
  try {
    const payload = validateTempalistPayload(request.payload);
    const url = buildTempalistUrl(payload);
    if (request.url !== url) throw invalid();
    return { payload, url, preparedAt: timestamp(request.preparedAt) };
  } catch {
    // Do not expose private payloads or URLs in persistence errors.
    throw invalid();
  }
}

function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  const result = value as Record<string, unknown>;
  if (
    keys.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !keys.includes(key))
  )
    throw invalid();
  return result;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string") throw invalid();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value)
    throw invalid();
  return value;
}

function invalid(): CorruptDataError {
  return new CorruptDataError("Tempalist transfer data is invalid.");
}
