# Talk&Talk · 可直接打开的 UI 评审版

这是给产品负责人、设计评审或协作者查看的独立微信开发者工具工程。

## 打开方式

1. 打开微信开发者工具，选择“导入项目”。
2. 项目目录选择本文件所在的 `direct-open-miniprogram` 文件夹。
3. AppID 保持“测试号 / 游客模式”；项目已预填 `touristappid`。
4. 点击“导入”或“编译”，首页会直接显示 31 个页面入口。

不需要启动后端、PostgreSQL、Redis，也不需要配置合法域名。

## 证据边界

- 画面来自真实微信开发者工具的 Talk&Talk v0.1 UI4 截图。
- 01 是匿名同意页；02–31 是 legal-only 失败关闭状态，不是业务成功数据。
- 本工程不请求网络、不登录、不支付、不写生产数据，也不能证明真实业务闭环。
- 工程名和界面均标注“UI 评审版 / 演示截图 / 不可上传”；禁止 Preview、Upload 或提交审核。

需要联调真实页面时，请回到仓库的 `frontend/miniprogram/README.md`，启动本地 API 后生成并导入 `frontend/miniprogram-local`。
