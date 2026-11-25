const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const U = require('../updater.js');

const REPO = 'someone/aula-control';
const SETUP = 'https://github.com/someone/aula-control/releases/download/v1.4.0/Aula-Control-Setup.exe';
const release = (over = {}) => ({
  tag_name: 'v1.4.0',
  draft: false,
  prerelease: false,
  body: '## Top features\n- A new battery tab',
  html_url: 'https://github.com/someone/aula-control/releases/tag/v1.4.0',
  assets: [
    { name: 'Aula-Control-Portable.exe', browser_download_url: SETUP.replace('Setup', 'Portable'), size: 10 },
    { name: 'Aula-Control-Setup.exe', browser_download_url: SETUP, size: 5, digest: `sha256:${crypto.createHash('sha256').update('hello').digest('hex')}` },
  ],
  ...over,
});
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

test('the repository is read from an address or owner/repo, and the placeholder means "not set"', () => {
  assert.equal(U.parseRepo('someone/aula-control'), 'someone/aula-control');
  assert.equal(U.parseRepo('https://github.com/someone/aula-control.git'), 'someone/aula-control');
  assert.equal(U.parseRepo('https://github.com/someone/aula-control/releases'), 'someone/aula-control');
  assert.equal(U.parseRepo('OWNER/REPO'), null);
  assert.equal(U.parseRepo(''), null);
  assert.equal(U.parseRepo('not a repo'), null);
});

test('versions compare number by number, not as text', () => {
  assert.equal(U.isNewer('v1.3.3', '1.3.2'), true);
  assert.equal(U.isNewer('1.10.0', '1.9.9'), true);
  assert.equal(U.isNewer('1.3.2', '1.3.2'), false);
  assert.equal(U.isNewer('1.3.1', '1.3.2'), false);
  assert.equal(U.isNewer('nightly', '1.3.2'), false);
});

test('a newer release offers the installer; drafts, pre-releases and older ones are ignored', () => {
  const ok = U.pickRelease(release(), { repo: REPO, current: '1.3.2', installable: true });
  assert.equal(ok.version, '1.4.0');
  assert.equal(ok.mode, 'install');
  assert.equal(ok.asset.name, 'Aula-Control-Setup.exe', 'the installer, not the portable file');
  assert.equal(ok.asset.sha256, crypto.createHash('sha256').update('hello').digest('hex'));
  assert.match(ok.notes, /battery tab/);
  assert.equal(U.pickRelease(release({ draft: true }), { repo: REPO, current: '1.3.2', installable: true }), null);
  assert.equal(U.pickRelease(release({ prerelease: true }), { repo: REPO, current: '1.3.2', installable: true }), null);
  assert.equal(U.pickRelease(release(), { repo: REPO, current: '1.4.0', installable: true }), null);
});

test('the portable copy, or a release with no installer, goes to the release page instead', () => {
  const portable = U.pickRelease(release(), { repo: REPO, current: '1.3.2', installable: false });
  assert.equal(portable.mode, 'page');
  assert.equal(portable.page, 'https://github.com/someone/aula-control/releases/tag/v1.4.0');
  const none = U.pickRelease(release({ assets: [] }), { repo: REPO, current: '1.3.2', installable: true });
  assert.equal(none.mode, 'page');
  const odd = U.pickRelease(release({ html_url: 'https://evil.example/x' }), { repo: REPO, current: '1.3.2', installable: false });
  assert.equal(odd.page, `https://github.com/${REPO}/releases/latest`, 'a page address that is not this repository is replaced');
});

test('an installer that is not hosted by GitHub is never offered', () => {
  const r = release();
  r.assets[1].browser_download_url = 'https://evil.example/Aula-Control-Setup.exe';
  assert.equal(U.pickRelease(r, { repo: REPO, current: '1.3.2', installable: true }).mode, 'page');
  assert.equal(U.validDownloadUrl('http://github.com/a/b'), false);
  assert.equal(U.validDownloadUrl('https://github.com.evil.example/a'), false);
  assert.equal(U.validDownloadUrl('https://objects.githubusercontent.com/x'), true);
});

