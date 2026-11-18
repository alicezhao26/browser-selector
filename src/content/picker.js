/* Browser Selector – in-page picker + screenshot driver.
 * Injected on demand (activeTab) together with defaults.js and selector.js.
 */
(function () {
  // The service worker sets __BS_BUILD__ (unique per extension load) before injecting.
  // A newer build replaces an older instance, so reloading the extension never leaves stale code running.
  const BUILD = window.__BS_BUILD__ || 'dev';
  if (window.__BROWSER_SELECTOR__ === BUILD) return;
  if (typeof window.__BS_DESTROY__ === 'function') {
    try { window.__BS_DESTROY__(); } catch (e) { /* old instance already gone */ }
  }
  window.__BROWSER_SELECTOR__ = BUILD;

  const S = globalThis.BS_Selector;
  const t = globalThis.BS_t;
  let settings = Object.assign({}, globalThis.BS_DEFAULTS);
  globalThis.BS_setLocale(settings.language);
  const applySettings = (s) => {
    settings = s;
    S.configure(s);
    globalThis.BS_setLocale(s.language);
    localize();
  };
  const settingsReady = globalThis.BS_loadSettings().then(applySettings);
  const onStorageChanged = (changes, area) => {
    if (area !== 'sync') return;
    globalThis.BS_loadSettings().then(applySettings);
  };
  try { chrome.storage.onChanged.addListener(onStorageChanged); } catch (e) { /* test harness */ }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    active: false,
    hovered: null,
    info: null,          // cached { el, css, xpath }
    locked: false,       // hard lock (Space)
    navLock: null,       // {x, y} – soft lock after keyboard navigation
    childStack: [],
    mouse: { x: 0, y: 0 },
    busy: false,
    menuOpen: false,
    uiLock: false,       // lock set by the Parent/Child buttons; released after the next action
    suppressClick: false // swallow the click that closes the menu
  };
  let computeTimer = 0;
  let rafPending = false;

  // ---------------------------------------------------------------------------
  // UI (closed shadow root so page CSS/JS can't touch it)
  // ---------------------------------------------------------------------------
  const host = document.createElement('browser-selector-ui');
  host.setAttribute('style', 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;');
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
<style>
  :host { all: initial; }
  * { box-sizing: border-box; }
  .ui { font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif; color: #e8ebf3; }
  code, .mono { font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace; }
  .hl { position: fixed; pointer-events: none; border: 2px solid #6c8cff; background: rgba(108,140,255,.14);
        border-radius: 2px; transition: all 60ms ease-out; display: none; }
  .hl.flash { border-color: #3ddc97; background: rgba(61,220,151,.25); }
  .hl.locked { border-style: dashed; }
  .tag { position: fixed; pointer-events: none; display: none; max-width: 520px; white-space: nowrap; overflow: hidden;
         text-overflow: ellipsis; background: #1d2333; color: #e8ebf3; padding: 3px 7px; border-radius: 4px;
         box-shadow: 0 2px 8px rgba(0,0,0,.35); font-size: 11px; }
  .tag b { color: #9fb4ff; font-weight: 600; } .tag .dim { color: #8a93a8; }
  .panel { position: fixed; right: 16px; bottom: 16px; width: 440px; max-width: calc(100vw - 32px);
           background: #151a26; border: 1px solid #2a3248; border-radius: 10px; box-shadow: 0 10px 40px rgba(0,0,0,.45);
           pointer-events: auto; display: none; overflow: hidden; }
  .panel.left { right: auto; left: 16px; }
  .panel.top { bottom: auto; top: 16px; }
  .ph { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1b2131; border-bottom: 1px solid #2a3248; }
  .ph .dot { width: 8px; height: 8px; border-radius: 50%; background: #6c8cff; flex: none; }
  .ph .desc { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #c9d2ea; }
  .ph .size { color: #8a93a8; flex: none; }
  .ph .lock { color: #ffcc66; flex: none; display: none; }
  .ph .lock.on { display: inline; }
  .ph button { all: unset; cursor: pointer; color: #8a93a8; padding: 0 4px; font-size: 14px; }
  .ph button:hover { color: #fff; }
  .rows { padding: 8px 12px 4px; display: grid; gap: 6px; }
  .row { display: grid; grid-template-columns: 46px 1fr auto; gap: 8px; align-items: start; }
  .row .k { color: #8a93a8; font-size: 11px; padding-top: 3px; text-transform: uppercase; letter-spacing: .04em; }
  .row code { display: block; background: #0e121b; border: 1px solid #232a3d; border-radius: 6px; padding: 4px 7px;
              color: #d7e0ff; word-break: break-all; cursor: pointer; max-height: 66px; overflow: auto; }
  .row code:hover { border-color: #6c8cff; }
  .row .meta { font-size: 11px; padding-top: 4px; white-space: nowrap; }
  .ok { color: #3ddc97; } .warn { color: #ffcc66; } .bad { color: #ff6b81; }
  .alts { display: grid; gap: 4px; }
  .alts code { color: #aab6d6; }
  .note { color: #ffcc66; font-size: 11px; padding: 0 12px 4px; }
  .bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; border-top: 1px solid #222a3c; }
  .bar button, .menu button { all: unset; box-sizing: border-box; cursor: pointer; }
  .bar button { font-size: 12px; padding: 4px 10px; border-radius: 6px; background: #232a3d; color: #e8ebf3; border: 1px solid #343d57; }
  .bar button:hover, .bar button:focus-visible { border-color: #6c8cff; }
  .bar button.primary { background: #4f6ff0; border-color: #4f6ff0; color: #fff; }
  .bar button.primary:hover { background: #6c8cff; }
  .hint { color: #8a93a8; font-size: 11px; padding: 0 12px 10px; }
  .ph .lock { cursor: pointer; }
  .keys { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 8px 12px 10px; color: #8a93a8; font-size: 11px; border-top: 1px solid #222a3c; }
  .keys.hidden { display: none; }
  .keys-title { flex-basis: 100%; color: #c9d2ea; }
  .menu { position: fixed; display: none; min-width: 200px; pointer-events: auto; background: #151a26; border: 1px solid #2a3248;
          border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 4px; }
  .menu button { display: flex; width: 100%; justify-content: space-between; gap: 18px; padding: 6px 10px; border-radius: 5px; color: #e8ebf3; font-size: 12px; }
  .menu button:hover, .menu button:focus-visible { background: #2a3350; }
  .menu .key { color: #6f7891; font-size: 11px; }
  .menu hr { border: 0; border-top: 1px solid #2a3248; margin: 4px 2px; }
  kbd { font-family: inherit; font-size: 10px; background: #232a3d; border: 1px solid #343d57; border-bottom-width: 2px;
        border-radius: 4px; padding: 0 4px; color: #d7e0ff; margin-right: 3px; }
  .toasts { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: grid; gap: 8px; justify-items: center; }
  .toast { pointer-events: auto; background: #151a26; border: 1px solid #2a3248; color: #e8ebf3; border-radius: 8px;
           padding: 8px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4); max-width: min(560px, calc(100vw - 32px));
           display: flex; gap: 10px; align-items: center; animation: in .15s ease-out; }
  .toast .t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toast.err { border-color: #ff6b81; }
  .toast img { max-width: 120px; max-height: 80px; border-radius: 4px; border: 1px solid #2a3248; flex: none; background: #fff; }
  .toast .col { display: grid; gap: 6px; min-width: 0; }
  .toast .btns { display: flex; gap: 6px; }
  .toast button { all: unset; cursor: pointer; font-size: 11px; padding: 3px 9px; border-radius: 5px; background: #2a3350; color: #e8ebf3; }
  .toast button:hover { background: #3a4670; }
  .toast button.primary { background: #4f6ff0; } .toast button.primary:hover { background: #6c8cff; }
  @keyframes in { from { opacity: 0; transform: translateY(-6px); } }
</style>
<div class="ui">
  <div class="hl"></div>
  <div class="tag"></div>
  <div class="panel">
    <div class="ph">
      <span class="dot"></span><span class="desc mono"></span><span class="lock" data-i18n="pkLocked"></span><span class="size"></span>
      <button class="help" data-i18n-title="pkToggleKeys">?</button><button class="close" data-i18n-title="pkExit">×</button>
    </div>
    <div class="rows">
      <div class="row"><span class="k">CSS</span><code class="css"></code><span class="meta cssmeta"></span></div>
      <div class="row altrow"><span class="k" data-i18n="pkAlt"></span><div class="alts"></div><span></span></div>
      <div class="row"><span class="k">XPath</span><code class="xpath"></code><span></span></div>
    </div>
    <div class="note"></div>
    <div class="bar">
      <button class="primary" data-act="css" data-i18n="pkBtnCopy"></button>
      <button data-act="shot" data-i18n="pkBtnShot"></button>
      <button data-act="parent" data-i18n="pkBtnParent"></button>
      <button data-act="more" data-i18n="pkBtnMore"></button>
    </div>
    <div class="hint" data-i18n-html="pkHintBasic"></div>
    <div class="keys hidden">
      <span class="keys-title" data-i18n="pkAdvanced"></span>
      <span><kbd data-i18n="keyClick"></kbd><kbd>C</kbd><span data-i18n="pkHintCss"></span></span>
      <span><kbd>X</kbd><span data-i18n="pkHintXpath"></span></span>
      <span><kbd>J</kbd><span data-i18n="pkHintJs"></span></span>
      <span><kbd>1-4</kbd><span data-i18n="pkHintAlt"></span></span>
      <span><kbd>T</kbd><span data-i18n="pkHintText"></span></span>
      <span><kbd>O</kbd><span data-i18n="pkHintHtml"></span></span>
      <span><kbd>S</kbd><span data-i18n="pkHintShot"></span></span>
      <span><kbd>V</kbd><span data-i18n="pkHintVisible"></span></span>
      <span><kbd>F</kbd><span data-i18n="pkHintFull"></span></span>
      <span><kbd>↑</kbd><kbd>↓</kbd><span data-i18n="pkHintParent"></span></span>
      <span><kbd>←</kbd><kbd>→</kbd><span data-i18n="pkHintSiblings"></span></span>
      <span><kbd>Space</kbd><span data-i18n="pkHintLock"></span></span>
      <span><kbd>H</kbd><span data-i18n="pkHintHide"></span></span>
      <span><kbd>Esc</kbd><span data-i18n="pkHintExit"></span></span>
    </div>
  </div>
  <div class="toasts"></div>
  <!-- menu last so it always paints above toasts -->
  <div class="menu" role="menu">
    <button role="menuitem" data-act="css"><span data-i18n="menuCopyCss"></span><span class="key">C</span></button>
    <button role="menuitem" data-act="xpath"><span data-i18n="menuCopyXpath"></span><span class="key">X</span></button>
    <button role="menuitem" data-act="jspath"><span data-i18n="menuCopyJs"></span><span class="key">J</span></button>
    <button role="menuitem" data-act="text"><span data-i18n="menuCopyText"></span><span class="key">T</span></button>
    <button role="menuitem" data-act="html"><span data-i18n="menuCopyHtml"></span><span class="key">O</span></button>
    <hr>
    <button role="menuitem" data-act="shot"><span data-i18n="menuShotElement"></span><span class="key">S</span></button>
    <button role="menuitem" data-act="visible"><span data-i18n="menuShotVisible"></span><span class="key">V</span></button>
    <button role="menuitem" data-act="full"><span data-i18n="menuShotFull"></span><span class="key">F</span></button>
    <hr>
    <button role="menuitem" data-act="parent"><span data-i18n="menuParent"></span><span class="key">↑</span></button>
    <button role="menuitem" data-act="child"><span data-i18n="menuChild"></span><span class="key">↓</span></button>
  </div>
</div>`;
  const $ = (sel) => shadow.querySelector(sel);
  const ui = {
    hl: $('.hl'), tag: $('.tag'), panel: $('.panel'), desc: $('.desc'), size: $('.size'), lock: $('.lock'),
    css: $('.css'), cssmeta: $('.cssmeta'), alts: $('.alts'), altrow: $('.altrow'), xpath: $('.xpath'),
    note: $('.note'), keys: $('.keys'), toasts: $('.toasts'), menu: $('.menu')
  };
  function mountHost() {
    if (!host.isConnected) (document.body || document.documentElement).appendChild(host);
  }

  function localize() {
    globalThis.BS_applyI18n(shadow);
    ui.css.title = t('pkClickToCopy', 'C');
    ui.xpath.title = t('pkClickToCopy', 'X');
    ui.lock.title = t('pkUnlock');
    if (state.info && state.info.el === state.hovered) renderInfo();
  }
  localize();

  ui.css.addEventListener('click', () => doCopy('css'));
  ui.xpath.addEventListener('click', () => doCopy('xpath'));
  $('.close').addEventListener('click', stop);
  $('.help').addEventListener('click', () => ui.keys.classList.toggle('hidden'));
  ui.lock.addEventListener('click', () => { state.locked = false; renderLock(); });

  // Panel buttons and right-click menu items share one action dispatcher.
  shadow.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (btn.dataset.act === 'more') {
        const r = btn.getBoundingClientRect();
        return openMenu(r.left, r.top, true);
      }
      runAct(btn.dataset.act, { fromUI: true });
    });
  });

  function runAct(name, opts) {
    closeMenu();
    if (name === 'visible') return screenshotVisible();
    if (name === 'full') return screenshotFull();
    if (!state.hovered) return toast(t('pkHoverFirst'), { error: true });
    if (name === 'shot') return screenshotElement(state.hovered);
    if (name === 'parent' || name === 'child') {
      navigate(name);
      // keep the new selection while the mouse travels back from the panel / menu
      if (opts && opts.fromUI) { state.locked = true; state.uiLock = true; renderLock(); }
      return;
    }
    return doCopy(name);
  }

  function openMenu(x, y, above) {
    state.menuOpen = true;
    const m = ui.menu;
    m.style.display = 'block';
    const w = m.offsetWidth, h = m.offsetHeight;
    let top = above ? y - h - 6 : y;
    if (top + h > window.innerHeight - 8) top = y - h;
    m.style.top = Math.max(8, top) + 'px';
    m.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  }

  function closeMenu() {
    if (!state.menuOpen) return;
    state.menuOpen = false;
    ui.menu.style.display = 'none';
  }

  // ---------------------------------------------------------------------------
  // Picker lifecycle
  // ---------------------------------------------------------------------------
  const cursorStyle = document.createElement('style');
  cursorStyle.textContent = '*, *::before, *::after { cursor: crosshair !important; }';

  async function start() {
    if (state.active) return;
    await settingsReady;
    state.active = true;
    mountHost();
    (document.head || document.documentElement).appendChild(cursorStyle);
    ui.panel.style.display = settings.showPanel ? 'block' : 'none';
    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', swallowKey, true);
    window.addEventListener('keypress', swallowKey, true);
    window.addEventListener('scroll', schedulePosition, true);
    window.addEventListener('resize', schedulePosition, true);
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend']
      .forEach((type) => window.addEventListener(type, onPointer, { capture: true, passive: false }));
    toast(t('pkStarted'), { html: true, ms: 2500 });
  }

  function stop() {
    if (!state.active) return;
    state.active = false;
    window.removeEventListener('mousemove', onMouseMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', swallowKey, true);
    window.removeEventListener('keypress', swallowKey, true);
    window.removeEventListener('scroll', schedulePosition, true);
    window.removeEventListener('resize', schedulePosition, true);
    ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend']
      .forEach((type) => window.removeEventListener(type, onPointer, { capture: true }));
    cursorStyle.remove();
    closeMenu();
    ui.hl.style.display = 'none';
    ui.tag.style.display = 'none';
    ui.panel.style.display = 'none';
    Object.assign(state, { hovered: null, info: null, locked: false, uiLock: false, navLock: null, childStack: [], suppressClick: false });
    renderLock();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  const fromUI = (e) => e.composedPath && e.composedPath().indexOf(host) !== -1;

  function deepElementFromPoint(x, y) {
    let el = document.elementFromPoint(x, y);
    while (el && el.shadowRoot) {
      const inner = el.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === el) break;
      el = inner;
    }
    return el;
  }

  function onMouseMove(e) {
    state.mouse = { x: e.clientX, y: e.clientY };
    if (state.locked || state.busy || state.menuOpen) return;
    if (state.navLock) {
      if (Math.hypot(e.clientX - state.navLock.x, e.clientY - state.navLock.y) < 24) return;
      state.navLock = null;
    }
    const el = deepElementFromPoint(e.clientX, e.clientY);
    if (!el || el === host || el === document.documentElement) return;
    if (el !== state.hovered) {
      state.childStack = [];
      select(el);
    }
  }

  function onPointer(e) {
    if (fromUI(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Right-click: open the action menu for the highlighted element.
    if (e.type === 'contextmenu') {
      if (!state.locked) {
        const el = deepElementFromPoint(e.clientX, e.clientY);
        if (el && el !== host && el !== document.documentElement && el !== state.hovered) select(el);
      }
      if (state.hovered) openMenu(e.clientX, e.clientY);
      return;
    }
    // A press outside the open menu just closes it.
    if (state.menuOpen && (e.type === 'pointerdown' || e.type === 'mousedown')) {
      if (e.button === 0) state.suppressClick = true;
      closeMenu();
      return;
    }
    if (e.type === 'click' && state.suppressClick) { state.suppressClick = false; return; }
    if (e.type === 'click' && e.button === 0 && state.hovered) {
      const action = settings.clickAction;
      if (action === 'none') return;
      if (action === 'screenshot') return screenshotElement(state.hovered);
      doCopy(action, { fromClick: true });
    }
  }

  function swallowKey(e) {
    if (handledKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  function handledKey(e) {
    if (e.altKey) return false;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((e.ctrlKey || e.metaKey) && k !== 'c') return false;
    return ['Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', '[', ']', 'c', 'x', 'j', 't', 'o', 's', 'v', 'f', 'h', '?', '1', '2', '3', '4', 'Enter'].indexOf(k) !== -1;
  }

  function onKeyDown(e) {
    if (!handledKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (state.busy) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const el = state.hovered;
    const menuWasOpen = state.menuOpen;
    closeMenu();
    switch (k) {
      case 'Escape': return menuWasOpen ? undefined : stop();
      case 'ArrowUp': case '[': return navigate('parent');
      case 'ArrowDown': case ']': return navigate('child');
      case 'ArrowLeft': return navigate('prev');
      case 'ArrowRight': return navigate('next');
      case ' ': state.locked = !state.locked; state.uiLock = false; state.navLock = null; return renderLock();
      case 'h': case '?': ui.keys.classList.toggle('hidden'); return;
      case 'v': return screenshotVisible();
      case 'f': return screenshotFull();
    }
    if (!el) return toast(t('pkHoverFirst'), { error: true });
    switch (k) {
      case 'c': case 'Enter': return doCopy('css');
      case 'x': return doCopy('xpath');
      case 'j': return doCopy('jspath');
      case 't': return doCopy('text');
      case 'o': return doCopy('html');
      case 's': return screenshotElement(el);
      case '1': case '2': case '3': case '4': return doCopy('alt', { index: +k - 1 });
    }
  }

  function navigate(dir) {
    const cur = state.hovered;
    if (!cur) return;
    let next = null;
    if (dir === 'parent') {
      next = cur.parentElement || (cur.getRootNode().host || null);
      if (next && next !== document.documentElement) state.childStack.push(cur);
      else next = null;
    } else if (dir === 'child') {
      next = state.childStack.pop() || cur.firstElementChild || (cur.shadowRoot && cur.shadowRoot.firstElementChild);
    } else if (dir === 'prev') {
      next = cur.previousElementSibling; state.childStack = [];
    } else if (dir === 'next') {
      next = cur.nextElementSibling; state.childStack = [];
    }
    if (!next) return flash(false);
    state.navLock = { ...state.mouse };
    select(next);
  }

  // ---------------------------------------------------------------------------
  // Selection rendering
  // ---------------------------------------------------------------------------
  function select(el) {
    state.hovered = el;
    state.info = null;
    position();
    ui.desc.textContent = S.describe(el);
    ui.css.textContent = '…';
    ui.cssmeta.textContent = '';
    ui.xpath.textContent = '…';
    ui.note.textContent = '';
    clearTimeout(computeTimer);
    computeTimer = setTimeout(() => computeInfo(el, 500), 40);
  }

  function computeInfo(el, budget) {
    if (state.info && state.info.el === el && state.info.budget >= budget) return state.info;
    const css = S.css(el, { budget, alternatives: 3 });
    const xpath = S.xpath(el);
    state.info = { el, css, xpath, budget };
    if (el === state.hovered) renderInfo();
    return state.info;
  }

  function renderInfo() {
    const { css, xpath } = state.info;
    ui.css.textContent = css.selector;
    const n = S.count(state.hovered, css.selector);
    const meta = document.createElement('span');
    meta.className = css.fallback ? 'warn' : n === 1 ? 'ok' : 'bad';
    meta.textContent = css.fallback ? t('pkPositional') : n === 1 ? t('pkOneMatch') : t('pkMatches', n);
    ui.cssmeta.replaceChildren(meta);
    ui.alts.textContent = '';
    css.alternatives.slice(0, 3).forEach((alt, i) => {
      const c = document.createElement('code');
      c.textContent = `${i + 2}  ${alt}`;
      c.title = t('pkClickToCopy', i + 2);
      c.addEventListener('click', () => doCopy('alt', { index: i + 1 }));
      ui.alts.appendChild(c);
    });
    ui.altrow.style.display = css.alternatives.length ? '' : 'none';
    ui.xpath.textContent = xpath || t('pkNoXpathShadow');
    ui.note.textContent = css.inShadow ? t('pkShadowNote', css.hostChain.join(' › ')) : '';
    renderTag();
  }

  function renderLock() {
    ui.lock.classList.toggle('on', state.locked);
    ui.hl.classList.toggle('locked', state.locked);
  }

  function releaseUiLock() {
    if (!state.uiLock) return;
    state.uiLock = false;
    state.locked = false;
    renderLock();
  }

  function schedulePosition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; position(); });
  }

  function position() {
    const el = state.hovered;
    if (!el || !el.isConnected) { ui.hl.style.display = 'none'; ui.tag.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    Object.assign(ui.hl.style, {
      display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px',
      width: r.width + 4 + 'px', height: r.height + 4 + 'px'
    });
    ui.size.textContent = `${Math.round(r.width)} × ${Math.round(r.height)}`;
    renderTag(r);
    // keep the panel from covering the target
    if (settings.showPanel) {
      const vw = window.innerWidth, vh = window.innerHeight;
      const coversRight = r.right > vw - 470 && r.bottom > vh - 260;
      ui.panel.classList.toggle('left', coversRight && r.left > 470);
      ui.panel.classList.toggle('top', coversRight && r.left <= 470 && r.top > 260);
    }
  }

  function renderTag(r) {
    const el = state.hovered;
    if (!el) return;
    r = r || el.getBoundingClientRect();
    const sel = state.info && state.info.el === el ? state.info.css.selector : S.describe(el);
    ui.tag.innerHTML = '';
    const b = document.createElement('b'); b.textContent = sel;
    const d = document.createElement('span'); d.className = 'dim'; d.textContent = `  ${Math.round(r.width)}×${Math.round(r.height)}`;
    ui.tag.append(b, d);
    ui.tag.style.display = 'block';
    const top = r.top > 26 ? r.top - 24 : Math.min(r.bottom + 4, window.innerHeight - 22);
    ui.tag.style.top = top + 'px';
    ui.tag.style.left = Math.max(4, Math.min(r.left, window.innerWidth - 300)) + 'px';
  }

  function flash(ok) {
    ui.hl.classList.add('flash');
    if (ok === false) ui.hl.style.borderColor = '#ff6b81';
    setTimeout(() => { ui.hl.classList.remove('flash'); ui.hl.style.borderColor = ''; }, 350);
  }

  // ---------------------------------------------------------------------------
  // Copy actions
  // ---------------------------------------------------------------------------
  const LABEL_KEYS = { css: 'labelCss', xpath: 'labelXpath', jspath: 'labelJspath', text: 'labelText', html: 'labelHtml', alt: 'labelCss' };

  async function doCopy(kind, opts) {
    opts = opts || {};
    const el = state.hovered;
    if (!el) return;
    const info = computeInfo(el, 1500); // full search budget for the final answer
    let value;
    switch (kind) {
      case 'css': value = info.css.selector; break;
      case 'alt': {
        const all = [info.css.selector].concat(info.css.alternatives);
        value = all[opts.index];
        if (!value) return toast(t('pkNoAlt', opts.index + 1), { error: true });
        break;
      }
      case 'xpath': value = info.xpath; if (!value) return toast(t('pkXpathShadow'), { error: true }); break;
      case 'jspath': value = S.jsPath(el, info.css); break;
      case 'text': value = (el.innerText || el.textContent || '').trim(); break;
      case 'html': value = el.outerHTML; break;
      default: return;
    }
    const ok = await copyText(value);
    flash(ok);
    if (!ok) return toast(t('pkClipboardBlocked'), { error: true }), console.log('[Browser Selector]', value);
    const shown = value.length > 90 ? value.slice(0, 89) + '…' : value;
    toast(t('pkCopied', t(LABEL_KEYS[kind]), shown));
    releaseUiLock();
    sendMessage({ type: 'history-add', entry: { kind: kind === 'alt' ? 'css' : kind, value: value.length > 2000 ? value.slice(0, 2000) : value } });
    if (opts.fromClick && settings.exitAfterCopy) stop();
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      // Fallback for pages whose permissions policy blocks the async clipboard API.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('style', 'position:fixed;top:-1000px;left:0;opacity:0;');
      document.documentElement.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function dataUrlToBlob(dataUrl) {
    const [head, b64] = dataUrl.split(',');
    const mime = head.match(/data:([^;]+)/)[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function copyImage(pngDataUrl) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': dataUrlToBlob(pngDataUrl) })]);
  }

  // ---------------------------------------------------------------------------
  // Screenshots
  // ---------------------------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          const err = chrome.runtime.lastError;
          if (err) return reject(new Error(err.message));
          if (res && res.ok === false) return reject(new Error(res.error));
          resolve(res || {});
        });
      } catch (e) { reject(e); }
    });
  }

  function viewport() {
    const de = document.documentElement;
    return { w: de.clientWidth || window.innerWidth, h: de.clientHeight || window.innerHeight, iw: window.innerWidth };
  }

  function docSize() {
    const de = document.documentElement, b = document.body || de;
    return {
      w: Math.max(de.scrollWidth, b.scrollWidth, de.clientWidth),
      h: Math.max(de.scrollHeight, b.scrollHeight, de.clientHeight)
    };
  }

  function scrollToXY(x, y) {
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }

  function isFixed(el) {
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement || (cur.getRootNode().host || null)) {
      const pos = getComputedStyle(cur).position;
      if (pos === 'fixed') return true;
    }
    return false;
  }

  function hideFixedElements() {
    const hidden = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el === host) continue;
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') {
          hidden.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
          el.style.setProperty('visibility', 'hidden', 'important');
        }
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    return () => hidden.forEach(([el, v, p]) => (v ? el.style.setProperty('visibility', v, p) : el.style.removeProperty('visibility')));
  }

  /**
   * Capture a region given in document coordinates (or viewport coordinates when `fixed`).
   * Small regions: one capture. Larger: scroll in tiles and stitch in the service worker.
   */
  async function captureRegion(region, { label, fixed, refresh } = {}) {
    await settingsReady;
    const session = Math.random().toString(36).slice(2);
    const vp = viewport();
    const saved = { x: window.scrollX, y: window.scrollY };
    const prevVisibility = host.style.visibility;
    host.style.visibility = 'hidden';
    let restoreFixed = null;
    state.busy = true;
    try {
      const doc = docSize();
      let { x, y, w, h } = region;
      // snap to whole CSS pixels so tiles never sample outside the captured image
      w = Math.ceil(x + w) - Math.floor(x); h = Math.ceil(y + h) - Math.floor(y);
      x = Math.floor(x); y = Math.floor(y);
      if (!fixed) {
        // clamp to the document
        const x2 = Math.min(doc.w, x + w), y2 = Math.min(doc.h, y + h);
        x = Math.max(0, x); y = Math.max(0, y); w = x2 - x; h = y2 - y;
      } else {
        const x2 = Math.min(vp.w, x + w), y2 = Math.min(vp.h, y + h);
        x = Math.max(0, x); y = Math.max(0, y); w = x2 - x; h = y2 - y;
      }
      if (w < 1 || h < 1) throw new Error(t('errNothingVisible'));

      if (fixed || (w <= vp.w && h <= vp.h)) {
        if (!fixed) {
          const visible = x >= window.scrollX && y >= window.scrollY && x + w <= window.scrollX + vp.w && y + h <= window.scrollY + vp.h;
          if (!visible) scrollToXY(x - (vp.w - w) / 2, y - (vp.h - h) / 2);
        }
        await frames(2); await sleep(80);
        let sx = fixed ? x : x - window.scrollX, sy = fixed ? y : y - window.scrollY;
        if (refresh) { const r = refresh(); sx = r.x; sy = r.y; w = r.w; h = r.h; } // re-measure after scroll
        const cx = Math.max(0, sx), cy = Math.max(0, sy);
        const cw = Math.min(vp.w, sx + w) - cx, ch = Math.min(vp.h, sy + h) - cy;
        if (cw < 1 || ch < 1) throw new Error(t('errNotVisible'));
        await sendMessage({ type: 'capture', session, viewportWidth: vp.iw, placement: { sx: cx, sy: cy, sw: cw, sh: ch, dx: 0, dy: 0 } });
        w = cw; h = ch;
      } else {
        const tiles = [];
        for (let ty = y; ty < y + h; ty += vp.h) {
          for (let tx = x; tx < x + w; tx += vp.w) tiles.push({ tx, ty, tw: Math.min(vp.w, x + w - tx), th: Math.min(vp.h, y + h - ty) });
        }
        if (tiles.length > 80) throw new Error(t('errTooLarge', tiles.length));
        for (let i = 0; i < tiles.length; i++) {
          const tile = tiles[i];
          scrollToXY(tile.tx, tile.ty);
          await frames(2); await sleep(i === 0 ? 150 : 60);
          const placement = { sx: tile.tx - window.scrollX, sy: tile.ty - window.scrollY, sw: tile.tw, sh: tile.th, dx: tile.tx - x, dy: tile.ty - y };
          await sendMessage({ type: 'capture', session, viewportWidth: vp.iw, placement, progress: (i + 1) / tiles.length });
          if (i === 0 && settings.hideFixedOnStitch) restoreFixed = hideFixedElements();
        }
      }
      const res = await sendMessage({ type: 'compose', session, width: w, height: h, label });
      return res;
    } finally {
      if (restoreFixed) restoreFixed();
      if (!fixed) scrollToXY(saved.x, saved.y);
      host.style.visibility = prevVisibility;
      state.busy = false;
    }
  }

  async function runScreenshot(fn, label) {
    mountHost();
    try {
      const res = await fn();
      await deliverScreenshot(res, label);
    } catch (e) {
      toast(t('shotFailed', e.message), { error: true, ms: 5000 });
    }
  }

  async function deliverScreenshot(res, label) {
    let copied = false, copyErr = '';
    if (settings.screenshotCopy) {
      try { await copyImage(res.pngDataUrl); copied = true; } catch (e) { copyErr = e.message; }
    }
    const parts = [t('shotSize', label, res.width, res.height)];
    if (copied) parts.push(t('shotCopied'));
    if (res.downloaded) parts.push(t('shotSaved'));
    if (res.shrunk) parts.push(t('shotShrunk'));
    const buttons = [];
    if (!res.downloaded) buttons.push({ text: t('btnSave'), primary: true, onClick: () => sendMessage({ type: 'download', dataUrl: res.dataUrl, filename: res.filename }).then(() => toast(t('shotSavedToast'))) });
    if (settings.screenshotCopy && !copied) buttons.push({ text: t('btnCopy'), primary: res.downloaded, onClick: () => copyImage(res.pngDataUrl).then(() => toast(t('shotImageCopied'))).catch((e) => toast(t('shotCopyFailed', e.message), { error: true })) });
    toast(parts.join(t('listSep')) + (copyErr ? t('shotClickCopy') : ''), { image: res.pngDataUrl, buttons, ms: 7000 });
    sendMessage({ type: 'history-add', entry: { kind: 'screenshot', value: `${label} ${res.width}×${res.height}` } }).catch(() => {});
  }

  function screenshotElement(el) {
    const pad = Number(settings.screenshotPadding) || 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
    };
    const fixed = isFixed(el);
    const v = measure();
    const region = fixed ? v : { x: v.x + window.scrollX, y: v.y + window.scrollY, w: v.w, h: v.h };
    return runScreenshot(() => captureRegion(region, { label: 'element', fixed, refresh: measure }), t('shotElement'))
      .then(releaseUiLock);
  }

  function screenshotVisible() {
    const vp = viewport();
    return runScreenshot(() => captureRegion({ x: 0, y: 0, w: vp.w, h: vp.h }, { label: 'visible', fixed: true }), t('shotVisible'));
  }

  function screenshotFull() {
    const d = docSize();
    return runScreenshot(() => captureRegion({ x: 0, y: 0, w: d.w, h: d.h }, { label: 'fullpage' }), t('shotFull'));
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------
  function toast(text, opts) {
    opts = opts || {};
    mountHost();
    // NB: never name a local `t` in this file – it would shadow the translate helper t().
    const box = document.createElement('div');
    box.className = 'toast' + (opts.error ? ' err' : '');
    if (opts.image) {
      const img = document.createElement('img');
      img.src = opts.image;
      img.onerror = () => img.remove(); // page CSP may block data: images
      box.appendChild(img);
    }
    const col = document.createElement('div'); col.className = 'col';
    const msg = document.createElement('div'); msg.className = 't';
    if (opts.html) msg.innerHTML = text; else msg.textContent = text;
    msg.title = opts.html ? '' : text;
    col.appendChild(msg);
    if (opts.buttons && opts.buttons.length) {
      const btns = document.createElement('div'); btns.className = 'btns';
      opts.buttons.forEach((b) => {
        const btn = document.createElement('button');
        btn.textContent = b.text;
        if (b.primary) btn.className = 'primary';
        btn.addEventListener('click', (e) => { e.stopPropagation(); b.onClick(); box.remove(); });
        btns.appendChild(btn);
      });
      const close = document.createElement('button'); close.textContent = t('btnClose');
      close.addEventListener('click', () => box.remove());
      btns.appendChild(close);
      col.appendChild(btns);
    }
    box.appendChild(col);
    ui.toasts.appendChild(box);
    while (ui.toasts.children.length > 3) ui.toasts.firstChild.remove();
    let timer = setTimeout(() => box.remove(), opts.ms || 1800);
    box.addEventListener('mouseenter', () => clearTimeout(timer));
    box.addEventListener('mouseleave', () => { timer = setTimeout(() => box.remove(), 1500); });
  }

  // ---------------------------------------------------------------------------
  // Messages from the service worker
  // ---------------------------------------------------------------------------
  const onMessage = (msg, sender, sendResponse) => {
    if (msg.type === 'toggle-picker') state.active ? stop() : start();
    else if (msg.type === 'start-picker') start();
    else if (msg.type === 'screenshot') {
      if (state.busy) return sendResponse({ ok: false, error: t('errBusy') });
      if (msg.mode === 'full') screenshotFull(); else screenshotVisible();
    }
    sendResponse({ ok: true });
  };
  try { chrome.runtime.onMessage.addListener(onMessage); } catch (e) { /* test harness */ }

  // Lets a newer build tear this instance down (see top of file).
  window.__BS_DESTROY__ = function () {
    stop();
    host.remove();
    try { chrome.runtime.onMessage.removeListener(onMessage); } catch (e) {}
    try { chrome.storage.onChanged.removeListener(onStorageChanged); } catch (e) {}
  };

  // exposed for the local test harness only
  globalThis.__BS_PICKER__ = {
    start, stop, select, state, screenshotElement, screenshotVisible, screenshotFull, doCopy, applySettings, toast, runAct,
    // test-only view into the closed shadow root (content scripts' globals are invisible to the page)
    _shadow: shadow
  };
})();
