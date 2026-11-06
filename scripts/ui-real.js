// The real screen against a fake USB device on the 2.4G dongle (not the demo keyboard) whose key layers are 512, 504 or
// the minimum bytes, for every model: opens the Keys tab, remaps a key, applies it, restores it, then applies a lighting effect.
// Run: npm install --no-save jsdom && node scripts/ui-real.js
const { boot, until, wait } = require('./ui-smoke.js');
const path = require('path');
const { FakeHid } = require(path.join(__dirname, '..', 'test', 'fake-hid.js'));
const { MockKeyboard } = require('../src/js/mock.js');
const Lay = require('../src/js/layout.js');
const K = require('../src/js/keys.js');

(async () => {
  let failed = 0;
  const check = (c, m) => { if (!c) { failed++; console.log('  FAIL:', m); } };
  for (const model of Lay.MODELS) {
    for (const size of [512, 504, K.neededBytes(model.keys)]) {
      const hid = new FakeHid();
      const kb = new MockKeyboard({ ledCount: 126, layoutKeys: model.keys, matrixBytes: size, latency: 2 });
      hid.add({ vendorId: 0x3554, productId: 0xfa09, productName: 'AULA 2.4G dongle' }, kb);
      const { w, errors, dom } = await boot(model.id, { demo: false, hid });
      const A = w.aulaApp;
      const ok = await until(() => A.session.ready, 8000);
      check(ok, `${model.id}/${size}: connects over the fake dongle (${A.session.status} ${A.session.statusDetail})`);
      if (!ok) { dom.window.close(); continue; }
      A.setTab('keys');
      await until(() => ['ready', 'error'].includes(A.keys.ka.state.status), 8000);
      check(A.keys.ka.state.status === 'ready', `${model.id}/${size}: Keys tab loads (${A.keys.ka.state.error})`);
      const doc = w.document;
      const caps = w.AulaLayout.KEYS.find((k) => k.n === 'Caps');
      A.keys.pick(caps);
      await wait(50);
      doc.querySelector('#kaGroups [data-group="fkeys"]').click();
      await wait(30);
      [...doc.querySelectorAll('#kaGrid .ka-key')][12].click(); // F13
      await wait(30);
      doc.getElementById('kaApply').click();
      await until(() => A.keys.pendingCount() === 0, 6000);
      check(kb.matrix[0].length === size, `${model.id}/${size}: layer length on the keyboard stays ${size} (is ${kb.matrix[0].length})`);
      check(K.decode(K.codeAt(kb.matrix[0], caps.led)).label === 'F13', `${model.id}/${size}: the keyboard now has F13 on Caps`);
      check(K.changedKeys(K.defaultLayer(0, model.keys).slice(0, size), kb.matrix[0]).join() === String(caps.led), `${model.id}/${size}: only Caps changed`);
      // Restore
      A.keys.pick(caps); await wait(40);
      doc.getElementById('kaRestoreKey').click(); await wait(30);
      doc.getElementById('kaApply').click();
      await until(() => A.keys.pendingCount() === 0, 6000);
      check(K.sameBytes(kb.matrix[0], K.defaultLayer(0, model.keys).slice(0, size)), `${model.id}/${size}: Restore puts the factory layer back`);
      // lighting through the real screen
      A.setTab('lighting'); await wait(60);
      [...doc.querySelectorAll('#effects button')][3].click(); await wait(30);
      doc.getElementById('btnApply').click();
      await until(() => !A.session.dirty, 6000);
      check(!A.session.dirty, `${model.id}/${size}: lighting applies`);
      check(errors.length === 0, `${model.id}/${size}: no script errors: ${errors.slice(0, 3).join(' | ')}`);
      console.log(`${model.id} / ${size} bytes:`, errors.length ? 'errors' : 'ok');
      A.session.disconnect(); A.session.unwatch && A.session.unwatch();
      dom.window.close();
    }
  }
  console.log(failed ? `\n${failed} problem(s)` : '\nall real-path UI checks passed');
  process.exit(failed ? 1 : 0);
})();
