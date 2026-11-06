'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { linuxAutostartEntry, loginItemOptions } = require('../login-item');
const bt = require('../bluetooth-linux');

test('autostart entry for an installed app runs the binary with --hidden', () => {
  const o = loginItemOptions({ isPackaged: true, appPath: '/opt/Aula Control/resources/app.asar', execPath: '/opt/Aula Control/aula-control' });
  const text = linuxAutostartEntry(o);
  assert.match(text, /^\[Desktop Entry\]/);
  assert.match(text, /^Exec="\/opt\/Aula Control\/aula-control" --hidden$/m);
  assert.match(text, /^Type=Application$/m);
});

test('autostart entry for an AppImage points at the real file, not the temporary mount', () => {
  const o = loginItemOptions({ isPackaged: true, appPath: '/tmp/.mount_x/resources/app.asar', execPath: '/tmp/.mount_x/aula-control', portableFile: '/home/me/Apps/Aula-Control.AppImage' });
  assert.match(linuxAutostartEntry(o), /^Exec=\/home\/me\/Apps\/Aula-Control\.AppImage --hidden$/m);
});

test('autostart entry from source passes the app folder as one argument', () => {
  const o = loginItemOptions({ isPackaged: false, appPath: '/home/me/my apps/aula', execPath: '/home/me/my apps/aula/node_modules/electron/dist/electron' });
  assert.match(linuxAutostartEntry(o), /^Exec="[^"]*electron" "\/home\/me\/my apps\/aula" --hidden$/m);
});

test('bluetoothctl output is parsed', () => {
  assert.strictEqual(bt.parseBatteryPercentage('Name: AULA F75\n\tBattery Percentage: 0x57 (87)\n'), 87);
  assert.strictEqual(bt.parseBatteryPercentage('Name: AULA F75\n'), null);
  assert.deepStrictEqual(bt.parseDevices('Device AA:BB:CC:DD:EE:FF AULA F75\nDevice 11:22:33:44:55:66 Mouse\nnoise'), [
    { address: 'AA:BB:CC:DD:EE:FF', name: 'AULA F75' },
    { address: '11:22:33:44:55:66', name: 'Mouse' },
  ]);
});

test('power_supply batteries are matched by name and the laptop battery is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));
  const mk = (name, files) => {
    fs.mkdirSync(path.join(dir, name));
    for (const [k, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, name, k), v + '\n');
  };
  mk('BAT0', { capacity: 50, scope: 'System', model_name: 'F75 laptop pack' });
  mk('hid-AA:BB-battery', { capacity: 64, model_name: 'AULA F75' });
  const re = /AULA|F75|F87/i;
  assert.deepStrictEqual(bt.fromPowerSupply(re, dir), { name: 'AULA F75', level: 64 });
  assert.strictEqual(bt.fromPowerSupply(/nothing/i, dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the udev rule covers the supported keyboard ids', () => {
  const rules = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'linux', '70-aula-control.rules'), 'utf8');
  for (const [v, p] of [['3554', 'fa09'], ['258a', '010c']]) assert.match(rules, new RegExp(`idVendor}=="${v}", ATTRS\\{idProduct}=="${p}".*uaccess`));
});
