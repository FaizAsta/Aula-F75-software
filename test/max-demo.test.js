'use strict';

/*
 * The demo F75 Max: a simulated USB-C cable and 2.4G dongle behind the real MaxSession. Every write goes through the same
 * step builders a real keyboard gets; the demo keeps its state in memory only and gives back what the session held before.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/js/max.js');
const { memoryStorage } = require('../src/js/engine.js');
const { FakeCable } = require('./fake-max.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const noHid = { getDevices: async () => [] };

test('the demo F75 Max is present with a cable and a dongle, without any HID device', async () => {
  const s = new M.MaxSession({ hid: noHid, storage: memoryStorage(), delayMs: 0 });
  assert.equal(s.present, false);
  assert.equal(await s.enterDemo(), true);
  assert.equal(s.demo, true);
  assert.equal(s.present, true);
  assert.equal(s.link, 'cable', 'writes go over the cable, as with a real one');
  assert.ok(s.dongle, 'and the dongle gives the battery');
  assert.equal(s.label, 'Demo keyboard');
  assert.equal(await s.scan(), true, 'a scan does not drop the demo');
  assert.equal(s.present, true);
});

test('every kind of write is accepted and confirmed', async () => {
  const s = new M.MaxSession({ hid: noHid, storage: memoryStorage(), delayMs: 0 });
  await s.enterDemo();
  s.setLighting({ mode: 6, brightness: 3 });
  let r = await s.applyLighting();
  assert.equal(r.ok, true);
  assert.equal(r.confirmed, true);
  assert.equal(r.via, 'cable');
  assert.deepEqual(s.cable.lastSteps, ['begin', 'select lighting', 'lighting', 'apply', 'save']);

  s.setSettings({ response: 4, winLock: true });
  r = await s.applySettings();
  assert.equal(r.ok && r.confirmed, true);

  s.paint([1, 2, 3], [255, 0, 0]);
  r = await s.applyKeyColors();
  assert.equal(r.ok && r.confirmed, true);
  assert.equal(s.cable.lastSteps.length, 5 + (2 + 9 + 2), 'user-defined mode (5 steps), then begin, select, nine key packets, apply, save');

  r = await s.factoryReset();
  assert.equal(r.ok && r.confirmed, true);
  assert.deepEqual(s.lighting, { ...M.DEFAULT_LIGHTING, rgb: M.DEFAULT_LIGHTING.rgb.slice() });
  assert.equal(s.keyColors.size, 0);
});

test('the battery is read through the demo dongle', async () => {
  const s = new M.MaxSession({ hid: noHid, storage: memoryStorage(), delayMs: 0 });
  await s.enterDemo();
  assert.equal(await s.pollBattery(), 78);
  assert.equal(s.battery.percent, 78);
  const report = M.rgbReport(M.DEFAULT_LIGHTING);
  M.withChecksum(report);
  await s.dongle.send(report); // a well-formed report goes through
  await assert.rejects(() => s.dongle.send(new Uint8Array(31)), /32 bytes/);
  const bad = M.withChecksum(M.rgbReport(M.DEFAULT_LIGHTING));
  bad[31] ^= 0xff;
  await assert.rejects(() => s.dongle.send(bad), /checksum/);
});

test('a packet of the wrong size is refused, so the step builders stay honest', async () => {
  const link = new M.DemoCableLink({ delayMs: 0 });
  await assert.rejects(() => link.run([{ name: 'short', bytes: new Uint8Array(10), kind: 'send' }]), /64 bytes/);
});

test('the demo starts from the defaults, saves nothing, and ends with the real state back', async () => {
  const storage = memoryStorage();
  const s = new M.MaxSession({ hid: noHid, storage, delayMs: 0 });
  s.setLighting({ mode: 3, brightness: 5 });
  s.setSettings({ response: 2 });
  s.paint([7], [1, 2, 3]);
  const saved = storage.getItem('aula.max.v1');
  assert.ok(saved, 'the real state is remembered');

  await s.enterDemo();
  assert.equal(s.lighting.mode, M.DEFAULT_LIGHTING.mode, 'the demo does not start from the real settings');
  assert.equal(s.keyColors.size, 0);
  s.setLighting({ mode: 9, brightness: 1 });
  s.setSettings({ response: 5, sleep: 3 });
  s.paint([9, 10], [9, 9, 9]);
  assert.equal(storage.getItem('aula.max.v1'), saved, 'nothing the demo does reaches what is remembered');

  await s.disconnect(); // what leaving the Max screen does
  assert.equal(s.demo, false);
  assert.equal(s.present, false, 'no keyboard is left behind');
  assert.equal(s.lighting.mode, 3);
  assert.equal(s.lighting.brightness, 5);
  assert.equal(s.settings.response, 2);
  assert.deepEqual([...s.keyColors], [[7, [1, 2, 3]]]);
  assert.equal(storage.getItem('aula.max.v1'), saved);
  s.setSettings({ sleep: 1 }); // saving works again
  assert.notEqual(storage.getItem('aula.max.v1'), saved);
});

test('entering the demo lets a real F75 Max go first, and a real one is found again afterwards', async () => {
  const cable = new FakeCable();
  const s = new M.MaxSession({ hid: { getDevices: async () => [cable] }, storage: memoryStorage(), delayMs: 0 });
  await s.scan();
  assert.equal(s.cable.device, cable);
  await s.enterDemo();
  assert.equal(s.cable.demo, true, 'the demo cable, not the real one');
  await s.disconnect();
  assert.equal(s.present, false);
  await s.scan();
  assert.equal(s.cable.device, cable, 'the real cable is found again');
});

test('the Start screen has a small Demo keyboards button beside Search again that opens the list of simulated keyboards, and the Max screen can start each', () => {
  const home = read('src/js/home.js');
  const html = read('src/index.html');
  // no long plate in the list any more: a small button sits next to Search again, in the same row and with the same look
  assert.doesNotMatch(home, /demoList/, 'no Demo keyboards plate in the device list');
  assert.match(html, /<div class="hm-actions"><button class="btn ghost" id="hmRescan"[^>]*>Search again<\/button><button class="btn ghost" id="hmDemos"[^>]*>Demo keyboards<\/button><\/div>/, 'the button is beside Search again and is the same size');
  assert.match(home, /\$\('#hmDemos'\)\.addEventListener\('click', \(\) => showDemos\(true\)\)/, 'pressing it only opens the list of demo keyboards');
  assert.match(home, /if \(demoView\) return demoItems\(\)/, 'pressing it lists only the demo keyboards');
  assert.match(home, /\$\('#hmRescan'\)\.parentElement\.hidden = demoView/, 'the button row is hidden while the demo keyboards are listed');
  assert.match(home, /demoView \? showDemos\(false\) : go\(entered \? 'app' : 'home'\)/, 'Back and Escape go one step up');
  assert.match(home, /if \(name !== 'devices'\) demoView = false/, 'leaving the devices screen closes the demo list');
  // the demo keyboards themselves: one card per family
  assert.match(home, /\['max', 'F75 Max'\], \['he', 'F75 HE'\]/, 'one demo card per family');
  assert.match(home, /name: `Demo \$\{name\}`/);
  assert.match(home, /demoFamily: fam/);
  assert.match(home, /A\.max\.enterDemo\(it\.demoFamily\)/);
  assert.match(home, /!mx\.max\.demo/, 'a real card is not shown as connected while the demo is on');
  const ui = read('src/js/max-ui.js');
  assert.match(ui, /async enterDemo\(family = 'max'\)/, 'exported, for either family');
  const app = read('src/js/app.js');
  assert.match(app, /MXU\.max\.demo\) MXU\.leave\(\)/, 'turning the demo F75 on ends the demo F75 Max / F75 HE');
  assert.match(html, /id="hmTitle"/, 'the heading can say Demo keyboards');
  assert.match(html, /choose Demo keyboards, then Demo F75 Max or Demo F75 HE/, 'Settings says where to find them');
});
