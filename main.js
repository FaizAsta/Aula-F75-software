'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, session, Notification, dialog, powerMonitor, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { loginItemOptions, linuxAutostartEntry, LINUX_AUTOSTART_NAME } = require('./login-item');
const { bluetoothBatteryLinux } = require('./bluetooth-linux');
const updater = require('./updater');
const pkg = require('./package.json');
const bgLib = require('./src/js/background.js');
const { usageLine } = require('./usage');
const whatsNew = require('./src/js/whatsnew.js');

// USB IDs the app is allowed to open through WebHID, plus any HID device whose name says AULA, F75 (which includes the F75 Pro) or F87.
const KNOWN_IDS = [
  [0x3554, 0xfa09], // F75 2.4G dongle
  [0x258a, 0x010c], // F75, F75 Pro and F87 over USB-C (same ids, same protocol)
  [0x0c45, 0x800a], // other AULA keyboards over USB-C, different protocol (detected only)
  [0x05ac, 0x024f], // other AULA 2.4G dongle, different protocol (detected only)
];
const NAME_RE = /aula|f75|f87/i;
const isAulaHid = (d) =>
  !!d && (KNOWN_IDS.some(([v, p]) => d.vendorId === v && d.productId === p) || NAME_RE.test(d.name || d.productName || ''));

const ICON = path.join(__dirname, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const TRAY_ICON = path.join(__dirname, 'assets', 'tray.png');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let win = null;
let tray = null;
let quitting = false;

// Frosted glass: Windows 11 22H2 (build 22621) and later can draw the window's own background as blurred acrylic, so the
// desktop shows through. Older Windows and other systems keep the solid look. The page only turns it on while the
// "Frosted window" switch is on and no background picture is chosen (see js/frost.js); otherwise it is switched off again.
const FROST_OK = process.platform === 'win32' && (Number(String(os.release()).split('.')[2]) || 0) >= 22621;
const FROST_PICTURE_KEYS = ['aula.bg', 'aula.bgPreset']; // the page's saved picture and preset, in the remembered data

// What the page will want when it starts, read from the remembered data: the "Frosted window" switch (Settings > Theme,
// on unless turned off) and no background picture. The page confirms or corrects it once it has loaded.
function frostWanted() {
  const mem = loadMemory();
  let allowed = true;
  try {
    allowed = JSON.parse(mem['aula.prefs'] || '{}').frost !== false;
  } catch (_) {
    allowed = true;
  }
  return FROST_OK && allowed && !FROST_PICTURE_KEYS.some((k) => !!mem[k]);
}

// ------------------------------------------------------------------ settings

// Many Linux desktops (GNOME in particular) show no tray icon without an extension, so closing the window would hide the app
// with no way back. There the window really closes unless the person turns the tray option on.
const DEFAULTS = { closeToTray: process.platform !== 'linux', openAtLogin: false, startMinimized: false, autoUpdate: true };
let settings = { ...DEFAULTS };
const settingsFile = () => path.join(app.getPath('userData'), 'host-settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (_) {
    settings = { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Could not save settings', err);
  }
}

// ------------------------------------------------------- remembered data
// What the page wants to keep between runs (the remembered keyboard settings, backups, battery history, preferences).
// Kept in a plain file in the user's data folder and written straight away, so a restart or a Windows shutdown
// cannot lose it the way delayed browser storage can.

const memoryFile = () => path.join(app.getPath('userData'), 'aula-memory.json');
let memory = null;

// ---------------------------------------------------------------- what's new

// After an update the page shows a short list of what is new: the bold title of each bullet of this version in
// RELEASE_NOTES.md (which ships inside the app, so this works offline), never the description. `whatsNewState` is set while
// that is owed for this run; the version is recorded once the person has seen it (or at once when there is nothing to show),
// so a window that was closed before it could be read shows it again next time.
let whatsNewState = null; // { from } or null

function recordRunVersion() {
  loadMemory()['aula.lastRunVersion'] = app.getVersion();
  saveMemory();
}

function prepareWhatsNew() {
  try {
    const mem = loadMemory();
    const d = whatsNew.decide(mem['aula.lastRunVersion'] || null, app.getVersion(), Object.keys(mem).length > 0);
    whatsNewState = d.show ? { from: d.from } : null;
    if (d.record) recordRunVersion();
  } catch (_) {
    whatsNewState = null;
  }
}

function loadMemory() {
  if (memory) return memory;
  memory = {};
  for (const f of [memoryFile(), memoryFile() + '.bak']) {
    try {
      const o = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        memory = o;
        break;
      }
    } catch (_) {
      /* missing or damaged: try the previous copy */
    }
  }
  return memory;
}

