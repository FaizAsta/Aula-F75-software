'use strict';

/*
 * Key assignment: the key codes, the layers, and the read-edit-write-verify loop over both links (the 2.4G dongle and the
 * USB-C cable), run against the simulated keyboard and the fake cable. They show the app does what the public protocol
 * notes describe and that it refuses the dangerous cases; whether a real keyboard agrees is settled by trying one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../src/js/protocol.js');
const K = require('../src/js/keys.js');
const L = require('../src/js/layout.js');
const W = require('../src/js/webhid.js');
const { KeyAssign } = require('../src/js/keyassign.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');
const { installFakeHid, CABLE } = require('./fake-hid.js');
const { CableKeyboard } = require('./fake-cable.js');

const keys = L.MODELS[0].keys; // F75
const led = (label, nth = 0) => keys.filter((k) => k.n === label)[nth].led;
const bytes = (...b) => Uint8Array.from(b);

// ------------------------------------------------------------------ the codes

test('key codes are the ones AULA\'s driver writes: [0, modifiers, 0, usage], consumer [2, 0, hi, lo]', () => {
  assert.deepEqual([...K.encode({ kind: 'key', usage: 0x2c })], [0, 0, 0, 0x2c]); // Space, as documented
  assert.deepEqual([...K.encode({ kind: 'media', usage: 0x00cd })], [2, 0, 0, 0xcd]); // Play/Pause, as documented
  assert.deepEqual([...K.encode({ kind: 'mods', mods: 0x08 })], [0, 0x08, 0, 0]); // the Windows key
  assert.deepEqual([...K.encode({ kind: 'combo', mods: 0x01, usage: 0x06 })], [0, 0x01, 0, 0x06]); // Ctrl+C
  assert.deepEqual([...K.encode({ kind: 'none' })], [0, 0, 0, 0]);
});

test('codes decode to names, and the Fn key and unknown codes are protected', () => {
  assert.equal(K.decode(bytes(0, 0, 0, 0x29)).label, 'Esc');
  assert.equal(K.decode(bytes(0, 0x04, 0, 0)).label, 'Left Alt');
  assert.equal(K.decode(bytes(0, 0x03, 0, 0x06)).label, 'Left Ctrl + Left Shift + C');
  assert.equal(K.decode(bytes(2, 0, 0, 0xcd)).label, 'Play / Pause');
  assert.equal(K.decode(bytes(3, 1, 1, 4)).kind, 'macro');
  assert.equal(K.decode(bytes(0, 0, 0, 0)).kind, 'none');
  assert.equal(K.decode(bytes(0x0d, 0, 0, 0)).protected, true);
  assert.equal(K.decode(bytes(0x0d, 0, 0, 0)).kind, 'fn');
  assert.equal(K.decode(bytes(0x55, 1, 2, 3)).protected, true); // a type this app does not know
  assert.equal(K.decode(bytes(0, 0, 0x01, 0x04)).protected, true); // a wide usage it does not know
  assert.equal(K.decode(bytes(0, 0, 0, 0x29)).protected, false);
});

test('encode refuses what it cannot write', () => {
  assert.throws(() => K.encode({ kind: 'key', usage: 0xff }), RangeError);
  assert.throws(() => K.encode({ kind: 'media', usage: 0x1234 }), RangeError);
  assert.throws(() => K.encode({ kind: 'mods', mods: 0 }), RangeError);
  assert.throws(() => K.encode({ kind: 'macro' }), RangeError);
  assert.throws(() => K.encode({ kind: 'fn' }), RangeError); // the Fn code can never be written
});

test('every key the palette offers has a name, and encodes and decodes to itself', () => {
  for (const g of K.GROUPS) {
    for (const u of g.usages) {
      assert.ok(K.NAMES.has(u), `${g.id}: usage 0x${u.toString(16)} has no name`);
      const d = K.decode(K.encode({ kind: 'key', usage: u }));
      assert.equal(d.kind, 'key');
      assert.equal(d.usage, u);
    }
  }
  for (const m of K.MEDIA) assert.equal(K.decode(K.encode({ kind: 'media', usage: m.usage })).usage, m.usage);
});

test('a layer is edited key by key: the other 508 bytes, including the trailing flag, stay as they were', () => {
  const base = K.defaultLayer(0, keys);
  const next = K.withCode(base, led('Caps'), K.encode({ kind: 'key', usage: 0x29 }));
  assert.deepEqual(K.changedKeys(base, next), [led('Caps')]);
  assert.deepEqual([...next.slice(-4)], [0x00, 0x00, 0x5a, 0xa5]);
  assert.equal(base.length, 512);
  assert.throws(() => K.withCode(base, 200, bytes(0, 0, 0, 0)), RangeError);
});

test('the layout\'s led is the matrix index: Esc 0, Win 11, Alt 17, Fn 53 on the F75', () => {
  assert.equal(led('Esc'), 0);
  assert.equal(led('Win'), 11);
  assert.equal(led('Alt'), 17);
  assert.equal(led('Fn'), 53);
  const base = K.defaultLayer(0, keys);
  assert.deepEqual([...K.codeAt(base, 53)], [0x0d, 0, 0, 0]);
  assert.deepEqual([...K.codeAt(base, 11)], [0, 0x08, 0, 0]);
});

test('a layer is only taken for the normal layer if Esc is Esc or Fn is where the layout puts it', () => {
  const base = K.defaultLayer(0, keys);
  assert.equal(K.looksLikeBaseLayer(base, keys), true);
  assert.equal(K.looksLikeBaseLayer(K.withCode(base, 0, bytes(0, 0, 0, 0x04)), keys), true); // Esc remapped, Fn still there
  assert.equal(K.looksLikeBaseLayer(new Uint8Array(512), keys), false);
  assert.equal(K.looksLikeBaseLayer(base.slice(0, 100), keys), false);
  assert.equal(K.looksLikeBaseLayer(K.defaultLayer(1, keys), keys), false);
});

// ------------------------------------------------------------------ the 2.4G dongle

async function dongle(mockOpts = {}) {
  const mock = new MockKeyboard(mockOpts);
  const storage = memoryStorage();
  const s = new Session({ storage, transportTimeout: 150, discover: async () => [{ io: mock, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
  assert.equal(await s.connectAuto(), true);
  const ka = new KeyAssign({ transport: () => s.transport, keys: () => keys, model: () => 'f75', storage });
  return { mock, s, ka, storage };
}

test('dongle: the layers are read with the documented commands (0x41, layer in the sub nibble) and decode', async () => {
  const { mock, s, ka } = await dongle();
  await ka.load();
  assert.equal(ka.state.status, 'ready', ka.state.error);
  assert.equal(ka.codeOf(0, led('Esc')).label, 'Esc');
  assert.equal(ka.codeOf(0, led('Fn')).kind, 'fn');
  assert.equal(ka.codeOf(1, led('F1')).label, 'Mute');
  const reads = mock.sent.filter((p) => p[1] === P.CMD.GET_MATRIX);
  assert.deepEqual([...new Set(reads.map((p) => p[4] >> 4))].sort(), [0, 1]);
  s.disconnect();
});

test('dongle: assigning a key writes the layer in 14-byte fragments (cmd 0x01), then reads it back', async () => {
  const { mock, s, ka } = await dongle();
  await ka.load();
  const r = await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'key', usage: 0x29 })]]));
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.kept, [led('Caps')]);
  assert.equal(ka.codeOf(0, led('Caps')).label, 'Esc');
  assert.equal(K.decode(K.codeAt(mock.matrix[0], led('Caps'))).label, 'Esc'); // the keyboard really has it
  const writes = mock.sent.filter((p) => p[1] === P.CMD.SET_MATRIX);
  assert.equal(writes.length, 37); // 512 bytes in 14-byte fragments
  assert.ok(writes.every((p) => p[2] === 37 && p[4] >> 4 === 0));
  // Only that key changed on the keyboard.
  assert.deepEqual(K.changedKeys(K.defaultLayer(0, keys), mock.matrix[0]), [led('Caps')]);
  s.disconnect();
});

test('dongle: the Fn layer is written under its own layer number and leaves the normal layer alone', async () => {
  const { mock, s, ka } = await dongle();
  await ka.load();
  const before0 = mock.matrix[0].slice();
  const r = await ka.apply(1, new Map([[led('F5'), K.encode({ kind: 'media', usage: 0x00b5 })]]));
  assert.equal(r.ok, true, r.error);
  assert.equal(K.decode(K.codeAt(mock.matrix[1], led('F5'))).label, 'Next track');
  assert.deepEqual([...mock.matrix[0]], [...before0]);
  assert.ok(mock.sent.filter((p) => p[1] === P.CMD.SET_MATRIX).every((p) => p[4] >> 4 === 1));
  s.disconnect();
});

test('dongle: the Fn key is never written, nor is a code the app does not know', async () => {
  const { mock, s, ka } = await dongle();
  mock.matrix[0] = K.withCode(mock.matrix[0], led('Q'), bytes(0x44, 1, 2, 3)); // a special key
  await ka.load();
  const sentBefore = mock.sent.length;
  const a = await ka.apply(0, new Map([[led('Fn'), K.encode({ kind: 'none' })]]));
  assert.equal(a.ok, false);
  assert.match(a.error, /Fn/);
  const b = await ka.apply(0, new Map([[led('Q'), K.encode({ kind: 'key', usage: 0x04 })]]));
  assert.equal(b.ok, false);
  assert.match(b.error, /special/);
  assert.equal(mock.sent.slice(sentBefore).filter((p) => p[1] === P.CMD.SET_MATRIX).length, 0, 'nothing was written');
  s.disconnect();
});

test('dongle: a keyboard that ignores the write is reported, with what it really holds', async () => {
  const { mock, s, ka } = await dongle({ dropWrites: true });
  await ka.load();
  const r = await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'key', usage: 0x29 })]]));
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [led('Caps')]);
  assert.match(r.error, /did not keep/);
  assert.equal(ka.codeOf(0, led('Caps')).label, 'Caps Lock'); // the state shows the truth, not the request
  assert.equal(ka.state.status, 'ready');
  s.disconnect();
});

test('dongle: a normal layer that does not look like the layout switches key assignment off, and nothing is written', async () => {
  const { mock, s, ka } = await dongle();
  mock.matrix[0] = new Uint8Array(512);
  await ka.load();
  assert.equal(ka.state.status, 'error');
  assert.match(ka.state.error, /protect/);
  const r = await ka.apply(0, new Map([[5, K.encode({ kind: 'none' })]]));
  assert.equal(r.ok, false);
  assert.equal(mock.sent.filter((p) => p[1] === P.CMD.SET_MATRIX).length, 0);
  s.disconnect();
});

test('dongle: two layers that read back identical are not written to', async () => {
  const { mock, s, ka } = await dongle();
  mock.matrix[1] = mock.matrix[0].slice(); // a keyboard that answers layer 1 with layer 0
  await ka.load();
  assert.equal(ka.state.status, 'ready');
  assert.equal(ka.layerAvailable(1), false);
  const r = await ka.apply(1, new Map([[led('F1'), K.encode({ kind: 'none' })]]));
  assert.equal(r.ok, false);
  assert.equal(mock.sent.filter((p) => p[1] === P.CMD.SET_MATRIX).length, 0);
  s.disconnect();
});

test('dongle: a keyboard with no answer for its key layers leaves the app working, key assignment unavailable', async () => {
  const { s, ka } = await dongle({ matrix: false });
  await ka.load();
  assert.equal(ka.state.status, 'error');
  assert.ok(s.ready, 'lighting is unaffected');
  s.disconnect();
});

test('restore: the layers as first read are kept and put back, one key or the whole layer', async () => {
  const { mock, s, ka, storage } = await dongle();
  await ka.load();
  assert.ok(storage.getItem('aula.keys.original.f75'));
  await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'key', usage: 0x29 })], [led('Tab'), K.encode({ kind: 'none' })]]));
  assert.deepEqual(K.changedKeys(K.defaultLayer(0, keys), mock.matrix[0]).sort((a, b) => a - b), [led('Caps'), led('Tab')].sort((a, b) => a - b));
  const one = ka.restoreEdits(0, led('Caps'));
  assert.equal(one.size, 1);
  assert.equal((await ka.apply(0, one)).ok, true);
  assert.deepEqual(K.changedKeys(K.defaultLayer(0, keys), mock.matrix[0]), [led('Tab')]);
  const all = ka.restoreEdits(0);
  assert.equal((await ka.apply(0, all)).ok, true);
  assert.deepEqual([...mock.matrix[0]], [...K.defaultLayer(0, keys)]);
  // A second session on the same storage keeps the first original, not what is on the keyboard now.
  await ka.apply(0, new Map([[led('A'), K.encode({ kind: 'key', usage: 0x05 })]]));
  const again = new KeyAssign({ transport: () => s.transport, keys: () => keys, model: () => 'f75', storage });
  await again.load();
  assert.equal(again.originalOf(0, led('A')).label, 'A');
  s.disconnect();
});

// ------------------------------------------------------------------ the USB-C cable

async function withCable(body, kbOpts = {}) {
  const [hid, restore] = installFakeHid();
  const sessions = [];
  try {
    const kb = new CableKeyboard(kbOpts);
    hid.add(CABLE, kb);
    const storage = memoryStorage();
    const s = new Session({ storage, transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
    sessions.push(s);
    assert.equal(await s.connectAuto(), true);
    const ka = new KeyAssign({ transport: () => s.transport, keys: () => keys, model: () => 'f75', storage });
    await body({ kb, s, ka });
  } finally {
    for (const s of sessions) s.disconnect();
    restore();
  }
}

test('cable: layers are read with feature command 0x83 and the layer in byte 2 of the header', async () => {
  await withCable(async ({ kb, ka }) => {
    await ka.load();
    assert.equal(ka.state.status, 'ready', ka.state.error);
    assert.equal(ka.codeOf(0, led('Esc')).label, 'Esc');
    assert.equal(ka.codeOf(1, led('F1')).label, 'Mute');
    const asks = kb.sets.filter((b) => b[0] === 0x83);
    assert.deepEqual([...new Set(asks.map((b) => b[1]))].sort(), [0, 1]);
    assert.ok(asks.every((b) => (b[5] | (b[6] << 8)) === 512));
  });
});

test('cable: a write is one feature report, command 0x03, the layer in the header and the whole 512-byte layer', async () => {
  await withCable(async ({ kb, ka }) => {
    await ka.load();
    const r = await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'combo', mods: 0x01, usage: 0x06 })]]));
    assert.equal(r.ok, true, r.error);
    const w = kb.writes.filter((x) => x.block === 'matrix');
    assert.equal(w.length, 1);
    assert.equal(w[0].layer, 0);
    assert.equal(w[0].size, 512);
    assert.equal(K.decode(K.codeAt(kb.layers[0], led('Caps'))).label, 'Left Ctrl + C');
    assert.deepEqual(K.changedKeys(K.defaultLayer(0, keys), kb.layers[0]), [led('Caps')]);
  });
});

test('cable: writing the Fn layer goes to layer 1 and leaves layer 0 alone', async () => {
  await withCable(async ({ kb, ka }) => {
    await ka.load();
    const before0 = kb.layers[0].slice();
    const r = await ka.apply(1, new Map([[led('F6'), K.encode({ kind: 'media', usage: 0x00b6 })]]));
    assert.equal(r.ok, true, r.error);
    assert.equal(kb.writes.find((x) => x.block === 'matrix').layer, 1);
    assert.deepEqual([...kb.layers[0]], [...before0]);
  });
});

test('cable: a keyboard that drops the write is reported', async () => {
  await withCable(async ({ ka }) => {
    await ka.load();
    const r = await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'none' })]]));
    assert.equal(r.ok, false);
    assert.match(r.error, /did not keep/);
  }, { dropMatrixWrites: true });
});

test('cable: a cable that does not serve the key layers leaves lighting working and key assignment off', async () => {
  await withCable(async ({ s, ka }) => {
    await ka.load();
    assert.equal(ka.state.status, 'error');
    assert.ok(s.ready);
  }, { serves: ['led', 'rgb', 'colors'] });
});

// ------------------------------------------------------------------ the tab in the page

test('the Keys tab is in the page, its scripts load before the code that needs them, and app.js hands it the session', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const html = read('src/index.html');
  assert.match(html, /id="tab-keys" data-tab="keys"/);
  assert.match(html, /id="panel-keys"/);
  // Key assignment is experimental, and the tab and the panel both say so (the dot is dropped on the F75 Max screen).
  assert.match(html, /id="tab-keys"[^>]*title="Keys \(experimental\)"/);
  assert.match(html, /<span class="exp-badge">Experimental<\/span>/);
  const keysCss = read('src/css/keys.css');
  assert.match(keysCss, /#tab-keys::after\s*\{\s*content:\s*''/);
  assert.match(keysCss, /\[data-family="max"\] #tab-keys::after\s*\{\s*content:\s*none/);
  assert.match(html, /css\/keys\.css/);
  const order = [...html.matchAll(/<script src="js\/([\w-]+)\.js"><\/script>/g)].map((m) => m[1]);
  const at = (n) => order.indexOf(n);
  assert.ok(at('keys') > -1 && at('keys') < at('mock'), 'the mock keyboard builds its key layers from keys.js');
  assert.ok(at('layout') > -1 && at('layout') < at('mock'), 'and from the layout');
  assert.ok(at('keyassign') > at('engine') && at('keys-ui') > at('keyassign') && at('keys-ui') < at('app'));
  const app = read('src/js/app.js');
  assert.match(app, /AulaKeysUI\.create/);
  assert.match(app, /TAB_ORDER = \['lighting', 'perkey', 'keys', 'battery', 'settings'\]/);
  // Every id the tab's script looks up exists in the page.
  const ui = read('src/js/keys-ui.js');
  for (const id of new Set([...ui.matchAll(/\$\('#(ka[A-Za-z]+|segLayer)'\)/g)].map((m) => m[1]))) assert.ok(html.includes(`id="${id}"`), `#${id} is missing from index.html`);
});

test('the package ships every file the Keys tab needs', () => {
  const pkg = require('../package.json');
  assert.ok(pkg.build.files.some((f) => f === 'src/**/*'), 'src/ is packaged as a whole, so keys.js, keyassign.js and keys-ui.js go with it');
});


