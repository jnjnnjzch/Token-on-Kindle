from pathlib import Path
import json
import subprocess
import textwrap

ROOT = Path.cwd()


def read(path):
    return (ROOT / path).read_text(encoding='utf-8')


def write(path, content):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(textwrap.dedent(content).lstrip('\n'), encoding='utf-8')


def replace_or_fail(text, old, new, label):
    if old not in text:
        raise RuntimeError(f'missing replacement point: {label}')
    return text.replace(old, new, 1)


lib = read('src-tauri/src/lib.rs')
lib = replace_or_fail(
    lib,
    '''use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    sync::{Arc, Condvar, Mutex, RwLock},
    thread,
    time::Duration,
};''',
    '''use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream, UdpSocket},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Condvar, Mutex, RwLock},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;''',
    'std imports'
)
lib = replace_or_fail(
    lib,
    '''struct RuntimeSettings {
    refresh_minutes: u64,
    image_url: String,
    browser_url: String,
}
''',
    '''struct RuntimeSettings {
    refresh_minutes: u64,
    image_url: String,
    browser_url: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRequest {
    version: String,
    download_url: String,
    checksum_url: String,
    asset_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInstallResult {
    version: String,
    restarting: bool,
}
''',
    'updater structs'
)
updater_code = r'''
fn validate_update_request(request: &UpdateRequest) -> Result<(), String> {
    const RELEASE_PREFIX: &str = "https://github.com/jnjnnjzch/Token-on-Kindle/releases/download/";
    if !request.download_url.starts_with(RELEASE_PREFIX)
        || !request.checksum_url.starts_with(RELEASE_PREFIX)
    {
        return Err("更新地址不是本项目的 GitHub Release".into());
    }
    if !request.asset_name.starts_with("Token-on-Kindle-")
        || !request.asset_name.ends_with("-windows-x64.zip")
        || request.asset_name.contains('/')
        || request.asset_name.contains('\\')
    {
        return Err("Windows 更新包名称不合法".into());
    }
    if !request.checksum_url.ends_with("-SHA256SUMS.txt") {
        return Err("Release 缺少统一 SHA-256 校验文件".into());
    }
    let version = request.version.strip_prefix('v').unwrap_or(&request.version);
    if version.split('.').count() < 3
        || !version.chars().all(|character| {
            character.is_ascii_alphanumeric() || ".-_".contains(character)
        })
    {
        return Err("版本号格式不合法".into());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn find_update_executable(root: &Path) -> Option<PathBuf> {
    for entry in fs::read_dir(root).ok()? {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_update_executable(&path) {
                return Some(found);
            }
        } else if path
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("Token-on-Kindle.exe"))
        {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn install_update(
    app: AppHandle,
    request: UpdateRequest,
) -> Result<UpdateInstallResult, String> {
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    validate_update_request(&request)?;

    let current_exe = std::env::current_exe()
        .map_err(|error| format!("无法定位当前程序：{error}"))?;
    let temp_root = std::env::temp_dir().join(format!(
        "token-on-kindle-update-{}-{}",
        request.version.trim_start_matches('v'),
        timestamp()
    ));
    let extract_dir = temp_root.join("payload");
    let zip_path = temp_root.join(&request.asset_name);
    let checksum_path = temp_root.join("SHA256SUMS.txt");
    fs::create_dir_all(&extract_dir)
        .map_err(|error| format!("无法创建更新目录：{error}"))?;

    let download_script = temp_root.join("download-and-verify.ps1");
    fs::write(
        &download_script,
        r#"param(
  [string]$DownloadUrl,
  [string]$ChecksumUrl,
  [string]$AssetName,
  [string]$ZipPath,
  [string]$ChecksumPath,
  [string]$ExtractDir
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Invoke-WebRequest -UseBasicParsing -Uri $DownloadUrl -OutFile $ZipPath
Invoke-WebRequest -UseBasicParsing -Uri $ChecksumUrl -OutFile $ChecksumPath
$line = Get-Content -LiteralPath $ChecksumPath | Where-Object { $_ -match ([regex]::Escape($AssetName) + '$') } | Select-Object -First 1
if (-not $line) { throw "checksum entry not found for $AssetName" }
$expected = ($line -split '\s+')[0].ToLowerInvariant()
$actual = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($expected -ne $actual) { throw "SHA-256 mismatch: expected $expected, got $actual" }
Expand-Archive -LiteralPath $ZipPath -DestinationPath $ExtractDir -Force
"#,
    )
    .map_err(|error| format!("无法写入下载脚本：{error}"))?;

    let output = Command::new("powershell.exe")
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&download_script)
        .arg("-DownloadUrl")
        .arg(&request.download_url)
        .arg("-ChecksumUrl")
        .arg(&request.checksum_url)
        .arg("-AssetName")
        .arg(&request.asset_name)
        .arg("-ZipPath")
        .arg(&zip_path)
        .arg("-ChecksumPath")
        .arg(&checksum_path)
        .arg("-ExtractDir")
        .arg(&extract_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("无法启动 PowerShell 下载器：{error}"))?;

    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "更新包下载或校验失败".into()
        } else {
            format!("更新包下载或校验失败：{detail}")
        });
    }

    let source_exe = find_update_executable(&extract_dir)
        .ok_or_else(|| "更新包中没有找到 Token-on-Kindle.exe".to_string())?;
    let replace_script = temp_root.join("replace-and-restart.ps1");
    fs::write(
        &replace_script,
        r#"param(
  [int]$ProcessId,
  [string]$SourceExe,
  [string]$TargetExe,
  [string]$WorkingDir
)
$ErrorActionPreference = 'Stop'
Wait-Process -Id $ProcessId -ErrorAction SilentlyContinue
$copied = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  try {
    Copy-Item -LiteralPath $SourceExe -Destination $TargetExe -Force
    $copied = $true
    break
  } catch {
    Start-Sleep -Milliseconds 250
  }
}
if (-not $copied) { throw 'unable to replace running executable' }
Start-Process -FilePath $TargetExe -WorkingDirectory (Split-Path -Parent $TargetExe)
Start-Sleep -Milliseconds 800
Remove-Item -LiteralPath $WorkingDir -Recurse -Force -ErrorAction SilentlyContinue
"#,
    )
    .map_err(|error| format!("无法写入替换脚本：{error}"))?;

    Command::new("powershell.exe")
        .arg("-NoLogo")
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&replace_script)
        .arg("-ProcessId")
        .arg(std::process::id().to_string())
        .arg("-SourceExe")
        .arg(&source_exe)
        .arg("-TargetExe")
        .arg(&current_exe)
        .arg("-WorkingDir")
        .arg(&temp_root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| format!("无法启动更新替换进程：{error}"))?;

    let app_for_exit = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(900));
        app_for_exit.exit(0);
    });

    Ok(UpdateInstallResult {
        version: request.version,
        restarting: true,
    })
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
async fn install_update(
    _app: AppHandle,
    _request: UpdateRequest,
) -> Result<UpdateInstallResult, String> {
    Err("当前自动安装仅支持 Windows 便携版；请从 Release 下载对应平台版本".into())
}
'''
lib = replace_or_fail(
    lib,
    '''#[tauri::command]
async fn refresh_sources(app: AppHandle) -> Result<(), String> {
    reload_sources(&app)
}
''',
    '''#[tauri::command]
async fn refresh_sources(app: AppHandle) -> Result<(), String> {
    reload_sources(&app)
}
''' + updater_code + '\n',
    'updater insertion'
)
lib = replace_or_fail(
    lib,
    '''            open_source,
            refresh_sources
        ])''',
    '''            open_source,
            refresh_sources,
            install_update
        ])''',
    'command registration'
)
lib = lib.replace('.inner_size(1080.0, 760.0)', '.inner_size(1180.0, 820.0)')
lib = lib.replace('.min_inner_size(760.0, 580.0)', '.min_inner_size(820.0, 620.0)')
write('src-tauri/src/lib.rs', lib)

