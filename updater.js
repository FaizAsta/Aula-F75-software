'use strict';

/*
 * Update check and download for the Windows app. Runs in the main process and has no Electron in it (fetch is passed in),
 * so the tests can drive it with a fake network.
 *
 * It asks GitHub for the repository's latest published release, compares the tag with the installed version, and can
 * download the installer from that release. Only github.com addresses are ever contacted for the download, the size is
 * checked, and so is the SHA-256 checksum when GitHub lists one for the file.
 *
 * Betas: a version like 1.5.3-beta.2 keeps its "-beta.2" (it is shown that way and compared that way: beta.2 is newer
 * than beta.1, and the final 1.5.3 is newer than any beta of it). A person running a stable version is never offered a
 * beta; a person running a beta is offered newer betas and the final release.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const NOTES_MAX = 6000;
const AGENT = 'aula-control-updater';

/** "owner/repo" from "owner/repo" or any github.com address of it. null when empty or still the OWNER/REPO placeholder. */
function parseRepo(value) {
  const s = String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '');
  const two = s.split('/').filter(Boolean).slice(0, 2).join('/');
  if (!/^[\w.-]+\/[\w.-]+$/.test(two) || /^owner\/repo$/i.test(two)) return null;
  return two;
}

/**
 * { nums: [major, minor, patch], pre: [...] } from "1.3.2", "v1.3.2" or "1.5.3-beta.2", else null. `pre` is the part after the
 * "-" split into words and numbers ("beta2", "beta.2" and "beta-2" all give ["beta", 2]), empty for a final release. A
 * "+build" ending is ignored.
 */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-_ ]+([0-9A-Za-z.\-_ ]+?))?(?:\+.*)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const pre = (m[4] || '')
    .split(/[.\-_ ]+|(?<=[A-Za-z])(?=\d)/)
    .filter(Boolean)
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x.toLowerCase()));
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre };
}

/** The version as shown in the app: "1.5.3" or "1.5.3-beta.2". */
function formatVersion(p) {
  return p.nums.join('.') + (p.pre.length ? `-${p.pre.join('.')}` : '');
}

/** -1, 0 or 1 for the pre-release parts: numbers before words, numbers by value, words by letters, shorter first. */
function comparePre(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    if (a[i] === b[i]) continue;
    const an = typeof a[i] === 'number';
    const bn = typeof b[i] === 'number';
    if (an !== bn) return an ? -1 : 1;
    return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a.nums[i] !== b.nums[i]) return a.nums[i] > b.nums[i];
  if (!a.pre.length || !b.pre.length) return !a.pre.length && b.pre.length > 0; // a final release beats its own betas
  return comparePre(a.pre, b.pre) > 0;
}

function parseUrl(u) {
  try {
    return new URL(String(u));
  } catch (_) {
    return null;
  }
}

/** True for an https address on GitHub's own download hosts. */
function validDownloadUrl(u) {
  const x = parseUrl(u);
  return !!x && x.protocol === 'https:' && DOWNLOAD_HOSTS.includes(x.hostname.toLowerCase());
}

function releasePage(u, repo) {
  const x = parseUrl(u);
  const ok = !!x && x.protocol === 'https:' && x.hostname.toLowerCase() === 'github.com' && x.pathname.toLowerCase().startsWith(`/${repo.toLowerCase()}/`);
  return ok ? x.href : `https://github.com/${repo}/releases/latest`;
}

/** True for a beta / release candidate: GitHub's pre-release flag, or a tag such as v1.5.3-beta.2 (even if it was not flagged). */
function isPrerelease(rel) {
  const v = parseVersion(rel && rel.tag_name);
  return !!(rel && rel.prerelease) || !!(v && v.pre.length);
}

/**
 * What the app needs from a GitHub release object, or null when it is not an update: a draft, not newer than `current`, or a
 * beta offered to someone who runs a stable version (someone who runs a beta is offered newer betas and the final release).
 * `installable` says whether this copy of the app can replace itself (the installed Windows build can; the portable file
 * and other systems send the person to the release page instead).
 */