test('checking GitHub: available, current, and the ways it can fail', async () => {
  const args = { repo: REPO, current: '1.3.2', installable: true };
  let asked = '';
  const a = await U.checkForUpdate({ ...args, fetch: async (u) => ((asked = u), json(release())) });
  assert.equal(a.status, 'available');
  assert.equal(asked, `https://api.github.com/repos/${REPO}/releases/latest`);
  assert.equal((await U.checkForUpdate({ ...args, current: '1.4.0', fetch: async () => json(release()) })).status, 'current');
  assert.match((await U.checkForUpdate({ ...args, fetch: async () => json({}, 404) })).message, /No release/);
  assert.match((await U.checkForUpdate({ ...args, fetch: async () => json({}, 403) })).message, /limiting/);
  assert.match((await U.checkForUpdate({ ...args, fetch: async () => json({}, 500) })).message, /500/);
  assert.match((await U.checkForUpdate({ ...args, fetch: async () => { throw new Error('offline'); } })).message, /internet/);
  // The same version as installed is "current"; one patch number higher is offered.
  assert.equal((await U.checkForUpdate({ ...args, fetch: async () => json(release({ tag_name: 'v1.3.2' })) })).status, 'current');
  assert.equal((await U.checkForUpdate({ ...args, fetch: async () => json(release({ tag_name: 'v1.3.3' })) })).info.version, '1.3.3');
  // A tag that is not a version must be reported, not silently treated as "you have the latest".
  assert.match((await U.checkForUpdate({ ...args, fetch: async () => json(release({ tag_name: 'v1.4' })) })).message, /not a version/);
});

test('beta versions keep their beta part and compare by it', () => {
  assert.deepEqual(U.parseVersion('v1.5.3-beta.2'), { nums: [1, 5, 3], pre: ['beta', 2] });
  assert.equal(U.formatVersion(U.parseVersion('v1.5.3-beta.2')), '1.5.3-beta.2');
  assert.equal(U.formatVersion(U.parseVersion('v1.5.3')), '1.5.3');
  // beta2, beta.2, beta-2 and "beta 2" are the same beta
  for (const t of ['1.5.3-beta2', '1.5.3-beta.2', '1.5.3-beta-2', '1.5.3 beta 2']) assert.equal(U.formatVersion(U.parseVersion(t)), '1.5.3-beta.2', t);
  assert.equal(U.isNewer('1.5.3-beta.2', '1.5.3-beta.1'), true, 'beta 2 is an update for beta 1');
  assert.equal(U.isNewer('1.5.3-beta.1', '1.5.3-beta.2'), false);
  assert.equal(U.isNewer('1.5.3-beta.1', '1.5.3-beta.1'), false);
  assert.equal(U.isNewer('1.5.3-beta.10', '1.5.3-beta.2'), true, 'by number, not as text');
  assert.equal(U.isNewer('1.5.3-beta10', '1.5.3-beta2'), true, 'also without the dot');
  assert.equal(U.isNewer('1.5.3', '1.5.3-beta.9'), true, 'the final release beats its betas');
  assert.equal(U.isNewer('1.5.3-beta.9', '1.5.3'), false, 'a beta is not an update for the final release');
  assert.equal(U.isNewer('1.5.3-rc.1', '1.5.3-beta.4'), true);
  assert.equal(U.isNewer('1.5.4-beta.1', '1.5.3'), true);
  assert.equal(U.isNewer('1.5.2', '1.5.3-beta.1'), false);
});

