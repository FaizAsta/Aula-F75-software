// Prints, as JSON, what the board renderer (render.py) needs from the app: each skin's colours and the layout it is drawn
// on, so the renders always match layout.js and skins.js and nothing is typed in twice.
//   node scripts/render-board/dump-models.js > models.json
const L = require('../../src/js/layout.js');
const S = require('../../src/js/skins.js');

const out = {};
for (const m of L.MODELS) {
  const skin = S.get(m.skin || m.id);
  if (out[skin.id]) continue; // models that share a skin share the picture
  const caps = new Set();
  for (const k of m.keys) {
    const acc = S.accentOf(skin, k.n);
    const name = acc ? Object.keys(skin.accents).find((a) => skin.accents[a] === acc) : '-';
    caps.add(`${k.w}|${name}`);
  }
  out[skin.id] = {
    skin,
    model: m.id,
    width: m.width !== undefined ? m.width : m.WIDTH,
    height: m.height !== undefined ? m.height : m.HEIGHT,
    keys: m.keys.map((k) => ({ n: k.n, x: k.x, y: k.y, w: k.w })),
    caps: [...caps].map((c) => {
      const [w, accent] = c.split('|');
      return { w: Number(w), accent };
    }),
    knob: !!m.knob,
  };
}
// The F75 Max is not in layout.js (it has its own key table, max.js), so its keys come from there. Its keys sit on a
// 16 x 6 grid with no gap under the function row.
try {
  const MX = require('../../src/js/max.js');
  const skin = S.get('max');
  if (skin && skin.id === 'max' && !out.max) {
    const keys = MX.keyLayout().map((k) => ({ n: k.name, x: k.x, y: k.y, w: k.w }));
    const caps = new Set();
    for (const k of keys) {
      const acc = S.accentOf(skin, k.n);
      const name = acc ? Object.keys(skin.accents).find((a) => skin.accents[a] === acc) : '-';
      caps.add(`${k.w}|${name}`);
    }
    out.max = {
      skin,
      model: 'max',
      width: 16,
      height: 6,
      keys,
      caps: [...caps].map((c) => {
        const [w, accent] = c.split('|');
        return { w: Number(w), accent };
      }),
      knob: !!skin.knob,
    };
  }
} catch (e) {
  process.stderr.write(`F75 Max left out: ${e.message}\n`);
}

process.stdout.write(JSON.stringify(out, null, 1));
