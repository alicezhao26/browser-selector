/* Browser Selector – service worker
 * - Routes keyboard commands / popup actions to the page (injecting the picker on demand).
 * - Captures the visible tab (throttled: Chrome allows ~2 captures/sec).
 * - Stitches captured tiles into element / full-page screenshots with OffscreenCanvas.
 * - Saves screenshots to Downloads and keeps a small copy history.
 */
importScripts('shared/defaults.js', 'shared/i18n.js', 'shared/locales/en.js', 'shared/locales/zh_CN.js');

const CONTENT_FILES = [
  'src/shared/defaults.js',
  'src/shared/i18n.js',
  'src/shared/locales/en.js',
  'src/shared/locales/zh_CN.js',
  'src/content/selector.js',
  'src/content/picker.js'
];
const CAPTURE_GAP_MS = 550;           // stay under MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND
const MAX_CANVAS_SIDE = 32000;
const MAX_CANVAS_AREA = 250_000_000;
const HISTORY_MAX = 30;

const sessions = new Map();           // sessionId -> { tiles: [] }
let lastCaptureAt = 0;
let captureChain = Promise.resolve();

// ---------------------------------------------------------------------------
// Commands & popup actions
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener(async (command, tab) => {
  tab = tab || (await getActiveTab());
  if (!tab) return;
  const action = { 'toggle-picker': 'toggle', 'screenshot-visible': 'visible', 'screenshot-full': 'full' }[command];
  if (action) runAction(action, tab);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((res) => sendResponse({ ok: true, ...res }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }));
  return true; // async response
});

async function useLocale() {
  const s = await BS_loadSettings();
  BS_setLocale(s.language);
  return s;
}

async function handleMessage(msg, sender) {
  await useLocale();
  switch (msg.type) {
    case 'popup-action': {
      const tab = await chrome.tabs.get(msg.tabId);
      return runAction(msg.action, tab);
    }
    case 'capture':
      return captureTile(msg, sender);
    case 'compose':
      return composeSession(msg, sender);
    case 'download':
      return { id: await download(msg.dataUrl, msg.filename) };
    case 'history-add':
      return addHistory(msg.entry, sender);
    case 'open-shortcuts':
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      return {};
    case 'open-options':
      await chrome.runtime.openOptionsPage();
      return {};
    default:
      throw new Error('Unknown message: ' + msg.type);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runAction(action, tab) {
  await useLocale();
  try {
    await ensureInjected(tab.id);
    const type = action === 'toggle' ? 'toggle-picker' : action === 'pick' ? 'start-picker' : 'screenshot';
    await chrome.tabs.sendMessage(tab.id, { type, mode: action });
    return { injected: true };
  } catch (err) {
    // Restricted pages (chrome://, Web Store, PDF viewer...) cannot be scripted.
    // A visible-area screenshot still works from here – save it straight to Downloads.
    if (action === 'visible' || action === 'full') {
      const dataUrl = await throttledCapture(tab.windowId);
      await download(dataUrl, makeFilename(tab.url, 'png'));
      return { injected: false, fallback: 'downloaded-visible' };
    }
    throw new Error(BS_t('bgNotScriptable', err.message || err));
  }
}

// Unique per extension load. storage.session is cleared when the extension is reloaded or updated,
// but survives service-worker restarts, so open tabs only get re-injected after a real reload.
async function getBuildId() {
  const { buildId } = await chrome.storage.session.get('buildId');
  if (buildId) return buildId;
  const id = chrome.runtime.getManifest().version + '-' + Date.now();
  await chrome.storage.session.set({ buildId: id });
  return id;
}

async function ensureInjected(tabId) {
  const build = await getBuildId();
  const [{ result: current } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => window.__BROWSER_SELECTOR__ || null
  });
  if (current !== build) {
    await chrome.scripting.executeScript({ target: { tabId }, func: (b) => { window.__BS_BUILD__ = b; }, args: [build] });
    await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
  }
}

// ---------------------------------------------------------------------------
// Capturing & stitching
// ---------------------------------------------------------------------------
function throttledCapture(windowId) {
  const run = async () => {
    const wait = lastCaptureAt + CAPTURE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } finally {
      lastCaptureAt = Date.now();
    }
  };
  const p = captureChain.then(run, run);
  captureChain = p.catch(() => {});
  return p;
}

