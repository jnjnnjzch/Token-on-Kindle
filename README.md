# Token on Kindle

一个轻量、跨平台的 Tauri 2 应用：在应用自己的系统 WebView 中登录 Codex Analytics 和 DeepSeek Platform，提取额度与用量，生成适合 Kindle 电子墨水屏的 8 位灰度 PNG，并通过局域网提供固定图片地址。

## 下载

稳定桌面版本与 KOReader 插件发布在仓库的 **Releases** 页面，无需进入 Actions 寻找临时产物：

- Windows x64 便携 ZIP；
- macOS Apple Silicon 应用 ZIP；
- Linux x64 AppImage；
- KOReader 插件 ZIP；
- SHA-256 校验文件。

应用启动后会检查最新 Release，并在控制中心显示与当前平台匹配的下载入口。

Android 目前使用由 CI 生成的 debug-signed 测试 APK。正式 APK 进入 Releases 前，需要先配置长期 Android 签名密钥；否则下一版无法覆盖安装，登录数据也无法在升级中稳定保留。

## 平台状态

- **Windows x64**：主要支持平台，托盘后台运行与便携 EXE。
- **macOS arm64**：使用系统 WKWebView，原生 Apple Silicon Runner 编译验证。
- **Linux x64**：使用 WebKitGTK，Ubuntu Runner 编译与 AppImage 打包验证。
- **Android arm64 beta**：可构建安装测试 APK；应用进程存活时可完成 Codex → DeepSeek 的 10 分钟轮询。Android 挂起进程后不保证继续刷新，系统级常驻仍需前台服务。

Tauri 不捆绑 Chromium：Windows 使用 WebView2，macOS 使用 WKWebView，Linux 使用 WebKitGTK，Android 使用系统 WebView。

## 登录状态与升级

应用始终使用稳定标识：

```text
com.jnjnnjzch.tokenonkindle
```

系统 WebView 的 Cookie、localStorage 与登录资料位于操作系统分配的应用数据目录，而不是便携 EXE 所在目录。桌面便携版本升级时，只需退出旧版本、解压覆盖程序并重新启动；不要手工删除应用数据目录。Codex 与 DeepSeek 通常无需重新登录。

Android 也依赖相同包名与相同签名证书来保留应用数据。正式 Android 发布前必须先固定签名密钥。

项目不会复制、导出或上传 Chrome/Edge Cookie。第一次分别在应用的 Codex 和 DeepSeek 窗口中登录后，后续由应用自己的持久化 WebView profile 保存会话。

## 自动采集

桌面应用启动时创建 Codex 与 DeepSeek 的持久后台 WebView。登录窗口关闭时只是隐藏，不销毁登录会话。

默认每 10 分钟：

1. 刷新两个官方网页；
2. 等待网页重新渲染；
3. 提取额度与用量；
4. 按所选 Kindle 型号重画原生分辨率 PNG；
5. 原子替换 HTTP 服务中的最新图片。

Android beta 在应用进程活跃时依次导航 Codex、DeepSeek 并返回看板。不需要 Codex CLI、DeepSeek `sk-...` Key 或第三方云服务。

## Kindle 原生分辨率

控制中心可以直接选择输出配置；`/dashboard.png` 地址保持不变：

| 输出尺寸 | 典型机型 |
|---|---|
| 600 × 800 | Kindle 4/5/7/8/10 等经典 6 英寸机型 |
| 758 × 1024 | Paperwhite 1 / 2 |
| 1072 × 1448 | Voyage、Paperwhite 3 / 4、Oasis 1、Kindle 11 等 300 ppi 6 英寸机型 |
| 1236 × 1648 | Paperwhite 5（11 代，6.8 英寸） |
| 1264 × 1680 | Oasis 2 / 3 与 7 英寸 300 ppi 机型 |
| 1860 × 2480 | Kindle Scribe 10.2 英寸 |

每种配置都直接生成对应尺寸的 **8 位灰度 PNG**，不是先做 600×800 再放大。整个排版和底部解锁安全区按比例缩放。

## Kindle 端

桌面或 Android 应用会显示类似：

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

- 填写应用给出的图片地址；
- 立即同步；
- 每 10/30/60 分钟自动同步；
- 一键设为 KOReader 休眠图片；
- 检测到 linkss 后，同步镜像到原生 Kindle 屏保目录。

详细说明见 [`koreader/README.md`](koreader/README.md)。

### 原生 Kindle 屏保插件

也可使用 KUAL、linkss ScreenSavers Hack 与 FalconFour/onlinescreensaverPW2，将图片地址填入 `IMAGE_URI`。

## 锁屏设计

- 高对比度灰阶卡片；
- Codex 周额度进度条；
- DeepSeek 余额、今日费用与 Token；
- Flash / Pro Token、费用和相对 bar；
- 缓存命中率进度条；
- 底部约 10% 纯黑安全区，承接 Kindle 固件叠加的白色“滑动以解锁”。

## 架构

```text
shared/core.mjs
  ├─ Codex / DeepSeek 文本解析
  ├─ RGBA → 灰度
  └─ 纯 JS PNG 编码器（bit depth 8 / colour type 0）

web/
  ├─ 控制中心与 Canvas 排版
  ├─ Kindle 原生分辨率配置
  ├─ GitHub Release 更新检测
  └─ 注入官方页面的 extractor.js

src-tauri/
  ├─ 持久化系统 WebView 登录窗口
  ├─ 10 分钟刷新线程
  ├─ 桌面托盘后台运行
  └─ 0.0.0.0:8765/dashboard.png 本地 HTTP 服务

koreader/tokenonkindle.koplugin/
  ├─ 图片下载与 PNG 校验
  ├─ KOReader 休眠屏幕配置
  └─ 可选 linkss 镜像
```

远程 Codex/DeepSeek 页面不会获得 Tauri 本地命令权限。提取脚本只把统计 JSON 编码进短暂的 document title，Rust 通过原生 title-change 回调接收；它不会读取聊天、代码、密码或 Cookie。

## 本地测试

```bash
npm install
npm test
```

Windows：

```powershell
npm run build -- --no-bundle
```

Android arm64 debug APK：

```bash
npm run tauri android init -- --ci
npm run tauri android build -- --debug --apk --target aarch64
```

Android 正式分发包必须配置长期签名密钥，不能依赖每台构建机临时生成的 debug 证书。

## 当前状态

- [x] Codex 周额度动态进度条；
- [x] DeepSeek 余额、Flash/Pro Token、费用与缓存指标提取；
- [x] 桌面每 10 分钟后台刷新；
- [x] Android 前台进程存活时的 10 分钟顺序刷新；
- [x] 多 Kindle 型号原生分辨率 8 位灰度 PNG；
- [x] Kindle 解锁文字安全区；
- [x] 局域网 HTTP 图片地址；
- [x] 应用内 Release 更新检测；
- [x] 桌面更新后保留系统 WebView 登录资料；
- [x] Windows、macOS、Linux 构建与 Release；
- [x] KOReader 插件第一版；
- [x] Android arm64 debug APK 构建门；
- [ ] Android 长期签名密钥与正式 Release APK；
- [ ] Android 前台服务常驻；
- [ ] 签名的一键安装更新器；
- [ ] 开机自启动设置页。

## 安全边界

- 默认只在局域网提供只读 PNG 和健康检查；
- 不需要 Codex CLI；
- 不需要 DeepSeek API Key；
- 不使用 Cloudflare 或其他云服务；
- 不把账号 Cookie 发送给 Kindle；
- 不要把 8765 端口映射到公网。
