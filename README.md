# Token on Kindle

一个轻量、跨平台的 Tauri 2 应用：在应用自己的系统 WebView 中登录 Codex Analytics 和 DeepSeek Platform，采集额度与用量，生成适合 Kindle 电子墨水屏的 8 位灰度 PNG，并在局域网同时提供屏保图片与 Kindle 浏览器页面。

## v0.5.0 新功能

- 控制中心可以直接设置 1–1440 分钟的自动刷新间隔；设置保存在应用 WebView 本地存储中，重启后自动恢复。
- 后台调度器会在修改间隔后立即重新计时，不会继续等待旧周期。
- 程序启动时自动提供完整 HTTP 页面：`http://局域网IP:端口/`，未越狱 Kindle 可直接用实验性浏览器访问。
- 保留固定屏保图片地址：`http://局域网IP:端口/dashboard.png`。
- 浏览器页面使用纯 HTML、无框架、无动画，并通过页面重载和防缓存参数获取最新图片，兼容较旧 Kindle 浏览器。
- 重做底部解锁安全区：由大面积纯黑底座改为 44 像素高的中灰色中央承托区，白色“滑动以解锁”仍保持高对比度，同时释放更多空间给数据与状态信息。

## 使用方法

1. 启动应用。
2. 分别打开 Codex 和 DeepSeek 登录窗口并完成登录。
3. 在控制中心选择 Kindle 分辨率、设置刷新间隔。
4. 未越狱 Kindle 在浏览器中打开“浏览器访问地址”。
5. KOReader、Online Screensaver 或 linkss 用户使用“屏保插件图片地址”。

电脑与 Kindle 必须连接同一局域网。不要把服务端口映射到公网。

## HTTP 地址

应用会在 `8765–8785` 中选择一个可用端口。

```text
http://192.168.1.20:8765/               Kindle 浏览器页面
http://192.168.1.20:8765/dashboard.png  固定 PNG 图片
http://192.168.1.20:8765/healthz        服务状态
```

根页面会使用与后台采集相同的刷新间隔自动重新载入。点击图片也可立即刷新。

## Kindle 原生分辨率

| 输出尺寸 | 典型机型 |
|---|---|
| 600×800 | Kindle 4/5/7/8/10 |
| 758×1024 | Paperwhite 1/2 |
| 1072×1448 | Voyage、Paperwhite 3/4、Oasis 1、Kindle 11 |
| 1236×1648 | Paperwhite 5 |
| 1264×1680 | Oasis 2/3 与 7 英寸 300 ppi 机型 |
| 1860×2480 | Kindle Scribe |

程序直接在目标画布上重新排版并生成 8 位灰度 PNG，不是先生成 600×800 再缩放。

## 数据来源

Codex 数据来自登录后的 Codex Analytics 页面。DeepSeek 使用登录后的 Platform 页面会话读取页面自身使用的同源接口：

```text
/api/v0/users/get_user_summary
/api/v0/usage/amount?month=...&year=...
/api/v0/usage/cost?month=...&year=...
```

它们用于获取余额、费用、请求数、Flash/Pro Token、缓存命中 Token、未命中 Token、输出 Token与缓存命中率。项目不需要模型调用用的 `sk-...` API Key，也不会把账号 Cookie 发送给 Kindle。

## 平台与发布

- Windows x64：主要支持平台，提供便携 EXE/ZIP。
- macOS arm64：使用系统 WKWebView。
- Linux x64：使用 WebKitGTK，发布 AppImage。
- Android arm64：提供 debug APK；长期后台运行仍需要前台服务支持。
- KOReader：提供插件 ZIP，可同步图片并设置为休眠屏幕。

正式版本发布在 GitHub Releases。CI 只执行快速测试和 Windows 便携 EXE 验证；完整多平台打包只在 Release 标签或手动发布时运行，避免重复构建。

## 本地开发

```bash
npm install
npm test
npm run build -- --no-bundle
```

Windows 便携程序输出：

```text
src-tauri/target/release/token-on-kindle.exe
```

## 安全边界

- HTTP 服务只提供只读页面、PNG 和健康检查。
- 远程 Codex/DeepSeek 页面不会获得 Tauri 本地命令权限。
- 登录状态保存在操作系统分配给该应用的 WebView 用户数据目录。
- 更新程序不会主动删除登录资料。
- 不要将局域网端口暴露到公网。
