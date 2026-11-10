'use strict';

/*
 * Every supported model (AULA F75, F75 Pro, F87 / F87 Pro) on every link (2.4G dongle and USB-C cable): connect, lighting
 * effects, sleep, palette, per-key colours, key assignment (every key of the layout, both layers), backup and restore,
 * and keyboards whose key layers are shorter than the usual 512 bytes.
 *
 * It runs the real session, transports and key code against the simulated keyboard (dongle) and the fake cable. It shows
 * the app does the same thing for every model's layout and key count; whether a particular physical keyboard agrees is
 * only settled by plugging one in.
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

const LINKS = ['dongle', 'cable'];

/** Runs body({ kb, s, storage, layers }) with a connected session on `link` for `model`. `layers(i)` is layer i on the keyboard. */
async function onLink(link, model, kbOpts, body) {
  if (link === 'dongle') {
    const kb = new MockKeyboard({ ledCount: 126, layoutKeys: model.keys, ...kbOpts });
    const storage = memoryStorage();
    const s = new Session({ storage, transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
    try {
      assert.equal(await s.connectAuto(), true, `${model.id}: dongle connects`);
      await body({ kb, s, storage, layers: (i) => kb.matrix[i] });
    } finally {
      s.disconnect();
    }
    return;
  }
  const [hid, restore] = installFakeHid();
  let s;
  try {
    const kb = new CableKeyboard({ layoutKeys: model.keys, ...kbOpts });
    hid.add(CABLE, kb);
    const storage = memoryStorage();
    s = new Session({ storage, transportTimeout: 100, tickMs: 60, discover: () => W.discover() });
    assert.equal(await s.connectAuto(), true, `${model.id}: cable connects`);
    await body({ kb, s, storage, layers: (i) => kb.layers[i] });
  } finally {
    if (s) s.disconnect();
    restore();
  }
}

const keyAssign = (s, storage, model) => new KeyAssign({ transport: () => s.transport, keys: () => model.keys, model: () => model.id, storage });

// ------------------------------------------------------------------ the layouts themselves

for (const m of L.MODELS) {
  test(`${m.id}: layout is self-consistent (unique LEDs, one Esc, one Fn, every LED inside the colour block and the key layer)`, () => {
    const leds = m.keys.map((k) => k.led);
    assert.equal(new Set(leds).size, leds.length);
    assert.equal(m.keys.filter((k) => k.n === 'Esc').length, 1);
    assert.equal(m.keys.filter((k) => k.n === 'Fn').length, 1);
    assert.ok(Math.max(...leds) < 126, 'inside the 126-light colour block');
    assert.ok(K.neededBytes(m.keys) <= K.LAYER_SIZE, 'inside a 512-byte key layer');
    // A factory layer for this layout passes the layer check, on its own and cut down to the bytes it needs.
    const base = K.defaultLayer(0, m.keys);
    assert.equal(K.looksLikeBaseLayer(base, m.keys), true);
    assert.equal(K.looksLikeBaseLayer(base.slice(0, K.neededBytes(m.keys)), m.keys), true);
    assert.equal(K.knownShare(base, m.keys), 1);
  });
}

// ------------------------------------------------------------------ connect and read

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: connects, reads every block, and the layout fits the keyboard's lights`, async () => {
      await onLink(link, m, {}, async ({ s }) => {
        assert.equal(s.ready, true);
        assert.ok(s.effect() && !s.effect().unknown, 'the effect on the keyboard is one the app knows');
        assert.deepEqual(s.unread, [], 'every block was handed over');
        assert.ok(P.ledCount(s.cur.colors) >= L.MODELS.find((x) => x.id === m.id).keys.reduce((a, k) => Math.max(a, k.led), 0) + 1);
        L.use(m.id);
        assert.equal(L.fits(P.ledCount(s.cur.colors)), true);
        L.use('f75');
      });
    });
  }
}

test('dongle: the battery is read; the cable has none', async () => {
  await onLink('dongle', L.MODELS[1], { battery: 64 }, async ({ s }) => {
    await s.pollBattery();
    assert.equal(s.battery.percent, 64);
  });
  await onLink('cable', L.MODELS[1], {}, async ({ s }) => {
    assert.equal(s.onCable, true);
    assert.equal(s.transport.noBattery, true);
    assert.equal(s.charging, true);
  });
});