// ------------------------------------------------------------------ keyboards whose layers are not 512 bytes
// A real F75 Pro on the dongle answered a layer read with fewer than 512 bytes, and the Keys tab showed "The keyboard
// sent a key layer that is too short". A layer is now accepted at whatever length holds every key of the layout, and
// written back at that same length.

const NEED = K.neededBytes(keys); // 360 for the F75 layout (highest led 89)

test('a layout\'s needed bytes follow its highest led, not a fixed 512', () => {
  assert.equal(NEED, (Math.max(...keys.map((k) => k.led)) + 1) * 4);
  assert.ok(NEED < K.LAYER_SIZE);
});

test('looksLikeBaseLayer: a shorter layer passes when it holds every key and nearly all decode, and not otherwise', () => {
  const full = K.defaultLayer(0, keys);
  for (const n of [NEED, 384, 504]) assert.equal(K.looksLikeBaseLayer(full.slice(0, n), keys), true, `${n} bytes`);
  assert.equal(K.looksLikeBaseLayer(full.slice(0, NEED - 4), keys), false, 'one key short of the layout');
  // The same bytes read one byte out of step decode to garbage: refused, although the first four bytes could pass.
  const shifted = new Uint8Array(504);
  shifted.set(full.slice(0, 503), 1);
  shifted.set([0, 0, 0, 0x29], 0);
  assert.equal(K.looksLikeBaseLayer(shifted, keys), false);
});

