// Shared default settings. Classic script: loaded by the service worker (importScripts),
// the popup/options pages (<script>) and the injected content scripts.
(function (g) {
  g.BS_DEFAULTS = {
    // ---- General ----
    language: 'auto',          // auto | en | zh_CN (see src/shared/i18n.js)

    // ---- Selector generation ----
    // Attributes tried first, in priority order. Values that look auto-generated are skipped.
    preferredAttributes: [
      'data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa',
      'data-automation-id', 'data-e2e', 'data-component', 'data-id'
    ],
    // Classes / ids matching any of these regexes (one per line) are ignored.
    ignorePatterns: [
      '^(is|has)-',
      '^(active|selected|hover|focus|focused|open|opened|show|shown|visible|hidden|disabled|checked|expanded|collapsed|current|loading)$',
      '^ng-',
      '^js-'
    ],
    useClasses: true,
    allowNthChild: true,
    maxDepth: 6,

    // ---- Picker behaviour ----
    clickAction: 'css',        // css | xpath | jspath | screenshot | none
    exitAfterCopy: true,       // leave the picker after a click-copy
    showPanel: true,

    // ---- Screenshots ----
    screenshotPadding: 0,      // px around element screenshots
    screenshotFormat: 'png',   // png | jpeg
    jpegQuality: 92,
    screenshotCopy: true,      // copy image to clipboard
    screenshotDownload: false, // also save to Downloads
    hideFixedOnStitch: true    // hide sticky/fixed headers after the first tile
  };

  g.BS_loadSettings = function () {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(g.BS_DEFAULTS, (s) => resolve(s || { ...g.BS_DEFAULTS }));
      } catch (e) {
        resolve({ ...g.BS_DEFAULTS });
      }
    });
  };
})(globalThis);
