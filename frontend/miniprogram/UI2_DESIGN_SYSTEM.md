# Talk&Talk Mini Program UI 2.0

## Direction

Apple-like hierarchy and restraint with native WeChat interaction behavior. Consumer surfaces lead with calm editorial content; companion tools use the same tokens with a denser operational layout.

## Theme tokens

| Role | Light | Dark |
|---|---:|---:|
| Background | `#F7F5F2` | `#0E0F10` |
| Surface | `#FFFFFF` | `#17191B` |
| Primary text | `#171717` | `#F5F3F0` |
| Secondary text | `#64615D` | `#A6A29D` |
| Border | `#E2DFDA` | `#2B2E31` |
| Accent | `#C65345` | `#FF8A78` |

`theme.json` owns the native navigation and TabBar values. `app.wxss` exposes matching semantic custom properties for page and component content. Every registered page must use semantic tokens; `scripts/ui2-audit.mjs` rejects raw page colors, gradients, decorative shadows and tail override layers.

## Typography, layout and motion

- System fonts only: Apple system / Helvetica Neue / PingFang SC.
- Display `44–52rpx`, section title `34rpx`, body `28rpx`, caption `25rpx`, metadata `22rpx`.
- Main spacing scale: `8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 56rpx`.
- Control radius `16rpx`, card `22rpx`, sheet `32rpx`, pill `999rpx`.
- Press feedback is `160ms`; entrances and sheets are `220–240ms`; reduced-motion disables them.

## Shared components

- `tt-avatar`: remote image, fixed local demo fallback, initials fallback and online state.
- `tt-media-card`: image-led companion discovery card.
- `tt-list-cell`: native grouped-list navigation.
- `tt-status`: semantic status with shape and text, never color alone.
- `tt-state` / `tt-skeleton`: loading, empty and error presentation.
- `tt-segmented`: compact tab selection.
- `tt-action-bar`: safe-area-aware primary actions.
- `tt-sheet` / `tt-filter-sheet`: root-portal dialog semantics and bounded scrolling.

## Synthetic assets

The five bundled portraits and the home illustration are fictional local/staging fixtures. Their prompts, original PNG files, optimized WebP outputs and SHA-256 manifest live in `artifacts/ui2-assets/`. Production companions must use the moderated `avatarAssetId` / `coverAssetId` flow.

## Verification

Run from the repository root:

```bash
backend/api/node_modules/.bin/tsc -p frontend/miniprogram/tsconfig.json --noEmit
node frontend/miniprogram/scripts/validate.mjs
node frontend/miniprogram/scripts/smoke.mjs
node frontend/miniprogram/scripts/ui2-audit.mjs
node frontend/miniprogram/scripts/test-local-build.mjs
```

Device proof must cover every one of the 31 pages in light and dark themes at 320×568, 390×844 and 430×932. Local/static checks do not substitute for DevTools and real-device evidence.