function pickRelease(rel, { repo, current, installable }) {
  if (!rel || rel.draft || !isNewer(rel.tag_name, current)) return null;
  const cur = parseVersion(current);
  if (isPrerelease(rel) && !(cur && cur.pre.length)) return null;
  const file = (rel.assets || []).find((a) => a && /setup[\w. -]*\.exe$/i.test(String(a.name || '')) && validDownloadUrl(a.browser_download_url));
  const digest = file && /^sha256:([0-9a-f]{64})$/i.exec(String(file.digest || ''));
  const asset = file
    ? { name: String(file.name), url: file.browser_download_url, size: Number.isFinite(file.size) && file.size > 0 ? file.size : 0, sha256: digest ? digest[1].toLowerCase() : null }
    : null;
  return {
    version: formatVersion(parseVersion(rel.tag_name)),
    current,
    notes: String(rel.body || '').slice(0, NOTES_MAX),
    page: releasePage(rel.html_url, repo),
    mode: installable && asset ? 'install' : 'page',
    asset,
  };
}

const failure = (message) => ({ status: 'error', message });

/**
 * Asks GitHub for the newest release. Resolves to { status: 'available', info } | { status: 'current' } | { status: 'error', message }.
 * A stable version asks for the repository's latest release, which GitHub never fills with a beta. A beta asks for the list of
 * releases instead (betas are in it) and takes the highest version, because the list is in date order, not version order.
 */
async function checkForUpdate({ repo, current, installable, fetch }) {
  const cur = parseVersion(current);
  const onBeta = !!(cur && cur.pre.length);
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/releases${onBeta ? '?per_page=30' : '/latest'}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (_) {
    return failure('Could not reach GitHub. Check your internet connection.');
  }
  if (res.status === 404) return failure('No release has been published on GitHub yet.');
  if (res.status === 403 || res.status === 429) return failure('GitHub is limiting requests right now. Try again in a little while.');
  if (!res.ok) return failure(`GitHub answered with an error (${res.status}).`);
  let body;
  try {
    body = await res.json();
  } catch (_) {
    return failure('GitHub sent a reply that could not be read.');
  }
  const published = (Array.isArray(body) ? body : [body]).filter((r) => r && !r.draft);
  if (onBeta && !published.length) return failure('No release has been published on GitHub yet.');
  // A release whose tag is not a version must be reported, not silently treated as "you have the latest".
  const odd = published.find((r) => !r.prerelease && !parseVersion(r.tag_name));
  if (odd && published.length === 1) {
    return failure(`The newest release on GitHub is tagged "${String(odd.tag_name || '').slice(0, 40)}", which is not a version like v1.3.3.`);
  }
  let best = null;
  for (const rel of published) {
    const info = pickRelease(rel, { repo, current, installable });
    if (info && (!best || isNewer(info.version, best.version))) best = info;
  }
  return best ? { status: 'available', info: best } : { status: 'current' };
}

/**
 * Downloads `asset` to `dest`. The file is written as dest + '.part' and only renamed once it is complete and, when GitHub
 * lists a checksum for it, matches it. Rejects with an AbortError when `signal` fires; any failure removes the partial file.
 */
async function download({ asset, dest, fetch, onProgress, signal }) {
  if (!asset || !validDownloadUrl(asset.url)) throw new Error('The download address is not on GitHub, so it was not used.');
  const res = await fetch(asset.url, { signal, headers: { 'User-Agent': AGENT } });
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
  if (res.url && !validDownloadUrl(res.url)) throw new Error('The download was sent somewhere other than GitHub, so it was not used.');
  const total = asset.size || Number(res.headers && res.headers.get && res.headers.get('content-length')) || 0;

  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const out = await fs.promises.open(part, 'w');
  const hash = crypto.createHash('sha256');
  let got = 0;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      await out.write(chunk);
      got += chunk.length;
      const now = Date.now();
      if (onProgress && now - last >= 100) {
        last = now;
        onProgress({ received: got, total });
      }
    }
    await out.close();
    if (total && got !== total) throw new Error('The download was incomplete.');
    if (asset.sha256 && hash.digest('hex') !== asset.sha256) throw new Error('The download did not match its checksum, so it was not used.');
    await fs.promises.rename(part, dest);
  } catch (err) {
    await out.close().catch(() => {});
    await fs.promises.rm(part, { force: true }).catch(() => {});
    throw err;
  }
  if (onProgress) onProgress({ received: got, total: total || got });
  return dest;
}

module.exports = { parseRepo, parseVersion, formatVersion, isNewer, validDownloadUrl, pickRelease, checkForUpdate, download };