write('web/diagnostics.js', r'''
const number = value => {
  const raw = typeof value === 'object' && value !== null ? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const defined = object => Object.fromEntries(
  Object.entries(object).filter(([, value]) => value !== undefined && value !== null && value !== '')
);

const modelSummary = model => model ? defined({
  name: model.name,
  requests: number(model.requests),
  tokens: number(model.tokens),
  cost: number(model.cost),
  cacheRate: number(model.cacheRate),
  cacheMissTokens: number(model.cacheMissTokens),
  cacheHitTokens: number(model.cacheHitTokens),
  outputTokens: number(model.outputTokens)
}) : undefined;

function compactDiagnostics(payload = {}) {
  const diagnostics = payload.diagnostics || {};
  const parser = diagnostics.parser || {};
  return defined({
    primarySource: diagnostics.primarySource,
    networkResponseCount: number(diagnostics.networkResponseCount),
    directError: diagnostics.directError,
    parser: Object.keys(parser).length ? defined({
      source: parser.source,
      selectedDate: parser.selectedDate,
      amountDayCount: number(parser.amountDayCount),
      costDayCount: number(parser.costDayCount),
      modelNames: Array.isArray(parser.modelNames) ? parser.modelNames : undefined
    }) : undefined
  });
}

function compactCodex(payload = {}) {
  return defined({
    source: payload.source,
    capturedAt: payload.capturedAt,
    account: payload.account ? defined({ plan: payload.account.plan, email: payload.account.email }) : undefined,
    quotas: Array.isArray(payload.quotas) ? payload.quotas.map(quota => defined({
      id: quota.id,
      label: quota.label,
      remainingPercent: number(quota.remainingPercent),
      usedPercent: number(quota.usedPercent),
      resetText: quota.resetText
    })) : undefined,
    diagnostics: compactDiagnostics(payload)
  });
}

function compactDeepSeek(payload = {}) {
  return defined({
    source: payload.source,
    capturedAt: payload.capturedAt,
    balance: number(payload.balance),
    today: defined({
      cost: number(payload.todayCost),
      requests: number(payload.todayRequests),
      tokens: number(payload.todayTokens)
    }),
    account: payload.account ? defined({
      cumulativeCost: number(payload.account.cumulativeCost),
      monthlyCost: number(payload.account.monthlyCost),
      monthlyRequests: number(payload.account.monthlyRequests),
      monthlyTokens: number(payload.account.monthlyTokens)
    }) : undefined,
    cacheRate: number(payload.cacheRate),
    models: payload.models ? defined({
      flash: modelSummary(payload.models.flash),
      pro: modelSummary(payload.models.pro)
    }) : undefined,
    diagnostics: compactDiagnostics(payload)
  });
}

export function diagnosticSnapshot(source, payload) {
  if (!payload) return null;
  return source === 'codex' ? compactCodex(payload) : compactDeepSeek(payload);
}
''')

