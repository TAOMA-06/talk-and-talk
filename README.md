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

- The app is frontend-only. Authentication, payment, chat, moderation, orders, and reports are local mock state.
- The deployment target is iOS 18. iOS 26+ uses Liquid Glass APIs through availability checks, with Material fallback on earlier supported systems.
