# 修正指示書: subagent-driven-development の Windows 実行互換性

## 概要

`subagent-driven-development` スキルの付属スクリプト `scripts/sdd-workspace` は Bash を前提としている。Windows の本作業環境では Bash サービスが `CreateInstance/E_ACCESSDENIED` で起動できず、スクリプトを実行できなかった。

## 再現条件

- Windows / PowerShell 環境
- Bash サービスの起動が許可されていない環境
- `bash scripts/sdd-workspace <plan-file>` を実行

## 期待結果

スキルの作業台帳・タスクブリーフ・レビュー用パッケージを、Bash が使えない Windows 環境でも生成できる。

## 修正案

1. `scripts/` に PowerShell 実装（`sdd-workspace.ps1`、`task-brief.ps1`、`review-package.ps1`）を併設する。
2. スキル本文で OS を検出し、Windows では PowerShell 実装を案内する。
3. PowerShell 実装は UTF-8 を明示し、計画単位の `.superpowers/sdd/<plan-name>/` と自己無視用 `.gitignore` を Bash 実装と同じ仕様にする。

## 今回の暫定対応

同一のディレクトリ構成と台帳形式を PowerShell と `apply_patch` で作成し、以降の実装・レビュー記録に使用する。
