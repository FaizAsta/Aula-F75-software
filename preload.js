'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Whether this window can be frosted (Windows 11 22H2 and later). Asked once and kept, so the page knows before it draws.
let frostSupported = false;
try {
  frostSupported = !!(ipcRenderer.sendSync('host:frost-info') || {}).supported;
} catch (_) {
  frostSupported = false;
}

contextBridge.exposeInMainWorld('aulaHost', {
  getSettings: () => ipcRenderer.invoke('host:get-settings'),
  setSettings: (patch) => ipcRenderer.invoke('host:set-settings', patch),
  version: () => ipcRenderer.invoke('host:version'),
  whatsNew: () => ipcRenderer.invoke('host:whats-new'),
  whatsNewSeen: () => ipcRenderer.send('host:whats-new-seen'),
  openSupport: (id) => ipcRenderer.invoke('host:open-support', String(id)),
  listBackgrounds: () => ipcRenderer.invoke('host:list-backgrounds'),
  loadMemory: () => ipcRenderer.sendSync('host:mem-load'),
  setMemory: (key, value) => ipcRenderer.send('host:mem-set', key, value),
  removeMemory: (key) => ipcRenderer.send('host:mem-remove', key),
  winControl: (action) => ipcRenderer.send('host:win-control', action),
  setTheme: (pref) => ipcRenderer.send('host:theme', pref),
  winState: () => ipcRenderer.invoke('host:win-state'),
  shown: () => ipcRenderer.invoke('host:shown'),
  onShown: (cb) => {
    const fn = (_e, shown) => cb(!!shown);
    ipcRenderer.on('host:shown', fn);
    return () => ipcRenderer.removeListener('host:shown', fn);
  },
  onWinState: (cb) => {
    const fn = (_e, state) => cb(state);
    ipcRenderer.on('host:win-state', fn);
    return () => ipcRenderer.removeListener('host:win-state', fn);
  },
  frost: { supported: frostSupported, set: (on) => ipcRenderer.send('host:frost', !!on) },
  onPower: (cb) => {
    const fn = (_e, kind) => cb(kind);
    ipcRenderer.on('host:power', fn);
    return () => ipcRenderer.removeListener('host:power', fn);
  },
  bluetoothBattery: (pattern) => ipcRenderer.invoke('host:bt-battery', pattern),
  idleSeconds: () => ipcRenderer.invoke('host:idle'),
  setTray: (text) => ipcRenderer.send('host:tray', text),
  notify: (title, body) => ipcRenderer.send('host:notify', { title, body }),
  saveFile: (name, text) => ipcRenderer.invoke('host:save-file', { name, text }),
  openFile: () => ipcRenderer.invoke('host:open-file'),
  update: {
    info: () => ipcRenderer.invoke('update:info'),
    pending: () => ipcRenderer.invoke('update:pending'),
    latest: () => ipcRenderer.invoke('update:latest'),
    check: () => ipcRenderer.invoke('update:check'),
    start: () => ipcRenderer.invoke('update:start'),
    install: () => ipcRenderer.invoke('update:install'),
    cancel: () => ipcRenderer.send('update:cancel'),
    dismiss: () => ipcRenderer.send('update:dismiss'),
    onBadge: (cb) => ipcRenderer.on('update:badge', (_e, info) => cb(info)),
    onAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
    onProgress: (cb) => ipcRenderer.on('update:progress', (_e, p) => cb(p)),
    onState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),
  },
});
