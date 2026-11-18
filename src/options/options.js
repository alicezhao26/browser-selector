const D = globalThis.BS_DEFAULTS;
const t = BS_t;
const LIST_FIELDS = ['preferredAttributes', 'ignorePatterns'];
const CMD_KEYS = { 'toggle-picker': 'cmdTogglePicker', 'screenshot-visible': 'cmdScreenshotVisible', 'screenshot-full': 'cmdScreenshotFull' };
const statusEl = document.getElementById('status');
const langSelect = document.getElementById('language');
let statusTimer = 0;
let commands = [];

// Language options: Auto + every registered language (native names).
langSelect.appendChild(new Option('', 'auto'));
BS_LANGUAGES.forEach((l) => langSelect.appendChild(new Option(l.name, l.code)));

function localize() {
  BS_applyI18n(document);
  document.title = t('optPageTitle');
  langSelect.querySelector('option[value="auto"]').textContent = t('languageAuto');
  renderCommands();
}

function renderCommands() {
  const box = document.getElementById('cmds');
  box.textContent = '';
  commands.filter((c) => c.name !== '_execute_action').forEach((c) => {
    const row = document.createElement('div');
    row.className = 'cmd';
    const name = document.createElement('span');
    name.textContent = CMD_KEYS[c.name] ? t(CMD_KEYS[c.name]) : c.description;
    const key = document.createElement('kbd');
    key.textContent = c.shortcut || t('shortcutNotSet');
    row.append(name, key);
    box.appendChild(row);
  });
}

function fill(s) {
  Object.keys(D).forEach((key) => {
    const el = document.getElementById(key);
    if (!el) return;
    if (LIST_FIELDS.includes(key)) el.value = (s[key] || []).join('\n');
    else if (el.type === 'checkbox') el.checked = !!s[key];
    else el.value = s[key];
  });
}

function read() {
  const out = {};
  Object.keys(D).forEach((key) => {
    const el = document.getElementById(key);
    if (!el) return;
    if (LIST_FIELDS.includes(key)) out[key] = el.value.split('\n').map((v) => v.trim()).filter(Boolean);
    else if (el.type === 'checkbox') out[key] = el.checked;
    else if (el.type === 'number') {
      const n = Number(el.value);
      const min = Number(el.min), max = Number(el.max);
      out[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : D[key];
    } else out[key] = el.value;
  });
  return out;
}

function invalidPatterns() {
  return document.getElementById('ignorePatterns').value.split('\n').map((v) => v.trim()).filter(Boolean)
    .filter((p) => { try { new RegExp(p); return false; } catch (e) { return true; } });
}

function save() {
  const bad = invalidPatterns();
  if (bad.length) return showStatus(t('optInvalidRegex', bad[0]), true);
  chrome.storage.sync.set(read(), () => showStatus(t('optSaved')));
}

function showStatus(text, error) {
  statusEl.textContent = text;
  statusEl.style.color = error ? 'var(--danger)' : '';
  statusEl.style.opacity = 1;
  clearTimeout(statusTimer);
  if (!error) statusTimer = setTimeout(() => (statusEl.style.opacity = 0), 1500);
}

document.querySelectorAll('input, select, textarea').forEach((el) => {
  if (el === langSelect) return;
  el.addEventListener(el.tagName === 'TEXTAREA' || el.type === 'number' ? 'input' : 'change', debounce(save, 400));
});

// Language applies instantly to this page; the popup and picker pick it up via storage.
langSelect.addEventListener('change', () => {
  BS_setLocale(langSelect.value);
  localize();
  chrome.storage.sync.set({ language: langSelect.value }, () => showStatus(t('optSaved')));
});

document.getElementById('reset').addEventListener('click', () => {
  chrome.storage.sync.set({ ...D }, () => {
    fill(D);
    BS_setLocale(D.language);
    localize();
    showStatus(t('optDefaultsRestored'));
  });
});
document.getElementById('shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

chrome.commands.getAll((cmds) => { commands = cmds; renderCommands(); });

function debounce(fn, ms) {
  let timer = 0;
  return (...a) => { clearTimeout(timer); timer = setTimeout(() => fn(...a), ms); };
}

BS_loadSettings().then((s) => {
  fill(s);
  BS_setLocale(s.language);
  localize();
});