for (const bytes504 of [504, 384, NEED]) {
  test(`dongle: a keyboard that sends ${bytes504}-byte layers loads, edits and writes back at ${bytes504} bytes`, async () => {
    const { mock, s, ka } = await dongle({ matrixBytes: bytes504 });
    await ka.load();
    assert.equal(ka.state.status, 'ready', ka.state.error);
    assert.equal(ka.state.layers[0].length, bytes504);
    assert.equal(ka.codeOf(0, led('Esc')).label, 'Esc');
    assert.equal(ka.codeOf(1, led('F1')).label, 'Mute');
    const r = await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'key', usage: 0x29 })]]));
    assert.equal(r.ok, true, r.error);
    assert.equal(ka.codeOf(0, led('Caps')).label, 'Esc');
    assert.equal(mock.matrix[0].length, bytes504, 'the layer on the keyboard keeps its length');
    const writes = mock.sent.filter((p) => p[1] === P.CMD.SET_MATRIX);
    assert.equal(writes.length, Math.ceil(bytes504 / 14)); // exactly the fragments the layer needs, no padding made up
    assert.deepEqual(K.changedKeys(K.defaultLayer(0, keys).slice(0, bytes504), mock.matrix[0]), [led('Caps')]);
    s.disconnect();
  });
}