function saveMemory() {
  try {
    const file = memoryFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(memory));
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
    } catch (_) {
      /* the backup copy is best effort */
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    console.error('Could not save remembered data', err);
  }
}

const memoryKeyOk = (k) => typeof k === 'string' && /^aula\.[\w.-]{1,60}$/.test(k);

const loginOpts = () =>
  loginItemOptions({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    execPath: process.execPath,
    portableFile: process.env.PORTABLE_EXECUTABLE_FILE || process.env.APPIMAGE, // an AppImage runs from a temporary mount
  });

const linuxAutostartFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', LINUX_AUTOSTART_NAME);

function applyLoginItem() {
  if (process.platform === 'linux') {
    try {
      const file = linuxAutostartFile();
      if (settings.openAtLogin) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, linuxAutostartEntry(loginOpts()));
      } else {
        fs.rmSync(file, { force: true });
      }
    } catch (err) {
      console.error('Could not update the autostart entry', err);
    }
    return;
  }
  try {
    app.setLoginItemSettings({ openAtLogin: !!settings.openAtLogin, ...loginOpts() });
  } catch (err) {
    console.error('Could not update the Windows startup entry', err);
  }
}

// What Windows really has, not just what we saved. Only Windows and macOS can report it.
function loginState() {
  if (process.platform === 'linux') {
    try {
      return { openAtLogin: fs.existsSync(linuxAutostartFile()), blocked: false };
    } catch (_) {
      return { openAtLogin: !!settings.openAtLogin, blocked: false };
    }
  }
  if (process.platform !== 'win32' && process.platform !== 'darwin') return { openAtLogin: !!settings.openAtLogin, blocked: false };
  try {
    const s = app.getLoginItemSettings(loginOpts());
    return { openAtLogin: !!s.openAtLogin, blocked: !!s.openAtLogin && s.executableWillLaunchAtLogin === false };
  } catch (_) {
    return { openAtLogin: !!settings.openAtLogin, blocked: false };
  }
}

// Settings as the page should see them: the saved values, with the real startup state filled in.
function publicSettings() {
  const login = loginState();
  return { ...settings, openAtLogin: login.openAtLogin, loginBlocked: login.blocked };
}

// -------------------------------------------------------------------- window

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

const windowShown = () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();
function sendShown() {
  if (win && !win.isDestroyed()) win.webContents.send('host:shown', windowShown());
}
const winState = () => ({ maximized: !!win && !win.isDestroyed() && (win.isMaximized() || win.isFullScreen()) });

function sendWinState() {
  if (win && !win.isDestroyed()) win.webContents.send('host:win-state', winState());
}

/** Turns the frosted (acrylic) window background on or off. Does nothing where it is not supported. */
function setFrost(on) {
  if (!FROST_OK || !win || win.isDestroyed() || typeof win.setBackgroundMaterial !== 'function') return;
  try {
    win.setBackgroundMaterial(on ? 'acrylic' : 'none');
  } catch (err) {
    console.error('Could not change the window background material', err);
  }
}

function createWindow() {
  const frostAtStart = frostWanted();
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 660,
    show: false,
    // No native title bar, logo or caption buttons: the page draws its own minimize / maximize / close buttons and a drag
    // area in its header. The window is not transparent, so Windows still gives it its own default corners, border and shadow.
    frame: false,
    // The acrylic material is always requested at creation (it also makes the page's own background transparent);
    // it is switched off just below when a picture was chosen.
    ...(FROST_OK ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } : {}),
    title: 'Aula Control',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // keep polling the keyboard while hidden in the tray
      spellcheck: false,
    },
  });

  win.setMenuBarVisibility(false);
  if (FROST_OK && !frostAtStart) setFrost(false);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    // Only stay hidden when Windows started us and there is a tray icon to bring the window back from.
    const hidden = process.argv.includes('--hidden') && settings.startMinimized && !!tray;
    if (!hidden) win.show();
  });

  win.on('close', (e) => {
    if (!quitting && settings.closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
  // Signing out or shutting down must not be held up by "keep running in the tray".
  win.on('session-end', () => {
    quitting = true;
  });

  // The page stops drawing the keyboard picture while nobody can see it (hidden in the tray, or minimized), and starts again
  // when the window comes back. The window keeps running either way: the battery is still read and the red light still works.
  for (const ev of ['hide', 'minimize', 'show', 'restore']) win.on(ev, sendShown);

  // The page swaps its maximize / restore icon, so tell it whenever that changes.
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, sendWinState);

  // Anything that tries to navigate away or open a window is not ours.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function createTray() {
  try {
    let img = nativeImage.createFromPath(TRAY_ICON);
    if (img.isEmpty()) img = nativeImage.createFromPath(ICON).resize({ width: 32, height: 32 });
    tray = new Tray(img);
  } catch (_) {
    tray = null;
    return;
  }
  tray.setToolTip('Aula Control');
  tray.on('click', showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Aula Control', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

// ---------------------------------------------------------------- HID access

function setupHidPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'hid');
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'hid'));
  ses.setDevicePermissionHandler((details) => details.deviceType === 'hid' && isAulaHid(details.device));
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault();
    const pick = (details.deviceList || []).find(isAulaHid);
    callback(pick ? pick.deviceId : undefined);
  });
}

