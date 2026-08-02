# Token on Kindle

一个轻量的 Tauri 2 应用：在独立系统 WebView 中登录 Codex Analytics 与 DeepSeek Platform，采集额度和用量，生成适合 Kindle 电子墨水屏的 8 位灰度 PNG，并在局域网提供同一张图片的浏览器页面和屏保地址。

## v0.6.1

- Windows、macOS 与 Linux 使用正式应用图标作为任务栏、Dock、菜单栏或系统托盘图标。
- 托盘实时显示 Codex、DeepSeek 与应用更新状态。
- 托盘支持显示或隐藏看板、暂停或恢复采集、打开或复制 Kindle 地址、检查更新和退出。
- 支持桌面端登录时自动启动；macOS 使用菜单栏模式，Linux 托盘不可用时关闭主窗口会正常退出。
- 主界面新增“任务栏与后台”区域，与托盘中的暂停状态和自动启动设置保持同步。

## v0.6.0

- Windows 便携版支持应用内自动更新：下载 GitHub Release ZIP、校验统一 SHA-256 清单、退出应用、替换当前 EXE，并自动重启。
- Codex 与 DeepSeek 顶部入口显示真实状态：需要登录、已连接、最近同步时间或同步失败，不再永久显示固定的“登录或查看”文案。
- 采集详情只显示排错所需的账户、额度、模型、月度汇总和解析来源字段，不再输出大量页面内部诊断噪声。
- 桌面控制中心重新排版为数据源状态、Kindle 预览、局域网地址、输出与同步、应用更新和采集详情。
- Kindle 浏览器页面与锁屏预览继续使用同一张 PNG，不维护第二套内容。
- 仓库只保留一套可复用的 `Build and release` Pipeline；PR 用于验证，主线新版本自动构建并发布全部平台。

## 使用方法

1. 启动应用。
2. 点击 Codex 和 DeepSeek 状态卡，完成登录并等待卡片变为“已连接”。
3. 选择 Kindle 屏幕型号并设置后台刷新间隔。
4. 未越狱 Kindle 在实验性浏览器中打开“Kindle 浏览器地址”。
5. KOReader、Online Screensaver 或 linkss 用户使用折叠区域中的“屏保插件图片地址”。

电脑与 Kindle 必须连接同一局域网。不要把服务端口映射到公网。

## HTTP 地址

应用会在 `8765–8785` 中选择一个可用端口。

```text
http://192.168.1.20:8765/               Kindle 浏览器页面
http://192.168.1.20:8765/dashboard.png  固定 PNG 图片
http://192.168.1.20:8765/healthz        服务状态
```

浏览器根页面只负责显示并刷新 `/dashboard.png`，因此它与应用预览和 Kindle 屏保始终使用同一套渲染结果。

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

这些接口用于获取余额、累计费用、月度费用、请求数、Flash/Pro Token、缓存命中 Token、未命中 Token、输出 Token 与缓存命中率。项目不需要模型调用用的 `sk-...` API Key，也不会把账号 Cookie 发送给 Kindle。

## 平台与发布

- Windows x64：主要支持平台，提供便携 EXE/ZIP，并支持自动安装更新和重启。
- macOS arm64：提供 `.app` ZIP，使用系统 WKWebView；更新检查后手动替换应用。
- Linux x64：发布 AppImage；更新检查后手动替换文件。
- Android arm64：提供 debug APK；不提供桌面托盘或自动启动控制。
- KOReader：提供插件 ZIP，用于同步图片并设置休眠屏幕，不提供桌面托盘。

正式版本发布在 GitHub Releases。PR 运行测试和 Windows 便携 EXE 验证；主线新版本由同一份 Pipeline 构建所有平台并创建 Release。

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
- Windows 更新程序只接受本项目 GitHub Release 地址，并在替换 EXE 前校验 SHA-256。
- 更新和托盘设置不会删除应用数据或登录资料。
- 不要将局域网端口暴露到公网。
