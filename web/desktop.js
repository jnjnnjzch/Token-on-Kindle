const invoke = window.__TAURI__?.core?.invoke;
const listen = window.__TAURI__?.event?.listen;
const panel = document.querySelector('#desktop-integration');
let desktop = null;
let syncTimer = null;
let traySyncInFlight = null;
let traySyncQueued = false;
let lastSourceStatus = '';
let lastUpdateStatus = '';

const text = selector => document.querySelector(selector)?.textContent?.trim() || '';
const connectionText = source => {
  const status = text('#' + source + '-connection');
  const detail = text('#' + source + '-detail');
  return [status, detail].filter(Boolean).join(' · ');
};

function renderDesktopState(next) {
  desktop = next;
  if (!panel) return;
  if (['android', 'ios'].includes(next.platform)) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  document.querySelector('#tray-state').textContent = next.trayAvailable ? '系统托盘已启用' : '系统托盘不可用';
  document.querySelector('#tray-detail').textContent = next.closeBehavior;
  const pause = document.querySelector('#toggle-collection');
  pause.textContent = next.paused ? '恢复后台采集' : '暂停后台采集';
  pause.dataset.active = String(next.paused);
  document.querySelector('#toggle-autostart').textContent = next.autostartEnabled ? '关闭开机启动' : '启用开机启动';
  document.body.dataset.collectionPaused = String(next.paused);
  if (next.paused) document.querySelector('#service').textContent = '后台采集已暂停 · 托盘仍在运行';
}

async function loadDesktopState() {
  if (!invoke) { if (panel) panel.hidden = true; return; }
  try { renderDesktopState(await invoke('get_desktop_state')); }
  catch { if (panel) panel.hidden = true; }
}

function trayPayloads() {
  const install = document.querySelector('#install-update');
  return {
    source: {
      codex: connectionText('codex'),
      deepseek: connectionText('deepseek'),
      volcengine: connectionText('volcengine')
    },
    update: {
      status: text('#update-status'),
      actionable: Boolean(install && !install.hidden && !install.disabled)
    }
  };
}

async function pushTrayStatus() {
  if (!invoke || !desktop || ['android', 'ios'].includes(desktop.platform)) return;
  if (traySyncInFlight) {
    traySyncQueued = true;
    return traySyncInFlight;
  }
  traySyncInFlight = (async () => {
    do {
      traySyncQueued = false;
      const payloads = trayPayloads();
      const sourceKey = JSON.stringify(payloads.source);
      const updateKey = JSON.stringify(payloads.update);
      if (sourceKey !== lastSourceStatus) {
        await invoke('set_tray_source_status', payloads.source);
        lastSourceStatus = sourceKey;
      }
      if (updateKey !== lastUpdateStatus) {
        await invoke('set_tray_update_status', payloads.update);
        lastUpdateStatus = updateKey;
      }
    } while (traySyncQueued);
  })().catch(() => {}).finally(() => {
    traySyncInFlight = null;
  });
  return traySyncInFlight;
}

function scheduleTraySync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushTrayStatus(), 500);
}

new MutationObserver(scheduleTraySync).observe(document.body, {
  subtree: true,
  childList: true,
  characterData: true,
  attributes: true,
  attributeFilter: ['hidden', 'disabled', 'data-state']
});

document.querySelector('#toggle-collection')?.addEventListener('click', async () => {
  renderDesktopState(await invoke('set_collection_paused', { paused: !desktop.paused }));
});
document.querySelector('#toggle-autostart')?.addEventListener('click', async () => {
  renderDesktopState(await invoke('set_autostart_enabled', { enabled: !desktop.autostartEnabled }));
});
document.querySelector('#open-system-browser')?.addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  document.querySelector('#service').textContent = '正在打开 Kindle 页面…';
  try {
    await invoke('open_browser_url');
    document.querySelector('#service').textContent = 'Kindle 页面已交给系统浏览器打开';
  } catch (error) {
    document.querySelector('#service').textContent = `打开 Kindle 页面失败：${error}`;
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#copy-kindle-url')?.addEventListener('click', async event => {
  const original = event.currentTarget.textContent;
  try {
    await invoke('copy_browser_url');
    event.currentTarget.textContent = '已复制';
  } finally {
    setTimeout(() => { event.currentTarget.textContent = original; }, 1200);
  }
});

listen?.('desktop-state-changed', event => renderDesktopState(event.payload));
listen?.('desktop-update-action', event => {
  document.querySelector('.app-update-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const selector = event.payload?.install ? '#install-update' : '#check-update';
  setTimeout(() => document.querySelector(selector)?.click(), 180);
});

await loadDesktopState();
setTimeout(loadDesktopState, 600);
setTimeout(loadDesktopState, 1800);
scheduleTraySync();
