# Talk&Talk BackendDemo

本目录是 Talk&Talk 的本机聊天后端 demo。它使用 Node 22 原生模块实现，无需安装第三方依赖；数据只保存在内存里，重启后恢复初始演示数据。

内容审查采用 **规则引擎 + DeepSeek API** 双层策略：高风险由规则直接拦截，边界内容由 DeepSeek 补充判断。

## 明天演示

给老板演示内容安全审核后台，请看 **[DEMO.md](./DEMO.md)**（5–7 分钟逐步脚本）。

快速启动：

```bash
cd BackendDemo
cp .env.example .env   # 填入 DEEPSEEK_API_KEY
npm start
```

浏览器打开 `http://localhost:8787`，点右上角 **「重置演示数据」** 后开始演示。

会前自检（可选）：

```bash
./scripts/prep-demo.sh
```

## 配置

复制环境变量模板并填入 DeepSeek API Key：

```bash
cp .env.example .env
```

`.env` 示例：

```bash
DEEPSEEK_API_KEY=你的key
```

可选环境变量：

```bash
DEEPSEEK_URL=https://api.deepseek.com   # 默认
DEEPSEEK_MODEL=deepseek-chat            # 默认
PORT=8787
DISABLE_DEEPSEEK=1                      # 仅规则引擎，不调 API（测试/离线）
```

启动时自动读取 `BackendDemo/.env`（若存在）。**切勿将 `.env` 提交到 Git。**

## Start

```bash
cd BackendDemo
npm start
```

打开：

```text
http://localhost:8787
```

无 API Key 时服务仍可运行，仅使用规则引擎兜底。

## API

- `GET /api/health`
- `GET /api/conversations`
- `GET /api/conversations/:id/messages`
- `POST /api/conversations/:id/messages`
- `POST /api/moderate`
- `GET /api/moderation-cases`
- `POST /api/labels`
- `GET /api/labels/export`
- `POST /api/reset`

所有 API 返回统一包裹：

```json
{
  "data": {},
  "meta": {
    "timestamp": "2026-07-04T00:00:00.000Z",
    "requestId": "uuid"
  }
}
```

错误返回：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "content is required"
  },
  "meta": {
    "timestamp": "2026-07-04T00:00:00.000Z",
    "requestId": "uuid"
  }
}
```

## Test

```bash
cd BackendDemo
npm test
```

测试默认 `DISABLE_DEEPSEEK=1`，只验证规则兜底、聊天写入、违规拦截、工单生成、样本标注导出和 reset。