write('web/app.js', r'''
import { encodeGrayscalePng, rgbaToGrayscale, verifyKindlePng } from './core.mjs';
import { diagnosticSnapshot } from './diagnostics.js';
import { renderKindleDashboard } from './kindle-renderer.js';
import { DEFAULT_PROFILE_ID, KINDLE_PROFILES, getKindleProfile } from './profiles.js';

const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const REFRESH_STORAGE_KEY = 'token-on-kindle:refresh-minutes';
const DEFAULT_REFRESH_MINUTES = 10;
const MIN_REFRESH_MINUTES = 1;
const MAX_REFRESH_MINUTES = 1440;

let state = { codex: null, deepseek: null, receivedAt: null, refreshMinutes: DEFAULT_REFRESH_MINUTES };
const canvas = document.querySelector('#dashboard');
const previewCtx = canvas.getContext('2d', { willReadFrequently: true });
let selectedProfileId = localStorage.getItem('token-on-kindle:profile') || DEFAULT_PROFILE_ID;

const numeric = value => {
  const raw = typeof value === 'object' && value !== null ? value.value : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

function normalizeRefreshMinutes(value) {
  if (value == null || value === '') return DEFAULT_REFRESH_MINUTES;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_REFRESH_MINUTES;
  return Math.min(MAX_REFRESH_MINUTES, Math.max(MIN_REFRESH_MINUTES, parsed));
}

function refreshDescription(minutes) {
  if (minutes < 60) return `每 ${minutes} 分钟刷新`;
  if (minutes % 60 === 0) return `每 ${minutes / 60} 小时刷新`;
  return `每 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟刷新`;
}

function serviceDescription(prefix = '后台采集正常') {
  return `${prefix} · ${refreshDescription(state.refreshMinutes)}`;
}

function formatSyncTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '刚刚收到数据';
  return `同步于 ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function hasUsefulData(source, payload) {
  if (!payload) return false;
  if (source === 'codex') return Array.isArray(payload.quotas) && payload.quotas.length > 0;
  return [
    numeric(payload.balance), numeric(payload.todayCost), numeric(payload.todayTokens),
    numeric(payload.account?.cumulativeCost), numeric(payload.models?.flash?.tokens),
    numeric(payload.models?.pro?.tokens)
  ].some(value => value != null);
}

function updateSourceCard(source, payload) {
  const card = document.querySelector(`#open-${source}`);
  const status = document.querySelector(`#${source}-connection`);
  const detail = document.querySelector(`#${source}-detail`);
  if (!card || !status || !detail) return;
  if (!payload) {
    card.dataset.state = 'idle';
    status.textContent = '需要登录';
    detail.textContent = '点击打开登录页面';
  } else if (!hasUsefulData(source, payload)) {
    card.dataset.state = 'error';
    status.textContent = '同步失败';
    detail.textContent = payload.diagnostics?.directError || '没有读取到有效数据';
  } else {
    card.dataset.state = 'connected';
    status.textContent = '已连接';
    detail.textContent = formatSyncTime(payload.capturedAt);
  }
}

function renderToContext(targetCtx, width, height) {
  targetCtx.save();
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.setTransform(width / 600, 0, 0, height / 800, 0, 0);
  renderKindleDashboard(targetCtx, state);
  targetCtx.restore();
}

function renderPreview() { renderToContext(previewCtx, 600, 800); }

function updateProfileUi() {
  const profile = getKindleProfile(selectedProfileId);
  document.querySelector('#format-note').textContent = `${profile.width} × ${profile.height} · 8 位灰度 PNG`;
  document.querySelector('#profile-description').textContent = profile.models;
}

function initializeProfileSelect() {
  const select = document.querySelector('#kindle-profile');
  select.replaceChildren(...KINDLE_PROFILES.map(profile => {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = `${profile.name} — ${profile.models}`;
    return option;
  }));
  selectedProfileId = getKindleProfile(selectedProfileId).id;
  select.value = selectedProfileId;
  select.addEventListener('change', () => {
    selectedProfileId = getKindleProfile(select.value).id;
    localStorage.setItem('token-on-kindle:profile', selectedProfileId);
    updateProfileUi();
    publish().catch(error => { document.querySelector('#service').textContent = `生成失败：${error.message}`; });
  });
  updateProfileUi();
}

function updateRefreshUi() {
  document.querySelector('#refresh-minutes').value = String(state.refreshMinutes);
  document.querySelector('#refresh-value').textContent = refreshDescription(state.refreshMinutes);
}

async function publish() {
  renderPreview();
  const profile = getKindleProfile(selectedProfileId);
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = profile.width;
  outputCanvas.height = profile.height;
  const outputCtx = outputCanvas.getContext('2d', { willReadFrequently: true });
  renderToContext(outputCtx, profile.width, profile.height);
  const rgba = outputCtx.getImageData(0, 0, profile.width, profile.height).data;
  const png = encodeGrayscalePng(profile.width, profile.height, rgbaToGrayscale(rgba));
  const check = verifyKindlePng(png, profile.width, profile.height);
  if (!check.ok) throw new Error(check.error);
  if (invoke) await invoke('set_dashboard_png', { bytes: Array.from(png), profile: profile.id });
}

function updateUi() {
  updateSourceCard('codex', state.codex);
  updateSourceCard('deepseek', state.deepseek);
  const codexDiagnostic = diagnosticSnapshot('codex', state.codex);
  const deepseekDiagnostic = diagnosticSnapshot('deepseek', state.deepseek);
  document.querySelector('#codex-status').textContent = codexDiagnostic ? JSON.stringify(codexDiagnostic, null, 2) : '尚未采集';
  document.querySelector('#deepseek-status').textContent = deepseekDiagnostic ? JSON.stringify(deepseekDiagnostic, null, 2) : '尚未采集';
  updateRefreshUi();
  publish().catch(error => { document.querySelector('#service').textContent = `生成失败：${error.message}`; });
}

async function applySavedRefreshInterval() {
  const saved = normalizeRefreshMinutes(localStorage.getItem(REFRESH_STORAGE_KEY));
  const settings = await invoke('set_refresh_interval', { minutes: saved });
  state.refreshMinutes = normalizeRefreshMinutes(settings.refreshMinutes);
  localStorage.setItem(REFRESH_STORAGE_KEY, String(state.refreshMinutes));
  document.querySelector('#url').textContent = settings.imageUrl;
  document.querySelector('#browser-url').textContent = settings.browserUrl;
}

async function load() {
  initializeProfileSelect();
  if (!invoke) {
    document.querySelector('#service').textContent = '浏览器预览模式';
    updateUi();
    return;
  }
  await applySavedRefreshInterval();
  const metrics = await invoke('get_status');
  state = { ...metrics, refreshMinutes: state.refreshMinutes };
  document.querySelector('#service').textContent = serviceDescription();
  updateUi();
  await listen('metrics-updated', event => {
    state = { ...event.payload, refreshMinutes: state.refreshMinutes };
    document.querySelector('#service').textContent = serviceDescription('已收到最新数据');
    updateUi();
  });
}

async function openSource(source) {
  document.querySelector('#service').textContent = `正在打开 ${source === 'codex' ? 'Codex' : 'DeepSeek'}…`;
  try {
    await invoke?.('open_source', { source });
    document.querySelector('#service').textContent = serviceDescription();
  } catch (error) { document.querySelector('#service').textContent = `打开失败：${error}`; }
}

async function refreshNow() {
  const button = document.querySelector('#refresh');
  button.disabled = true;
  document.querySelector('#service').textContent = '正在刷新两个数据源…';
  try {
    await invoke?.('refresh_sources');
    setTimeout(() => {
      document.querySelector('#service').textContent = serviceDescription('已触发刷新，等待页面返回');
      button.disabled = false;
    }, 700);
  } catch (error) {
    button.disabled = false;
    document.querySelector('#service').textContent = `刷新失败：${error}`;
  }
}

async function saveRefreshInterval() {
  const input = document.querySelector('#refresh-minutes');
  const minutes = normalizeRefreshMinutes(input.value);
  input.value = String(minutes);
  try {
    const settings = await invoke('set_refresh_interval', { minutes });
    state.refreshMinutes = normalizeRefreshMinutes(settings.refreshMinutes);
    localStorage.setItem(REFRESH_STORAGE_KEY, String(state.refreshMinutes));
    document.querySelector('#url').textContent = settings.imageUrl;
    document.querySelector('#browser-url').textContent = settings.browserUrl;
    updateRefreshUi();
    await publish();
    document.querySelector('#service').textContent = serviceDescription('刷新间隔已保存');
  } catch (error) { document.querySelector('#service').textContent = `保存失败：${error}`; }
}

async function copyText(selector, button, successText) {
  try {
    await navigator.clipboard.writeText(document.querySelector(selector).textContent);
    const previous = button.textContent;
    button.textContent = successText;
    setTimeout(() => { button.textContent = previous; }, 1200);
  } catch { document.querySelector('#service').textContent = '复制失败，请手动选择地址'; }
}

document.querySelector('#open-codex').onclick = () => openSource('codex');
document.querySelector('#open-deepseek').onclick = () => openSource('deepseek');
document.querySelector('#refresh').onclick = refreshNow;
document.querySelector('#save-refresh').onclick = saveRefreshInterval;
document.querySelector('#refresh-minutes').addEventListener('keydown', event => { if (event.key === 'Enter') saveRefreshInterval(); });
document.querySelector('#copy').onclick = event => copyText('#url', event.currentTarget, '已复制');
document.querySelector('#copy-browser').onclick = event => copyText('#browser-url', event.currentTarget, '已复制');
load().catch(error => { document.querySelector('#service').textContent = `启动失败：${error}`; });
''')

