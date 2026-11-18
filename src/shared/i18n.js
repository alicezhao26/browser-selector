// Tiny i18n layer shared by every context (service worker, popup, options, content scripts).
// Unlike chrome.i18n it lets the user override the language in Settings.
// Dictionaries live in src/shared/locales/<code>.js and register into BS_LOCALES.
(function (g) {
  g.BS_LOCALES = g.BS_LOCALES || {};
  // Languages offered in the UI (native names, never translated).
  g.BS_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'zh_CN', name: '简体中文' }
  ];

  let current = 'en';

  function uiLanguage() {
    try { return chrome.i18n.getUILanguage(); } catch (e) { return (g.navigator && navigator.language) || 'en'; }
  }

  function resolve(pref) {
    if (pref && pref !== 'auto' && g.BS_LOCALES[pref]) return pref;
    const ui = String(uiLanguage() || 'en').replace('-', '_');
    if (g.BS_LOCALES[ui]) return ui;
    const base = ui.split('_')[0].toLowerCase();
    if (base === 'zh') return 'zh_CN'; // zh, zh-TW, zh-HK… fall back to Simplified for now
    return Object.keys(g.BS_LOCALES).find((k) => k.split('_')[0] === base) || 'en';
  }

  g.BS_setLocale = function (pref) {
    current = resolve(pref);
    // only on our own pages (popup/options) – never touch a host page from the content script
    if (g.document && document.documentElement && g.location && location.protocol === 'chrome-extension:') {
      document.documentElement.lang = current.replace('_', '-');
    }
    return current;
  };

  g.BS_getLocale = function () { return current; };

  /** Translate `key`, replacing {0}, {1}… with the extra arguments. Falls back to English, then the key. */
  g.BS_t = function (key) {
    const subs = Array.prototype.slice.call(arguments, 1);
    const dict = g.BS_LOCALES[current] || {};
    const msg = dict[key] != null ? dict[key] : (g.BS_LOCALES.en || {})[key] != null ? g.BS_LOCALES.en[key] : key;
    return String(msg).replace(/\{(\d+)\}/g, (m, i) => (subs[i] !== undefined ? String(subs[i]) : m));
  };

  /**
   * Translate a DOM subtree:
   *   data-i18n="key"            -> textContent
   *   data-i18n-html="key"       -> innerHTML (trusted dictionary strings only)
   *   data-i18n-title / -placeholder / -aria-label="key" -> attribute
   */
  g.BS_applyI18n = function (root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = g.BS_t(el.getAttribute('data-i18n')); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = g.BS_t(el.getAttribute('data-i18n-html')); });
    ['title', 'placeholder', 'aria-label'].forEach((attr) => {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
        el.setAttribute(attr, g.BS_t(el.getAttribute(`data-i18n-${attr}`)));
      });
    });
  };
})(globalThis);
