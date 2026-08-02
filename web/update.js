import { APP_VERSION } from './version.js';

const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/jnjnnjzch/Token-on-Kindle/releases/latest';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

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
  if (ua.includes('windows')) pattern = /windows-x64\.zip$/i;
  else if (ua.includes('mac')) pattern = /macos-(arm64|x64)\.zip$/i;
  else if (ua.includes('linux')) pattern = /linux-x64\.AppImage$/i;
  return assets.find(asset => pattern?.test(asset.name)) || null;
}

function currentVersion() {
  return APP_VERSION;
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
    const installed = currentVersion();
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
  setStatus('下载后退出应用，解压并覆盖旧程序；登录状态会保留。', 'available');
});

const versionTarget = document.querySelector('#installed-version');
if (versionTarget) versionTarget.textContent = `当前 ${currentVersion()}`;

if (shouldAutoCheck()) setTimeout(() => checkForUpdates(), 2500);