write('web/update.js', r'''
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
''')

write('web/index.html', r'''
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Token on Kindle</title>
  <link rel="stylesheet" href="styles.css"><link rel="stylesheet" href="update.css">
</head>
<body>
  <main class="app-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark" aria-hidden="true"><span></span></div><div><h1>Token on Kindle</h1><p>Codex 与 DeepSeek 的电子墨水用量看板</p></div></div>
      <div id="service" class="service-pill">正在启动后台服务…</div>
    </header>
    <section class="source-strip" aria-label="数据源状态与控制">
      <button id="open-codex" class="source-card" data-state="idle"><span class="source-monogram">C</span><span class="source-copy"><span class="button-kicker">CODEX</span><strong id="codex-connection">需要登录</strong><small id="codex-detail">点击打开登录页面</small></span><span class="source-action">打开</span></button>
      <button id="open-deepseek" class="source-card" data-state="idle"><span class="source-monogram">D</span><span class="source-copy"><span class="button-kicker">DEEPSEEK</span><strong id="deepseek-connection">需要登录</strong><small id="deepseek-detail">点击打开登录页面</small></span><span class="source-action">打开</span></button>
      <button id="refresh" class="refresh-button"><span>立即刷新</span><small>重新加载两个数据源</small></button>
    </section>
    <section class="workspace">
      <article class="panel preview-panel"><div class="panel-heading"><div><span class="eyebrow">KINDLE PREVIEW</span><h2>锁屏预览</h2></div><div id="format-note" class="format-note">600 × 800 · 8 位灰度 PNG</div></div><div class="preview-stage"><div class="kindle-frame"><canvas id="dashboard" width="600" height="800"></canvas></div></div></article>
      <aside class="control-column">
        <section class="panel connection-panel"><div class="section-title"><div><span class="eyebrow">KINDLE CONNECTION</span><h2>局域网访问</h2></div><span class="section-badge">同一张 PNG</span></div><label class="field-label">Kindle 浏览器地址</label><div class="url-row"><div class="url-box"><code id="browser-url">正在读取局域网地址…</code></div><button id="copy-browser" class="icon-button">复制</button></div><p class="help-text">未越狱 Kindle 直接打开。HTTP 页面与锁屏预览使用完全相同的图片。</p><details class="secondary-endpoint"><summary>屏保插件图片地址</summary><div class="url-row compact-row"><div class="url-box"><code id="url">正在读取图片地址…</code></div><button id="copy" class="icon-button">复制</button></div></details></section>
        <section class="panel settings-panel"><div class="section-title"><div><span class="eyebrow">OUTPUT & SYNC</span><h2>输出与同步</h2></div></div><div class="settings-grid"><div class="setting-block"><label class="field-label" for="kindle-profile">Kindle 屏幕型号</label><select id="kindle-profile" class="profile-select" aria-describedby="profile-description"></select><p id="profile-description" class="field-note">Kindle 经典机型</p></div><div class="setting-block"><label class="field-label" for="refresh-minutes">后台刷新间隔</label><div class="interval-control"><input id="refresh-minutes" class="interval-input" type="number" min="1" max="1440" step="1" value="10"><button id="save-refresh" class="save-button">保存</button></div><p id="refresh-value" class="field-note">每 10 分钟刷新</p></div></div></section>
        <section class="panel app-update-panel"><div class="section-title"><div><span class="eyebrow">APP UPDATE</span><h2>应用更新</h2></div><span id="installed-version" class="format-note">读取版本中…</span></div><p id="update-status" class="update-status">启动后自动检查 GitHub Releases</p><div class="update-actions"><button id="check-update" class="secondary-action">检查更新</button><button id="install-update" class="install-button" hidden>下载、安装并重启</button></div><p class="help-text">Windows 便携版会校验 SHA-256，退出后替换当前 EXE 并自动重启；应用数据和登录状态不会删除。</p></section>
        <details class="panel debug-panel"><summary><span>采集详情</span><small>仅保留排查所需字段</small></summary><div class="status-grid"><article><h3>Codex</h3><pre id="codex-status">尚未采集</pre></article><article><h3>DeepSeek</h3><pre id="deepseek-status">尚未采集</pre></article></div></details>
      </aside>
    </section>
  </main>
  <script type="module" src="app.js"></script><script type="module" src="update.js"></script>
</body>
</html>
''')

