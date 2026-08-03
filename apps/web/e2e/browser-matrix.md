# Browser matrix

Task 14 uses the automated suite as a regression gate and the following manual matrix before a pilot release. Record observations in `docs/operations/browser-verification.md`; do not treat an automated Chromium run as a substitute for installed-PWA or real Push delivery.

| Target | Install | Offline reload | Notification permission | Test Push | Notification click |
| --- | --- | --- | --- | --- | --- |
| iOS Home Screen PWA | Manual | Manual | Manual | Manual | Manual |
| Android Chrome installed PWA | Manual | Manual | Manual | Manual | Manual |
| Windows Chrome installed PWA | Manual | Manual | Manual | Manual | Manual |
| Windows Edge installed PWA | Manual | Manual | Manual | Manual | Manual |

Automated coverage: `accessibility.spec.ts` checks all eight primary routes and keyboard paths; `offline-resilience.spec.ts` checks local persistence and online outbox recovery; `data-recovery.spec.ts` checks corrupt/future-schema preservation and stale notification navigation.
