'use strict';

/*
 * The Linux build: package.json asks for an AppImage and a .deb, the udev rule covers every USB id the app opens, the
 * GitHub workflow builds both systems and attaches all files to one release, and the Windows updater is not confused by
 * the extra files on that release.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('../updater');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('package.json builds an AppImage and a .deb for Linux with fixed file names', () => {
  assert.equal(pkg.scripts['dist:linux'], 'electron-builder --linux AppImage deb');
  assert.deepEqual(pkg.build.linux.target.map((t) => t.target).sort(), ['AppImage', 'deb']);
  assert.equal(pkg.build.appImage.artifactName, 'Aula-Control-x86_64.AppImage');
  assert.equal(pkg.build.deb.artifactName, 'Aula-Control-amd64.deb');
  assert.ok(pkg.build.linux.maintainer, 'a .deb needs a maintainer');
  assert.ok(fs.existsSync(path.join(root, pkg.build.linux.icon)), 'the Linux icon exists');
});

test('the Windows build is unchanged', () => {
  assert.equal(pkg.scripts.dist, 'electron-builder --win nsis portable');
  assert.equal(pkg.build.nsis.artifactName, 'Aula-Control-Setup.${ext}');
  assert.equal(pkg.build.portable.artifactName, 'Aula-Control-Portable.${ext}');
});

test('the udev rule covers every USB id main.js opens, and the .deb installs it', () => {
  const main = read('main.js');
  const block = main.match(/const KNOWN_IDS = \[([\s\S]*?)\];/);
  assert.ok(block, 'KNOWN_IDS in main.js');
  const ids = [...block[1].matchAll(/\[0x([0-9a-f]{4}), 0x([0-9a-f]{4})\]/gi)].map((m) => [m[1].toLowerCase(), m[2].toLowerCase()]);
  assert.ok(ids.length >= 4, 'found the ids');
  const rules = read('linux/99-aula-control.rules');
  for (const [v, p] of ids) {
    assert.match(rules, new RegExp(`idVendor}=="${v}", ATTRS{idProduct}=="${p}", TAG\\+="uaccess"`), `no rule for ${v}:${p}`);
  }
  assert.ok(pkg.build.deb.fpm.some((a) => a.startsWith('linux/99-aula-control.rules=/etc/udev/rules.d/')));
});

// The workflow is not in the project zip (the unpack step never touches .github), so this runs only in a checkout that has it.
const wfFile = path.join(root, '.github', 'workflows', 'build.yml');
test('the workflow unpacks the zip into main, builds Windows and Linux, releases, then moves the zip to dev', { skip: !fs.existsSync(wfFile) && 'build.yml is not in this copy' }, () => {
  const wf = read('.github/workflows/build.yml');
  assert.match(wf, /paths: \['\*\.zip'\]/, 'starts when a zip is uploaded');
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /contents: write/);
  assert.match(wf, /tar --exclude='\.\/\.github'/, 'the .github folder of the zip is never copied');
  assert.match(wf, /windows-latest/);
  assert.match(wf, /ubuntu-latest/);
  assert.match(wf, /npm run dist -- --publish never/);
  assert.match(wf, /npm run dist:linux -- --publish never/);
  assert.match(wf, /dist\/\*\.exe/);
  assert.match(wf, /dist\/\*\.AppImage/);
  assert.match(wf, /dist\/\*\.deb/);
  assert.match(wf, /linux\/99-aula-control\.rules/);
  assert.match(wf, /--notes-file RELEASE_NOTES\.md/);
  assert.match(wf, /git push origin dev/);
  assert.match(wf, /git rm -q "\$ZIP"/);
});

test('the AppImage turns the sandbox off, the installed app does not', () => {
  const main = read('main.js');
  assert.match(main, /process\.platform === 'linux' && process\.env\.APPIMAGE\) app\.commandLine\.appendSwitch\('no-sandbox'\)/);
});

const release = (names) => ({
  tag_name: 'v9.9.9',
  html_url: 'https://github.com/o/r/releases/tag/v9.9.9',
  body: '',
  assets: names.map((name) => ({ name, size: 10, browser_download_url: `https://github.com/o/r/releases/download/v9.9.9/${name}` })),
});
const ALL = ['Aula-Control-Setup.exe', 'Aula-Control-Portable.exe', 'Aula-Control-x86_64.AppImage', 'Aula-Control-amd64.deb', '99-aula-control.rules'];

test('with Linux files on the release, the installed Windows app still downloads the Setup exe', () => {
  const info = updater.pickRelease(release(ALL), { repo: 'o/r', current: '1.0.0', installable: true });
  assert.equal(info.mode, 'install');
  assert.equal(info.asset.name, 'Aula-Control-Setup.exe');
});

test('on Linux the app only opens the release page', () => {
  const info = updater.pickRelease(release(ALL), { repo: 'o/r', current: '1.0.0', installable: false });
  assert.equal(info.mode, 'page');
});
