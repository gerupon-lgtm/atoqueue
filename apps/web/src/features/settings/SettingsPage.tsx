import type { AppRepository } from "../../../../../packages/domain/src";
import { BackupSettings } from "./BackupSettings";
import { NotificationSettings } from "./NotificationSettings";

export interface SettingsPageProps {
  repository: AppRepository;
  flushNotifications?: () => Promise<unknown>;
}

export function SettingsPage({ repository, flushNotifications }: SettingsPageProps) {
  return <section aria-labelledby="settings-page-title">
    <h1 id="settings-page-title">設定</h1>
    <BackupSettings repository={repository} flushOutbox={flushNotifications} />
    <NotificationSettings flushNotifications={flushNotifications} repository={repository} />
    <section aria-labelledby="app-information-title">
      <h2 id="app-information-title">アプリ情報</h2>
      <p>あとキュー</p>
      <p>バージョン 0.1.0</p>
      <p>この端末にのみデータを保存します。</p>
      <p>端末間では同期しません。</p>
    </section>
  </section>;
}