write('web/styles.css', r'''
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;color:#171717;background:#ecece8;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-width:760px;min-height:100vh;background:linear-gradient(145deg,#f8f8f5 0,#ecece8 42%,#e4e4df 100%)}button,summary,input,select{font:inherit}button,summary{cursor:pointer}h1,h2,h3,p{margin-top:0}.app-shell{width:min(1280px,calc(100% - 34px));margin:0 auto;padding:22px 0 34px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:2px 2px 17px;border-bottom:1px solid #c9c9c2}.brand{display:flex;align-items:center;gap:13px}.brand-mark{width:38px;height:47px;padding:4px;border:2px solid #171717;border-radius:7px;background:#fff;box-shadow:0 5px 15px rgba(0,0,0,.08)}.brand-mark span{display:block;width:100%;height:100%;background:linear-gradient(to top,#111 0 58%,#d8d8d2 58% 100%);border-radius:2px}h1{margin-bottom:2px;font-size:27px;line-height:1.1;letter-spacing:-.55px}.brand p{margin:0;color:#6a6a64;font-size:13px}.service-pill{max-width:430px;padding:8px 13px;border:1px solid #c8c8c1;border-radius:999px;background:rgba(255,255,255,.72);color:#4f4f49;font-size:12px;text-align:center}.source-strip{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1fr) 178px;gap:12px;padding:15px 0}.source-card,.refresh-button{min-height:74px;border:1px solid #c8c8c1;border-radius:15px;transition:.15s ease}.source-card:hover,.refresh-button:hover,.icon-button:hover,.save-button:hover,.secondary-action:hover,.install-button:hover{transform:translateY(-1px);box-shadow:0 9px 20px rgba(0,0,0,.08)}.source-card{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:12px;padding:11px 13px;background:rgba(255,255,255,.88);text-align:left}.source-card[data-state="connected"]{border-color:#8e9e90;background:#f7faf6}.source-card[data-state="error"]{border-color:#b98f8f;background:#fcf7f7}.source-monogram{display:grid;place-items:center;width:40px;height:40px;border-radius:11px;background:#1b1b1b;color:#fff;font-weight:800}.source-copy{min-width:0;display:flex;flex-direction:column;gap:2px}.source-copy strong{font-size:15px}.source-copy small{overflow:hidden;color:#707069;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.button-kicker,.eyebrow{color:#777770;font-size:9px;font-weight:800;letter-spacing:1.35px}.source-action{color:#52524d;font-size:11px;font-weight:750}.refresh-button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:10px 16px;background:#181818;color:#fff;font-weight:760}.refresh-button small{color:#cfcfca;font-size:10px;font-weight:500}.refresh-button:disabled{cursor:wait;opacity:.65}.workspace{display:grid;grid-template-columns:minmax(510px,1fr) 410px;gap:16px;align-items:start}.panel{border:1px solid #d0d0c9;border-radius:18px;background:rgba(255,255,255,.9);box-shadow:0 13px 32px rgba(0,0,0,.05)}.preview-panel{padding:18px}.panel-heading,.section-title{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.panel-heading{align-items:flex-end;margin-bottom:14px}.panel-heading h2,.section-title h2{margin:4px 0 0;font-size:20px;letter-spacing:-.3px}.format-note,.section-badge{color:#777770;font-size:11px}.section-badge{padding:5px 8px;border-radius:999px;background:#ededE8;font-weight:700}.preview-stage{display:grid;place-items:center;min-height:620px;padding:20px;border-radius:14px;background:linear-gradient(135deg,rgba(255,255,255,.54),transparent 47%),#dcdcd6}.kindle-frame{padding:10px;border:2px solid #222;border-radius:14px;background:#2b2b2b;box-shadow:0 22px 38px rgba(0,0,0,.18)}canvas{display:block;width:390px;height:520px;border-radius:3px;background:#fff}.control-column{display:grid;gap:13px}.connection-panel,.settings-panel,.app-update-panel{padding:17px}.field-label{display:block;margin:14px 0 7px;color:#565650;font-size:11px;font-weight:760}.url-row{display:grid;grid-template-columns:minmax(0,1fr) 66px;gap:8px;align-items:stretch}.url-box{min-width:0;padding:10px 11px;border:1px solid #cecec7;border-radius:10px;background:#f3f3ef}.url-box code{display:block;overflow-wrap:anywhere;color:#292929;font-size:11px;line-height:1.45}.icon-button,.save-button,.secondary-action,.install-button{border:1px solid #bdbdb6;border-radius:10px;font-weight:750;transition:.14s ease}.icon-button{background:#fff;font-size:11px}.help-text{margin:11px 0 0;color:#6b6b64;font-size:11px;line-height:1.58}.secondary-endpoint{margin-top:12px;padding-top:10px;border-top:1px solid #e2e2dc}.secondary-endpoint summary{color:#55554f;font-size:11px;font-weight:750}.compact-row{margin-top:9px}.settings-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-top:13px}.setting-block{min-width:0;padding:12px;border:1px solid #dfdfd9;border-radius:12px;background:#fafaf8}.setting-block .field-label{margin-top:0}.profile-select,.interval-input{width:100%;min-width:0;padding:9px 10px;border:1px solid #bdbdb6;border-radius:9px;background:#fff;color:#181818;font-size:11px;font-weight:650}.interval-control{display:grid;grid-template-columns:1fr 62px;gap:7px}.save-button{background:#1a1a1a;color:#fff;font-size:11px}.field-note{margin:7px 0 0;color:#777770;font-size:10px;line-height:1.45}.debug-panel{overflow:hidden}.debug-panel summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;color:#454540;font-size:12px;font-weight:760;list-style:none}.debug-panel summary::-webkit-details-marker{display:none}.debug-panel summary small{color:#85857e;font-size:10px;font-weight:500}.status-grid{display:grid;gap:9px;padding:0 12px 12px}.status-grid article{min-width:0;padding:11px;border-radius:10px;background:#f1f1ed}.status-grid h3{margin-bottom:7px;font-size:12px}pre{max-height:210px;margin:0;overflow:auto;white-space:pre-wrap;word-break:break-word;color:#50504a;font:10px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}@media(max-width:1040px){.workspace{grid-template-columns:1fr 370px}canvas{width:360px;height:480px}.preview-stage{min-height:580px}}@media(max-width:900px){body{min-width:620px}.workspace{grid-template-columns:1fr}.control-column{grid-template-columns:1fr 1fr}.connection-panel,.debug-panel{grid-column:1/-1}}@media(max-width:680px){body{min-width:0}.app-shell{width:calc(100% - 22px);padding-top:14px}.topbar{align-items:flex-start;flex-direction:column}.source-strip{grid-template-columns:1fr}.workspace,.control-column,.settings-grid{grid-template-columns:1fr}.connection-panel,.debug-panel{grid-column:auto}canvas{width:min(78vw,390px);height:auto;aspect-ratio:3/4}.preview-stage{min-height:auto;padding:14px}}
''')