// ------------------------------------------------------------------- power

// After Windows sleep or a screen unlock a USB keyboard link can come back dead without any plug event, and the
// dongle comes back before the keyboard does. The page cannot see power events, so tell it: it looks again at once
// and checks that the link still answers.
function watchPower() {
  for (const kind of ['resume', 'unlock-screen']) {
    powerMonitor.on(kind, () => {
      if (win && !win.isDestroyed()) win.webContents.send('host:power', kind);
    });
  }
}

// ------------------------------------------------------------------- updates
// Asks GitHub for the latest release of the repository named in package.json ("aulaControl.updateRepo"). When it is newer
// than this version the page shows the update dialog. The installed Windows build downloads the installer and runs it;
// the portable file and other systems open the release page instead, because a running file cannot replace itself.

const UPDATE_REPO = updater.parseRepo(pkg.aulaControl && pkg.aulaControl.updateRepo);
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_FILE;
const CAN_INSTALL = process.platform === 'win32' && !IS_PORTABLE;
const update = { info: null, dismissed: '', controller: null, ready: null }; // ready: the downloaded installer, { version, file }

const sendUpdate = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};
// What the page may see (never the download address).
const publicInfo = (i) => ({ version: i.version, current: i.current, notes: i.notes, mode: i.mode, size: i.asset ? i.asset.size : 0 });

async function checkUpdates(manual) {
  if (!UPDATE_REPO) return { status: 'off' };
  const r = await updater.checkForUpdate({ repo: UPDATE_REPO, current: app.getVersion(), installable: CAN_INSTALL, fetch: net.fetch.bind(net) });
  if (r.status === 'error') return r;
  if (r.status === 'current') {
    update.info = null;
    sendUpdate('update:badge', null); // the header icon goes away
    return { status: 'current', current: app.getVersion() };
  }
  const first = !update.info || update.info.version !== r.info.version;
  update.info = r.info;
  sendUpdate('update:badge', publicInfo(r.info)); // the header icon stays until the app is updated, even after "Later"
  if (!manual && update.dismissed !== r.info.version) {
    sendUpdate('update:available', publicInfo(r.info));
    if (first && Notification.isSupported() && (!win || !win.isVisible())) {
      const n = new Notification({ title: 'Aula Control update', body: `Version ${r.info.version} is available.`, icon: ICON });
      n.on('click', showWindow);
      n.show();
    }
  }
  return { status: 'available', info: publicInfo(r.info) };
}

function autoCheckUpdates() {
  if (settings.autoUpdate) checkUpdates(false).catch(() => {});
}

async function startUpdate() {
  const info = update.info;
  if (!info) return { ok: false, message: 'There is no update to install.' };
  if (info.mode === 'page') {
    shell.openExternal(info.page);
    return { ok: true, opened: true };
  }
  if (update.controller) return { ok: true };
  if (update.ready && update.ready.version === info.version && fs.existsSync(update.ready.file)) return { ok: true, ready: true }; // already downloaded
  const controller = new AbortController();
  update.controller = controller;
  const dir = path.join(app.getPath('temp'), 'aula-control-update');
  try {
    fs.rmSync(dir, { recursive: true, force: true }); // an older download that was never used
  } catch (_) {
    /* in use or missing: fine */
  }
  const dest = path.join(dir, `Aula-Control-Setup-${info.version}.exe`);
  (async () => {
    try {
      await updater.download({ asset: info.asset, dest, fetch: net.fetch.bind(net), signal: controller.signal, onProgress: (p) => sendUpdate('update:progress', p) });
      update.ready = { version: info.version, file: dest };
      sendUpdate('update:state', { state: 'ready' }); // the page asks "Install now?"; nothing is started until the person says yes
    } catch (err) {
      if (err && err.name === 'AbortError') sendUpdate('update:state', { state: 'cancelled' });
      else sendUpdate('update:state', { state: 'error', message: String((err && err.message) || err).slice(0, 200) });
    } finally {
      update.controller = null;
    }
  })();
  return { ok: true };
}

