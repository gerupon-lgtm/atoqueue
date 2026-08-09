import type { AppRepository } from "../../../../../packages/domain/src";
import type { NotificationSetupResult } from "../../infrastructure/notifications/push-subscription";
import { BackupSettings } from "./BackupSettings";
import { NotificationSettings } from "./NotificationSettings";
import "./SettingsPage.css";

export interface SettingsPageProps {
  repository: AppRepository;
  flushNotifications?: () => Promise<unknown>;
  deleteDeviceData?: () => Promise<void>;
  setupNotifications?: () => Promise<NotificationSetupResult>;
}

export function SettingsPage({
  repository,
  flushNotifications,
  deleteDeviceData,
  setupNotifications,
}: SettingsPageProps) {
  return (
    <section aria-labelledby="settings-page-title" className="settings-page">
      <h1 id="settings-page-title">設定</h1>
      <NotificationSettings
        flushNotifications={flushNotifications}
        repository={repository}
        setup={setupNotifications}
      />
      <details className="settings-page__disclosure">
        <summary>データ</summary>
        <div className="settings-page__disclosure-content">
          <BackupSettings
            deleteDeviceData={deleteDeviceData}
            repository={repository}
            flushOutbox={flushNotifications}
            showHeading={false}
          />
        </div>
      </details>
      <details className="settings-page__disclosure">
        <summary>アプリ情報</summary>
        <div
          aria-label="アプリ情報"
          className="settings-page__app-information settings-page__disclosure-content"
        >
          <dl>
            <div>
              <dt>アプリ</dt>
              <dd>あとキュー</dd>
            </div>
            <div>
              <dt>バージョン</dt>
              <dd>0.1.0</dd>
            </div>
            <div>
              <dt>保存</dt>
              <dd>この端末のみ</dd>
            </div>
            <div>
              <dt>同期</dt>
              <dd>端末間では同期しません</dd>
            </div>
          </dl>
        </div>
      </details>
      <small className="settings-page__copyright">© 2026 SIKUMI LAB</small>
    </section>
  );
}