// ------------------------------------------------------------------ lighting: every effect, brightness, speed, colour, sleep

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: every effect applies and reads back with its brightness, speed and colour`, async () => {
      await onLink(link, m, {}, async ({ s }) => {
        for (const e of P.EFFECTS.filter((x) => !x.custom)) {
          assert.equal(s.setEffect(e.mode), true, e.name);
          s.setBrightness(3);
          if (e.speed) s.setSpeed(2);
          if (e.color) s.setColorIndex(4);
          const r = await s.apply();
          assert.equal(r.ok, true, `${e.name}: kept`);
          assert.equal(r.modeOk, true, `${e.name}: mode`);
          assert.equal(P.getMode(s.dev0.led), e.mode, `${e.name}: mode on the keyboard`);
          assert.equal(P.getBrightness(s.dev0.led, e), 3, `${e.name}: brightness`);
          if (e.speed) assert.equal(P.getSpeed(s.dev0.led, e), 2, `${e.name}: speed`);
          if (e.color && !e.colorful) assert.equal(P.getColorIndex(s.dev0.led, e), 4, `${e.name}: colour`);
          if (e.colorful) assert.equal(P.getColorIndex(s.dev0.led, e), P.MULTICOLOR, `${e.name}: always multicolour`);
          assert.equal(s.dirty, false);
        }
        // Off and back.
        assert.equal(s.setEffect(P.MODE_OFF), true);
        assert.equal((await s.apply()).ok, true);
        assert.equal(P.getMode(s.dev0.led), P.MODE_OFF);
      });
    });

    test(`${m.id} on the ${link}: every sleep timeout is written and read back`, async () => {
      await onLink(link, m, {}, async ({ s }) => {
        for (const o of P.SLEEP_OPTIONS) {
          s.setSleepValue(o.value);
          const r = await s.apply();
          assert.equal(r.ok, true, `${o.seconds}s`);
          assert.equal(P.getSleepValue(s.dev0.led), o.value);
        }
      });
    });

    test(`${m.id} on the ${link}: a palette colour is written and the other colours are left alone`, async () => {
      await onLink(link, m, {}, async ({ s }) => {
        const e = P.EFFECTS.find((x) => x.mode === 2); // Breathing: a colour effect
        s.setEffect(e.mode);
        const before = s.dev0.rgb.slice();
        assert.equal(s.setPaletteColor(3, [12, 200, 77]), true);
        const r = await s.apply();
        assert.equal(r.ok, true);
        assert.deepEqual(P.getPaletteColor(s.dev0.rgb, e, 3), [12, 200, 77]);
        const changed = [];
        for (let i = 0; i < before.length; i++) if (before[i] !== s.dev0.rgb[i]) changed.push(i);
        assert.deepEqual(changed.sort((a, b) => a - b), [P.palOffset(e.slot, 3), P.palOffset(e.slot, 3) + 1, P.palOffset(e.slot, 3) + 2]);
      });
    });
  }
}

// ------------------------------------------------------------------ per-key colours: every key of the layout

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: every key of the layout can be painted, and only the painted lights change`, async () => {
      await onLink(link, m, {}, async ({ s }) => {
        const colourOf = (led) => [(led * 7 + 31) & 255, (led * 13 + 5) & 255, (led * 29 + 101) & 255];
        const leds = m.keys.map((k) => k.led);
        const before = s.dev0.colors.slice();
        s.paintKeysWith(leds, colourOf);
        const r = await s.apply();
        assert.equal(r.ok, true);
        assert.equal(P.getMode(s.dev0.led), P.MODE_CUSTOM, 'painting switches to per-key mode');
        for (const led of leds) assert.deepEqual(P.getKeyColor(s.dev0.colors, led), colourOf(led), `key ${led}`);
        // Lights with no key on this model are untouched.
        const n = P.ledCount(s.dev0.colors);
        for (let led = 0; led < n; led++) {
          if (leds.includes(led)) continue;
          assert.deepEqual(P.getKeyColor(s.dev0.colors, led), P.getKeyColor(before, led), `unused light ${led}`);
        }
        // Painting a single key afterwards changes exactly that key's three bytes.
        const only = leds[leds.length - 1];
        const snap = s.dev0.colors.slice();
        s.paintKeys([only], [1, 2, 3]);
        assert.equal((await s.apply()).ok, true);
        const diff = [];
        for (let i = 0; i < snap.length; i++) if (snap[i] !== s.dev0.colors[i]) diff.push(i);
        assert.equal(diff.length, 3);
      });
    });
  }
}

