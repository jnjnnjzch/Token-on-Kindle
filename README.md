# Token on Kindle

一个轻量、跨平台的 Tauri 2 应用：在应用自己的系统 WebView 中登录 Codex Analytics 和 DeepSeek Platform，提取额度与用量，生成适合 Kindle 电子墨水屏的 8 位灰度 PNG，并通过局域网提供固定图片地址。

## 下载

正式版本发布在仓库的 **Releases** 页面，不需要进入 Actions 查找临时产物。v0.4.0 提供：

- Windows x64 便携 ZIP；
- macOS Apple Silicon 应用 ZIP；
- Linux x64 AppImage；
- Android arm64 debug APK；
- KOReader 插件 ZIP；
- SHA-256 校验文件。

应用启动后会检查最新 Release，并在控制中心显示对应平台的下载入口。

## 平台状态

- **Windows x64**：主要支持平台，托盘后台运行与便携 EXE。
- **macOS arm64**：使用系统 WKWebView，由 macOS arm64 Runner 原生构建。
- **Linux x64**：使用 WebKitGTK，输出 AppImage。
- **Android arm64**：提供 debug 签名测试 APK；应用进程存活时可依次刷新 Codex 与 DeepSeek。系统挂起应用后不能保证 10 分钟后台任务持续运行，正式后台常驻仍需 Android 前台服务。

Tauri 不捆绑 Chromium：Windows 使用 WebView2，macOS 使用 WKWebView，Linux 使用 WebKitGTK，Android 使用系统 WebView。

## 登录状态与升级

应用使用稳定标识：

```text
com.jnjnnjzch.tokenonkindle
```

系统 WebView 的 Cookie、localStorage 与登录资料位于操作系统为该应用分配的用户数据目录，而不是便携 EXE 所在目录。桌面便携版本升级流程：

1. 从应用内或 GitHub Releases 下载新版本；
2. 从托盘完全退出旧版本；
3. 解压并替换应用程序；
4. 启动新版本。

该流程不会主动删除 WebView 用户数据，Codex 与 DeepSeek 通常无需重新登录。不要在升级时手工清理应用数据目录。

项目不会复制、导出或上传 Chrome/Edge Cookie。第一次分别在应用的 Codex 和 DeepSeek 窗口中登录后，后续由应用自己的持久化 WebView profile 保存会话。

## DeepSeek 数据来源

v0.4.0 不再把图表 tooltip 当作主要数据源。已登录的 DeepSeek Platform WebView 使用其网页会话令牌读取页面自身使用的同源端点：

```text
/api/v0/users/get_user_summary
/api/v0/usage/amount?month=...&year=...
/api/v0/usage/cost?month=...&year=...
```

它们提供：

- 账户充值余额与赠送余额；
- 今日 Flash / Pro Token；
- 今日 Flash / Pro 费用；
- 缓存命中 Token、未命中 Token、输出 Token；
- 缓存命中率与请求数；
- 月度总费用、Token 与请求数。

这里使用的是已登录 Platform 页面的会话令牌，不是模型调用用的 `sk-...` API Key。网络响应监听、ECharts 与 tooltip 读取仅作为兼容后备。

## 自动采集

桌面应用启动时创建 Codex 与 DeepSeek 的持久后台 WebView。登录窗口关闭时只是隐藏，不销毁登录会话。

默认每 10 分钟：

1. 刷新两个官方网页；
2. 从页面与同源 Platform 用量端点提取统计；
3. 重画所选 Kindle 分辨率的 PNG；
4. 原子替换 HTTP 服务中的最新图片。

不需要 Codex CLI、DeepSeek `sk-...` Key 或第三方云服务。

## Kindle 端

桌面应用会显示类似：

```text
http://192.168.1.20:8765/dashboard.png
```

### KOReader 插件

从 Release 下载 KOReader 插件 ZIP，把其中的：

```text
tokenonkindle.koplugin
```

复制到：

```text
koreader/plugins/
```

重启 KOReader 后打开：

```text
工具 → Token on Kindle
```

插件支持：

