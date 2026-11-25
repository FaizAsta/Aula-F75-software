'use strict';

/*
 * Video backgrounds / live wallpapers (Settings > Theme > Background > Video or live wallpaper).
 *
 * A video is far too big for the remembered-data file, so the main process copies it into the app's own folder under a name it
 * makes itself, and the page remembers only that name. These tests check the name and file rules, the real copying and tidying
 * on a real folder, and that the page, the preload, the main process and the build are wired together.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BG = require('../src/js/background.js');
const bgvideo = require('../bgvideo.js');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'aula-bgvideo-'));

// ------------------------------------------------------------------ names and files

test('only names made by newVideoName() are accepted as kept videos', () => {
  const name = BG.newVideoName('MP4', 1732190000000);
  assert.equal(name, 'bg-1732190000000.mp4');
  assert.ok(BG.isVideoName(name));
  for (const e of BG.VIDEO_EXTENSIONS) assert.ok(BG.isVideoName(BG.newVideoName(e, 1732190000000)), e);
  for (const bad of ['', null, undefined, 42, 'bg-1.mp4', 'video.mp4', '../bg-1732190000000.mp4', 'bg-1732190000000.mp4/x', 'bg-1732190000000.exe', 'bg-1732190000000.mp4 ', 'bg-17321900000x0.mp4', 'a/bg-1732190000000.mp4', 'bg-1732190000000.mp4\u0000.png']) {
    assert.equal(BG.isVideoName(bad), false, `${String(bad)} is refused`);
  }
  assert.equal(BG.newVideoName('exe', 1732190000000), '', 'no name for a type that is not offered');
  assert.equal(BG.newVideoName('', 1732190000000), '');
});

test('the file picker offers videos and one animated picture, and checkVideoFile() judges name, size and kind', () => {
  assert.deepEqual(BG.VIDEO_EXTENSIONS, ['mp4', 'webm', 'm4v', 'ogv', 'mov', 'gif']);
  assert.deepEqual(BG.checkVideoFile('Live Wallpaper.MP4', 10_000_000), { ok: true, ext: 'mp4' });
  assert.deepEqual(BG.checkVideoFile('loop.webm', 1), { ok: true, ext: 'webm' });
  assert.deepEqual(BG.checkVideoFile('a.gif', 5), { ok: true, ext: 'gif' });
  assert.equal(BG.checkVideoFile('notes.txt', 100).ok, false);
  assert.equal(BG.checkVideoFile('photo.png', 100).ok, false, 'a still picture goes through Choose picture instead');
  assert.equal(BG.checkVideoFile('mp4', 100).ok, false, 'a name that only ends in the letters is not a video');
  assert.match(BG.checkVideoFile('a.mp4', 0).error, /empty/);
  assert.match(BG.checkVideoFile('a.mp4', BG.MAX_VIDEO + 1).error, /too big \(over 500 MB\)/);
  assert.equal(BG.checkVideoFile('a.mp4', BG.MAX_VIDEO).ok, true, 'the limit itself is allowed');
  assert.equal(BG.checkVideoFile('a.mp4', 100, false).ok, false, 'a folder named like a video is refused');
  assert.equal(BG.mediaKind('x.GIF'), 'animated');
  assert.equal(BG.mediaKind('x.mov'), 'video');
  assert.equal(BG.mediaKind('x.png'), null);
  assert.equal(BG.mediaKind(null), null);
});

test('the video address is the folder address plus a checked name, and nothing else is built', () => {
  const base = 'file:///C:/Users/Me%20(work)/AppData/Roaming/Aula%20Control/backgrounds/';
  assert.ok(BG.isVideoBase(base));
  assert.ok(BG.isVideoBase('file:///home/me/.config/Aula%20Control/backgrounds/'));
  for (const bad of ['', null, 'https://example.com/', 'file:///x/y', 'file:///a b/', 'file:///a"b/', "file:///a'b/", 'file:///a\\b/', 'file:///a?x=1/', 'file:///a#b/', 'file:///a\nb/', 'javascript:alert(1)//', 'data:video/mp4;base64,AAAA/']) {
    assert.equal(BG.isVideoBase(bad), false, `${String(bad)} is not a folder address`);
  }
  assert.equal(BG.videoUrl(base, 'bg-1732190000000.mp4'), `${base}bg-1732190000000.mp4`);
  assert.equal(BG.videoUrl(base, '../x.mp4'), '');
  assert.equal(BG.videoUrl('https://x.test/', 'bg-1732190000000.mp4'), '');
  assert.equal(BG.videoCss(base, 'bg-1732190000000.gif'), `url("${base}bg-1732190000000.gif")`);
  assert.equal(BG.videoCss(base, 'bg-1732190000000.gif\") ; background: url(x'), '', 'a name with CSS in it paints nothing');
});

// ------------------------------------------------------------------ the real folder

test('importVideo() copies the picked file under a new name, byte for byte, and leaves the original alone', async () => {
  const src = tmp();
  const dir = path.join(tmp(), 'backgrounds'); // does not exist yet: it is made
  const file = path.join(src, 'My Wallpaper (final).mp4');
  const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  fs.writeFileSync(file, bytes);
  const r = await bgvideo.importVideo(file, dir, 1732190000123);
  assert.deepEqual(r, { ok: true, name: 'bg-1732190000123.mp4' });
  assert.ok(fs.readFileSync(path.join(dir, r.name)).equals(bytes));
  assert.ok(fs.existsSync(file), 'the original is still there');
  assert.deepEqual(fs.readdirSync(dir), [r.name]);
});

test('importVideo() refuses what is not a video, an empty file, a folder, a missing file and a file over the limit, and writes nothing', async () => {
  const src = tmp();
  const dir = path.join(tmp(), 'backgrounds');
  const write = (n, b) => {
    const f = path.join(src, n);
    fs.writeFileSync(f, b);
    return f;
  };
  assert.equal((await bgvideo.importVideo(write('notes.txt', 'hello'), dir)).ok, false);
  assert.equal((await bgvideo.importVideo(write('empty.mp4', ''), dir)).ok, false);
  fs.mkdirSync(path.join(src, 'folder.mp4'));
  assert.equal((await bgvideo.importVideo(path.join(src, 'folder.mp4'), dir)).ok, false);
  assert.match((await bgvideo.importVideo(path.join(src, 'gone.mp4'), dir)).error, /Could not open/);
  const big = path.join(src, 'huge.webm');
  fs.closeSync(fs.openSync(big, 'w'));
  fs.truncateSync(big, BG.MAX_VIDEO + 1); // a sparse file: it says it is over the limit without using the space
  const r = await bgvideo.importVideo(big, dir);
  assert.equal(r.ok, false);
  assert.match(r.error, /too big/);
  assert.equal(fs.existsSync(dir), false, 'nothing was created for a refused file');
});

test('importVideo() twice keeps both copies until tidy() runs (the old one may still be playing)', async () => {
  const src = tmp();
  const dir = tmp();
  const a = path.join(src, 'a.mp4');
  const b = path.join(src, 'b.gif');
  fs.writeFileSync(a, 'AAAA');
  fs.writeFileSync(b, 'BBBB');
  const r1 = await bgvideo.importVideo(a, dir, 1732190000001);
  const r2 = await bgvideo.importVideo(b, dir, 1732190000002);
  assert.deepEqual(fs.readdirSync(dir).sort(), [r1.name, r2.name].sort());
  assert.equal(r2.name, 'bg-1732190000002.gif');
});

test('a second copy made in the same millisecond takes the next free name and never touches the first', async () => {
  const src = tmp();
  const dir = tmp();
  const a = path.join(src, 'a.mp4');
  const b = path.join(src, 'b.mp4');
  fs.writeFileSync(a, 'AAAA');
  fs.writeFileSync(b, 'BBBB');
  const r1 = await bgvideo.importVideo(a, dir, 1732190000777);
  const r2 = await bgvideo.importVideo(b, dir, 1732190000777);
  assert.deepEqual([r1.ok, r2.ok], [true, true]);
  assert.notEqual(r1.name, r2.name);
  assert.ok(BG.isVideoName(r2.name));
  assert.equal(fs.readFileSync(path.join(dir, r1.name), 'utf8'), 'AAAA', 'the first copy is as it was');
  assert.equal(fs.readFileSync(path.join(dir, r2.name), 'utf8'), 'BBBB');
});

test('importVideo() reports a folder it cannot make and leaves nothing behind', async () => {
  const src = tmp();
  const a = path.join(src, 'a.mp4');
  fs.writeFileSync(a, 'AAAA');
  const blocker = path.join(src, 'blocker'); // a file where the folder should go
  fs.writeFileSync(blocker, 'x');
  const r = await bgvideo.importVideo(a, path.join(blocker, 'backgrounds'));
  assert.equal(r.ok, false);
  assert.match(r.error, /Could not copy/);
});

test('tidy() deletes the kept videos except the one in use, and never touches anything else in the folder', async () => {
  const dir = tmp();
  const keep = 'bg-1732190000002.mp4';
  const files = ['bg-1732190000001.mp4', keep, 'bg-1732190000003.gif', 'README.txt', 'bg-notes.mp4', 'my-video.mp4', 'bg-1732190000004.exe'];
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  const gone = await bgvideo.tidy(dir, keep);
  assert.deepEqual(gone.sort(), ['bg-1732190000001.mp4', 'bg-1732190000003.gif']);
  assert.deepEqual(fs.readdirSync(dir).sort(), [keep, 'README.txt', 'bg-1732190000004.exe', 'bg-notes.mp4', 'my-video.mp4'].sort());
  const rest = await bgvideo.tidy(dir, '');
  assert.deepEqual(rest, [keep], "'' deletes every kept video");
  assert.deepEqual(fs.readdirSync(dir).sort(), ['README.txt', 'bg-1732190000004.exe', 'bg-notes.mp4', 'my-video.mp4']);
  assert.deepEqual(await bgvideo.tidy(path.join(dir, 'does-not-exist'), ''), [], 'a folder that is not there is fine');
});

// ------------------------------------------------------------------ wiring

test('the Theme page has the video picker and layer: the layer sits right behind the picture layer, inside the shell', () => {
  const html = read('src', 'index.html');
  const theme = html.indexOf('id="setpage-theme"');
  const debug = html.indexOf('id="setpage-debug"');
  for (const id of ['bgVideoPick', 'bgVideoFile', 'bgVideoHint', 'bgVideoWarn']) {
    const i = html.indexOf(`id="${id}"`);
    assert.ok(i > theme && i < debug, `${id} is on the Theme page`);
  }
  const warn = html.match(/<p class="hint caution" id="bgVideoWarn">([^<]*)<\/p>/);
  assert.ok(warn, 'the video row has a warning note');
  assert.match(warn[1], /GPU/, 'it says a video uses the GPU');
  assert.ok(/4K/.test(warn[1]) && /2K/.test(warn[1]) && /1080p/.test(warn[1]), 'it says how the load drops from 4K to 2K to 1080p');
  assert.match(html, /<input type="file" id="bgVideoFile" accept="[^"]*video\/mp4[^"]*video\/webm[^"]*\.gif[^"]*" hidden>/);
  const picture = html.indexOf('id="appBg"');
  const video = html.indexOf('id="appBgVideo"');
  assert.ok(video > picture && video < html.indexOf('<header class="top">'), 'the video layer follows the picture layer and comes before the header');
  const tag = html.slice(html.lastIndexOf('<video', video), html.indexOf('</video>', video));
  assert.match(tag, /class="app-bg app-bg-video"/, 'it is a background layer like the picture');
  for (const a of [/\bmuted\b/, /\bloop\b/, /\bplaysinline\b/, /\bhidden\b/, /aria-hidden="true"/, /tabindex="-1"/]) assert.match(tag, a);
  assert.doesNotMatch(tag, /\bcontrols\b|\bautoplay\b/, 'no player controls, and playback is decided by the app (visible or not)');
});

test('the page may play media from its own data folder, and nothing wider than that', () => {
  const csp = read('src', 'index.html').match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /media-src 'self' blob: file:(;|$)/);
  assert.match(csp, /img-src 'self' data: blob: file:(;|$)/);
  assert.match(csp, /script-src 'self'(;|$)/, 'scripts are still only the app\'s own');
  assert.doesNotMatch(csp, /https?:|\*/, 'no web addresses and no wildcards');
});

