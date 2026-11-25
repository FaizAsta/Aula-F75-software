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
// The F75 Max and the F75 HE are not in layout.js (they have their own key tables, max.js and he.js). Their keys sit on a
// 16 x 6 grid with no gap under the function row.
for (const [id, file] of [['max', '../../src/js/max.js'], ['f75he', '../../src/js/he.js']]) {
  try {
    const KB = require(file);
    const skin = S.get(id);
    if (!skin || skin.id !== id || out[id]) continue;
    const keys = KB.keyLayout().map((k) => ({ n: k.legend, x: k.x, y: k.y, w: k.w })); // by the label the preview prints (layout.js), as the skins list them
    const caps = new Set();
    for (const k of keys) {
      const acc = S.accentOf(skin, k.n);
      const name = acc ? Object.keys(skin.accents).find((a) => skin.accents[a] === acc) : '-';
      caps.add(`${k.w}|${name}`);
    }
    const grid = KB.GRID || { w: 16, h: 6 };
    out[id] = {
      skin,
      model: id,
      width: grid.w,
      height: grid.h,
      keys,
      caps: [...caps].map((c) => {
        const [w, accent] = c.split('|');
        return { w: Number(w), accent };
      }),
      knob: !!skin.knob,
    };
  } catch (e) {
    process.stderr.write(`${id} left out: ${e.message}\n`);
  }
}

process.stdout.write(JSON.stringify(out, null, 1));