- 填写桌面应用给出的图片地址；
- 立即同步；
- 每 10/30/60 分钟自动同步；
- 一键设为 KOReader 休眠图片；
- 检测到 linkss 后，可同步镜像到原生 Kindle 屏保目录。

详细说明见 [`koreader/README.md`](koreader/README.md)。

### 原生 Kindle 屏保插件

也可使用 KUAL、linkss ScreenSavers Hack 与 FalconFour/onlinescreensaverPW2，将图片地址填入 Online Screensaver 的 `IMAGE_URI`。

## Kindle 原生分辨率

控制中心可选择：

| 输出尺寸 | 典型机型 |
|---|---|
| 600×800 | Kindle 4/5/7/8/10 |
| 758×1024 | Paperwhite 1/2 |
| 1072×1448 | Voyage、Paperwhite 3/4、Oasis 1、Kindle 11 |
| 1236×1648 | Paperwhite 5 |
| 1264×1680 | Oasis 2/3 与 7 英寸 300 ppi 机型 |
| 1860×2480 | Kindle Scribe |

程序直接在目标画布上重新排版并生成 8 位灰度 PNG，不是先生成 600×800 再缩放。预览窗口始终以 600×800 比例展示，图片 URL 不随型号切换而变化。

所有配置都保留比例化的底部纯黑安全区，让 Kindle 固件叠加的白色“滑动以解锁”保持清晰。

## 架构

```text
shared/
  ├─ core.mjs                         PNG 编码与基础解析
  ├─ deepseek-platform-parser.mjs     Platform 真实响应结构解析
  └─ DeepSeek 兼容后备解析器

web/
  ├─ 桌面控制中心
  ├─ 高对比度电子墨水渲染器
  ├─ Kindle 原生分辨率 profiles
  ├─ GitHub Release 更新检测
  └─ 注入官方页面的 extractor.js

src-tauri/
  ├─ 持久化系统 WebView 登录窗口
  ├─ 10 分钟后台刷新线程
  ├─ 托盘后台运行
  └─ 0.0.0.0:8765/dashboard.png 本地 HTTP 服务

koreader/tokenonkindle.koplugin/
  ├─ 图片下载与 PNG 校验
  ├─ KOReader 休眠屏幕配置
  └─ 可选 linkss 镜像
```

远程 Codex/DeepSeek 页面不会获得 Tauri 本地命令权限。提取脚本只把统计 JSON 编码进短暂的 document title，Rust 通过原生 title-change 回调接收；它不会读取聊天、代码或密码。

## 本地开发

### 核心与前端测试

```bash
npm install
npm test
```

### Windows

```powershell
npm install
npm test
npm run build -- --no-bundle
```

便携 EXE：

```text
src-tauri\target\release\token-on-kindle.exe
```

### Linux

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
npm install
npm test
npm run build -- --no-bundle
```

### Android

```bash
npm install
npm run tauri android init -- --ci
npm run tauri android build -- --debug --apk --target aarch64
```

## v0.4.0 状态

- [x] Codex 周额度动态进度条；
- [x] 不存在 5 小时额度时不生成空卡；
- [x] DeepSeek 余额、Flash/Pro Token、费用、请求数与缓存指标；
- [x] DeepSeek Platform 真实 amount/cost/summary 响应结构测试；
- [x] 每 10 分钟后台刷新；
- [x] 六种 Kindle 原生分辨率；
- [x] 8 位灰度真 PNG 与解锁文字安全区；
- [x] 局域网 HTTP 图片地址；
- [x] 应用内 Release 更新检测；
- [x] Release 标签自动同步应用版本；
- [x] 更新后保留系统 WebView 登录资料；
- [x] Windows、macOS、Linux 构建；
- [x] Android arm64 debug APK 构建；
- [x] KOReader 插件第一版；
- [ ] Android 前台服务；
- [ ] 正式 Android 长期签名；
- [ ] 签名的一键安装更新器；
- [ ] 开机自启动设置页。

## 安全边界

- 默认只在局域网提供只读 PNG 和健康检查；
- 不需要 Codex CLI；
- 不需要 DeepSeek API Key；
- 不使用 Cloudflare 或其他云服务；
- 不把账号 Cookie 发送给 Kindle；
- 不要把 8765 端口映射到公网。
