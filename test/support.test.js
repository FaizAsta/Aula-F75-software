'use strict';

/*
 * The Support button: the list of links, and that the pieces that use it are wired together.
 *
 * Why this is tested: the Discord invite is in two places (the README and src/js/support-links.js). If one is changed
 * and the other forgotten, the app would send people to a dead invite. And the page may only ever ask the main process
 * to open a link by its id, so that a page can never make the app open some other address.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const Links = require('../src/js/support-links.js');

test('the menu has the Discord invite from the README', () => {
  const readme = read('README.md');
  const invite = /https:\/\/discord\.gg\/[A-Za-z0-9]+/.exec(readme);
  assert.ok(invite, 'the README has a Discord invite');
  const discord = Links.find('discord');
  assert.ok(discord, 'the menu has a Discord entry');
  assert.equal(discord.url, invite[0]);
  assert.equal(discord.label, 'Discord');
});

test('every link is https: or mailto:, has a name, and no id appears twice', () => {
  const list = Links.list();
  assert.ok(list.length >= 1);
  const ids = new Set();
  for (const l of list) {
    assert.match(l.url, /^(https:\/\/|mailto:)/);
    assert.ok(l.label.length > 0);
    assert.ok(!ids.has(l.id), `id ${l.id} is used twice`);
    ids.add(l.id);
  }
});

test('a line with no address yet is left out of the menu', () => {
  const out = Links.usable([
    { id: 'a', label: 'A', url: 'https://example.com/a' },
    { id: 'b', label: 'B', hint: 'x', url: '' },
    { id: 'c', label: 'C', url: '   ' },
  ]);
  assert.deepEqual(out.map((l) => l.id), ['a']);
});

test('only https: and mailto: addresses are accepted', () => {
  const bad = ['http://example.com', 'javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe', 'ftp://example.com', 'data:text/html,hi', '//example.com', 'https://', 'mailto:', 'steam://run/1', 'C:\\Windows\\notepad.exe'];
  for (const url of bad) assert.deepEqual(Links.usable([{ id: 'x', label: 'X', url }]), [], `${url} must not be accepted`);
  assert.equal(Links.usable([{ id: 'x', label: 'X', url: 'mailto:me@example.com' }]).length, 1);
  assert.equal(Links.usable([{ id: 'x', label: 'X', url: ' https://example.com ' }])[0].url, 'https://example.com');
});

test('a malformed list is tolerated, and a repeated id keeps the first entry', () => {
  assert.deepEqual(Links.usable(null), []);
  assert.deepEqual(Links.usable([null, 5, 'x', {}, { id: 'a' }, { id: 'a', label: 'A' }, { id: 7, label: 'N', url: 'https://example.com' }]), []);
  const out = Links.usable([
    { id: 'a', label: 'First', url: 'https://example.com/1' },
    { id: 'a', label: 'Second', url: 'https://example.com/2' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'First');
});

test('find gives nothing for an id that is not in the list', () => {
  assert.equal(Links.find('nope'), null);
  assert.equal(Links.find(undefined), null);
  assert.equal(Links.find('__proto__'), null);
  assert.equal(Links.find('instagram'), null, 'a line with no address is not found either');
});

test('the main process opens a link by id only, and the page cannot hand it an address', () => {
  const main = read('main.js');
  const preload = read('preload.js');
  assert.match(main, /require\('\.\/src\/js\/support-links\.js'\)/);
  const handler = /ipcMain\.handle\('host:open-support',[\s\S]*?\n  \}\);/.exec(main);
  assert.ok(handler, 'main.js handles host:open-support');
  assert.match(handler[0], /supportLinks\.find\(id\)/, 'the address is looked up from the list');
  assert.match(handler[0], /shell\.openExternal\(link\.url\)/, 'it opens the address from the list, not the one the page sent');
  assert.doesNotMatch(handler[0], /openExternal\(\s*id\b/);
  assert.match(preload, /openSupport:\s*\(id\)\s*=>\s*ipcRenderer\.invoke\('host:open-support',\s*String\(id\)\)/);
  // The window still refuses to navigate or open windows by itself.
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
});

test('the page loads the list before the menu, and both Support buttons use the menu', () => {
  const html = read('src', 'index.html');
  const iLinks = html.indexOf('js/support-links.js');
  const iMenu = html.indexOf('js/support.js');
  assert.ok(iLinks > 0 && iMenu > iLinks, 'support-links.js comes before support.js');
  assert.match(html, /css\/support\.css/);
  const buttons = html.match(/<button[^>]*\bdata-support\b[^>]*>/g) || [];
  assert.equal(buttons.length, 2, 'one button in the header, one on the start screen');
  for (const b of buttons) {
    assert.match(b, /aria-haspopup="menu"/);
    assert.match(b, /aria-controls="supPop"/);
    assert.match(b, /aria-expanded="false"/);
  }
  assert.ok(buttons.some((b) => /id="supBtn"/.test(b)));
  assert.ok(buttons.some((b) => /id="supBtnHome"/.test(b) && /data-lock/.test(b)), 'the start-screen button is part of the start screen\'s click handling');
});

test('the menu script opens links through the host and falls back to the browser only without one', () => {
  const src = read('src', 'js', 'support.js');
  assert.match(src, /host\.openSupport\(id\)/);
  assert.match(src, /window\.open\(l\.url, '_blank', 'noopener'\)/);
  assert.match(src, /'Escape'/);
  assert.match(src, /aria-expanded/);
});

test('the Support CSS file is part of the packaged app', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.build.files.includes('src/**/*'), 'everything under src/ is packaged');
  assert.ok(fs.existsSync(path.join(root, 'src', 'css', 'support.css')));
  assert.ok(fs.existsSync(path.join(root, 'src', 'js', 'support-links.js')));
});
