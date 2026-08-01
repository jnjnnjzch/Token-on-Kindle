# Token on Kindle

一个轻量、跨平台的 Tauri 2 应用：在应用自己的系统 WebView 中登录 Codex Analytics 和 DeepSeek Platform，提取额度/用量，生成 Kindle 7 可直接使用的 `600×800`、8 位灰度真 PNG，并在局域网提供固定图片地址。

## 目标平台

- Windows：优先支持，托盘后台运行，输出便携 EXE。
- macOS：使用系统 WKWebView。
- Linux：使用 WebKitGTK。
- Android：复用同一前端与 Rust 核心；首版应用在前台时提供图片，后续增加 Android 前台服务以保障后台常驻。

Tauri 不捆绑 Chromium：Windows 使用 WebView2，macOS 使用 WKWebView，Linux 使用 WebKitGTK，Android 使用系统 WebView。

## 登录与 Cookie

应用使用自己持久化的系统 WebView 配置目录。第一次分别登录 Codex 和 DeepSeek 后，会话由系统 WebView 保存，之后通常无需重复登录。

项目不会复制、导出或上传 Chrome/Edge Cookie：浏览器资料目录可能正在被锁定，Cookie 受系统密钥加密，而且不同浏览器和系统的存储格式不同。

## 架构

```text
shared/core.mjs
  ├─ Codex / DeepSeek 文本解析
  ├─ RGBA → 灰度
  └─ 纯 JS PNG 编码器（bit depth 8 / colour type 0）

web/
  ├─ 本地看板 UI
  ├─ Canvas 600×800 排版
  └─ 注入官方页面的 extractor.js

src-tauri/
  ├─ 启动系统 WebView 登录窗口
  ├─ 通过页面标题信号接收提取结果
  ├─ 托盘后台运行（桌面）
  └─ 0.0.0.0:8765/dashboard.png 本地 HTTP 服务
```

远程 Codex/DeepSeek 页面不会获得 Tauri 本地命令权限。提取脚本只把少量统计 JSON 编码进短暂的 document title，Rust 通过原生 title-change 回调接收；它不会读取聊天、代码、密码或 Cookie。

## Kindle 端

推荐使用：

- KUAL
- linkss ScreenSavers Hack
- FalconFour/onlinescreensaverPW2

应用界面会显示类似地址：

```text
http://192.168.1.20:8765/dashboard.png
```

填入 Online Screensaver 的 `IMAGE_URI` 即可。

## 本地开发

### 核心测试（仅需 Node.js 22）

```bash
npm test
```

### Linux 桌面

安装官方 Tauri 依赖后：

```bash
npm install
npm run dev
```

Debian/Ubuntu 依赖：

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

### Windows

安装 Microsoft C++ Build Tools、Rust stable MSVC、Node.js 22，以及 WebView2 Runtime（Windows 10/11 通常已有），然后：

```powershell
npm install
npm test
npm run build -- --no-bundle
```

便携 EXE：

```text
src-tauri\target\release\token-on-kindle.exe
```

## Android

```bash
npm install
npm run tauri android init -- --ci
npm run tauri android build
```

Android 端使用同一解析、Dashboard Canvas 与 Rust HTTP 服务。首版在应用前台时工作；可靠后台常驻需要后续加入 Android 前台服务。

## 当前状态

- [x] Codex 周额度动态进度条
- [x] 不存在 5 小时额度时不生成空卡
- [x] DeepSeek 余额/今日/本月/Token/缓存指标语义提取
- [x] 600×800、8 位灰度真 PNG
- [x] 局域网 HTTP 图片地址
- [x] Windows/macOS/Linux 桌面壳源码
- [x] Android 共用核心与移动导航分支
- [ ] 根据真实账户页面进一步校准选择器
- [ ] Android 前台服务常驻
- [ ] 开机自启动设置页

## 安全边界

- 默认只在局域网提供只读 PNG 和健康检查。
- 不需要 Codex CLI。
- 不需要 DeepSeek API Key。
- 不使用 Cloudflare 或其他云服务。
- 不把账号 Cookie 发送给 Kindle。
- 不要把 8765 端口映射到公网。
