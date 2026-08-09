import { useEffect, useState } from "react";
import {
  backupFilename,
  createBackup,
  inspectBackup,
  restoreBackup,
  type AppRepository,
  type AppSnapshot,
  type BackupInspection,
} from "../../../../../packages/domain/src";

export interface BackupSettingsProps {
  repository: AppRepository;
  now?: () => string;
  flushOutbox?: () => Promise<unknown>;
  deleteDeviceData?: () => Promise<void>;
  showHeading?: boolean;
}

/** Keeps export/import at the local persistence boundary, never in a page route. */
export function BackupSettings({
  repository,
  now = () => new Date().toISOString(),
  flushOutbox,
  deleteDeviceData,
  showHeading = true,
}: BackupSettingsProps) {
  const [current, setCurrent] = useState<AppSnapshot>();
  const [serialized, setSerialized] = useState<string>();
  const [inspection, setInspection] = useState<BackupInspection>();
  const [error, setError] = useState<string>();
  const [feedback, setFeedback] = useState<string>();
  const [syncPending, setSyncPending] = useState(false);
  const [activeOperation, setActiveOperation] = useState<
    "export" | "restore" | "delete"
  >();
  const [download, setDownload] = useState<{
    href: string;
    filename: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let active = true;
    void repository
      .load()
      .then((snapshot) => {
        if (active) setCurrent(snapshot);
      })
      .catch(() => {
        if (active) setError("現在のデータを読み込めませんでした。");
      });
    return () => {
      active = false;
    };
  }, [repository]);

  async function exportJson(): Promise<void> {
    setBusy(true);
    setActiveOperation("export");
    setDownload(undefined);
    setError(undefined);
    setFeedback(undefined);
    try {
      const snapshot = await repository.load();
      const contents = await createBackup(snapshot);
      if (download) URL.revokeObjectURL(download.href);
      setDownload({
        href: URL.createObjectURL(
          new Blob([contents], { type: "application/json" }),
        ),
        filename: backupFilename(new Date(now())),
      });
      setError(undefined);
      setFeedback("バックアップを準備しました。ダウンロードしてください。");
    } catch {
      setError("バックアップを作成できませんでした。");
    } finally {
      setBusy(false);
      setActiveOperation(undefined);
    }
  }

  async function selectBackup(file: File | undefined): Promise<void> {
    setInspection(undefined);
    setSerialized(undefined);
    setError(undefined);
    setFeedback(undefined);
    setSyncPending(false);
    if (!file) return;
    try {
      const contents = await readFile(file);
      const next = await inspectBackup(contents);
      const snapshot = await repository.load();
      setCurrent(snapshot);
      setSerialized(contents);
      setInspection(next);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "バックアップを確認できませんでした。",
      );
    }
  }

  async function replace(): Promise<void> {
    if (!serialized || !inspection) return;
    setBusy(true);
    setActiveOperation("restore");
    setError(undefined);
    setFeedback(undefined);
    setSyncPending(false);
    try {
      // Re-load just before confirmation so current device identity can never be stale.
      const latest = await repository.load();
      const restored = await restoreBackup({
        current: latest,
        serialized,
        now: now(),
      });
      await repository.save(restored);
      setCurrent(restored);
      setInspection(undefined);
      setSerialized(undefined);
      setFeedback("データを復元しました。");
      if (navigator.onLine !== false && flushOutbox) {
        try {
          await flushOutbox();
        } catch {
          setSyncPending(true);
        }
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "復元できませんでした。",
      );
    } finally {
      setBusy(false);
      setActiveOperation(undefined);
    }
  }

  async function removeDeviceData(): Promise<void> {
    if (!deleteDeviceData) return;
    setBusy(true);
    setActiveOperation("delete");
    setError(undefined);
    setFeedback(undefined);
    setSyncPending(false);
    setDeleted(false);
    try {
      await deleteDeviceData();
      setDeleted(true);
      setDeleteConfirmation(false);
      setCurrent(undefined);
    } catch {
      setError(
        "端末データを削除できませんでした。通信状態を確認してから、もう一度お試しください。",
      );
    } finally {
      setBusy(false);
      setActiveOperation(undefined);
    }
  }

  return (
    <section
      {...(showHeading
        ? { "aria-labelledby": "backup-settings-title" }
        : { "aria-label": "データ" })}
    >
      {showHeading ? <h2 id="backup-settings-title">データ</h2> : null}
      <p>
        バックアップにはこの端末のタスク、記録、設定を含めます。通知の登録情報は含めません。
      </p>
      <button disabled={busy} onClick={() => void exportJson()} type="button">
        {activeOperation === "export"
          ? "準備中…"
          : "JSONバックアップを書き出す"}
      </button>
      {download ? (
        <a download={download.filename} href={download.href}>
          バックアップをダウンロード
        </a>
      ) : null}
      {feedback ? <p role="status">{feedback}</p> : null}
      {syncPending ? <p role="alert">通知への反映は送信待ちです。</p> : null}
      <label>
        JSONバックアップを復元
        <input
          accept="application/json,.json"
          aria-label="JSONバックアップを復元"
          disabled={busy}
          onChange={(event) => void selectBackup(event.target.files?.[0])}
          type="file"
        />
      </label>
      {inspection && current ? (
        <section aria-live="polite">
          <p>{countsLabel("取り込みデータ", inspection.counts)}</p>
          <p>{countsLabel("現在のデータ", counts(current))}</p>
          <p>内容を確認してから置き換えてください。</p>
          <button disabled={busy} onClick={() => void replace()} type="button">
            {activeOperation === "restore" ? "復元中…" : "この内容で置き換える"}
          </button>
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <section
        aria-labelledby="device-data-title"
        className="backup-settings__danger-zone"
      >
        <h2 id="device-data-title">端末データ</h2>
        <p>
          この端末に保存した記録、タスク、設定、下書きを削除します。バックアップを作成してから実行してください。
        </p>
        {!deleteConfirmation ? (
          <button
            disabled={busy || !deleteDeviceData}
            onClick={() => setDeleteConfirmation(true)}
            type="button"
          >
            端末データを削除
          </button>
        ) : (
          <div className="backup-settings__delete-confirmation" role="alert">
            <p>この操作は取り消せません。</p>
            <div className="backup-settings__delete-actions">
              <button
                className="backup-settings__delete-confirm"
                disabled={busy}
                onClick={() => void removeDeviceData()}
                type="button"
              >
                {activeOperation === "delete" ? "削除中…" : "削除を確定する"}
              </button>
              <button
                className="backup-settings__delete-cancel"
                disabled={busy}
                onClick={() => setDeleteConfirmation(false)}
                type="button"
              >
                やめる
              </button>
            </div>
          </div>
        )}
        {deleted ? <p role="status">端末データを削除しました。</p> : null}
      </section>
    </section>
  );
}

function counts(snapshot: AppSnapshot) {
  return {
    captures: snapshot.captures.length,
    tasks: snapshot.tasks.length,
    reviewSessions: snapshot.reviewSessions.length,
    actionHistory: snapshot.actionHistory.length,
  };
}

function countsLabel(
  label: string,
  value: {
    captures: number;
    tasks: number;
    reviewSessions: number;
    actionHistory: number;
  },
): string {
  return `${label}: タスク ${value.tasks}件 / 記録 ${value.captures}件 / 確認 ${value.reviewSessions}件 / 履歴 ${value.actionHistory}件`;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(new Error("ファイルを読み込めませんでした。"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}