write('web/update.css', r'''
.update-status{min-height:20px;margin:12px 0;color:#5e5e58;font-size:12px;line-height:1.5}.update-status[data-state="ok"]{color:#34613d}.update-status[data-state="available"]{color:#1d1d1d;font-weight:700}.update-status[data-state="error"]{color:#8b3030}.update-actions{display:grid;grid-template-columns:128px 1fr;gap:8px}.secondary-action,.install-button{min-height:40px;padding:9px 12px}.secondary-action{background:#fff;color:#1b1b1b}.install-button{background:#181818;color:#fff;border-color:#181818}.install-button[hidden]{display:none}.secondary-action:disabled,.install-button:disabled{cursor:wait;opacity:.62}
''')

pkg = json.loads(read('package.json'))
pkg['version'] = '0.6.0'
write('package.json', json.dumps(pkg, ensure_ascii=False, indent=2) + '\n')
write('src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').replace('version = "0.5.5"', 'version = "0.6.0"', 1))
config = json.loads(read('src-tauri/tauri.conf.json'))
config['version'] = '0.6.0'
write('src-tauri/tauri.conf.json', json.dumps(config, ensure_ascii=False, indent=2) + '\n')
write('web/version.js', '// Generated from the release tag / Cargo package version. Do not edit manually.\nexport const APP_VERSION = "0.6.0";\n')
if (ROOT.joinpath('tests/version-target.test.mjs').exists()):
    version_test = read('tests/version-target.test.mjs').replace('v0.5.5', 'v0.6.0').replace('0.5.5', '0.6.0')
    write('tests/version-target.test.mjs', version_test)

