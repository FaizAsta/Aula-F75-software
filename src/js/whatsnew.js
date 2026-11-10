/*
 * "What's new" after an update. The text comes from RELEASE_NOTES.md, which ships inside the app, so it works offline and
 * shows the notes of the version that is really installed. Only the HEADER of each bullet is shown (the bold title at the
 * start of the line), never the description under it. Pure functions, so the main process and the tests share them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AulaWhatsNew = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /** [major, minor, patch] of "1.4.5" (a leading "v" and anything after a "-" are ignored). Missing parts are 0. */
  const parts = (v) =>
    String(v || '')
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
      .concat([0, 0, 0])
      .slice(0, 3);

  /** 1 when a is newer than b, -1 when older, 0 when the same. */
  function compare(a, b) {
    const x = parts(a);
    const y = parts(b);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
  }

  /** The header of one bullet: its bold title ("**The knob stays where you set it:** ..." gives the words in bold). */
  function header(line) {
    const text = line.replace(/^[-*+]\s+/, '').trim();
    const bold = /^\*\*(.+?)\*\*/.exec(text);
    let h = bold ? bold[1] : text.split(/(?<=[.:!?])\s/)[0];
    h = h
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*_]/g, '')
      .trim()
      .replace(/[:.\s]+$/, '');
    return h.length > 90 ? `${h.slice(0, 87).trimEnd()}...` : h;
  }

  /** Every version section of the notes, newest first as written: [{ version, items: [header, ...] }]. */
  function sections(md) {
    const text = String(md || '').replace(/<!--[\s\S]*?-->/g, '');
    const out = [];
    let cur = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const h2 = /^##\s+(.*)$/.exec(line);
      if (h2) {
        const v = /(\d+\.\d+(?:\.\d+)?)/.exec(h2[1]);
        cur = v ? { version: v[1], items: [] } : null;
        if (cur) out.push(cur);
        continue;
      }
      if (cur && /^[-*+]\s+\S/.test(line)) {
        const h = header(line);
        if (h) cur.items.push(h);
      }
    }
    return out;
  }

  /**
   * The sections to show after an update: every version newer than `from` up to and including `to`, newest first, with the
   * ones that have no bullets left out. When `from` is unknown (null) only `to` is shown.
   */
  function collect(md, from, to) {
    return sections(md)
      .filter((s) => (from ? compare(s.version, from) > 0 && compare(s.version, to) <= 0 : compare(s.version, to) === 0))
      .filter((s) => s.items.length)
      .sort((a, b) => compare(b.version, a.version));
  }

  /**
   * What to do at start-up. `prev` is the version that last ran (null if never recorded), `current` the running one, and
   * `hadData` whether the app already has saved data (so a null `prev` is an update from a version that did not record it,
   * not a first install).
   * Returns { show, from, record }: show the dialog, from which version, and whether to record `current` right now.
   */
  function decide(prev, current, hadData) {
    if (prev && compare(prev, current) === 0) return { show: false, from: null, record: false };
    if (!prev) return hadData ? { show: true, from: null, record: false } : { show: false, from: null, record: true };
    if (compare(current, prev) > 0) return { show: true, from: prev, record: false };
    return { show: false, from: null, record: true }; // an older version than the last one that ran: nothing to announce
  }

  return { compare, header, sections, collect, decide };
});