test('someone on a beta is offered the next beta, named with its beta part; someone on a stable version is not', () => {
  const beta2 = release({ tag_name: 'v1.5.3-beta.2', prerelease: true, html_url: 'https://github.com/someone/aula-control/releases/tag/v1.5.3-beta.2' });
  const onBeta = U.pickRelease(beta2, { repo: REPO, current: '1.5.3-beta.1', installable: true });
  assert.equal(onBeta.version, '1.5.3-beta.2');
  assert.equal(onBeta.current, '1.5.3-beta.1');
  assert.equal(onBeta.mode, 'install');
  assert.equal(U.pickRelease(beta2, { repo: REPO, current: '1.5.3-beta.2', installable: true }), null, 'already on it');
  assert.equal(U.pickRelease(beta2, { repo: REPO, current: '1.5.2', installable: true }), null, 'a stable version never gets a beta');
  // a beta that was not marked as a pre-release on GitHub is still a beta
  const unflagged = release({ tag_name: 'v1.5.3-beta.2', prerelease: false });
  assert.equal(U.pickRelease(unflagged, { repo: REPO, current: '1.5.2', installable: true }), null);
  assert.equal(U.pickRelease(unflagged, { repo: REPO, current: '1.5.3-beta.1', installable: true }).version, '1.5.3-beta.2');
  // the final release is offered to a beta
  assert.equal(U.pickRelease(release({ tag_name: 'v1.5.3' }), { repo: REPO, current: '1.5.3-beta.4', installable: true }).version, '1.5.3');
  assert.equal(U.pickRelease(release({ tag_name: 'v1.5.3-beta.2', draft: true }), { repo: REPO, current: '1.5.3-beta.1', installable: true }), null, 'drafts are never offered');
});

test('checking GitHub from a beta looks at all releases (betas are not in "latest") and takes the highest version', async () => {
  const args = { repo: REPO, current: '1.5.3-beta.1', installable: true };
  const tag = (t, over = {}) => release({ tag_name: t, prerelease: /-/.test(t), ...over });
  let asked = '';
  const list = [tag('v1.5.3-beta.2'), tag('v1.5.2'), tag('v1.5.3-beta.1'), tag('v1.5.3-beta.3', { draft: true })];
  const a = await U.checkForUpdate({ ...args, fetch: async (u) => ((asked = u), json(list)) });
  assert.match(asked, new RegExp(`^https://api\\.github\\.com/repos/${REPO}/releases\\?per_page=\\d+$`));
  assert.equal(a.status, 'available');
  assert.equal(a.info.version, '1.5.3-beta.2', 'shown as a beta, the draft beta 3 is skipped');
  // the list is in date order: an older beta listed first must not win over a newer one
  const mixed = await U.checkForUpdate({ ...args, fetch: async () => json([tag('v1.5.3-beta.2'), tag('v1.5.3-beta.5'), tag('v1.5.3-beta.3')]) });
  assert.equal(mixed.info.version, '1.5.3-beta.5');
  // the final release wins over the betas of it
  const fin = await U.checkForUpdate({ ...args, fetch: async () => json([tag('v1.5.3'), tag('v1.5.3-beta.2')]) });
  assert.equal(fin.info.version, '1.5.3');
  // nothing newer than the installed beta
  assert.equal((await U.checkForUpdate({ ...args, fetch: async () => json([tag('v1.5.3-beta.1'), tag('v1.5.2')]) })).status, 'current');
  assert.match((await U.checkForUpdate({ ...args, fetch: async () => json([]) })).message, /No release/);
  // a stable version still asks for "latest" and is never offered a beta
  let stableAsked = '';
  const s = await U.checkForUpdate({ repo: REPO, current: '1.5.2', installable: true, fetch: async (u) => ((stableAsked = u), json(tag('v1.5.3-beta.2'))) });
  assert.equal(stableAsked, `https://api.github.com/repos/${REPO}/releases/latest`);
  assert.equal(s.status, 'current');
});

test('the update dialog and notification show the version exactly as the update is named (beta part included)', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  assert.match(read('src/js/update.js'), /Aula Control \$\{info\.version\} is available\. You have \$\{info\.current\}/);
  assert.match(read('main.js'), /Version \$\{r\.info\.version\} is available/);
});

// A fake download: the body arrives in two chunks.
const body = (...parts) => new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(Buffer.from(p))); c.close(); } });
const reply = (parts, over = {}) => async () => ({ ok: true, status: 200, url: SETUP, headers: { get: () => null }, body: body(...parts), ...over });
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aula-upd-')), 'Setup.exe');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

