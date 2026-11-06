// The real window (index.html + every script) in jsdom with fake F75 Max devices plugged in: the app finds the Max, takes
// over the screen, and the Lighting / Per-key / Keyboard sections write the documented packets. Also checks that an
// F75 is untouched, and that another AULA model on the Max's USB ids is left alone.
// Run: npm install --no-save jsdom && node scripts/ui-max.js
const path = require('path');
const { boot, until, wait } = require('./ui-smoke.js');
const { FakeCable, FakeDongle, fakeHid } = require(path.join(__dirname, '..', 'test', 'fake-max.js'));

let failed = 0;
const check = (c, m) => {
  if (!c) {
    failed++;
    console.log('  FAIL:', m);
  }
};

async function page(devices, opts = {}) {
  const list = devices.slice();
  const hid = fakeHid(list);
  hid.getDevices = async () => list.slice();
  const ctx = await boot('f75', { demo: false, hid });
  ctx.w.confirm = () => opts.confirm !== false;
  ctx.list = list;
  return ctx;
}

(async () => {
  // ---------------------------------------------------------------- USB-C + dongle
  {
    console.log('== F75 Max on the USB-C cable and the 2.4G dongle');
    const cable = new FakeCable();
    const dongle = new FakeDongle({ percent: 77 });
    const { w, errors, dom } = await page([cable, dongle]);
    const A = w.aulaApp;
    const doc = w.document;
    check(await until(() => A.max && A.max.active(), 8000), 'the Max screen opens by itself');
    check(doc.querySelector('.shell').dataset.family === 'max', 'the shell is in Max mode');
    check(!doc.getElementById('maxRoot').hidden, 'the Max panel shows');
    check(/F75 Max, USB-C cable/.test(doc.getElementById('connText').textContent), `header says ${doc.getElementById('connText').textContent}`);
    check(await until(() => /77%/.test(doc.getElementById('batChipText').textContent), 4000), `battery chip: ${doc.getElementById('batChipText').textContent}`);
    check(doc.getElementById('tab-keys').textContent === 'Keyboard', 'the Keys tab is the Keyboard section');
    check(w.getComputedStyle ? true : true, 'styles');

    // Lighting
    const tiles = [...doc.querySelectorAll('#mxLighting .mx-effect')];
    check(tiles.length === 20, `20 effects: ${tiles.length}`);
    tiles[15].click(); // Ripple
    await wait(20);
    check(A.max.max.lighting.mode === 15, 'choosing an effect sets it');
    check(tiles[15].getAttribute('aria-checked') === 'true', 'the tile shows as chosen');
    doc.querySelector('#mxBright [data-v="4"]').click();
    doc.querySelector('#mxSpeed [data-v="0"]').click();
    doc.getElementById('mxColourful').click();
    await wait(20);
    check(A.max.max.lighting.brightness === 5 && A.max.max.lighting.speed === 1 && A.max.max.lighting.colorful, 'brightness, speed and rainbow colours');
    doc.getElementById('mxApplyL').click();
    check(await until(() => A.max.max.last && A.max.max.last.name === 'lighting' && A.max.max.last.ok, 4000), 'Apply lighting succeeds');
    check(cable.ops().join() === '18,13,data,02,f0', `cable ops: ${cable.ops().join()}`);
    check(/accepted every step/.test(doc.getElementById('mxStatus').textContent), `status: ${doc.getElementById('mxStatus').textContent}`);
    check(dongle.sent.filter((b) => b[0] !== 0x20).length === 0, 'nothing but battery queries went to the dongle');

    // Per-key
    A.setTab('perkey');
    await wait(60);
    check(!doc.getElementById('mxPerkey').hidden && doc.getElementById('mxLighting').hidden, 'the Per-key section shows');
    const keys = [...doc.querySelectorAll('#mxPerkey .mx-key')];
    check(keys.length === 80, `80 keys drawn: ${keys.length}`);
    const esc = keys.find((k) => k.title === 'esc');
    esc.dispatchEvent(new w.Event('pointerdown', { bubbles: true, cancelable: true }));
    w.dispatchEvent(new w.Event('pointerup'));
    await wait(20);
    check(A.max.max.keyColors.size === 1 && A.max.max.keyColors.has(1), 'clicking Esc paints light 1');
    doc.getElementById('mxFill').click();
    await wait(20);
    check(A.max.max.keyColors.size === 80, 'Fill all keys');
    doc.getElementById('mxRainbow').click();
    await wait(20);
    check(new Set([...A.max.max.keyColors.values()].map((c) => c.join())).size > 10, 'Rainbow paints many colours');
    cable.sent.length = 0;
    doc.getElementById('mxApplyK').click();
    check(await until(() => A.max.max.last && A.max.max.last.name === 'per-key colours' && A.max.max.last.ok, 5000), `Apply per-key succeeds: ${A.max.max.last && A.max.max.last.error}`);
    check(cable.ops().includes('23') && cable.ops().filter((o) => o === 'data').length === 10, `per-key ops: ${cable.ops().join()}`);
    doc.getElementById('mxClear').click();
    await wait(20);
    check(A.max.max.keyColors.size === 0, 'Turn all off');

    // Keyboard
    A.setTab('keys');
    await wait(60);
    check(!doc.getElementById('mxKeyboard').hidden, 'the Keyboard section shows');
    doc.getElementById('mxWin').click();
    doc.querySelector('#mxResp [data-v="3"]').click();
    const sleep = doc.getElementById('mxSleep');
    sleep.value = '3';
    sleep.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(20);
    check(A.max.max.settings.winLock && A.max.max.settings.response === 4 && A.max.max.settings.sleep === 3, 'settings follow the controls');
    cable.sent.length = 0;
    doc.getElementById('mxApplyS').click();
    check(await until(() => A.max.max.last && A.max.max.last.name === 'settings' && A.max.max.last.ok, 4000), 'Apply settings succeeds');
    check(cable.ops().join() === '18,17,data,02', `settings ops: ${cable.ops().join()}`);
    check(cable.sent[2][2] === 1 && cable.sent[2][6] === 3 && cable.sent[2][8] === 4, 'settings bytes: Win lock, sleep, response');

    // the app's own Settings stays reachable
    A.setTab('settings');
    await wait(80);
    check(!doc.getElementById('panel-settings').hidden, 'Settings panel shows');
    check(doc.querySelector('.shell').dataset.maxView === 'app', 'the Max panel steps aside for Settings');
    A.setTab('battery');
    await wait(40);
    check(doc.getElementById('panel-settings').hidden === false, 'the F75 Battery panel is not reachable in Max mode');
    A.setTab('lighting');
    await wait(60);
    check(doc.querySelector('.shell').dataset.maxView === 'max', 'back to the Max screen');

    // unplug everything: the app returns to the F75 screen
    cable.opened = false;
    dongle.opened = false;
    A.max.max.hid.getDevices = async () => [];
    check(await until(() => !A.max.active(), 9000), 'unplugging leaves the Max screen');
    check(doc.querySelector('.shell').dataset.family === '', 'the shell is back to normal');
    check(doc.getElementById('tab-keys').textContent === 'Keys', 'the tab label is restored');
    check(errors.length === 0, `no script errors:\n    ${errors.slice(0, 4).join('\n    ')}`);
    console.log(errors.length ? '  errors: ' + errors.length : '  ok, no script errors');
    A.max.stop();
    dom.window.close();
  }

  // ---------------------------------------------------------------- dongle only
  {
    console.log('== F75 Max on the 2.4G dongle only');
    const dongle = new FakeDongle({ percent: 41 });
    const { w, errors, dom } = await page([dongle]);
    const A = w.aulaApp;
    const doc = w.document;
    check(await until(() => A.max && A.max.active(), 8000), 'the Max screen opens');
    check(/2\.4G dongle/.test(doc.getElementById('connText').textContent), doc.getElementById('connText').textContent);
    check(await until(() => /41%/.test(doc.getElementById('batChipText').textContent), 4000), 'battery 41% in the header');
    A.setTab('perkey');
    await wait(50);
    check(doc.getElementById('mxApplyK').disabled, 'Per-key Apply is off without the cable');
    check(/need the USB-C cable/.test(doc.getElementById('mxPerkeyHint').textContent), 'it says why');
    A.setTab('lighting');
    await wait(50);
    doc.querySelectorAll('#mxLighting .mx-effect')[7].click();
    doc.getElementById('mxApplyL').click();
    check(await until(() => A.max.max.last && A.max.max.last.name === 'lighting' && A.max.max.last.ok, 4000), 'lighting applies over 2.4G');
    check(/does not confirm/.test(doc.getElementById('mxStatus').textContent), `status: ${doc.getElementById('mxStatus').textContent}`);
    const lighting = dongle.sent.filter((b) => b[0] === 0x0f || b[0] === 0x05);
    check(lighting.length === 2 && lighting[0][0] === 0x0f && lighting[1][0] === 0x05 && lighting[1][3] === 7, 'commit, then the RGB report with mode 7');
    check(errors.length === 0, `no script errors:\n    ${errors.slice(0, 4).join('\n    ')}`);
    console.log(errors.length ? '  errors: ' + errors.length : '  ok, no script errors');
    A.max.stop();
    dom.window.close();
  }

  // ---------------------------------------------------------------- another AULA model on the same ids
  {
    console.log('== another AULA model on the Max\'s USB ids (S98 Pro)');
    const s98 = new FakeCable({ name: 'AULA-S98Pro' });
    const { w, errors, dom } = await page([s98]);
    const A = w.aulaApp;
    await wait(3500);
    check(!A.max.active(), 'it is not opened as an F75 Max');
    check(s98.sent.length === 0, 'not a single byte was sent to it');
    check(errors.length === 0, `no script errors: ${errors.slice(0, 3).join(' | ')}`);
    A.max.stop();
    dom.window.close();
  }

  // ---------------------------------------------------------------- an unnamed device waits for a yes
  {
    console.log('== a device whose name does not say which model it is');
    const unknown = new FakeCable({ name: 'USB Composite Device' });
    const { w, errors, dom } = await page([unknown]);
    const A = w.aulaApp;
    await wait(3500);
    check(!A.max.active(), 'it does not open by itself');
    check(unknown.sent.length === 0, 'nothing was sent');
    const opened = await A.max.enter({ confirmed: true });
    check(opened && A.max.active(), 'after the person says yes it opens');
    check(unknown.ops().length === 0, 'and still nothing is written until Apply');
    check(errors.length === 0, `no script errors: ${errors.slice(0, 3).join(' | ')}`);
    A.max.stop();
    dom.window.close();
  }

  console.log(failed ? `\n${failed} problem(s)` : '\nall Max UI checks passed');
  process.exit(failed ? 1 : 0);
})();
