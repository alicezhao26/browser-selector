const t = BS_t;
const errorEl = document.getElementById('error');
const langSelect = document.getElementById('language');
let history = [];
let toggleShortcut = 'Alt+C';
const KIND_KEYS = { css: 'kindCss', xpath: 'kindXpath', jspath: 'kindJspath', text: 'kindText', html: 'kindHtml', screenshot: 'kindScreenshot' };

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function localize() {
  BS_applyI18n(document);
  document.title = t('appName');
  langSelect.querySelector('option[value="auto"]').textContent = t('languageAuto');
  renderHistory();
}

// Language switcher: Auto + every registered language (native names).
function buildLanguageSelect(current) {
  langSelect.textContent = '';
  const auto = new Option(t('languageAuto'), 'auto');
  langSelect.appendChild(auto);
  BS_LANGUAGES.forEach((l) => langSelect.appendChild(new Option(l.name, l.code)));
  langSelect.value = current || 'auto';
}

langSelect.addEventListener('change', () => {
  chrome.storage.sync.set({ language: langSelect.value });
  BS_setLocale(langSelect.value);
  localize();
});

// Show the currently assigned shortcuts.
chrome.commands.getAll((cmds) => {
  cmds.forEach((c) => {
    if (c.name === 'toggle-picker' && c.shortcut) toggleShortcut = c.shortcut;
    const k = document.querySelector(`kbd[data-cmd="${c.name}"]`);
    if (k) k.textContent = c.shortcut || ''; // empty <kbd> is hidden via CSS
  });
  renderHistory();
});

document.querySelectorAll('.action').forEach((btn) => {
  btn.addEventListener('click', async () => {
    errorEl.hidden = true;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.runtime.sendMessage({ type: 'popup-action', action: btn.dataset.action, tabId: tab.id }, (res) => {
      if (chrome.runtime.lastError || !res || !res.ok) {
        errorEl.textContent = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || t('popupError');
        errorEl.hidden = false;
        return;
      }
      window.close(); // give focus back to the page (needed for clipboard writes)
    });
  });
});

document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ history: [] });
  history = [];
  renderHistory();
});

function renderHistory() {
  const list = document.getElementById('history');
  const empty = document.getElementById('empty');
  list.textContent = '';
  empty.innerHTML = t('popupEmpty', escapeHtml(toggleShortcut));
  empty.hidden = history.length > 0;
  document.getElementById('clear').hidden = history.length === 0;
  history.forEach((h) => {
    const li = document.createElement('li');
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = KIND_KEYS[h.kind] ? t(KIND_KEYS[h.kind]) : h.kind;
    const code = document.createElement('code');
    code.textContent = h.value;
    code.title = h.value;
    const src = document.createElement('span');
    src.className = 'src';
    let host = '';
    try { host = new URL(h.url).hostname; } catch (e) {}
    const meta = () => `${host}${t('listSep')}${timeAgo(h.time)}`;
    src.textContent = meta();
    li.append(kind, code, src);
    if (h.kind !== 'screenshot') {
      li.title = t('popupCopyAgain');
      li.addEventListener('click', async () => {
        await navigator.clipboard.writeText(h.value);
        li.classList.add('copied');
        src.textContent = t('popupCopied');
        setTimeout(() => { li.classList.remove('copied'); src.textContent = meta(); }, 1200);
      });
    }
    list.appendChild(li);
  });
}

function timeAgo(time) {
  const s = Math.round((Date.now() - time) / 1000);
  if (s < 60) return t('timeJustNow');
  if (s < 3600) return t('timeMinutes', Math.round(s / 60));
  if (s < 86400) return t('timeHours', Math.round(s / 3600));
  return t('timeDays', Math.round(s / 86400));
}

(async function init() {
  const settings = await BS_loadSettings();
  BS_setLocale(settings.language);
  buildLanguageSelect(settings.language);
  const res = await chrome.storage.local.get({ history: [] });
  history = res.history;
  localize();
})();
