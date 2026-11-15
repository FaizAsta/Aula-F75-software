/*
 * "Which UI do you want to use?": the question asked once, after the person presses Start. Pure functions, so the page and the
 * tests share them (the same pattern as whatsnew.js).
 *
 * Who is asked: everybody who has not answered yet. That is a first install, and also an update from a build that had no
 * such question. The answer is stored as `styleAsked: true` next to `style` in the saved settings (app.js owns the saving),
 * so it is asked exactly once per person, not once per version. Closing the window before answering does not count as an
 * answer: the question comes back on the next start.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AulaStylePick = factory();
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const STYLES = ['classic', 'glass'];
  const DEFAULT = 'classic';

  /** Has the person not answered yet? `prefs` is the saved settings object (or nothing at all). */
  const owed = (prefs) => !(prefs && prefs.styleAsked === true);

  /**
   * Which choice is selected when the question opens: the style already saved (somebody who switched Liquid glass on in
   * Settings before this question existed keeps it highlighted), otherwise Classic, the original look.
   */
  const initial = (prefs) => (prefs && prefs.style === 'glass' ? 'glass' : DEFAULT);

  /** What to save when the person answers. Anything that is not a known style counts as Classic. */
  const answer = (choice) => ({ style: STYLES.includes(choice) ? choice : DEFAULT, styleAsked: true });

  /** The choice next to `current` in `dir` (+1 or -1), wrapping round: for the arrow keys. */
  const step = (current, dir) => {
    const i = STYLES.indexOf(current);
    return STYLES[(((i < 0 ? 0 : i) + (dir < 0 ? -1 : 1)) % STYLES.length + STYLES.length) % STYLES.length];
  };

  return { STYLES, DEFAULT, owed, initial, answer, step };
});
