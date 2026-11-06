'use strict';

/*
 * Update check and download for the Windows app. Runs in the main process and has no Electron in it (fetch is passed in),
 * so the tests can drive it with a fake network.
 *
 * It asks GitHub for the repository's latest published release, compares the tag with the installed version, and can
 * download the installer from that release. Only github.com addresses are ever contacted for the download, the size is
 * checked, and so is the SHA-256 checksum when GitHub lists one for the file.
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

/** [major, minor, patch] from "1.3.2" or "v1.3.2" (anything after the third number is ignored), else null. */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
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

/**
 * What the app needs from a GitHub release object, or null when it is not an update: a draft, a pre-release, or not newer
 * than `current`. `installable` says whether this copy of the app can replace itself (the installed Windows build can; the
 * portable file and other systems send the person to the release page instead).
 */
function pickRelease(rel, { repo, current, installable }) {
  if (!rel || rel.draft || rel.prerelease || !isNewer(rel.tag_name, current)) return null;
  const file = (rel.assets || []).find((a) => a && /setup[\w. -]*\.exe$/i.test(String(a.name || '')) && validDownloadUrl(a.browser_download_url));
  const digest = file && /^sha256:([0-9a-f]{64})$/i.exec(String(file.digest || ''));
  const asset = file
    ? { name: String(file.name), url: file.browser_download_url, size: Number.isFinite(file.size) && file.size > 0 ? file.size : 0, sha256: digest ? digest[1].toLowerCase() : null }
    : null;
  return {
    version: parseVersion(rel.tag_name).join('.'),
    current,
    notes: String(rel.body || '').slice(0, NOTES_MAX),
    page: releasePage(rel.html_url, repo),
    mode: installable && asset ? 'install' : 'page',
    asset,
  };
}

const failure = (message) => ({ status: 'error', message });

/** Asks GitHub for the latest release. Resolves to { status: 'available', info } | { status: 'current' } | { status: 'error', message }. */
async function checkForUpdate({ repo, current, installable, fetch }) {
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': AGENT },
      signal: AbortSignal.timeout(15000),
    });
  } catch (_) {
    return failure('Could not reach GitHub. Check your internet connection.');
  }
  if (res.status === 404) return failure('No release has been published on GitHub yet.');
  if (res.status === 403 || res.status === 429) return failure('GitHub is limiting requests right now. Try again in a little while.');
  if (!res.ok) return failure(`GitHub answered with an error (${res.status}).`);
  let rel;
  try {
    rel = await res.json();
  } catch (_) {
    return failure('GitHub sent a reply that could not be read.');
  }
  if (rel && !rel.draft && !rel.prerelease && !parseVersion(rel.tag_name)) {
    return failure(`The newest release on GitHub is tagged "${String(rel.tag_name || '').slice(0, 40)}", which is not a version like v1.3.3.`);
  }
  const info = pickRelease(rel, { repo, current, installable });
  return info ? { status: 'available', info } : { status: 'current' };
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

module.exports = { parseRepo, parseVersion, isNewer, validDownloadUrl, pickRelease, checkForUpdate, download };
