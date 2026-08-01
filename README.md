# Token on Kindle

一个轻量、跨平台的 Tauri 2 应用：在应用自己的系统 WebView 中登录 Codex Analytics 和 DeepSeek Platform，提取额度与用量，生成适合 Kindle 电子墨水屏的 8 位灰度 PNG，并通过局域网提供固定图片地址。

## 下载

正式版本发布在仓库的 **Releases** 页面，不需要再进入 Actions 下载临时产物。每个版本计划提供：

- Windows x64 便携 ZIP；
- macOS Apple Silicon 应用 ZIP；
- Linux x64 AppImage；
- KOReader 插件 ZIP；
- SHA-256 校验文件。

应用启动后会检查最新 Release，并在控制中心显示对应平台的下载入口。

## 平台状态

- **Windows x64**：主要支持平台，托盘后台运行与便携 EXE。
- **macOS arm64**：使用系统 WKWebView；由 GitHub Actions 原生 arm64 Runner 编译验证。
- **Linux x64**：使用 WebKitGTK；由 Ubuntu Runner 编译与 AppImage 打包验证。
- **Android**：设计目标，尚未发布可验证 APK。可靠后台运行还需要 Android 前台服务适配。

Tauri 不捆绑 Chromium：Windows 使用 WebView2，macOS 使用 WKWebView，Linux 使用 WebKitGTK。

## 登录状态与升级

应用使用稳定标识：

```text
com.jnjnnjzch.tokenonkindle
```

系统 WebView 的 Cookie、localStorage 与登录资料位于操作系统为该应用分配的用户数据目录，而不是便携 EXE 所在目录。因此便携版本升级流程是：

1. 从应用内或 GitHub Releases 下载新版本；
2. 从托盘完全退出旧版本；
3. 解压并替换应用程序；
4. 启动新版本。

该流程不会主动删除 WebView 用户数据，Codex 与 DeepSeek 通常无需重新登录。不要在升级时手工清理应用数据目录。

项目不会复制、导出或上传 Chrome/Edge Cookie。第一次分别在应用的 Codex 和 DeepSeek 窗口中登录后，后续由应用自己的持久化 WebView profile 保存会话。

## 自动采集

桌面应用启动时创建 Codex 与 DeepSeek 的持久后台 WebView。登录窗口关闭时只是隐藏，不销毁登录会话。

默认每 10 分钟：

1. 刷新两个官方网页；
2. 等待网页重新渲染；
3. 提取额度与用量；
4. 重画 Kindle PNG；
5. 原子替换 HTTP 服务中的最新图片。

不需要 Codex CLI、DeepSeek `sk-...` Key 或第三方云服务。

## Kindle 端

桌面应用会显示类似：

```text
http://192.168.1.20:8765/dashboard.png
```

可选接入方式：

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

也可使用：

- KUAL；
- linkss ScreenSavers Hack；
- FalconFour/onlinescreensaverPW2。

将图片地址填入 Online Screensaver 的 `IMAGE_URI`。

## 锁屏输出

当前默认配置面向 Kindle 7：

```text
600 × 800
8 位灰度 PNG
3:4 纵向布局
```

底部保留 80 像素纯黑安全区，让 Kindle 固件叠加的白色“滑动以解锁”保持清晰。KOReader 可将图片缩放到其他 Kindle 屏幕；针对不同型号的原生分辨率与安全区配置将作为后续独立版本实现。

## 架构

```text
shared/core.mjs
  ├─ Codex / DeepSeek 文本解析
  ├─ RGBA → 灰度
  └─ 纯 JS PNG 编码器（bit depth 8 / colour type 0）

web/
  ├─ 桌面控制中心
  ├─ Canvas 锁屏排版
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

远程 Codex/DeepSeek 页面不会获得 Tauri 本地命令权限。提取脚本只把统计 JSON 编码进短暂的 document title，Rust 通过原生 title-change 回调接收；它不会读取聊天、代码、密码或 Cookie。

## 本地开发

### 核心与前端测试

```bash
npm install
npm test
```

### Windows

安装 Microsoft C++ Build Tools、Rust stable MSVC、Node.js 22，以及 WebView2 Runtime，然后：

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

Debian/Ubuntu 依赖：

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

然后：

```bash
npm install
npm test
npm run build -- --no-bundle
```

### Android

Android 尚处于开发阶段。以下命令只是 Tauri 初始化入口，不代表当前仓库已经生成可用 APK：

```bash
npm install
npm run tauri android init -- --ci
npm run tauri android build
```

## 当前状态

- [x] Codex 周额度动态进度条；
- [x] 不存在 5 小时额度时不生成空卡；
- [x] DeepSeek 余额、Flash/Pro Token、费用与缓存指标提取；
- [x] 每 10 分钟后台刷新；
- [x] 600×800、8 位灰度真 PNG；
- [x] Kindle 解锁文字安全区；
- [x] 局域网 HTTP 图片地址；
- [x] 应用内 Release 更新检测；
- [x] 更新后保留系统 WebView 登录资料；
- [x] Windows、macOS、Linux 构建工作流；
- [x] KOReader 插件第一版；
- [ ] Android APK 与前台服务；
- [ ] 多 Kindle 型号原生分辨率配置；
- [ ] 签名的一键安装更新器；
- [ ] 开机自启动设置页。

## 安全边界

- 默认只在局域网提供只读 PNG 和健康检查；
- 不需要 Codex CLI；
- 不需要 DeepSeek API Key；
- 不使用 Cloudflare 或其他云服务；
- 不把账号 Cookie 发送给 Kindle；
- 不要把 8765 端口映射到公网。
