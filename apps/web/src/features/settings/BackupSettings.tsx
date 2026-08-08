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
}

/** Keeps export/import at the local persistence boundary, never in a page route. */
export function BackupSettings({ repository, now = () => new Date().toISOString(), flushOutbox, deleteDeviceData }: BackupSettingsProps) {
  const [current, setCurrent] = useState<AppSnapshot>();
  const [serialized, setSerialized] = useState<string>();
  const [inspection, setInspection] = useState<BackupInspection>();
  const [error, setError] = useState<string>();
  const [download, setDownload] = useState<{ href: string; filename: string }>();
  const [busy, setBusy] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let active = true;
    void repository.load().then((snapshot) => { if (active) setCurrent(snapshot); }).catch(() => { if (active) setError("現在のデータを読み込めませんでした。"); });
    return () => { active = false; };
  }, [repository]);

  async function exportJson(): Promise<void> {
    try {
      const snapshot = await repository.load();
      const contents = await createBackup(snapshot);
      if (download) URL.revokeObjectURL(download.href);
      setDownload({ href: URL.createObjectURL(new Blob([contents], { type: "application/json" })), filename: backupFilename(new Date(now())) });
      setError(undefined);
    } catch {
      setError("バックアップを作成できませんでした。");
    }
  }

  async function selectBackup(file: File | undefined): Promise<void> {
    setInspection(undefined);
    setSerialized(undefined);
    setError(undefined);
    if (!file) return;
    try {
      const contents = await readFile(file);
      const next = await inspectBackup(contents);
      const snapshot = await repository.load();
      setCurrent(snapshot);
      setSerialized(contents);
      setInspection(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "バックアップを確認できませんでした。");
    }
  }

  async function replace(): Promise<void> {
    if (!serialized || !inspection) return;
    setBusy(true);
    try {
      // Re-load just before confirmation so current device identity can never be stale.
      const latest = await repository.load();
      const restored = await restoreBackup({ current: latest, serialized, now: now() });
      await repository.save(restored);
      setCurrent(restored);
      setInspection(undefined);
      setSerialized(undefined);
      if (navigator.onLine !== false) await flushOutbox?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "復元できませんでした。");
    } finally {
      setBusy(false);
    }
  }

  async function removeDeviceData(): Promise<void> {
    if (!deleteDeviceData) return;
    setBusy(true);
    try {
      await deleteDeviceData();
      setDeleted(true);
      setDeleteConfirmation(false);
      setCurrent(undefined);
    } catch {
      setError("端末データを削除できませんでした。通信状態を確認してから、もう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  return <section aria-labelledby="backup-settings-title">
    <h2 id="backup-settings-title">データ</h2>
    <p>バックアップにはこの端末のタスク、記録、設定を含めます。通知の登録情報は含めません。</p>
    <button onClick={() => void exportJson()} type="button">JSONバックアップを書き出す</button>
    {download ? <a download={download.filename} href={download.href}>バックアップをダウンロード</a> : null}
    <label>
      JSONバックアップを復元
      <input accept="application/json,.json" aria-label="JSONバックアップを復元" onChange={(event) => void selectBackup(event.target.files?.[0])} type="file" />
    </label>
    {inspection && current ? <section aria-live="polite">
      <p>{countsLabel("取り込みデータ", inspection.counts)}</p>
      <p>{countsLabel("現在のデータ", counts(current))}</p>
      <p>内容を確認してから置き換えてください。</p>
      <button disabled={busy} onClick={() => void replace()} type="button">この内容で置き換える</button>
    </section> : null}
    {error ? <p role="alert">{error}</p> : null}
    <section aria-labelledby="device-data-title" className="backup-settings__danger-zone">
      <h2 id="device-data-title">端末データ</h2>
      <p>この端末に保存した記録、タスク、設定、下書きを削除します。バックアップを作成してから実行してください。</p>
      {!deleteConfirmation ? (
        <button disabled={busy || !deleteDeviceData} onClick={() => setDeleteConfirmation(true)} type="button">端末データを削除</button>
      ) : (
        <div role="alert">
          <p>この操作は取り消せません。</p>
          <button disabled={busy} onClick={() => void removeDeviceData()} type="button">削除を確定する</button>
          <button disabled={busy} onClick={() => setDeleteConfirmation(false)} type="button">やめる</button>
        </div>
      )}
      {deleted ? <p role="status">端末データを削除しました。</p> : null}
    </section>
  </section>;
}

function counts(snapshot: AppSnapshot) {
  return { captures: snapshot.captures.length, tasks: snapshot.tasks.length, reviewSessions: snapshot.reviewSessions.length, actionHistory: snapshot.actionHistory.length };
}

function countsLabel(label: string, value: { captures: number; tasks: number; reviewSessions: number; actionHistory: number }): string {
  return `${label}: タスク ${value.tasks}件 / 記録 ${value.captures}件 / 確認 ${value.reviewSessions}件 / 履歴 ${value.actionHistory}件`;
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("ファイルを読み込めませんでした。"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(file);
  });
}