test('download writes the file only when size and checksum match, and reports progress', async () => {
  const dest = tmp();
  const seen = [];
  await U.download({ asset: { url: SETUP, size: 5, sha256: sha('hello') }, dest, fetch: reply(['hel', 'lo']), onProgress: (p) => seen.push(p) });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'hello');
  assert.equal(fs.existsSync(`${dest}.part`), false);
  assert.deepEqual(seen[seen.length - 1], { received: 5, total: 5 });
});

test('a wrong checksum, a short file or a redirect off GitHub leaves nothing behind', async () => {
  for (const [asset, fetch, re] of [
    [{ url: SETUP, size: 5, sha256: sha('other') }, reply(['hel', 'lo']), /checksum/],
    [{ url: SETUP, size: 9, sha256: null }, reply(['hel', 'lo']), /incomplete/],
    [{ url: SETUP, size: 5, sha256: null }, reply(['hello'], { url: 'https://evil.example/x.exe' }), /somewhere other/],
    [{ url: 'https://evil.example/x.exe', size: 5 }, reply(['hello']), /not on GitHub/],
  ]) {
    const dest = tmp();
    await assert.rejects(U.download({ asset, dest, fetch }), re);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(`${dest}.part`), false);
  }
});

test('cancelling stops the download and removes the partial file', async () => {
  const dest = tmp();
  const ctl = new AbortController();
  const slow = new ReadableStream({
    async start(c) {
      c.enqueue(Buffer.from('hel'));
      await new Promise((r) => setTimeout(r, 30));
      c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    },
  });
  const fetch = async () => ({ ok: true, status: 200, url: SETUP, headers: { get: () => null }, body: slow });
  setTimeout(() => ctl.abort(), 10);
  await assert.rejects(U.download({ asset: { url: SETUP, size: 5 }, dest, fetch, signal: ctl.signal }), (e) => e.name === 'AbortError');
  assert.equal(fs.existsSync(`${dest}.part`), false);
});

test('the packaged app includes updater.js, which main.js requires at start', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.includes('updater.js'));
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8'), /require\('\.\/updater'\)/);
});

test('after the download the app asks before installing: nothing starts the installer except the Install now request', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const main = read('main.js');
  const startFn = main.slice(main.indexOf('async function startUpdate'), main.indexOf('async function installUpdate'));
  assert.ok(!/openPath/.test(startFn), 'startUpdate must not run the installer');
  assert.match(startFn, /state: 'ready'/);
  assert.match(main, /ipcMain\.handle\('update:install'/);
  assert.match(read('preload.js'), /install: \(\) => ipcRenderer\.invoke\('update:install'\)/);
  assert.match(read('src/js/update.js'), /Install now/);
});

test('a found update shows an icon in the header and on the start screens, and the app looks on every start', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('src/index.html');
  assert.match(html, /id="updBadge"[^>]*\bhidden\b/); // header icon, hidden until an update is known
  assert.match(html, /id="updBadgeHome"[^>]*\bhidden\b/); // the header is hidden on the start and device screens
  const main = read('main.js');
  assert.match(main, /sendUpdate\('update:badge', publicInfo\(r\.info\)\)/);
  assert.match(main, /sendUpdate\('update:badge', null\)/);
  assert.match(main, /ipcMain\.handle\('update:latest'/);
  assert.match(main, /setTimeout\(autoCheckUpdates, \d+ \* 1000\)/); // once at start, then every few hours
  const pre = read('preload.js');
  assert.match(pre, /onBadge:/);
  assert.match(pre, /latest: \(\) => ipcRenderer\.invoke\('update:latest'\)/);
  assert.match(read('src/js/update.js'), /api\.onBadge\(badge\)/);
});

test('the README Version badge is live from GitHub releases, so no version is typed into the README (the app reads its own version from package.json)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes(`img.shields.io/github/v/release/${pkg.aulaControl.updateRepo}`), 'the Version badge reads the latest release from GitHub');
  assert.doesNotMatch(readme, /badge\/version-/, 'a fixed version number is written into the README');
});

test('update dialog buttons do not use a class that the page layout already uses', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src/js/update.js'), 'utf8');
  assert.ok(js.includes("'upd-act upd-main'"));
  assert.ok(!js.includes("'upd-act main'"), '"main" is the page area: it is laid out as a column and hidden on the start screen');
});