write('tests/diagnostic-summary.test.mjs', r'''
import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnosticSnapshot } from '../web/diagnostics.js';

test('DeepSeek diagnostic summary keeps useful fields and removes noisy raw data', () => {
  const summary = diagnosticSnapshot('deepseek', {
    source: 'deepseek', capturedAt: '2026-08-02T08:31:25.126Z',
    range: { cost: null, requests: 1558, tokens: 239211413 },
    url: 'https://platform.deepseek.com/usage', balance: { value: 68.9 },
    todayTokens: { value: 64299835 },
    account: { cumulativeCost: 144.6, monthlyCost: 22.1, monthlyTokens: 500 },
    diagnostics: { chartCount: 5, visibleSummary: { lineCount: 77 }, parser: { source: 'platform-internal-api', attempts: [{ date: 'x' }], amountDayCount: 31 } }
  });
  assert.equal(summary.account.cumulativeCost, 144.6);
  assert.equal(summary.today.tokens, 64299835);
  assert.equal(summary.diagnostics.parser.amountDayCount, 31);
  assert.equal('range' in summary, false);
  assert.equal('url' in summary, false);
  assert.equal('visibleSummary' in summary.diagnostics, false);
  assert.equal('attempts' in summary.diagnostics.parser, false);
});
''')
write('tests/updater-contract.test.mjs', r'''
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const native = fs.readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const frontend = fs.readFileSync(new URL('../web/update.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
test('Windows portable updater downloads, verifies, replaces, and restarts', () => {
  assert.match(native, /async fn install_update/); assert.match(native, /Get-FileHash/);
  assert.match(native, /SHA-256 mismatch/); assert.match(native, /Wait-Process/);
  assert.match(native, /Copy-Item/); assert.match(native, /Start-Process/);
  assert.match(native, /app_for_exit\.exit\(0\)/); assert.match(native, /refresh_sources,\s*install_update/);
  assert.match(frontend, /invoke\('install_update'/); assert.match(frontend, /下载、安装并重启/);
  assert.match(html, /id="install-update"/);
});
''')
write('tests/source-status-ui.test.mjs', r'''
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
test('source controls expose real connection states', () => {
  assert.match(html, /id="codex-connection"/); assert.match(html, /id="deepseek-connection"/);
  assert.match(app, /status\.textContent = '已连接'/); assert.match(app, /status\.textContent = '同步失败'/); assert.match(app, /status\.textContent = '需要登录'/);
});
''')
write('tests/repository-cleanup-contract.test.mjs', r'''
import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const workflows = fs.readdirSync(new URL('../.github/workflows', import.meta.url)).filter(name => /\.ya?ml$/i.test(name));
const pipeline = fs.readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');
test('repository keeps one reusable workflow and cleans legacy branches and runs', () => {
  assert.deepEqual(workflows, ['pipeline.yml']); assert.match(pipeline, /workflow_call:/);
  assert.match(pipeline, /Repository cleanup/); assert.match(pipeline, /merge-base --is-ancestor/);
  assert.match(pipeline, /Clean stale branches/); assert.match(pipeline, /Windows Portable/);
});
''')

