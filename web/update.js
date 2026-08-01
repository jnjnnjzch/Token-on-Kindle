const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/jnjnnjzch/Token-on-Kindle/releases/latest';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FALLBACK_VERSION = '0.4.0';

function normalizeVersion(value) {
  return String(value || '0.0.0').trim().replace(/^v/i, '').split('-')[0]
    .split('.').map(part => Number.parseInt(part, 10) || 0).slice(0, 3);
}

function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function platformAsset(assets = []) {
  const ua = navigator.userAgent.toLowerCase();
  let pattern;
  // Android WebView user agents also contain "Linux", so Android must be
  // detected before the desktop Linux AppImage branch.
  if (ua.includes('android')) pattern = /android-arm64\.apk$/i;
  else if (ua.includes('windows')) pattern = /windows-x64\.zip$/i;
  else if (ua.includes('mac')) pattern = /macos-(arm64|x64)\.zip$/i;
  else if (ua.includes('linux')) pattern = /linux-x64\.AppImage$/i;
  return assets.find(asset => pattern?.test(asset.name)) || null;
}

async function currentVersion() {
  try {
    return await window.__TAURI__?.app?.getVersion?.() || FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
}

function setStatus(message, state = 'neutral') {
  const status = document.querySelector('#update-status');
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

async function checkForUpdates({ manual = false } = {}) {
  const button = document.querySelector('#check-update');
  const download = document.querySelector('#download-update');
  if (button) button.disabled = true;
  if (manual) setStatus('正在检查 GitHub Releases…');

  try {
    const response = await fetch(GITHUB_LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (response.status === 404) {
      setStatus('仓库还没有正式 Release');
      return;
    }
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);

    const release = await response.json();
    const installed = await currentVersion();
    const latest = release.tag_name || release.name || '0.0.0';
    document.querySelector('#installed-version').textContent = `当前 ${installed}`;

    if (compareVersions(latest, installed) <= 0) {
      setStatus(`已是最新版本 · ${latest}`, 'ok');
      if (download) download.hidden = true;
      return;
    }

    const asset = platformAsset(release.assets);
    setStatus(`发现新版本 ${latest}`, 'available');
    if (download) {
      download.hidden = false;
      download.href = asset?.browser_download_url || release.html_url;
      download.textContent = asset ? `下载 ${asset.name}` : '打开 Release 下载页';
    }
  } catch (error) {
    setStatus(`检查失败：${error.message}`, 'error');
  } finally {
    if (button) button.disabled = false;
    localStorage.setItem('token-on-kindle:last-update-check', String(Date.now()));
  }
}

function shouldAutoCheck() {
  const last = Number(localStorage.getItem('token-on-kindle:last-update-check') || 0);
  return Date.now() - last > CHECK_INTERVAL_MS;
}

const button = document.querySelector('#check-update');
button?.addEventListener('click', () => checkForUpdates({ manual: true }));

document.querySelector('#download-update')?.addEventListener('click', () => {
  if (navigator.userAgent.toLowerCase().includes('android')) {
    setStatus('APK 下载完成后由 Android 安装器确认升级；应用数据与网页登录状态会保留。', 'available');
  } else {
    setStatus('下载后退出应用，解压并覆盖旧程序；登录状态会保留。', 'available');
  }
});

if (shouldAutoCheck()) setTimeout(() => checkForUpdates(), 2500);
else currentVersion().then(version => {
  const target = document.querySelector('#installed-version');
  if (target) target.textContent = `当前 ${version}`;
});