/** Runs the downloaded installer and closes the app so the installer can replace it. Only called after the person chose Install now. */
async function installUpdate() {
  const got = update.ready;
  if (!got || !fs.existsSync(got.file)) {
    update.ready = null;
    return { ok: false, message: 'The downloaded installer is no longer there. Download the update again.' };
  }
  sendUpdate('update:state', { state: 'installing' });
  await new Promise((r) => setTimeout(r, 900)); // long enough to read the message
  if (await shell.openPath(got.file)) return { ok: false, message: 'Windows could not start the installer.' };
  quitting = true; // the installer replaces the running app, so it must not hide in the tray instead
  setTimeout(() => app.quit(), 600);
  return { ok: true };
}

// ----------------------------------------------------------------------- IPC

function bluetoothBattery(pattern) {
  return new Promise((resolve) => {
    if (process.platform === 'linux') return bluetoothBatteryLinux(pattern).then(resolve, () => resolve(null));
    if (process.platform !== 'win32') return resolve(null);
    const pat = String(pattern || 'AULA|F75|F87').slice(0, 64);
    try {
      new RegExp(pat);
    } catch (_) {
      return resolve(null);
    }
    // Windows publishes the Bluetooth battery level as a device property for devices that expose the standard service.
    const script = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      '$pat = $env:AULA_PATTERN',
      '$out = @()',
      'Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match $pat } | ForEach-Object {',
      "  $p = Get-PnpDeviceProperty -InstanceId $_.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2'",
      '  if ($p -and $null -ne $p.Data -and $p.Type -ne "Empty") {',
      '    $out += [pscustomobject]@{ name = $_.FriendlyName; level = [int]$p.Data }',
      '  }',
      '}',
      'if ($out.Count -gt 0) { $out | ConvertTo-Json -Compress }',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, env: { ...process.env, AULA_PATTERN: pat } },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) return resolve(null);
        try {
          const parsed = JSON.parse(stdout.trim());
          const list = Array.isArray(parsed) ? parsed : [parsed];
          const hit = list.find((x) => Number.isFinite(x.level) && x.level >= 0 && x.level <= 100);
          resolve(hit ? { name: String(hit.name), level: hit.level } : null);
        } catch (_) {
          resolve(null);
        }
      },
    );
  });
}

