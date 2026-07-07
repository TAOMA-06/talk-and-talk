# Talk&Talk iOS Demo

This folder is now the canonical iOS app workspace.

## Open and Build

1. Open `TalkAndTalk.xcodeproj` in Xcode.
2. Select the `TalkAndTalk` scheme.
3. Run on an iOS 18+ simulator or device.

The project is generated from `project.yml` with XcodeGen:

```bash
xcodegen generate
```

## Current Structure

- `Sources/` - SwiftUI app source for the iOS demo.
- `UITests/` - UI smoke tests.
- `project.yml` - XcodeGen configuration.
- `TalkAndTalk.xcodeproj` - generated Xcode project, ready to open.
- `Archive/` - previous experiments and older project layouts kept for reference.

## Notes

- Companion chat with 林屿/许澈/周映 (`c1`/`c2`/`c3`) can connect to the local `BackendDemo` API for real moderation and replies.
- Orders, community, discovery, and other companions remain local mock state.
- The deployment target is iOS 18. iOS 26+ uses Liquid Glass APIs through availability checks, with Material fallback on earlier supported systems.

## Dual-end demo (iOS + Web admin)

Terminal 1 — start backend:

```bash
cd BackendDemo
cp .env.example .env   # add DEEPSEEK_API_KEY
npm start
```

Terminal 2 — run iOS app in Simulator (Xcode → `TalkAndTalk` scheme).

Default backend URL for Simulator: `http://127.0.0.1:8787` (override with Scheme env `BACKEND_BASE_URL`).

1. Open chat with **林屿 (c1)** in the iOS app — status bar should show **后端已连接**.
2. Send a normal message → companion reply comes from backend.
3. Send `我们加微信聊吧` → blocked in app; refresh Web admin at `http://localhost:8787` to see the new ticket.

On a physical device, set `BACKEND_BASE_URL` to your Mac's LAN IP, e.g. `http://192.168.1.10:8787`.

See [BackendDemo/DEMO.md](BackendDemo/DEMO.md) for the full presentation script.