async function captureTile(msg, sender) {
  const dataUrl = await throttledCapture(sender.tab.windowId);
  if (!sessions.has(msg.session)) sessions.set(msg.session, { tiles: [] });
  sessions.get(msg.session).tiles.push({ dataUrl, placement: msg.placement, viewportWidth: msg.viewportWidth });
  if (msg.progress != null && msg.progress < 1) {
    chrome.action.setBadgeBackgroundColor({ color: '#4f6ff0', tabId: sender.tab.id }).catch(() => {});
    chrome.action.setBadgeText({ text: Math.round(msg.progress * 100) + '%', tabId: sender.tab.id }).catch(() => {});
  }
  return {};
}

async function composeSession(msg, sender) {
  const session = sessions.get(msg.session);
  sessions.delete(msg.session);
  chrome.action.setBadgeText({ text: '', tabId: sender.tab.id }).catch(() => {});
  if (!session || !session.tiles.length) throw new Error(BS_t('bgNothingCaptured'));

  const settings = await BS_loadSettings();
  const bitmaps = await Promise.all(session.tiles.map(async (t) => {
    const blob = await (await fetch(t.dataUrl)).blob();
    return createImageBitmap(blob);
  }));

  // Device-pixel scale from the first tile (captured image width / CSS viewport width).
  let scale = bitmaps[0].width / session.tiles[0].viewportWidth;
  let outW = Math.max(1, Math.round(msg.width * scale));
  let outH = Math.max(1, Math.round(msg.height * scale));
  let shrink = Math.min(1, MAX_CANVAS_SIDE / outW, MAX_CANVAS_SIDE / outH, Math.sqrt(MAX_CANVAS_AREA / (outW * outH)));
  outW = Math.round(outW * shrink);
  outH = Math.round(outH * shrink);

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext('2d');
  if (settings.screenshotFormat === 'jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, outW, outH);
  }
  session.tiles.forEach((t, i) => {
    const bmp = bitmaps[i];
    const s = bmp.width / t.viewportWidth;
    const p = t.placement;
    ctx.drawImage(
      bmp,
      Math.round(p.sx * s), Math.round(p.sy * s), Math.round(p.sw * s), Math.round(p.sh * s),
      Math.round(p.dx * scale * shrink), Math.round(p.dy * scale * shrink),
      Math.round(p.sw * scale * shrink), Math.round(p.sh * scale * shrink)
    );
    bmp.close();
  });

  const type = settings.screenshotFormat === 'jpeg' ? 'image/jpeg' : 'image/png';
  const outBlob = await canvas.convertToBlob({ type, quality: settings.jpegQuality / 100 });
  const dataUrl = await blobToDataUrl(outBlob);
  // Clipboard only accepts PNG images, so give the page a PNG copy when saving JPEG.
  const pngDataUrl = type === 'image/png' ? dataUrl : await blobToDataUrl(await canvas.convertToBlob({ type: 'image/png' }));

  let downloaded = false;
  if (settings.screenshotDownload) {
    await download(dataUrl, makeFilename(sender.tab.url, settings.screenshotFormat, msg.label));
    downloaded = true;
  }
  return {
    dataUrl,
    pngDataUrl,
    width: outW,
    height: outH,
    downloaded,
    filename: makeFilename(sender.tab.url, settings.screenshotFormat, msg.label),
    shrunk: shrink < 1
  };
}

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

function download(url, filename) {
  return chrome.downloads.download({ url, filename, saveAs: false });
}

function makeFilename(pageUrl, ext, label) {
  let host = 'page';
  try { host = new URL(pageUrl).hostname.replace(/^www\./, '') || 'page'; } catch (e) {}
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const kind = (label || 'screenshot').replace(/[^a-z0-9-]+/gi, '-');
  return `browser-selector/${host}-${kind}-${stamp}.${ext === 'jpeg' ? 'jpg' : 'png'}`;
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
async function addHistory(entry, sender) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({ ...entry, url: sender.tab && sender.tab.url, title: sender.tab && sender.tab.title, time: Date.now() });
  await chrome.storage.local.set({ history: history.slice(0, HISTORY_MAX) });
  return {};
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
