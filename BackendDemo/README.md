# Talk&Talk BackendDemo

本目录是 Talk&Talk 的本机聊天后端 demo。它使用 Node 22 原生模块实现，无需安装第三方依赖；数据只保存在内存里，重启后恢复初始演示数据。

## Start

```bash
cd BackendDemo
npm start
```

打开：

```text
http://localhost:8787
```

可选配置：

```bash
PORT=8788 OLLAMA_MODEL=jia:latest npm start
```

如果要启用本地 AI 审查，先在另一个终端启动 Ollama：

```bash
ollama serve
```

本机已有模型可优先尝试：`jia:latest`、`wen:latest`、`luo:32b`。如果 Ollama 未启动，服务仍会运行，并使用规则引擎兜底。

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

测试默认禁用 Ollama，只验证规则兜底、聊天写入、违规拦截、工单生成、样本标注导出和 reset。