function registerIpc() {
  ipcMain.handle('host:get-settings', () => publicSettings());
  ipcMain.handle('host:set-settings', (_e, patch) => {
    const allowed = ['closeToTray', 'openAtLogin', 'startMinimized', 'autoUpdate'];
    for (const k of allowed) if (typeof patch?.[k] === 'boolean') settings[k] = patch[k];
    saveSettings();
    applyLoginItem();
    return publicSettings();
  });
  ipcMain.handle('host:version', () => app.getVersion());
  ipcMain.handle('host:whats-new', () => {
    if (!whatsNewState) return null;
    let sections = [];
    try {
      sections = whatsNew.collect(fs.readFileSync(path.join(__dirname, 'RELEASE_NOTES.md'), 'utf8'), whatsNewState.from, app.getVersion());
    } catch (_) {
      sections = [];
    }
    if (!sections.length) {
      whatsNewState = null;
      recordRunVersion(); // nothing to announce for this version
      return null;
    }
    return { version: app.getVersion(), sections };
  });
  ipcMain.on('host:whats-new-seen', () => {
    if (!whatsNewState) return;
    whatsNewState = null;
    recordRunVersion();
  });

  // Preset backgrounds: the pictures in src/img/backgrounds (inside the app package once it is built). Only file names go
  // to the page; it builds the address itself, and only for names that pass the same check.
  ipcMain.handle('host:list-backgrounds', () => {
    try {
      return bgLib.presetNames(fs.readdirSync(path.join(__dirname, 'src', 'img', 'backgrounds')));
    } catch (_) {
      return [];
    }
  });

  // Updates. The page only ever sees the version, the release notes and what kind of update it is.
  ipcMain.handle('update:info', () => ({ enabled: !!UPDATE_REPO, current: app.getVersion(), portable: IS_PORTABLE }));
  ipcMain.handle('update:latest', () => (update.info ? publicInfo(update.info) : null)); // for the header icon: not hidden by "Later"
  ipcMain.handle('update:pending', () => (update.info && update.dismissed !== update.info.version ? publicInfo(update.info) : null));
  ipcMain.handle('update:check', () => checkUpdates(true));
  ipcMain.handle('update:start', () => startUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.on('update:cancel', () => {
    if (update.controller) update.controller.abort();
  });
  ipcMain.on('update:dismiss', () => {
    if (update.info) update.dismissed = update.info.version;
  });

  // Remembered data. The page reads it once, synchronously, before it draws, then sends each change here.
  ipcMain.on('host:mem-load', (e) => {
    e.returnValue = loadMemory();
  });
  ipcMain.on('host:mem-set', (_e, key, value) => {
    if (!memoryKeyOk(key) || typeof value !== 'string' || value.length > 2 * 1024 * 1024) return;
    loadMemory()[key] = value;
    saveMemory();
  });
  ipcMain.on('host:mem-remove', (_e, key) => {
    if (!memoryKeyOk(key)) return;
    delete loadMemory()[key];
    saveMemory();
  });

  // Caption buttons are drawn by the page, so the page asks us to act on the window.
  ipcMain.handle('host:win-state', () => winState());
  ipcMain.handle('host:shown', () => windowShown());
  ipcMain.on('host:win-control', (_e, action) => {
    if (!win || win.isDestroyed()) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    else if (action === 'close') win.close(); // still honours "close to tray"
  });
  // The page draws its own theme; this only makes the parts Windows draws (file dialogs, the tray menu) match it, and
  // keeps the page's prefers-color-scheme in step when the choice is 'system'. The page sends it on every start.
  ipcMain.on('host:theme', (_e, pref) => {
    if (pref === 'dark' || pref === 'light' || pref === 'system') nativeTheme.themeSource = pref;
  });
  // Frosted window background. The page asks once, before it draws, whether it is available, then says when to switch.
  ipcMain.on('host:frost-info', (e) => {
    e.returnValue = { supported: FROST_OK };
  });
  ipcMain.on('host:frost', (_e, on) => {
    if (typeof on === 'boolean') setFrost(on);
  });
  ipcMain.handle('host:bt-battery', (_e, pattern) => bluetoothBattery(pattern));

  ipcMain.on('host:tray', (_e, text) => {
    if (!tray) return;
    // The second line is what the app costs right now, measured by Electron (all of its processes, averaged since the last
    // time the tooltip was set). Hover the tray icon to read it.
    let line = '';
    try {
      line = usageLine(app.getAppMetrics(), os.cpus().length, os.totalmem());
    } catch (_) {
      line = '';
    }
    const head = String(text || 'Aula Control').slice(0, 60);
    tray.setToolTip(line ? `${head}\n${line}` : head);
  });
  ipcMain.on('host:notify', (_e, { title, body }) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: String(title || '').slice(0, 80), body: String(body || '').slice(0, 200), icon: ICON });
    n.on('click', showWindow);
    n.show();
  });

  ipcMain.handle('host:save-file', async (_e, { name, text }) => {
    if (!win) return false;
    const res = await dialog.showSaveDialog(win, { defaultPath: String(name || 'aula-export.txt') });
    if (res.canceled || !res.filePath) return false;
    fs.writeFileSync(res.filePath, String(text ?? ''), 'utf8');
    return true;
  });
  ipcMain.handle('host:open-file', async () => {
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (res.canceled || !res.filePaths[0]) return null;
    const stat = fs.statSync(res.filePaths[0]);
    if (stat.size > 1024 * 1024) return null;
    return fs.readFileSync(res.filePaths[0], 'utf8');
  });
}

// ----------------------------------------------------------------- lifecycle

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});

if (gotLock) app.whenReady().then(() => {
  app.setAppUserModelId('com.aulacontrol.app');
  Menu.setApplicationMenu(null); // no default menu, so Ctrl+R / F5 reach the app's own Refresh instead of reloading the window
  loadSettings();
  prepareWhatsNew();
  applyLoginItem();
  setupHidPermissions();
  watchPower();
  registerIpc();
  createTray();
  createWindow();
  setTimeout(autoCheckUpdates, 4 * 1000); // every start of the app, a few seconds in so the window and the keyboard connection come up first
  setInterval(autoCheckUpdates, 6 * 60 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// With "keep running in the tray" on, closing only hides the window, so this fires only when the window
// really closed: the setting is off (or there is no tray). Either way the app should end, not linger.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
