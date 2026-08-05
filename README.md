# Token on Kindle

一个面向 Kindle 墨水屏的跨平台 Tauri 2 应用：在独立系统 WebView 中登录 Codex、DeepSeek 与火山方舟 Agent Plan 企业版，将三个来源的用量统一渲染为 Kindle 原生分辨率的 8 位灰度 PNG。

- 桌面控制中心负责登录、采集、预览、后台刷新和更新。
- Kindle 浏览器、KOReader、Online Screensaver 与 linkss 读取同一张 `/dashboard.png`。
- 账号 Cookie 只保存在操作系统分配给应用的 WebView 数据目录，不会发送给 Kindle。

当前稳定版：**v0.9.6**
[下载最新 Release](https://github.com/jnjnnjzch/Token-on-Kindle/releases/tag/v0.9.6)

## v0.9.6 主界面启动稳定性修复

- 主窗口不再依赖 Codex、DeepSeek 或火山方舟外部 WebView 创建成功。
- 三个数据源窗口改为首次点击时按需创建；单个页面创建失败只会显示来源错误，不会终止主程序。
- 主窗口不再注入仅供外部页面使用的采集脚本。
- PNG 生成恢复 v0.6.2 的直接编码路径，移除启动阶段的模块 Worker。

## v0.9.5 长期运行稳定性修复

- 三个数据源独立刷新；某个 WebView 失败不会阻断其他来源。
- 火山方舟继续保留企业版 SPA 页面，同时在当前视图内触发“查询/刷新”后再读取 AFP 与模型图表。
- 同步钩子缺失不再静默成功，并会在控制中心显示部分失败来源。
- 火山图表缓存超过 90 秒后失效，避免长期重复发送旧结果。
- PNG 后台线程增加 30 秒超时、终止和自动重建，避免图片发布永久卡住。
- 删除未使用的火山完整响应缓存与遗留读取路径。

## v0.9.4 重点修复

火山方舟 Agent Plan 企业版页面的有效统计界面包含前端 SPA 状态。即使地址栏仍是同一个 URL，重新加载页面也可能丢失手动选择的企业版用量视图。

v0.9.4 恢复了按来源区分的刷新机制：

- Codex 与 DeepSeek 可以重新加载页面后采集。
- 火山方舟不会在手动同步或定时同步时执行 `location.reload()`。
- 火山方舟只在当前已经定位好的企业版界面中调用页面内采集钩子。
- 隐藏火山窗口不会销毁 WebView，已选择的企业版界面会继续保留。

火山方舟固定打开：

```text
https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan-enterprise
```

## 快速开始

1. 从 GitHub Release 下载对应平台的安装包。
2. 启动应用，依次打开 Codex、DeepSeek 和火山方舟状态卡并完成登录。
3. 按下方说明将火山方舟停留在正确的企业版用量界面。
4. 选择 Kindle 屏幕型号，并设置后台刷新间隔。
5. 让电脑与 Kindle 连接到同一局域网。
6. 未越狱 Kindle 在实验性浏览器中打开“Kindle 浏览器地址”。
7. KOReader、Online Screensaver 或 linkss 使用“屏保插件图片地址”。

默认刷新间隔为 10 分钟，可设置为 1–1440 分钟。

## 火山方舟企业版设置

火山方舟需要在首次登录或会话失效后手动定位一次：

1. 在控制中心打开“火山方舟”。
2. 完成登录，确认浏览器位于 Agent Plan 企业版地址。
3. 在页面中继续点击，切换到实际显示企业版 AFP 用量、时间窗口和模型统计的界面。
4. 等待用量卡片和图表完整出现。
5. 点击页面中的“隐藏窗口”返回控制中心。

之后的“立即同步”和后台定时同步都会保留该界面，不再刷新或导航火山方舟页面。

> 同一个 URL 不一定代表同一个火山方舟页面状态。若火山数据停止更新，首先重新打开火山窗口，确认仍能看到企业版用量卡片和图表，然后再次隐藏窗口。

## 数据来源

| 来源 | 登录页面 | 采集方式 |
|---|---|---|
| Codex | `https://chatgpt.com/codex/cloud/settings/analytics` | 读取登录后的 Analytics 页面数据 |
| DeepSeek | `https://platform.deepseek.com/usage` | 读取页面 DOM、图表和页面自身使用的同源接口 |
| 火山方舟 | `https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan-enterprise` | 读取当前企业版视图中的用量卡片、ECharts 图表和同源响应 |

DeepSeek 页面会使用以下同源接口：

```text
/api/v0/users/get_user_summary
/api/v0/usage/amount?month=...&year=...
/api/v0/usage/cost?month=...&year=...
```

采集内容包括余额、累计费用、月度汇总、请求数、模型 Token、缓存命中 Token、未命中 Token、输出 Token、缓存命中率，以及火山方舟 Agent Plan 企业版的 AFP 时间窗口和模型用量。

项目不需要模型调用使用的 `sk-...` API Key。

## 刷新机制

桌面端维护三个独立后台 WebView：

- Codex：后台同步时允许重新加载。
- DeepSeek：后台同步时允许重新加载。
- 火山方舟：后台同步时只执行当前页面内采集，不重新加载。

手动同步和定时同步使用同一套原生调度逻辑。系统托盘或菜单栏可在支持的平台暂停或恢复后台采集。

当前采集结果保存在应用内存中，不会持久化到磁盘。应用更新或完全退出后重新启动时，控制中心可能暂时显示“尚未采集”；等待下一次自动同步或点击“立即同步”即可重新生成看板。

## HTTP 地址

应用会在 `8765–8785` 中选择一个可用端口，并监听局域网地址。

```text
http://192.168.1.20:8765/               Kindle 浏览器页面
http://192.168.1.20:8765/dashboard.png  固定 PNG 图片
http://192.168.1.20:8765/healthz        服务状态
```

根页面只负责显示并刷新 `/dashboard.png`。点击图片可立即重新载入，因此应用预览、Kindle 浏览器和屏保插件始终使用同一份渲染结果。

`/healthz` 返回：

```json
{
  "ok": true,
  "dashboardReady": true,
  "refreshMinutes": 10
}
```

## Kindle 原生分辨率

| 输出尺寸 | 典型机型 |
|---|---|
| 600×800 | Kindle 4/5/7/8/10 |
| 758×1024 | Paperwhite 1/2 |
| 1072×1448 | Voyage、Paperwhite 3/4、Oasis 1、Kindle 11 |
| 1236×1648 | Paperwhite 5 |
| 1264×1680 | Oasis 2/3 与 7 英寸 300 ppi 机型 |
| 1860×2480 | Kindle Scribe |

程序直接在目标画布上重新排版并生成 8 位灰度 PNG，不是先生成 600×800 图片再放大。

## 平台与下载文件

| 平台 | Release 文件 | 说明 |
|---|---|---|
| Windows x64 | `Token-on-Kindle-v0.9.5-windows-x64.zip` | 主要支持平台；便携 EXE；支持应用内自动更新和重启 |
| macOS arm64 | `Token-on-Kindle-v0.9.5-macos-arm64.zip` | `.app` ZIP；使用系统 WKWebView；更新后手动替换应用 |
| Linux x64 | `Token-on-Kindle-v0.9.5-linux-x64.AppImage` | AppImage；更新后手动替换文件 |
| Android arm64 | `Token-on-Kindle-v0.9.5-android-arm64-debug.apk` | debug APK；不提供桌面托盘和开机启动控制 |
| KOReader | `Token-on-Kindle-v0.9.5-koreader-plugin.zip` | 从局域网同步 PNG，并用于休眠屏幕 |

每个 Release 同时提供统一的 `SHA256SUMS.txt`。

### 从早期 Windows 版本升级

v0.6.0 和 v0.6.1 的旧更新器可能在下载后关闭应用，但没有替换原 EXE。由这些版本直接升级时，需要手动完成一次：

1. 完全退出旧程序。
2. 下载当前 Windows ZIP。
3. 解压并覆盖原来的便携 EXE。

从 v0.6.2 起，Windows 更新由独立更新助手完成，并在替换前校验 SHA-256。

## 桌面集成

在支持的平台，系统托盘或菜单栏提供：

- 显示或隐藏控制中心。
- 暂停或恢复后台采集。
- 打开或复制 Kindle 地址。
- 查看数据源和更新状态。
- 检查更新。
- 退出应用。

Windows 支持登录时自动启动。macOS 使用菜单栏模式。Linux 托盘不可用时，关闭主窗口会正常退出。

## 常见问题

### 火山方舟数据不更新

重新打开火山窗口，确认当前页面实际显示 Agent Plan 企业版 AFP 用量卡片和图表。若页面回到了入口或其他订阅界面，重新点击进入正确视图并隐藏窗口。

### 重启后显示“尚未采集”

采集结果目前只保存在内存中。点击“立即同步”，或等待下一次后台刷新。

### Kindle 无法打开页面

- 确认电脑与 Kindle 在同一局域网。
- 使用控制中心显示的实际地址，不要手工假设端口为 8765。
- 检查电脑防火墙是否允许应用访问专用网络。
- 在电脑浏览器中先访问 `/healthz`，确认 `ok` 为 `true`。

### Windows 自动更新没有替换程序

确认当前 EXE 所在目录可写，并查看程序目录附近保留的 `update.log`。从 v0.6.0 或 v0.6.1 升级时应先手动覆盖一次。

## 本地开发

需要 Node.js、Rust 和对应平台的 Tauri 2 构建依赖。

```bash
npm install
npm test
npm run dev
npm run build -- --no-bundle
```

Windows 便携程序输出：

```text
src-tauri/target/release/token-on-kindle.exe
```

`web/extractor.js` 和火山方舟模型列表由组合脚本生成。修改采集器组件后，应通过 npm scripts 重新组合，不要只修改生成文件。

## 发布流程

仓库只保留一套 `Build and release` Pipeline：

- Pull Request：运行解析器、PNG、渲染器、JavaScript、KOReader 和各平台构建验证。
- `main`：按同步版本构建 Windows、macOS、Linux、Android 和 KOReader，并创建或更新 GitHub Release。
- 发布资产包含统一 SHA-256 校验清单。

## 安全边界

- 局域网 HTTP 服务只提供 `/`、`/dashboard.png` 和 `/healthz`。
- 服务没有账号认证，不要将 `8765–8785` 端口映射到公网。
- 远程 Codex、DeepSeek 和火山方舟页面不会获得 Tauri 本地命令权限。
- 登录状态保存在操作系统分配给应用的 WebView 用户数据目录。
- Kindle 只接收渲染后的只读页面和 PNG，不接收账号 Cookie。
- Windows 更新程序只接受本项目 GitHub Release 地址，并在替换 EXE 前校验 SHA-256。
