# UI 2.0 DevTools visual evidence

Status: `conditional_pass` — 62/62 main screenshots accepted by `verify-matrix.mjs`.

- Light: 31/31 captured, 0 redirects, 0 failures.
- Dark: 31/31 rendered in the official dark simulator and saved from the real Developer Tools window because dark-mode `App.captureScreenshot` stalled.
- Contact sheets: `light-contact-sheet.png` and `dark-contact-sheet.png`.
- Device evidence: six critical flows at 320×568 and 430×932; the 390×844 simulator is covered by the 62-image matrix.
- Enlarged text: four critical flows at 320×568 / font size 26.
- Key states accepted: filter dialog, empty, localized error, disabled action and avatar fallback.
- Not accepted: visible loading skeleton and keyboard-focus screenshots; Developer Tools crashed during those final captures.

The matrix was generated from a fresh `frontend/miniprogram/scripts/create-local-copy.mjs` project using the explicit local test AppID. Preview, upload and real-device actions remained outside this run.

After setting the simulator theme, run:

```bash
env \
  MINIPROGRAM_AUTOMATOR_ROOT=/private/tmp/talktalk-miniprogram-automator \
  MINIPROGRAM_AUTOMATION_PORT=9420 \
  UI2_THEME=light \
  UI2_CUSTOMER_SESSION_PAYLOAD=/private/tmp/.../runtime/u1/devtools-storage-payload.json \
  UI2_COMPANION_SESSION_PAYLOAD=/private/tmp/.../runtime/p1/devtools-storage-payload.json \
  UI2_LOCAL_LEGAL_ORIGIN=http://127.0.0.1:32029 \
  UI2_SCREENSHOT_DIR="$PWD/artifacts/ui2-visual-evidence/light" \
  node artifacts/ui2-visual-evidence/capture-pages.mjs
```

Repeat with `UI2_THEME=dark` after changing the DevTools simulator to dark appearance. `manifest.json` records captured, redirected and failed routes; redirected consent/login pages are not counted as the intended page passing.
