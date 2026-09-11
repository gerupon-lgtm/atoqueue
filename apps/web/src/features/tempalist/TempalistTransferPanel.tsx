import { useRef, useState } from "react";
import { measureTempalistUrl } from "../../../../../packages/domain/src/tempalist-link";
import type {
  PreparedTempalistRequest,
  TempalistDraft,
} from "../../../../../packages/domain/src";
import type { TempalistTransferService } from "../../application/tempalist-transfer-service";
import "./TempalistTransferPanel.css";

export function TempalistTransferPanel({
  draft,
  onChange,
  onCancel,
  service,
}: {
  draft: TempalistDraft;
  onChange(draft: TempalistDraft): void;
  onCancel(): void;
  service: TempalistTransferService;
}) {
  const [prepared, setPrepared] = useState<PreparedTempalistRequest | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState(false);
  let length: number | null = null;
  let invalid = "";
  try {
    length = measureTempalistUrl({
      schemaVersion: 1,
      kind: "checklist-create",
      source: "atoqueue",
      requestId: "00000000-0000-4000-8000-000000000000",
      title: draft.title,
      items: draft.tasks.map((task) => ({
        sourceTaskId: task.id,
        label: task.title,
      })),
    });
    if (length > 8000)
      invalid =
        "8000文字を超えています。リスト名を短くするか、項目を分けて送ってください。";
  } catch {
    invalid = !draft.title.trim()
      ? "リスト名を入力してください。"
      : draft.tasks.length === 0
        ? "タスクを1件以上選択してください。"
        : "項目の内容を確認し、タスクを選び直してください。";
  }
  async function run(operation: "prepare" | "open") {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      if (operation === "prepare") setPrepared(await service.prepare(draft));
      else if (prepared) {
        await service.open(prepared);
        setOpened(true);
      }
    } catch (cause) {
      const changed =
        cause instanceof Error &&
        cause.message ===
          "選択したタスクが変更または削除されています。内容を確認し直してください。";
      setError(
        changed
          ? "選択したタスクが変更または削除されています。「選択に戻る」で選び直してください。"
          : operation === "prepare"
            ? "確定内容を保存できませんでした。入力は保持されています。もう一度確定してください。"
            : "開く操作を完了できませんでした。同じ内容でもう一度開いてください。",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function change(next: TempalistDraft) {
    if (pending.current) return;
    setError("");
    onChange(next);
  }
  function move(index: number, offset: number) {
    const tasks = [...draft.tasks];
    [tasks[index], tasks[index + offset]] = [
      tasks[index + offset]!,
      tasks[index]!,
    ];
    change({ ...draft, tasks });
  }
  return (
    <section
      className="tempalist-transfer"
      aria-labelledby="tempalist-title"
      aria-busy={busy}
    >
      <h1 id="tempalist-title">チェックリストの確認</h1>
      <p>
        URLには選択したタスク名が含まれます。URLの共有やブラウザ履歴から内容が見える場合があります。
      </p>
      <p>元のタスクと通知はあとキューに残ります。</p>
      <p>
        Androidを優先して確認しています。iOSのアプリ起動・保存先は未検証です。
      </p>
      <fieldset disabled={busy}>
        {prepared ? (
          <>
            <h2>{prepared.payload.title}</h2>
            <ol>
              {prepared.payload.items.map((item) => (
                <li key={item.sourceTaskId}>{item.label}</li>
              ))}
            </ol>
            <p>
              確定内容を保存しました。開く操作は受信・保存の成功を示すものではありません。
            </p>
            <button type="button" onClick={() => void run("open")}>
              テンパリストで開く
            </button>
            <button
              type="button"
              onClick={() => {
                setPrepared(null);
                setOpened(false);
                setError("");
              }}
            >
              編集に戻る
            </button>
          </>
        ) : (
          <>
            <label>
              リスト名
              <input
                value={draft.title}
                onChange={(event) =>
                  change({ ...draft, title: event.target.value })
                }
              />
            </label>
            <ol className="tempalist-transfer__items">
              {draft.tasks.map((task, index) => (
                <li key={task.id} data-testid="transfer-item">
                  <span>{task.title}</span>
                  <div className="tempalist-transfer__actions">
                    <button
                      type="button"
                      aria-label={`${task.title}を上へ`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      上へ
                    </button>
                    <button
                      type="button"
                      aria-label={`${task.title}を下へ`}
                      disabled={index === draft.tasks.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      下へ
                    </button>
                    <button
                      type="button"
                      aria-label={`${task.title}を除外`}
                      onClick={() =>
                        change({
                          ...draft,
                          tasks: draft.tasks.filter(
                            (item) => item.id !== task.id,
                          ),
                        })
                      }
                    >
                      除外
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <p>
              {draft.tasks.length}件 / URL文字数: {length ?? "—"} / 8000
            </p>
            {invalid && <p role="alert">{invalid}</p>}
            <button
              type="button"
              disabled={!!invalid}
              onClick={() => void run("prepare")}
            >
              内容を確定
            </button>
          </>
        )}
        <button type="button" disabled={busy} onClick={onCancel}>
          選択に戻る
        </button>
      </fieldset>
      {busy && <p role="status">保存しています…</p>}
      {error && <p role="alert">{error}</p>}
      {opened && (
        <p role="status">
          開く操作を受け付けました。同じ内容でもう一度開けます。
        </p>
      )}
    </section>
  );
}