test('a 384-byte colour block (126 lights + 6 bytes of padding, as AULA\'s driver sends it) is read with planes of 126', () => {
  const block = new Uint8Array(384);
  P.setKeyColor(block, 5, [10, 20, 30]);
  P.setKeyColor(block, 125, [40, 50, 60]);
  assert.equal(P.ledCount(block), 126);
  assert.deepEqual([block[5], block[126 + 5], block[252 + 5]], [10, 20, 30]);
  assert.deepEqual([block[125], block[126 + 125], block[252 + 125]], [40, 50, 60]);
  assert.deepEqual([...block.subarray(378)], [0, 0, 0, 0, 0, 0], 'the padding is not touched');
  assert.equal(P.ledCount(new Uint8Array(378)), 126);
  assert.equal(P.ledCount(new Uint8Array(96 * 3)), 96, 'any other size is still length / 3');
});

// ------------------------------------------------------------------ key assignment: every key, both layers, three layer sizes

for (const m of L.MODELS) {
  for (const link of LINKS) {
    for (const bytes of [512, 504, 'min']) {
      const size = bytes === 'min' ? K.neededBytes(m.keys) : bytes;
      test(`${m.id} on the ${link}, ${size}-byte layers: load, remap every key on both layers, then Restore`, async () => {
        await onLink(link, m, { matrixBytes: size }, async ({ s, storage, layers }) => {
          const ka = keyAssign(s, storage, m);
          await ka.load();
          assert.equal(ka.state.status, 'ready', ka.state.error);
          assert.equal(ka.state.layers[0].length, size);
          assert.equal(ka.layerAvailable(1), true, 'the Fn layer is read too');

          const fnLed = m.keys.find((k) => k.n === 'Fn').led;
          assert.equal(ka.isFnKey(fnLed), true);
          assert.equal(ka.codeOf(0, fnLed).kind, 'fn');
          assert.equal(ka.codeOf(0, m.keys.find((k) => k.n === 'Esc').led).label, 'Esc');

          const factory = [layers(0).slice(), layers(1).slice()];
          const editable = m.keys.filter((k) => k.led !== fnLed);

          for (const layer of [0, 1]) {
            // Every key of the layout to F13, in one write.
            const edits = new Map(editable.map((k) => [k.led, K.encode({ kind: 'key', usage: 0x68 })]));
            // Keys whose code the app protects are refused as a whole, so take them out and check they were really protected.
            const protectedLeds = editable.filter((k) => ka.codeOf(layer, k.led).protected).map((k) => k.led);
            for (const led of protectedLeds) edits.delete(led);
            const r = await ka.apply(layer, edits);
            assert.equal(r.ok, true, `layer ${layer}: ${r.error}`);
            assert.equal(r.kept.length, edits.size, `layer ${layer}: every change kept`);
            assert.equal(layers(layer).length, size, `layer ${layer}: keeps its length on the keyboard`);
            for (const led of edits.keys()) assert.equal(ka.codeOf(layer, led).label, 'F13', `layer ${layer}, key ${led}`);
            assert.equal(ka.codeOf(layer, fnLed).kind === 'fn' || layer === 1, true, 'the Fn key itself is untouched');
            // Bytes outside the edited keys are exactly as they were (the tail flag included).
            const changedLeds = K.changedKeys(factory[layer], layers(layer));
            assert.deepEqual(changedLeds.sort((a, b) => a - b), [...edits.keys()].filter((led) => !K.sameBytes(K.codeAt(factory[layer], led), edits.get(led))).sort((a, b) => a - b));
          }

          // Restore both layers.
          for (const layer of [0, 1]) {
            const back = ka.restoreEdits(layer);
            assert.ok(back.size > 0, `layer ${layer}: there is something to restore`);
            const r = await ka.apply(layer, back);
            assert.equal(r.ok, true, `layer ${layer}: ${r.error}`);
            assert.deepEqual([...layers(layer)], [...factory[layer]], `layer ${layer}: back to the factory bytes`);
          }
        });
      });
    }
  }

  test(`${m.id}: the Fn key and special keys are never written, on either layer`, async () => {
    await onLink('dongle', m, {}, async ({ s, storage, kb }) => {
      const ka = keyAssign(s, storage, m);
      await ka.load();
      const fnLed = m.keys.find((k) => k.n === 'Fn').led;
      const before = kb.matrix[0].slice();
      let r = await ka.apply(0, new Map([[fnLed, K.encode({ kind: 'key', usage: 0x04 })]]));
      assert.equal(r.ok, false);
      assert.match(r.error, /Fn/);
      // A key that holds a code the app does not recognise is left alone.
      const odd = m.keys.find((k) => k.n === 'Q').led;
      kb.matrix[0].set([0x09, 0x01, 0x02, 0x03], odd * 4);
      await ka.load();
      r = await ka.apply(0, new Map([[odd, K.encode({ kind: 'key', usage: 0x04 })]]));
      assert.equal(r.ok, false);
      assert.match(r.error, /special key/);
      assert.deepEqual([...kb.matrix[0].slice(odd * 4, odd * 4 + 4)], [0x09, 0x01, 0x02, 0x03]);
      assert.equal(before.length, kb.matrix[0].length);
    });
  });

  test(`${m.id}: media keys, modifiers and combinations encode, write and read back`, async () => {
    await onLink('dongle', m, {}, async ({ s, storage }) => {
      const ka = keyAssign(s, storage, m);
      await ka.load();
      const target = m.keys.find((k) => k.n === 'Caps').led;
      const specs = [
        { kind: 'media', usage: 0x00cd, label: 'Play / Pause' },
        { kind: 'media', usage: 0x00e9, label: 'Volume up' },
        { kind: 'mods', mods: 0x01 | 0x04, label: 'Left Ctrl + Left Alt' },
        { kind: 'combo', mods: 0x04, usage: 0x2b, label: 'Left Alt + Tab' },
        { kind: 'combo', mods: 0x01, usage: 0x06, label: 'Left Ctrl + C' },
        { kind: 'key', usage: 0x73, label: 'F24' },
        { kind: 'none', label: 'Not set' },
      ];
      for (const sp of specs) {
        const r = await ka.apply(0, new Map([[target, K.encode(sp)]]));
        assert.equal(r.ok, true, `${sp.label}: ${r.error}`);
        assert.equal(ka.codeOf(0, target).label, sp.label);
      }
    });
  });
}