test('dongle: a layer too short for the layout still says why, with the real size', async () => {
  const { s, ka } = await dongle({ matrixBytes: 128 });
  await ka.load();
  assert.equal(ka.state.status, 'error');
  assert.match(ka.state.error, /sent 128 bytes/);
  assert.match(ka.state.error, new RegExp(`at least ${NEED}`));
  s.disconnect();
});

test('dongle: the original of a short layer is remembered at its own length, and Restore puts a key back', async () => {
  const { mock, s, ka, storage } = await dongle({ matrixBytes: 504 });
  await ka.load();
  await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'key', usage: 0x29 })]]));
  const again = new KeyAssign({ transport: () => s.transport, keys: () => keys, model: () => 'f75', storage });
  await again.load();
  assert.equal(again.state.status, 'ready', again.state.error);
  assert.equal(again.originalOf(0, led('Caps')).label, 'Caps Lock', 'the saved original was not overwritten by the edited layer');
  const edits = again.restoreEdits(0);
  assert.deepEqual([...edits.keys()], [led('Caps')]);
  const r = await again.apply(0, edits);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([...mock.matrix[0]], [...K.defaultLayer(0, keys).slice(0, 504)]);
  s.disconnect();
});

test('restoreEdits never restores a key the saved original does not hold', () => {
  const ka = new KeyAssign({ transport: () => null, keys: () => keys, model: () => 'f75' });
  const full = K.defaultLayer(0, keys);
  ka.state = { ...ka.state, layers: [full, null], original: [full.slice(0, 40), null] }; // original holds keys 0..9 only
  assert.equal(ka.restoreEdits(0, led('Caps')).size, 0);
});

test('cable: a keyboard that holds 504-byte layers loads, edits and writes the same length', async () => {
  await withCable(async ({ kb, ka }) => {
    await ka.load();
    assert.equal(ka.state.status, 'ready', ka.state.error);
    assert.equal(ka.state.layers[0].length, 504);
    const r = await ka.apply(0, new Map([[led('Caps'), K.encode({ kind: 'combo', mods: 0x01, usage: 0x06 })]]));
    assert.equal(r.ok, true, r.error);
    const w = kb.writes.filter((x) => x.block === 'matrix');
    assert.equal(w.length, 1);
    assert.equal(w[0].size, 504);
    assert.equal(kb.layers[0].length, 504);
    assert.equal(K.decode(K.codeAt(kb.layers[0], led('Caps'))).label, 'Left Ctrl + C');
  }, { matrixBytes: 504 });
});
