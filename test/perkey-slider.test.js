'use strict';

/*
 * The Per-key page has its own brightness slider (the row across the foot of the card). It sets the Per-key effect's level, the
 * same level the Lighting page shows for that effect, and it can only be used while Per-key is the effect: on any other effect the
 * level it would change belongs to that other effect.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const P = require('../src/js/protocol.js');
const L = require('../src/js/layout.js');
const { MockKeyboard } = require('../src/js/mock.js');
const { Session, memoryStorage } = require('../src/js/engine.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('the Per-key card has a brightness row with a slider, a meter and a value, set up like the Lighting one', () => {
  const html = read('index.html');
  const card = html.slice(html.indexOf('id="pkCard"'), html.indexOf('class="pk-foot"'));
  assert.match(card, /id="pkBright"[^>]*data-on="false"/, 'starts switched off until the page knows the effect');
  assert.match(card, /<input class="range" id="rngPkBright" type="range" min="0" max="4" step="1"/);
  assert.equal((card.match(/id="meterPkBright"[^>]*>(<i><\/i>)+/) || [''])[0].split('<i>').length - 1, 4, 'four ticks, grown to the keyboard\'s levels by app.js');
  assert.match(card, /id="valPkBright"/);
  assert.ok(card.indexOf('id="pkBright"') > card.indexOf('id="pkAll"'), 'it sits under the three columns');
});

test('app.js keeps the Per-key slider to the Per-key effect and grows it with the keyboard\'s brightness levels', () => {
  const js = read('js/app.js');
  assert.match(js, /\['#rngPkBright', '#meterPkBright'\]/, 'scale built for both sliders');
  assert.match(js, /const perKeyEffectOn = \(\) => !!session\.cur && P\.getMode\(session\.cur\.led\) === P\.MODE_CUSTOM/);
  assert.match(js, /\$\('#rngPkBright'\)\.addEventListener\('input', \(e\) => \{\s*if \(perKeyEffectOn\(\)\) session\.setBrightness/);
  assert.match(js, /rng\.disabled = !on;/, 'switched off while another effect is on');
  assert.match(js, /renderPerKeyBrightness\(ready\);/, 'drawn with the rest of the page');
});

test('the brightness row is styled across the card, and stacks with it in a narrow window', () => {
  const css = read('css/keys.css');
  assert.match(css, /\.pk-bright \{[^}]*grid-column: 1 \/ -1;/);
  assert.match(css, /\.pk-bright\[data-on="false"\]/);
  assert.match(css, /@media \(max-width: 880px\) \{[\s\S]*\.pk-bright \{ grid-template-columns: minmax\(0, 1fr\) auto;/);
});

test('the slider and the Lighting page share one level: the Per-key effect\'s own, so another effect keeps its own', async () => {
  const kb = new MockKeyboard({ ledCount: 126, layoutKeys: L.MODELS[0].keys });
  const s = new Session({ storage: memoryStorage(), transportTimeout: 150, discover: async () => [{ io: kb, meta: { mode: 'dongle', label: '2.4G dongle' } }] });
  try {
    assert.equal(await s.connectAuto(), true);
    const perKey = P.effectOf(P.MODE_CUSTOM);
    const rainbow = P.effectOf(3);
    // Per-key is the effect: the slider's level is the Per-key slot, and Rainbow's is left alone.
    s.setEffect(P.MODE_CUSTOM);
    const rainbowBefore = P.getBrightness(s.cur.led, rainbow);
    assert.ok(s.setBrightness(1));
    assert.equal(P.getBrightness(s.cur.led, perKey), 1);
    assert.equal(P.getBrightness(s.cur.led, rainbow), rainbowBefore);
    // Another effect is the one in use: the same call would change that effect's level, which is why the page switches the slider off.
    s.setEffect(3);
    s.setBrightness(2);
    assert.equal(P.getBrightness(s.cur.led, rainbow), 2);
    assert.equal(P.getBrightness(s.cur.led, perKey), 1, 'the Per-key level is untouched');
  } finally {
    s.disconnect();
  }
});
