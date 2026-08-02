import { APP_VERSION } from './version.js';

const invoke = window.__TAURI__?.core?.invoke;
const GITHUB_LATEST_RELEASE = 'https://api.github.com/repos/jnjnnjzch/Token-on-Kindle/releases/latest';
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const isWindows = navigator.userAgent.toLowerCase().includes('windows');
let availableRelease = null;

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

function setStatus(message, state = 'neutral') {
  const status = document.querySelector('#update-status');
  status.textContent = message;
  status.dataset.state = state;
}

function setBusy(busy) {
  for (const selector of ['#check-update', '#install-update']) {
    const control = document.querySelector(selector);
    if (control) control.disabled = busy;
  }
}

async function checkForUpdates({ manual = false } = {}) {
  const install = document.querySelector('#install-update');
  setBusy(true);
  if (manual) setStatus('正在检查 GitHub Releases…');
  try {
    const response = await fetch(GITHUB_LATEST_RELEASE, {
      headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store'
    });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const release = await response.json();
    const latest = release.tag_name || release.name || '0.0.0';
    document.querySelector('#installed-version').textContent = `当前 ${APP_VERSION}`;
    if (compareVersions(latest, APP_VERSION) <= 0) {
      availableRelease = null;
      setStatus(`已是最新版本 · ${latest}`, 'ok');
      install.hidden = true;
      return;
    }
    const asset = platformAsset(release.assets);
    const checksum = release.assets?.find(item => /SHA256SUMS\.txt$/i.test(item.name)) || null;
    availableRelease = { release, latest, asset, checksum };
    setStatus(`发现新版本 ${latest}`, 'available');
    install.hidden = false;
    const canAutoInstall = isWindows && invoke && asset && checksum;
    install.textContent = canAutoInstall ? `下载、安装并重启 ${latest}` : '打开 Release 下载';
    install.dataset.mode = canAutoInstall ? 'install' : 'manual';
  } catch (error) { setStatus(`检查失败：${error.message}`, 'error'); }
  finally {
    setBusy(false);
    localStorage.setItem('token-on-kindle:last-update-check', String(Date.now()));
  }
}

async function installAvailableUpdate() {
  if (!availableRelease) return;
  const { release, latest, asset, checksum } = availableRelease;
  if (!isWindows || !invoke || !asset || !checksum) {
    window.open(release.html_url, '_blank', 'noopener,noreferrer');
    setStatus('已打开 Release 页面，请下载对应平台版本。', 'available');
    return;
  }
  setBusy(true);
  setStatus(`正在下载 ${latest} 并校验 SHA-256…`, 'available');
  try {
    await invoke('install_update', {
      request: {
        version: latest,
        downloadUrl: asset.browser_download_url,
        checksumUrl: checksum.browser_download_url,
        assetName: asset.name
      }
    });
    setStatus('校验完成，应用正在退出、替换并自动重启…', 'available');
  } catch (error) {
    setBusy(false);
    setStatus(`自动更新失败：${error}`, 'error');
  }
}

function shouldAutoCheck() {
  const last = Number(localStorage.getItem('token-on-kindle:last-update-check') || 0);
  return Date.now() - last > CHECK_INTERVAL_MS;
}

document.querySelector('#check-update')?.addEventListener('click', () => checkForUpdates({ manual: true }));
document.querySelector('#install-update')?.addEventListener('click', installAvailableUpdate);
document.querySelector('#installed-version').textContent = `当前 ${APP_VERSION}`;
if (shouldAutoCheck()) setTimeout(() => checkForUpdates(), 2500);
