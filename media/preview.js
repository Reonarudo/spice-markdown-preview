// The view toggle's preview script (docs/source-toggle-spec.md section 8). Loaded once per page
// load into VS Code's Markdown preview through `markdown.previewScripts`; it flips a claimed fence
// between its rendering and its source view, remembers which fences are flipped, and puts them
// back after every re-render, refresh and reopen.
//
// Two layers: a pure core with no DOM access, exported for the unit tests when `module` exists,
// and the DOM wiring in `boot()`, which runs only inside a document.
(function () {
  'use strict';
  const BASE = 'spice';

  // A flipped fence is an entry { key, ordinal, index }: its fence key (`data-fence-key`), its
  // ordinal among the fences sharing that key, and its index among all of this extension's
  // fences, in document order. `keys` below is the document's fence keys in that order.

  /** The positions to flip: the key's group at `ordinal` if the key is present, else `index`. */
  function match(entries, keys) {
    const groups = new Map();
    keys.forEach((key, position) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(position);
    });
    const flipped = new Set();
    for (const entry of entries) {
      const group = groups.get(entry.key);
      const target = group ? group[entry.ordinal] : (entry.index < keys.length ? entry.index : undefined);
      if (target !== undefined) flipped.add(target);
    }
    return [...flipped].sort((a, b) => a - b);
  }

  /** The entries describing the flipped positions, recomputed from the document so they only ever name real fences. */
  function collect(keys, flipped) {
    const set = new Set(flipped);
    const seen = new Map();
    const entries = [];
    keys.forEach((key, index) => {
      const ordinal = seen.get(key) || 0;
      seen.set(key, ordinal + 1);
      if (set.has(index)) entries.push({ key, ordinal, index });
    });
    return entries;
  }

  function storageKey(base, uri) {
    return `${base}-markdown-preview.view-toggle:${uri}`;
  }

  /** The stored entries, or none when storage is unavailable or holds something else. */
  function load(storage, key) {
    try {
      const parsed = JSON.parse(storage.getItem(key) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  /** Mirror the entries to storage; the key is removed when nothing is flipped. A storage that throws is memory-only. */
  function save(storage, key, entries) {
    try {
      if (entries.length === 0) storage.removeItem(key);
      else storage.setItem(key, JSON.stringify(entries));
    } catch (_) {
      // Memory-only: the flip still survives patch updates, not a reload.
    }
  }

  /** The DOM wiring: every call into the core passes the document's keys and `localStorage`. */
  function boot() {
    const WRAPPER = `.${BASE}-fence`;
    const TOGGLE = `.${BASE}-toggle`;
    const storage = storageOrNone();
    const key = storageKey(BASE, documentUri());
    let entries = load(storage, key);

    /** Reading `window.localStorage` itself throws when storage is disabled; `load`/`save` then degrade. */
    function storageOrNone() {
      try {
        return window.localStorage;
      } catch (_) {
        return null;
      }
    }
    function documentUri() {
      try {
        const meta = document.getElementById('vscode-markdown-preview-data');
        return JSON.parse(meta.dataset.settings).source;
      } catch (_) {
        return location.href;
      }
    }
    function fences() {
      return [...document.querySelectorAll(WRAPPER)];
    }
    function keysOf(all) {
      return all.map((fence) => fence.getAttribute('data-fence-key') || '');
    }
    function setView(fence, source) {
      if (source) fence.setAttribute('data-view', 'source');
      else fence.removeAttribute('data-view');
      const button = fence.querySelector(TOGGLE);
      if (button) button.setAttribute('aria-pressed', source ? 'true' : 'false');
    }
    function flippedPositions(all) {
      return all.flatMap((fence, index) => (fence.getAttribute('data-view') === 'source' ? [index] : []));
    }
    /** Re-decorate the document from the remembered entries, then remember what is really flipped. */
    function apply() {
      const all = fences();
      const flipped = new Set(match(entries, keysOf(all)));
      all.forEach((fence, index) => setView(fence, flipped.has(index)));
      remember(all);
    }
    function remember(all) {
      entries = collect(keysOf(all), flippedPositions(all));
      save(storage, key, entries);
    }

    document.addEventListener('click', (event) => {
      const button = event.target.closest(TOGGLE);
      if (!button) return;
      const fence = button.closest(WRAPPER);
      if (!fence) return;
      setView(fence, fence.getAttribute('data-view') !== 'source');
      remember(fences());
    });

    // Document edits patch the DOM in place and strip script-set attributes, so decorate again.
    window.addEventListener('vscode.markdown.updateContent', apply);

    // The script may start before the preview body exists.
    if (document.querySelector('.markdown-body')) {
      apply();
    } else {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.markdown-body')) return;
        observer.disconnect();
        apply();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (typeof document !== 'undefined') boot();
  if (typeof module !== 'undefined') module.exports = { match, collect, storageKey, load, save };
})();
