/*
 * The links behind the Support button: where people go for help or to talk to the author.
 *
 * This is the ONE place to edit. The page shows these in the Support menu (support.js), and the main process opens them
 * in the browser or the mail app (main.js). The page only ever sends an id, never an address, so it cannot make the
 * app open something that is not on this list.
 *
 * To add a link, add a line to LINKS. Only https: and mailto: addresses are used, and a line with an empty url is left
 * out of the menu, so the two lines at the bottom can stay here until there is an address to put in them.
 * Pure data and functions, so the page, the main process and the tests share them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AulaSupportLinks = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // id: a short word (it also picks the icon in the menu). label: the name shown. hint: one line under it.
  const LINKS = [
    { id: 'discord', label: 'Discord', hint: 'Join the server, ask for help or share an idea', url: 'https://discord.gg/BdeQygyRwN' },
    { id: 'github', label: 'GitHub', hint: 'Source code and the latest releases', url: 'https://github.com/FaizAsta/Aula-F75-software' },
    { id: 'instagram', label: 'Instagram', hint: 'Follow along', url: '' },
    { id: 'email', label: 'Email', hint: 'Write to the author', url: '' }, // e.g. 'mailto:name@example.com'
  ];

  const SAFE = /^(https:\/\/[^\s]+|mailto:[^\s]+)$/i;

  /** The entries that can really be opened: a known shape, an https: or mailto: address, and no id twice. */
  function usable(links) {
    const seen = new Set();
    const out = [];
    for (const l of links || []) {
      if (!l || typeof l.id !== 'string' || !l.id || seen.has(l.id)) continue;
      if (typeof l.label !== 'string' || !l.label) continue;
      if (typeof l.url !== 'string' || !SAFE.test(l.url.trim())) continue;
      seen.add(l.id);
      out.push({ id: l.id, label: l.label, hint: typeof l.hint === 'string' ? l.hint : '', url: l.url.trim() });
    }
    return out;
  }

  const list = () => usable(LINKS);
  const find = (id) => list().find((l) => l.id === id) || null;

  return { list, find, usable };
});
