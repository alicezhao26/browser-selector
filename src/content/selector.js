/* Browser Selector – selector engine
 * Generates the shortest *robust* unique CSS selector for an element, plus XPath and JS path.
 *
 * Strategy
 *  1. For the target and each ancestor (up to maxDepth) build candidate simple selectors with a
 *     penalty: test ids < stable #id < name/aria/for/alt/... < stable classes < tag < :nth-of-type.
 *     Values that look auto-generated (hashes, React useId, UUIDs, CSS-module suffixes, long
 *     numbers) are skipped, as are state classes (active, open, is-*) and user ignore patterns.
 *  2. Best-first search over chains "ancestor ... target" (score = sum of penalties + 1 per level)
 *     and return the cheapest chains that match exactly the target in its root (document or
 *     shadow root).
 *  3. Fallback: an anchored :nth-of-type path, which is always unique.
 */
(function (g) {
  // No "already loaded" guard: a re-injection after an extension reload must replace the old engine.
  let cfg = Object.assign({}, g.BS_DEFAULTS || {});
  let ignoreRes = compilePatterns(cfg.ignorePatterns);

  function configure(settings) {
    cfg = Object.assign({}, g.BS_DEFAULTS || {}, settings || {});
    ignoreRes = compilePatterns(cfg.ignorePatterns);
  }

  function compilePatterns(list) {
    const out = [];
    (list || []).forEach((p) => {
      if (!p || !String(p).trim()) return;
      try { out.push(new RegExp(String(p).trim())); } catch (e) { /* bad user regex */ }
    });
    return out;
  }

  const esc = (s) => CSS.escape(s);
  const escAttr = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\a ');

  const SEMANTIC = new Set([
    'main', 'nav', 'header', 'footer', 'aside', 'article', 'section', 'form', 'h1', 'h2', 'h3', 'h4',
    'button', 'table', 'thead', 'tbody', 'tfoot', 'ul', 'ol', 'dl', 'label', 'input', 'select',
    'textarea', 'dialog', 'figure', 'figcaption', 'video', 'audio', 'iframe', 'svg', 'img', 'canvas',
    'picture', 'summary', 'details', 'fieldset', 'legend', 'blockquote', 'pre', 'code'
  ]);
  const UTILITY = /^-?(m|p|[mp][trblxy]|w|h|min-[wh]|max-[wh]|size|gap|gap-[xy]|space-[xy]|text|bg|border|border-[trblxy]|rounded|shadow|ring|flex|grid|grid-cols|col|col-span|row|row-span|items|justify|content|self|place|font|leading|tracking|z|top|left|right|bottom|inset|inset-[xy]|opacity|overflow|cursor|transition|duration|ease|delay|translate-[xy]|scale|rotate|order|basis|grow|shrink|fill|stroke|outline|select|pointer-events|whitespace|break|truncate|line-clamp|aspect|object|d|float|clear|align|sr-only|not-sr-only)(-|$)/;
  const GENERIC = new Set([
    'flex', 'grid', 'block', 'inline', 'inline-block', 'hidden', 'relative', 'absolute', 'fixed', 'sticky',
    'container', 'row', 'col', 'wrapper', 'inner', 'outer', 'content', 'clearfix', 'pull-left', 'pull-right',
    'left', 'right', 'center', 'text-center', 'small', 'large', 'item'
  ]);

  // ---------------------------------------------------------------------------
  // Heuristics
  // ---------------------------------------------------------------------------
  function looksGenerated(v) {
    if (!v) return true;
    v = String(v);
    if (v.length > 64) return true;
    if (/^\d+$/.test(v)) return true;                                    // pure numeric ids
    if (/(^|[-_:])r[0-9a-z]{1,4}:|^:[a-z0-9]+:$|«r[0-9a-z]+»/i.test(v)) return true; // React useId ":r1:"
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(v)) return true;    // UUID
    if (/\d{4,}/.test(v)) return true;                                   // long numbers / timestamps
    if (/^(css|sc|jsx|svelte|astro|emotion|tw|styled)-[a-z0-9]{4,}$/i.test(v)) return true; // CSS-in-JS
    if (/^(ember|ext-gen|yui_|gwt-uid-|mui-|radix-|headlessui-)[-_]?\S*\d/i.test(v)) return true;
    if (/__[a-z0-9_-]{4,}$/i.test(v) && /\d/.test(v.split('__').pop())) return true; // CSS modules hash
    if (/^_[a-z0-9]{4,}$/i.test(v) && /\d/.test(v)) return true;
    if (/^[a-z0-9]{5,}$/i.test(v) && /\d[a-z]+\d|[a-z]\d+[a-z]/i.test(v) && /\d/.test(v)) return true; // x7k2p
    if (/^[a-zA-Z0-9]{6,}$/.test(v) && /\d/.test(v) && /[a-z]/.test(v) && /[A-Z]/.test(v)) return true; // aB3dE9
    const digits = (v.match(/\d/g) || []).length;
    if (v.length > 3 && digits / v.length > 0.3) return true;
    return false;
  }

  function ignored(v) {
    return ignoreRes.some((re) => re.test(v));
  }

  function classPenalty(c) {
    let p = 3;
    if (/[:\[\]\/!.%@#]/.test(c)) p += 3;      // tailwind variants / arbitrary values
    if (UTILITY.test(c)) p += 2;
    if (GENERIC.has(c)) p += 2;
    if (c.length <= 2) p += 2;
    return p;
  }

  function tagOf(el) {
    return el.localName || el.nodeName.toLowerCase();
  }

  function nthOfType(el) {
    let n = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
      if (s.localName === el.localName) n++;
    }
    return n;
  }

  function hasSameTypeSiblings(el) {
    const p = el.parentElement || el.parentNode;
    if (!p || !p.children) return false;
    let n = 0;
    for (const c of p.children) if (c.localName === el.localName && ++n > 1) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Candidates for one element
  // ---------------------------------------------------------------------------
  const GENERIC_ATTRS = [
    // [attr, penalty, prefixTag, onlyTags]
    ['name', 2, true],
    ['for', 3, true, ['label']],
    ['aria-label', 3, true],
    ['alt', 3.5, true, ['img', 'area', 'input']],
    ['placeholder', 3.5, true],
    ['title', 4, true],
    ['href', 4.5, true, ['a', 'link', 'area']],
    ['role', 5, true],
    ['type', 6, true, ['input', 'button']],
    ['aria-controls', 6, true]
  ];

  function candidatesFor(el, isTarget) {
    const tag = tagOf(el);
    const etag = esc(tag);
    const out = [];
    const add = (sel, p) => out.push({ sel, p });

    if (el.id && !looksGenerated(el.id) && !ignored(el.id)) add('#' + esc(el.id), 1);

    (cfg.preferredAttributes || []).forEach((a, i) => {
      const v = el.getAttribute && el.getAttribute(a);
      if (v == null || v === '' || v.length > 80) return;
      add(`[${a}="${escAttr(v)}"]`, (looksGenerated(v) ? 4 : 0.8) + i * 0.05);
    });

    GENERIC_ATTRS.forEach(([a, p, prefix, only]) => {
      if (only && only.indexOf(tag) === -1) return;
      const v = el.getAttribute && el.getAttribute(a);
      if (v == null || v === '' || v.length > 80) return;
      if (a === 'href' && (/^(javascript:|#$|data:)/i.test(v) || /[?&](utm_|sid=|token=|session)/i.test(v))) return;
      if (a !== 'href' && a !== 'title' && a !== 'aria-label' && a !== 'placeholder' && a !== 'alt' && looksGenerated(v)) return;
      if ((a === 'aria-controls' || a === 'for') && looksGenerated(v)) return;
      add(`${prefix ? etag : ''}[${a}="${escAttr(v)}"]`, p);
    });

    if (cfg.useClasses !== false && el.classList && el.classList.length) {
      const classes = Array.from(new Set(el.classList))
        .filter((c) => c && !looksGenerated(c) && !ignored(c))
        .map((c) => ({ c, p: classPenalty(c) }))
        .sort((a, b) => a.p - b.p)
        .slice(0, 4);
      classes.forEach(({ c, p }) => {
        add('.' + esc(c), p);
        add(etag + '.' + esc(c), p + 0.5);
      });
      for (let i = 0; i < Math.min(3, classes.length); i++) {
        for (let j = i + 1; j < Math.min(3, classes.length); j++) {
          add('.' + esc(classes[i].c) + '.' + esc(classes[j].c), classes[i].p + classes[j].p - 1);
        }
      }
    }

    const tagP = tag.indexOf('-') > 0 ? 2.5 : SEMANTIC.has(tag) ? 4 : 7;
    if (tag !== 'html') add(etag, tagP);

    if (cfg.allowNthChild !== false && hasSameTypeSiblings(el)) {
      add(`${etag}:nth-of-type(${nthOfType(el)})`, tagP + 3);
      // combine the best class/attr candidate with position: e.g. li.item:nth-of-type(3)
      const best = out.find((o) => o.sel.indexOf(':nth') === -1 && /^[a-z0-9-]*\./i.test(o.sel));
      if (best && isTarget) {
        const base = best.sel.startsWith(etag) ? best.sel : etag + best.sel;
        add(`${base}:nth-of-type(${nthOfType(el)})`, best.p + 3);
      }
    }

    // dedupe + sort
    const seen = new Set();
    return out
      .sort((a, b) => a.p - b.p)
      .filter((o) => (seen.has(o.sel) ? false : (seen.add(o.sel), true)))
      .slice(0, isTarget ? 10 : 6);
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------
  class Heap {
    constructor() { this.a = []; }
    get size() { return this.a.length; }
    push(x) {
      const a = this.a; a.push(x);
      let i = a.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].score <= a[i].score) break;
        [a[p], a[i]] = [a[i], a[p]]; i = p;
      }
    }
    pop() {
      const a = this.a; const top = a[0]; const last = a.pop();
      if (a.length) {
        a[0] = last; let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1; let m = i;
          if (l < a.length && a[l].score < a[m].score) m = l;
          if (r < a.length && a[r].score < a[m].score) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]]; i = m;
        }
      }
      return top;
    }
  }

  function buildChain(parts) {
    let s = parts[0].sel;
    for (let k = 1; k < parts.length; k++) {
      s += parts[k].i === parts[k - 1].i - 1 ? ' > ' : ' ';
      s += parts[k].sel;
    }
    return s;
  }

  function countMatches(scope, sel, el) {
    try {
      const r = scope.querySelectorAll(sel);
      return { n: r.length, unique: r.length === 1 && r[0] === el };
    } catch (e) {
      return { n: -1, unique: false };
    }
  }

  /** Best unique selector(s) for `el` inside its own root (document or shadow root). */
  function localCss(el, opts) {
    opts = opts || {};
    const budget = opts.budget || 1200;
    const want = opts.alternatives != null ? opts.alternatives + 1 : 4;
    const scope = el.getRootNode();

    const path = [el];
    for (let cur = el.parentElement; cur && path.length <= (cfg.maxDepth || 6); cur = cur.parentElement) {
      if (cur.localName === 'html') break;
      path.push(cur);
    }
    const cands = path.map((e, i) => candidatesFor(e, i === 0));

    const heap = new Heap();
    cands[0].forEach((c) => heap.push({ score: c.p, parts: [{ i: 0, sel: c.sel }] }));
    const results = [];
    const seen = new Set();
    let checks = 0;
    let extra = Infinity;

    while (heap.size && checks < budget && results.length < want && extra > 0) {
      const st = heap.pop();
      const sel = buildChain(st.parts);
      if (seen.has(sel)) continue;
      seen.add(sel);
      checks++;
      if (results.length) extra--;
      const m = countMatches(scope, sel, el);
      if (m.unique) {
        // skip near-duplicates such as "button.btn" when ".btn" is already a result
        const key = sel.replace(/(^|[\s>]+)[a-z][a-z0-9-]*(?=[.#\[:])/gi, '$1');
        if (results.some((r) => r.key === key)) continue;
        results.push({ selector: sel, score: +st.score.toFixed(2), key });
        if (results.length === 1) extra = 250; // limited extra effort for alternatives
        continue;
      }
      if (m.n < 1) continue;
      if (st.parts.length >= 4) continue; // keep selectors readable
      const top = st.parts[0].i;
      for (let j = top + 1; j <= Math.min(top + 3, path.length - 1); j++) {
        for (const c of cands[j]) {
          heap.push({ score: st.score + c.p + 1, parts: [{ i: j, sel: c.sel }].concat(st.parts) });
        }
      }
    }

    if (!results.length) {
      results.push({ selector: anchoredPath(el, scope), score: 99, fallback: true });
    }
    return { results, checks };
  }

  function anchoredPath(el, scope) {
    const steps = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      const tag = esc(tagOf(cur));
      if (cur.id && !looksGenerated(cur.id) && countMatches(scope, '#' + esc(cur.id), cur).unique) {
        steps.unshift('#' + esc(cur.id));
        return steps.join(' > ');
      }
      if (tagOf(cur) === 'html' || tagOf(cur) === 'body') { steps.unshift(tagOf(cur)); if (tagOf(cur) === 'html') break; continue; }
      steps.unshift(hasSameTypeSiblings(cur) ? `${tag}:nth-of-type(${nthOfType(cur)})` : tag);
    }
    return steps.join(' > ');
  }

  /** Chain of shadow hosts (outermost first) that enclose `el`. */
  function shadowHosts(el) {
    const hosts = [];
    let root = el.getRootNode();
    while (root && root.host) {
      hosts.unshift(root.host);
      root = root.host.getRootNode();
    }
    return hosts;
  }

  /**
   * Main entry: returns
   *  { selector, alternatives[], fallback, count, hostChain[], inShadow, checks }
   */
  function css(el, opts) {
    const { results, checks } = localCss(el, opts);
    const hosts = shadowHosts(el);
    const hostChain = hosts.map((h) => localCss(h, { budget: 400, alternatives: 0 }).results[0].selector);
    return {
      selector: results[0].selector,
      alternatives: results.slice(1).map((r) => r.selector),
      fallback: !!results[0].fallback,
      score: results[0].score,
      hostChain,
      inShadow: hosts.length > 0,
      checks
    };
  }

  function jsPath(el, cssResult) {
    const r = cssResult || css(el);
    const chain = r.hostChain.concat([r.selector]);
    return 'document.querySelector(' + JSON.stringify(chain[0]) + ')' +
      chain.slice(1).map((s) => '.shadowRoot.querySelector(' + JSON.stringify(s) + ')').join('');
  }

  // ---------------------------------------------------------------------------
  // XPath
  // ---------------------------------------------------------------------------
  function xpathLiteral(s) {
    if (s.indexOf('"') === -1) return `"${s}"`;
    if (s.indexOf("'") === -1) return `'${s}'`;
    return 'concat(' + s.split('"').map((p) => `"${p}"`).join(`, '"', `) + ')';
  }

  function xpathTag(el) {
    const tag = tagOf(el);
    return el.namespaceURI && el.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? `*[local-name()=${xpathLiteral(tag)}]` : tag;
  }

  function xpathCount(doc, xp, el) {
    try {
      const r = doc.evaluate(xp, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      return r.snapshotLength === 1 && r.snapshotItem(0) === el;
    } catch (e) { return false; }
  }

  function ownText(el) {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.length > 0 && t.length <= 50 ? t : '';
  }

  function xpath(el) {
    if (shadowHosts(el).length) return null; // XPath cannot pierce shadow DOM
    const doc = el.ownerDocument;
    const tag = xpathTag(el);
    const tries = [];
    if (el.id && !looksGenerated(el.id)) tries.push(`//${tag}[@id=${xpathLiteral(el.id)}]`);
    (cfg.preferredAttributes || []).forEach((a) => {
      const v = el.getAttribute(a);
      if (v) tries.push(`//${tag}[@${a}=${xpathLiteral(v)}]`);
    });
    ['name', 'aria-label', 'placeholder', 'title', 'alt'].forEach((a) => {
      const v = el.getAttribute(a);
      if (v && v.length <= 80) tries.push(`//${tag}[@${a}=${xpathLiteral(v)}]`);
    });
    const text = ownText(el);
    if (text && el.children.length <= 2) tries.push(`//${tag}[normalize-space()=${xpathLiteral(text)}]`);
    for (const xp of tries) if (xpathCount(doc, xp, el)) return xp;

    // positional path anchored on the closest ancestor with a usable id
    const steps = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      const t = xpathTag(cur);
      if (cur !== el && cur.id && !looksGenerated(cur.id)) {
        const anchor = `//${t}[@id=${xpathLiteral(cur.id)}]`;
        if (xpathCount(doc, anchor, cur)) { steps.unshift(anchor); return steps.join('/'); }
      }
      if (tagOf(cur) === 'html') { steps.unshift('/html'); break; }
      steps.unshift(hasSameTypeSiblings(cur) ? `${t}[${nthOfType(cur)}]` : t);
    }
    return steps.join('/');
  }

  // ---------------------------------------------------------------------------
  // Misc helpers for the UI
  // ---------------------------------------------------------------------------
  function describe(el) {
    let s = tagOf(el);
    if (el.id) s += '#' + el.id;
    const cls = el.classList ? Array.from(el.classList).slice(0, 3) : [];
    if (cls.length) s += '.' + cls.join('.');
    if (el.classList && el.classList.length > 3) s += '…';
    return s.length > 80 ? s.slice(0, 79) + '…' : s;
  }

  function count(el, selector) {
    try { return el.getRootNode().querySelectorAll(selector).length; } catch (e) { return -1; }
  }

  g.BS_Selector = { configure, css, jsPath, xpath, describe, count, looksGenerated };
})(globalThis);
