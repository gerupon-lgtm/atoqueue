# 記録画面の起動直後フォーカス復元計画

**Requirements:** F-001、F-002、NF-001、NF-009

**Goal:** 通知設定を処理済みの端末では、保存済み状態の非同期読込を待たず、記録画面のマウント直後に本文入力欄へフォーカスする。Pixelの起動直後で従来動いていたタイミングを復元し、追加のタイマー遅延は入れない。

**Constraints:**

- 通知設定が未処理（`pushSubscriptionStatus="not_requested"`）の端末では、自動フォーカスもVirtual Keyboard APIの表示要求も行わない。
- 画面コンポーネントから `localStorage` を直接参照しない。同期的な起動判定が必要なら、インフラストラクチャ境界から真偽値を渡す。
- 起動時と、別画面から記録画面へ戻った時の両方で同じ動作にする。
- `navigator.virtualKeyboard.show()` は機能検出し、例外や非対応時も入力欄のフォーカスを維持する。
- 保存形式、通知API、DB migration、通知文面は変更しない。
- 単一画面のロジック変更として、表示・Web・API・全ワークスペースの版を `mvp-1.26.0` / `1.26.0` へ揃える。
- PixelでのOSキーボード表示は自動テストでは確定できないため、公開後の実機確認を受入項目として残す。

## Task 1: 起動直後フォーカスを復元する

**Files:**

- Modify: `apps/web/src/features/capture/QuickCapturePage.tsx`
- Modify: `apps/web/src/features/capture/QuickCapturePage.test.tsx`
- Modify: `apps/web/src/infrastructure/local-storage/local-storage-repository.ts`
- Modify: `apps/web/src/infrastructure/local-storage/local-storage-repository.test.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/e2e/quick-capture.spec.ts` only if the existing public-flow assertion needs adjustment
- Modify: version manifests/constants and the current design/release documents
- Create: `docs/operations/releases/mvp-1.26.0.md`

### Step 1: RED

公開UIテストで、`repository.load()` と `repository.loadDraft()` が未解決でも、同期的な起動判定が「通知設定処理済み」を返す場合は、初回effectで本文入力欄がフォーカスされ、Virtual Keyboard APIへ1回だけ表示要求することを確認する。現行実装では非同期読込を待つため失敗することを確認する。

同時に、同期的な起動判定が未処理を返す場合はフォーカスも表示要求も行わないテストを維持する。

### Step 2: GREEN

ローカル保存アダプタに、保存済みSnapshotを検証済みの既存読込経路で同期参照し、通知設定が処理済みかだけを返す安全な起動判定を追加する。保存データなし・破損・未知版では自動フォーカスを許可せず、通常の非同期読込による既存エラー処理へ委ねる。

ルーターから起動判定コールバックを `QuickCapturePage` へ渡し、マウント直後のeffectで判定してフォーカスする。非同期Snapshot読込後の既存処理は、汎用テストや別アダプタ向けのフォールバックとして維持してよいが、同一マウントで表示要求を重複させない。

### Step 3: 検証

- `QuickCapturePage` と `LocalStorageRepository` の対象テスト
- Web単体・結合テスト
- Chromium E2Eの記録画面起動・画面遷移
- lint、全ワークスペース型検査、全テスト、全build、配置成果物検査
- `git diff --check`

### Step 4: リリース

要件・基本設計・画面設計・タスク一覧・MVP計画へ、非同期読込後ではなくマウント直後に復元した理由と、Pixel実機確認が必要な点を追記する。検証結果を `docs/operations/releases/mvp-1.26.0.md` に記録し、承認済みのGitHub Actions本番フローで配置する。
