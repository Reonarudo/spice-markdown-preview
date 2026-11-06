// The view toggle's preview script (docs/source-toggle-spec.md section 8, amended by
// docs/bom-view-spec.md section 9). Loaded once per page load into VS Code's Markdown preview
// through `markdown.previewScripts`; it flips a claimed fence between its rendering, its source
// view and its BOM view, remembers which fences are flipped to which view, and puts them back
// after every re-render, refresh and reopen.
//
// Two layers: a pure core with no DOM access, exported for the unit tests when `module` exists,
// and the DOM wiring in `boot()`, which runs only inside a document.
(function () {
  'use strict';
  const BASE = 'spice';

  // A flipped fence is an entry { key, ordinal, index, view }: its fence key (`data-fence-key`),
  // its ordinal among the fences sharing that key, its index among all of this extension's fences,
  // in document order, and the view it is flipped to, `source` or `bom`. `keys` below is the
  // document's fence keys in that order; `views` a Map from position to view.

  /** The positions to flip, as a Map position -> view: the key's group at `ordinal` if the key is present, else `index`. */
  function match(entries, keys) {
    const groups = new Map();
    keys.forEach((key, position) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(position);
    });
    const views = new Map();
    for (const entry of entries) {
      const group = groups.get(entry.key);
      const target = group ? group[entry.ordinal] : (entry.index < keys.length ? entry.index : undefined);
      if (target !== undefined) views.set(target, entry.view);
    }
    return views;
  }

  /** The entries describing the flipped positions, recomputed from the document so they only ever name real fences. */
  function collect(keys, views) {
    const seen = new Map();
    const entries = [];
    keys.forEach((key, index) => {
      const ordinal = seen.get(key) || 0;
      seen.set(key, ordinal + 1);
      if (views.has(index)) entries.push({ key, ordinal, index, view: views.get(index) });
    });
    return entries;
  }

  function storageKey(base, uri) {
    return `${base}-markdown-preview.view-toggle:${uri}`;
  }

  /**
   * The stored entries, or none when storage is unavailable or holds something else. Normalised: a
   * 0.4.0 entry without a view is a source flip; anything else malformed is dropped.
   */
  function load(storage, key) {
    try {
      const parsed = JSON.parse(storage.getItem(key) || '[]');
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry) => {
        if (!entry || typeof entry.key !== 'string' || typeof entry.ordinal !== 'number' || typeof entry.index !== 'number') return [];
        const view = entry.view === undefined ? 'source' : entry.view;
        return view === 'source' || view === 'bom' ? [{ key: entry.key, ordinal: entry.ordinal, index: entry.index, view }] : [];
      });
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
    const BOM = `.${BASE}-bom-button`;
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
    /** `view` is 'source', 'bom' or undefined (the rendering); each button is pressed only in its own view. */
    function setView(fence, view) {
      if (view) fence.setAttribute('data-view', view);
      else fence.removeAttribute('data-view');
      const toggle = fence.querySelector(TOGGLE);
      if (toggle) toggle.setAttribute('aria-pressed', view === 'source' ? 'true' : 'false');
      const bom = fence.querySelector(BOM);
      if (bom) bom.setAttribute('aria-pressed', view === 'bom' ? 'true' : 'false');
    }
    function viewsOf(all) {
      const views = new Map();
      all.forEach((fence, index) => {
        const view = fence.getAttribute('data-view');
        if (view === 'source' || view === 'bom') views.set(index, view);
      });
      return views;
    }
    /** Re-decorate the document from the remembered entries, then remember what is really flipped. */
    function apply() {
      const all = fences();
      const views = match(entries, keysOf(all));
      all.forEach((fence, index) => setView(fence, views.get(index)));
      remember(all);
    }
    function remember(all) {
      entries = collect(keysOf(all), viewsOf(all));
      save(storage, key, entries);
    }

    // Each button leads to its view from anywhere, and back to the rendering from its own view.
    document.addEventListener('click', (event) => {
      const toggle = event.target.closest(TOGGLE);
      const bom = event.target.closest(BOM);
      if (!toggle && !bom) return;
      const fence = (toggle || bom).closest(WRAPPER);
      if (!fence) return;
      const current = fence.getAttribute('data-view');
      if (toggle) setView(fence, current === 'source' ? undefined : 'source');
      else setView(fence, current === 'bom' ? undefined : 'bom');
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
