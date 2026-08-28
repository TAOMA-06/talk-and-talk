# Talk&Talk 支持工单演示视频工具

这组工具只把已经采集好的证据截图编排成视频。它不会截图、不会操作应用、不会修改输入图片，也不会推断或补写测试结果。

## 文件

- `render-demo.swift`：从有序 JSON 清单渲染固定规格的 H.264 MP4。
- `verify-video.swift`：读取成片的实际媒体轨道，输出 JSON 报告并从视频真实帧生成联系表。
- `shot-manifest.schema.json`：输入清单的 JSON Schema Draft 2020-12 定义。

## 证据边界

1. 正式截图必须声明 `sourceKind: "evidence"`，并给出非空 `evidenceRef`。
2. `sourceKind: "synthetic-placeholder"` 默认会被拒绝；仅自测时同时传入 `--allow-synthetic`，且占位图必须位于 `/private/tmp/`。
3. 结果卡的 `status`、`headline`、`details` 和 `evidenceRefs` 都必须由清单明确提供。渲染器不会因视频生成成功而把业务测试标成通过。
4. 输出只能是 `.mp4`，输出父目录必须已经存在；已有文件默认不覆盖，只有显式 `--overwrite` 才会替换。
5. 标题卡、证据边界卡和结果卡属于演示编排层，不是应用界面。截图画面只做缩放、平移和透明度转场，不会写回源文件。

## 输入示例

```json
{
  "schemaVersion": 1,
  "video": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "codec": "h264",
    "averageBitRate": 10000000
  },
  "timing": {
    "titleSeconds": 3.5,
    "boundarySeconds": 4.0,
    "resultSeconds": 5.0,
    "crossfadeSeconds": 0.6
  },
  "cards": {
    "title": {
      "kicker": "本地实用测试",
      "title": "支持工单完整处理演示",
      "subtitle": "基于本次测试真实截图编排，不代表生产环境放行。",
      "meta": ["macOS", "1920×1080", "证据截图"]
    },
    "boundary": {
      "title": "先说明这段视频能证明什么",
      "subtitle": "只陈述本次实际执行范围。",
      "items": [
        "所有应用画面来自本次测试截图",
        "不包含真实账号、手机号、聊天原文或支付数据",
        "本地通过不等于生产环境通过"
      ]
    },
    "result": {
      "status": "blocked",
      "headline": "示例：真实结果尚未写入",
      "details": ["等待实际测试记录"],
      "evidenceRefs": ["待替换为真实 manifest 或日志引用"]
    }
  },
  "shots": [
    {
      "id": "ticket-created",
      "image": "/absolute/path/to/01-ticket-created.png",
      "sourceKind": "evidence",
      "evidenceRef": "support-ticket-run.json#ticket-created",
      "label": "01 · 工单已创建",
      "caption": "展示本次测试实际出现的工单编号、状态和脱敏字段。",
      "durationSeconds": 4.5,
      "fit": "contain",
      "motion": "zoomIn"
    }
  ],
  "footer": "Talk&Talk · 支持工单本地测试 · 采集时间与 SHA 见证据清单"
}
```

正式渲染前，应使用支持 Draft 2020-12 的 JSON Schema 验证器校验清单。Swift 渲染器还会再次执行关键安全校验。

## 编译与渲染

编译产物建议放在 `/private/tmp`，不要混入最终证据目录：

```bash
swiftc -O \
  "/Users/taoma/Documents/talk and talk/artifacts/practical-demo/support-ticket-20260827/tools/render-demo.swift" \
  -o /private/tmp/talktalk-render-demo

/private/tmp/talktalk-render-demo \
  --manifest /absolute/path/to/shot-manifest.json \
  --output /absolute/path/to/talktalk-support-ticket-demo.mp4
```

渲染规格固定为 1920×1080、30 fps、H.264，默认每两秒一个关键帧、禁止帧重排并启用网络播放优化。支持的镜头运动：`none`、`zoomIn`、`zoomOut`、`panLeft`、`panRight`；缩放和平移幅度刻意保持轻微。

## 验证与联系表

```bash
swiftc -parse-as-library -O \
  "/Users/taoma/Documents/talk and talk/artifacts/practical-demo/support-ticket-20260827/tools/verify-video.swift" \
  -o /private/tmp/talktalk-verify-video

/private/tmp/talktalk-verify-video \
  --input /absolute/path/to/talktalk-support-ticket-demo.mp4 \
  --report /absolute/path/to/video-report.json \
  --contact-sheet /absolute/path/to/video-contact-sheet.png
```

未提供 `--times` 时，验证器会在视频时长的 8%、24%、40%、56%、72%、88% 处抽取实际帧。也可以显式指定：

```bash
--times 1.0,5.0,9.0,13.0,17.0,21.0
```

验证器报告：时长、变换后的分辨率、编码 FourCC/名称、名义帧率、估算帧数和每张联系表图片的实际取帧时间。若不是 H.264、1920×1080、约 30 fps，仍会写出报告和联系表，但以退出码 `2` 表示规格不通过。

可以再保留一份系统级文本检查：

```bash
/usr/bin/avmediainfo /absolute/path/to/video.mp4 --brief --metadata track
```

## 限制

- 仅支持带 AppKit/AVFoundation 的 macOS。
- 当前版本只生成视频轨，不生成旁白或背景音乐。
- 时间线和帧时间戳是确定的；H.264 由系统编码器完成，不承诺跨 macOS/硬件字节级完全一致。
- 渲染器能约束清单必须显式给出结果和证据引用，但不能替代对引用内容真实性的人工复核。
- 超长字幕会被限定在卡片区域内；正式清单应遵守 Schema 中的长度上限，并在成片联系表中人工检查中文换行。