test('the CSS gives the video the same layer as the picture, filling it', () => {
  const css = read('src', 'css', 'app.css');
  const layer = css.match(/(?:^|\n)\.app-bg-video\s*\{([^}]*)\}/);
  assert.ok(layer, '.app-bg-video has a rule');
  assert.match(layer[1], /object-fit:\s*cover/);
  assert.match(layer[1], /width:\s*100%/);
  assert.match(layer[1], /height:\s*100%/);
  assert.match(css, /\.app-bg-video\[hidden\]\s*\{\s*display:\s*none/);
  assert.match(css, /\.shell:not\(\[data-screen="app"\]\) \.app-bg \{ opacity: 0; \}/, 'the start screen still hides the layer, video included');
});

test('app.js plays the video only while it can be seen, shares the opacity, and forgets a video that cannot play', () => {
  const app = read('src', 'js', 'app.js');
  assert.match(app, /BG_VIDEO_KEY = 'aula\.bgVideo'/);
  assert.match(app, /\$\('#appBgVideo'\)\.style\.setProperty\('--bg-opacity'/, 'the slider moves the video layer too (it is not a child of #appBg)');
  // playback follows: window shown, tab visible, window in focus, an app screen up
  const sync = app.slice(app.indexOf('function syncBgMedia()'), app.indexOf('function renderBackground()'));
  assert.match(sync, /windowShown && !document\.hidden && windowFocused\(\)/, 'it plays only while the window is shown, visible and in focus');
  assert.match(app, /const windowFocused = \(\) => typeof document\.hasFocus !== 'function' \|\| document\.hasFocus\(\);/);
  assert.match(sync, /dataset\.screen === 'app'/);
  assert.match(sync, /\.pause\(\)/);
  assert.match(sync, /\.play\(\)/);
  // and is re-checked whenever any of those changes
  assert.match(app, /syncBgMedia\(\); \/\/ a video behind the app stops while the window is in the tray/);
  assert.match(app, /document\.addEventListener\('visibilitychange', syncBgMedia\)/);
  assert.match(app, /window\.addEventListener\('focus', syncBgMedia\)/, 'coming back to the window plays the video again');
  assert.match(app, /window\.addEventListener\('blur', syncBgMedia\)/, 'clicking another program pauses it');
  assert.match(app, /MutationObserver\(syncBgMedia\)\.observe\(\$\('\.shell'\), \{ attributes: true, attributeFilter: \['data-screen'\] \}\)/);
  assert.match(app.slice(app.indexOf('function renderBackground()')), /syncBgMedia\(\);\n  \}/, 'renderBackground() ends by syncing');
  // a video that fails is dropped with a message
  assert.match(app, /\$\('#appBgVideo'\)\.addEventListener\('error'/);
  assert.match(app, /That video could not be played/);
  // only a name this module made is ever turned into an address
  assert.match(app, /BG\.isVideoName\(vname\) && BG\.videoUrl\(base, vname\)/);
  assert.match(app, /BG\.isVideoName\(r\.name\)/, 'the name main.js sends back is checked too');
});

test('app.js keeps only one background at a time and drops the old copy of a video', () => {
  const app = read('src', 'js', 'app.js');
  const set = app.slice(app.indexOf('function setBackground('), app.indexOf('// Builds the tiles for the pictures'));
  for (const k of ['BG_KEY', 'BG_PRESET_KEY', 'BG_VIDEO_KEY']) assert.match(set, new RegExp(`store\\.removeItem\\(${k}\\)`), `${k} is cleared first`);
  assert.match(set, /kind === 'video'\) store\.setItem\(BG_VIDEO_KEY, value\)/);
  assert.match(set, /releaseVideo\(\)/, 'the player lets go of the file before it is deleted');
  assert.match(set, /host\.tidyBackgroundVideo\(kind === 'video' \? value : ''\)/, 'the new video is kept, every other copy goes');
  assert.doesNotMatch(app, /setItem\(BG_VIDEO_KEY, ?['"`]/, 'no video is chosen by default');
});

test('the preload offers the three calls, and the main process answers each one', () => {
  const pre = read('preload.js');
  assert.match(pre, /sendSync\('host:bg-video-base'\)/);
  assert.match(pre, /\bbgVideoBase,/);
  assert.match(pre, /pickBackgroundVideo: \(\) => ipcRenderer\.invoke\('host:pick-bg-video'\)/);
  assert.match(pre, /tidyBackgroundVideo: \(keep\) => ipcRenderer\.invoke\('host:tidy-bg-video', String\(keep \|\| ''\)\)/);
  const main = read('main.js');
  assert.match(main, /ipcMain\.on\('host:bg-video-base'/);
  assert.match(main, /ipcMain\.handle\('host:pick-bg-video'/);
  assert.match(main, /ipcMain\.handle\('host:tidy-bg-video'/);
  // the person picks in a dialog the main process opens; the page never sends a path to copy
  assert.match(main, /dialog\.showOpenDialog\(win, \{[^}]*title: 'Choose a background video'/);
  assert.doesNotMatch(main.slice(main.indexOf("'host:pick-bg-video'"), main.indexOf("'host:tidy-bg-video'")), /async \(_e, \w+/, 'host:pick-bg-video takes no argument from the page');
  assert.match(main, /bgLib\.isVideoName\(keep\) \? keep : ''/, 'a name from the page is checked before anything is kept');
  assert.match(main, /bgVideoDir = \(\) => path\.join\(app\.getPath\('userData'\), bgLib\.VIDEO_DIR\)/, 'copies live in the data folder, not in the app package');
});

test('a window with a video background starts solid, like one with a picture, and old copies are tidied at start', () => {
  const main = read('main.js');
  assert.match(main, /FROST_PICTURE_KEYS = \['aula\.bg', 'aula\.bgPreset', 'aula\.bgVideo'\]/);
  assert.match(main, /function tidyBgVideos\(\)/);
  assert.match(main, /prepareWhatsNew\(\);\n  tidyBgVideos\(\);/);
  assert.match(main, /appendSwitch\('disable-features', 'HardwareMediaKeyHandling,MediaSessionService'\)/, 'a muted decoration must not take the media keys');
});

test('the built app contains every file main.js loads from the app folder, bgvideo.js included', () => {
  const pkg = JSON.parse(read('package.json'));
  const main = read('main.js');
  const local = [...main.matchAll(/require\('\.\/([\w.-]+?)(?:\.js)?'\)/g)].map((m) => m[1] + '.js').filter((f) => fs.existsSync(path.join(root, f)));
  assert.ok(local.includes('bgvideo.js'), 'main.js requires bgvideo.js');
  for (const f of local) assert.ok(pkg.build.files.includes(f), `${f} is listed in build.files, or the built app would not start`);
});

test('the preset folder still takes pictures only: a video there is not a preset', () => {
  for (const v of ['clip.mp4', 'clip.webm', 'clip.gif', 'clip.mov']) assert.equal(BG.isPresetName(v), false, v);
});
