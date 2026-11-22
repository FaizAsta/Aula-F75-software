'use strict';

/*
 * Video backgrounds, the file side (the main process uses this; the page never sees a path).
 *
 * A picked video is copied into the app's own data folder under a name made by src/js/background.js ("bg-<time>.mp4"), so the
 * background keeps working if the original is moved or deleted, and uninstalling removes it with the rest of the app's data.
 * Only that name is remembered by the page. Only files whose name passes isVideoName() are ever created or deleted here, so
 * nothing else in the folder can be touched.
 */

const fs = require('node:fs');
const path = require('node:path');
const bg = require('./src/js/background.js');

/** Copies the file at `srcPath` into `dir`. Resolves { ok: true, name } or { ok: false, error } with a message that can be shown as it is. */
async function importVideo(srcPath, dir, now = Date.now()) {
  let stat;
  try {
    stat = await fs.promises.stat(srcPath);
  } catch (_) {
    return { ok: false, error: 'Could not open that file.' };
  }
  const check = bg.checkVideoFile(path.basename(String(srcPath)), stat.size, stat.isFile());
  if (!check.ok) return check;
  try {
    await fs.promises.mkdir(dir, { recursive: true });
  } catch (_) {
    return { ok: false, error: 'Could not copy that file. Is there enough free space?' };
  }
  // A name that is already taken (two copies in the same millisecond) is never overwritten or deleted: the next free one is used.
  for (let i = 0; i < 5; i++) {
    const name = bg.newVideoName(check.ext, now + i);
    const dest = path.join(dir, name);
    try {
      await fs.promises.copyFile(srcPath, dest, fs.constants.COPYFILE_EXCL);
      return { ok: true, name };
    } catch (err) {
      if (err && err.code === 'EEXIST') continue;
      await fs.promises.rm(dest, { force: true }).catch(() => {}); // our own half-written copy: never leave it behind
      break;
    }
  }
  return { ok: false, error: 'Could not copy that file. Is there enough free space?' };
}

/**
 * Deletes every kept video in `dir` except `keep` (pass '' to delete them all). Best effort: Windows will not delete a file that is
 * still playing, and that is fine, because this runs again at the next start. Resolves the names it deleted.
 */
async function tidy(dir, keep = '') {
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch (_) {
    return [];
  }
  const gone = [];
  for (const n of names) {
    if (!bg.isVideoName(n) || n === keep) continue;
    try {
      await fs.promises.rm(path.join(dir, n), { force: true });
      gone.push(n);
    } catch (_) {
      /* in use right now: it goes the next time */
    }
  }
  return gone;
}

module.exports = { importVideo, tidy };