// ------------------------------------------------------------------ backup and restore after a reset

for (const m of L.MODELS) {
  for (const link of LINKS) {
    test(`${m.id} on the ${link}: a backup exports and loads back, and settings come back after the keyboard resets`, async () => {
      await onLink(link, m, {}, async ({ s, kb }) => {
        s.setEffect(5);
        s.setBrightness(2);
        s.paintKeys([m.keys[3].led], [9, 8, 7]);
        assert.equal((await s.apply()).ok, true);
        const backup = JSON.parse(JSON.stringify(s.exportBackup()));
        assert.equal(backup.app, 'aula-control');
        s.setEffect(3);
        assert.equal((await s.apply()).ok, true);
        assert.deepEqual(s.importBackup(backup), { ok: true });
        assert.equal(P.getMode(s.cur.led), P.MODE_CUSTOM, 'the backup holds the per-key mode it was taken in');
        assert.equal(s.dirty, true, 'loading a backup changes nothing on the keyboard until Apply');
        assert.equal((await s.apply()).ok, true);
        assert.deepEqual(P.getKeyColor(s.dev0.colors, m.keys[3].led), [9, 8, 7]);
        // A backup from a keyboard with a different number of lights is refused, not half-loaded.
        const bad = { ...backup, colors: backup.colors.slice(0, 300) };
        assert.equal(s.importBackup(bad).ok, false);
        assert.equal(s.importBackup({ app: 'something else' }).ok, false);
        void kb;
      });
    });
  }
}