for obsolete in [
    '.github/workflows/ci.yml', '.github/workflows/release.yml', '.github/workflows/core.yml',
    '.github/workflows/windows-portable.yml', '.github/workflows/desktop-matrix.yml',
    '.github/workflows/android.yml', '.github/workflows/cleanup-branches.yml',
    '.github/workflows/publish-v0.5.0-once.yml'
]:
    ROOT.joinpath(obsolete).unlink(missing_ok=True)

pipeline = subprocess.check_output(['git', 'show', 'origin/main:.github/workflows/pipeline.yml'], text=True)
pipeline = pipeline.replace('permissions:\n  contents: write', 'permissions:\n  contents: write\n  actions: write')
if 'name: Repository cleanup' not in pipeline:
    pipeline += r'''

  cleanup:
    name: Repository cleanup
    if: ${{ always() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}
    needs: [prepare, tests, windows, desktop-release, android-release, publish]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: Remove merged work branches
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          set -euo pipefail
          git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune
          gh api --paginate "repos/$GITHUB_REPOSITORY/branches?per_page=100" --jq '.[].name' | while read -r branch; do
            [[ "$branch" == 'main' ]] && continue
            if git show-ref --verify --quiet "refs/remotes/origin/$branch" && git merge-base --is-ancestor "origin/$branch" origin/main; then
              echo "Deleting merged branch $branch"
              gh api -X DELETE "repos/$GITHUB_REPOSITORY/git/refs/heads/$branch" || true
            fi
          done
      - name: Remove legacy workflow run history
        env:
          GH_TOKEN: ${{ github.token }}
        shell: bash
        run: |
          set -euo pipefail
          legacy='^(Clean stale branches|Core Checks|Desktop Matrix|Publish release|Windows Portable)$'
          gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs?per_page=100" --jq ".workflow_runs[] | select(.name | test(\"$legacy\")) | .id" | while read -r run_id; do
            [[ -n "$run_id" ]] || continue
            echo "Deleting legacy workflow run $run_id"
            gh api -X DELETE "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" || true
          done
'''
write('.github/workflows/pipeline.yml', pipeline)

ROOT.joinpath('tools/generate-v0.6.0.mjs').unlink(missing_ok=True)
ROOT.joinpath('tools/generate-v0.6.0.py').unlink(missing_ok=True)
print('Generated v0.6.0 maintenance sources')
