# Talk&Talk UI 2.0 delivery evidence

Generated against the working tree on 2026-08-29. This is local repository evidence only; it is not a release, preview upload or production deployment receipt.

## Implemented

- 31 registered Mini Program pages use the Apple × WeChat light/dark design system.
- 10 shared components cover avatars, media cards, list cells, status, skeleton/loading, empty/error states, action bars, segmented controls and half-screen sheets.
- Native navigation and the five-tab bar use `darkmode` + `themeLocation` with light/dark icon sets.
- Five synthetic fictional portrait fixtures and one editorial hero are bundled for local/staging demonstration only.
- Companion avatar/cover reserve, complete, review, replace, remove and public-read APIs are implemented with owner scope, MIME/size/SHA-256 validation, moderated publication and controlled storage cleanup.
- Account deletion immediately unpublishes the companion and detaches avatar/cover references; retained media remains subject to the existing bounded storage-deletion worker.

## Automated evidence

| Gate | Result |
|---|---|
| Backend TypeScript production build | Passed |
| Backend Jest | 148 suites / 1405 tests passed / 0 skipped |
| Static commercial preflight | 93 tests passed / 0 skipped |
| Prisma schema generation and empty-schema migration diff | Passed |
| OpenAPI route/status/reference contract | Passed as part of static preflight |
| Mini Program TypeScript | Passed |
| Registered page/route structure | 31 pages / 5 tabs passed; external AppID warning expected in development |
| Mini Program runtime smoke | 885 mock API calls passed, including mock/real payment branches |
| UI 2.0 static audit | 31 pages / 10 components / light+dark / token-only page styles passed |
| Synthetic asset manifest | 17 source/output files matched SHA-256; avatar outputs are 384px/768px WebP within budget |
| Local-build isolation | Passed |
| Git whitespace check | Passed |
| Official Developer Tools compile | Passed on the isolated project with 0 project errors; remaining warnings were DevTools/grey-library notices |
| Main visual matrix | 31 light + 31 dark screenshots verified, 62 total |
| Device matrix | Representative critical flows captured at 320×568, 390×844 and 430×932 |
| Enlarged text | Four critical flows captured at 320×568 with Developer Tools font size 26 |

## Evidence not passed in this run

- **Visible loading-skeleton screenshot:** not accepted. The component/runtime gates pass, but Developer Tools crashed during the final visible skeleton capture.
- **Keyboard-focus screenshot:** not accepted. Computer Use returned `noWindowsAvailable`, then the Developer Tools window reported `已崩溃` before focus evidence could be saved.
- **Every page at all three device sizes:** not run. All 31 pages were captured at 390×844; six high-risk flows were additionally captured at both 320×568 and 430×932.
- **Sealed candidate PostgreSQL execution:** not run. A brand-new disposable PostgreSQL database successfully applied all 118 migrations, including `20260828010000_companion_profile_media`; this does not replace the protected candidate receipt.
- **Real storage/moderation provider, real WeChat login/payment, preview/upload and physical-device checks:** not run and intentionally outside this local implementation run.

Dark-mode `App.captureScreenshot` repeatedly stalled in Developer Tools 2.01.2510290. Dark evidence therefore uses the same official simulator rendered in the real DevTools window, saved through Computer Use and cropped to the visible device frame. The raw window captures, crop metadata and per-route manifest are retained.

## Safety boundary

Do not use the synthetic portraits as production identities. Do not run preview, upload, production media migration, deploy or push from this evidence folder.

Both disposable PostgreSQL databases, Redis DB 11/12, temporary session payloads and generated Developer Tools projects were removed after capture. Only repository source and non-secret evidence artifacts remain.
