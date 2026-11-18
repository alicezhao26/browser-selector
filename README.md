# Browser Selector

English | [简体中文](README.zh-CN.md)

A Chrome extension (Manifest V3) for grabbing page elements with one shortcut and the mouse: copy the **best CSS selector**, XPath, JS path, text or HTML, and take **element / visible / full-page screenshots**.

## Install (developer mode)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
3. Pin the extension. If a shortcut is taken by another extension, set it at `chrome://extensions/shortcuts`.

## Shortcuts

Global shortcuts (work on any page):

| | |
|---|---|
| <kbd>Alt+C</kbd> | Start / stop the element picker |
| <kbd>Alt+S</kbd> | Screenshot the visible area |
| <kbd>Alt+A</kbd> | Screenshot the full page |

Inside the picker:

| | |
|---|---|
| <kbd>Click</kbd> | Copy the best CSS selector |
| <kbd>S</kbd> | Screenshot the highlighted element |
| <kbd>Right-click</kbd> | Menu with every action: XPath, JS path, text, HTML, visible / full-page screenshots, parent / child |
| <kbd>Esc</kbd> | Close the menu / exit |

The info panel also has **Copy CSS · Screenshot · Parent ↑ · More…** buttons. **Parent ↑** keeps the parent selected (shown as *locked*) while you move the mouse back, and the lock is released after the next copy or screenshot.

You can change any global shortcut at `chrome://extensions/shortcuts`.

<details>
<summary>Optional single-key shortcuts inside the picker (click <b>?</b> in the panel to show them)</summary>

| | |
|---|---|
| <kbd>C</kbd> / <kbd>Ctrl+C</kbd> / <kbd>Enter</kbd> | Copy best CSS selector |
| <kbd>1</kbd>–<kbd>4</kbd> | Copy best / alternative selectors |
| <kbd>X</kbd> | Copy XPath |
| <kbd>J</kbd> | Copy JS path (`document.querySelector(...).shadowRoot.querySelector(...)`) |
| <kbd>T</kbd> / <kbd>O</kbd> | Copy text / outerHTML |
| <kbd>V</kbd> / <kbd>F</kbd> | Screenshot visible area / full page |
| <kbd>↑</kbd> <kbd>↓</kbd> | Select parent / back to child |
| <kbd>←</kbd> <kbd>→</kbd> | Previous / next sibling |
| <kbd>Space</kbd> | Lock the selection so mouse moves are ignored |
| <kbd>H</kbd> | Show / hide this list |

</details>

> **Upgrading from an earlier version:** Chrome only applies default shortcuts on a fresh install and keeps the ones you already had. To get Alt+C / Alt+S / Alt+A, set them at `chrome://extensions/shortcuts`, or remove the extension and load it unpacked again.

Screenshots are copied to the clipboard (PNG) and can be saved to `Downloads/browser-selector/` from the toast, or automatically (see Settings).

## Languages

The extension is available in **English** and **简体中文 (Simplified Chinese)**. Pick a language from the drop-down in the popup or on the Settings page. **Auto** follows the browser language, and any Chinese variant falls back to Simplified. The change applies right away to the popup, the Settings page and the in-page picker.

There are two layers:

- `src/shared/i18n.js` + `src/shared/locales/<code>.js` hold every UI string. A custom layer is used instead of `chrome.i18n` so the language can be changed in Settings.
- `_locales/<code>/messages.json` holds the extension name, description and shortcut names. These are read by Chrome itself and always follow the browser language.

### Adding a language (e.g. Japanese)

1. Copy `src/shared/locales/en.js` to `ja.js`, change `.en =` to `.ja =`, and translate the values. Keep every `{0}` placeholder.
2. Add `{ code: 'ja', name: '日本語' }` to `BS_LANGUAGES` in `src/shared/i18n.js`.
3. Load the file wherever the others load:
   - `importScripts` and `CONTENT_FILES` in `src/background.js`
   - the `<script>` tags in `popup.html` and `options.html`
   - `test/playground.html`
4. Copy `_locales/en/messages.json` to `_locales/ja/messages.json` and translate it.
5. Open the playground. The i18n checks flag missing or extra keys, placeholder mismatches, and keys used in code but not defined.

## How the "best selector" is chosen

`src/content/selector.js` scores candidate selectors for the target and its ancestors, then runs a best-first search for the cheapest chain that matches **only** the target:

1. Test attributes (`data-testid`, `data-test`, `data-cy`, `data-qa`, …; configurable)
2. Stable `#id`
3. `name`, `for`, `aria-label`, `alt`, `placeholder`, `title`, `href`, `role`, `type`
4. Stable class names (Tailwind utilities and generic names score worse)
5. Tag names (semantic and custom-element tags score better)
6. `:nth-of-type()` as a last resort, then a fully anchored path

Values that look generated are skipped: React `useId` (`:r3:`), CSS-module hashes (`Button_root__a1B2c`), styled-components / emotion (`sc-…`, `css-…`), UUIDs, long numbers (`ember1234`), and state classes (`active`, `is-open`, …). Up to 3 unique alternatives are offered. Elements inside open shadow roots get a selector for their own root plus a host chain, and the JS path pierces the shadow roots.

## Project layout

```
manifest.json
src/background.js          service worker: commands, injection, throttled capture, stitching, downloads, history
src/content/selector.js    selector / XPath engine (no dependencies)
src/content/picker.js      overlay, info panel, keyboard handling, screenshot driver
src/shared/defaults.js     default settings shared by every context
src/shared/i18n.js         translation helper (BS_t, BS_applyI18n, language detection)
src/shared/locales/        UI strings: en.js, zh_CN.js
_locales/                  Chrome-managed strings: extension name, description, shortcut names
src/popup/                 toolbar popup (actions + recent copies)
src/options/               settings page
icons/                     generated PNG icons
test/playground.html       fixture page + engine tests (runs the real content scripts with a chrome.* stub)
test/serve.ps1             tiny static server for the playground
```

## Permissions

`activeTab` + `scripting` inject the picker only into the tab where you press a shortcut or click the popup, so there's no `<all_urls>` host permission. `downloads` saves screenshots, `storage` holds settings and history, and `clipboardWrite` lets the extension copy.

## Testing

```
powershell -ExecutionPolicy Bypass -File test/serve.ps1
```
Then open http://localhost:8765/test/playground.html. The i18n box checks that the translations are complete. The engine results box checks that every fixture element gets a unique CSS selector and XPath, checks the expected best picks, and confirms generated tokens are skipped. To try the picker UI there, run `__BS_PICKER__.start()` in the DevTools console.

## Known limitations

- Chrome pages (`chrome://`, the Web Store, the PDF viewer) can't be scripted. On those pages the screenshot shortcuts save a visible-area capture.
- Iframes: the picker runs in the top frame only.
- Full-page capture scrolls the window. Apps that scroll an inner container (`height: 100vh; overflow: auto`) only capture the viewport.
- `captureVisibleTab` is limited to about 2 calls per second, so a full page takes about 0.6 s per screen.
