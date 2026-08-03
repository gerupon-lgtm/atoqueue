# Browser verification

Task 14 requirements: NF-001, NF-003, NF-004, NF-005, NF-006, NF-010, NF-012, NF-013 and F-013.

Use the production PWA and notification API only after their deployment approval. Do not put a task title or task body in any test Push request; confirm that the visible notification is the generic text `あとキュー` / `確認したい項目があります`.

## Recording template

Record one row per real-device run. `Pending` is not a passing result.

| Date (JST) | Device / OS | Browser and version | Install result | Offline result | Permission result | Generic test Push result | Notification click result | Notes / operator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pending | iOS / iOS version | Safari / version | Pending | Pending | Pending | Pending | Pending | Home Screen PWA |
| Pending | Android / Android version | Chrome / version | Pending | Pending | Pending | Pending | Pending | Installed PWA |
| Pending | Windows / version | Chrome / version | Pending | Pending | Pending | Pending | Pending | Installed PWA |
| Pending | Windows / version | Edge / version | Pending | Pending | Pending | Pending | Pending | Installed PWA |

## Procedure

1. Install the PWA and reopen it from the installed icon. Confirm Japanese name and icon.
2. Create a capture, disable network, reload the app, and confirm the capture remains. Make one local edit while the notification API is unavailable; the app must remain usable.
3. Re-enable network and open the app. Confirm the anonymous notification outbox can retry. No task text may appear in network inspection or server logs.
4. From Settings, read the privacy explanation and explicitly select `通知を設定する`. Confirm no permission prompt appears before that action. Test both denied and unavailable states: the app must instruct the user to use browser settings or continue with 今日の確認.
5. Send a staging/production test Push using only a reminder ID. Confirm generic notification text, then tap/click it. A current mapped reminder may be prioritised; a stale or unknown reminder must open normal `/today` without an error.
6. For recovery, in a non-production browser profile set malformed and future-schema local data. Confirm the original value is preserved; malformed data is copied under `atoqueue:corrupt:<timestamp>` and the user sees a recovery message. Never overwrite an unsupported schema.

## Automated evidence and limitations

- `apps/web/e2e/accessibility.spec.ts` runs axe serious/critical checks over the capture, inbox, candidate, Today, result, task list, task detail, and Settings routes, and exercises keyboard-only paths.
- `apps/web/e2e/offline-resilience.spec.ts` checks saved offline reload and online recovery of the anonymous outbox.
- `apps/web/e2e/data-recovery.spec.ts` checks malformed JSON, unsupported schema preservation, and stale notification navigation.
- `apps/api/src/privacy-regression.test.ts` submits `SECRET_TASK_CANARY_8D3` through the rejected request path and checks HTTP responses, in-memory database records, Push payloads, and structured logs. It is a contract regression test; it cannot inspect a production PostgreSQL server or third-party browser Push service.

The local Codex sandbox may prevent Playwright Chromium from launching with `spawn EPERM`. When that happens, run the same direct command on a workstation that can launch Chromium and attach the result; do not mark browser checks as completed from a sandbox failure.

## Accepted dependency exception

`pnpm audit --audit-level high` on 2026-08-04 reports `GHSA-qwww-vcr4-c8h2` for `apps/web > react-router-dom > react-router` (installed 7.18.2; advisory range `>=7.12.0 <8.3.0`). This PWA does not enable React Router RSC mode or expose server actions, so the reported RSC CSRF path is not reachable in this client-only Vite deployment. Upgrade to React Router 8.3.0 or later as part of the next router compatibility review; remove this exception only after the production build and route tests pass on that version.
