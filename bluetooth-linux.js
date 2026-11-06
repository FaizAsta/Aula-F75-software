'use strict';

// Battery level of a Bluetooth keyboard on Linux. Two sources, tried in this order, both read-only:
//   1. /sys/class/power_supply: the kernel exposes a battery for HID devices that report one ("hid-AA:BB:..-battery"), and
//      BlueZ's battery provider shows up there too. UPower reads the same place.
//   2. `bluetoothctl info <address>` for connected devices, which prints "Battery Percentage: 0x64 (100)".

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');

const POWER_SUPPLY = '/sys/class/power_supply';

function readTrim(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch (_) {
    return '';
  }
}

/** Looks through the power_supply folder for a battery whose name matches `re`. Returns { name, level } or null. */
function fromPowerSupply(re, dir = POWER_SUPPLY) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir);
  } catch (_) {
    return null;
  }
  for (const e of entries) {
    const base = path.join(dir, e);
    const name = readTrim(path.join(base, 'model_name')) || e;
    if (!re.test(name) && !re.test(e)) continue;
    if (readTrim(path.join(base, 'scope')) === 'System') continue; // the laptop's own battery
    const level = Number(readTrim(path.join(base, 'capacity')));
    if (Number.isFinite(level) && level >= 0 && level <= 100 && readTrim(path.join(base, 'capacity'))) return { name, level };
  }
  return null;
}

/** "Battery Percentage: 0x64 (100)" in `bluetoothctl info` output, or null. */
function parseBatteryPercentage(text) {
  const m = /Battery Percentage:\s*0x[0-9a-f]+\s*\((\d{1,3})\)/i.exec(String(text || ''));
  if (!m) return null;
  const level = Number(m[1]);
  return level >= 0 && level <= 100 ? level : null;
}

/** Device lines of `bluetoothctl devices`: "Device AA:BB:CC:DD:EE:FF Some Name". */
function parseDevices(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = /^Device\s+([0-9A-F:]{17})\s+(.+)$/i.exec(line.trim());
    if (m) out.push({ address: m[1], name: m[2] });
  }
  return out;
}

const run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });

async function fromBluetoothctl(re) {
  const devices = parseDevices(await run('bluetoothctl', ['devices', 'Connected'])).filter((d) => re.test(d.name));
  for (const d of devices) {
    const level = parseBatteryPercentage(await run('bluetoothctl', ['info', d.address]));
    if (level !== null) return { name: d.name, level };
  }
  return null;
}

/** { name, level } for a connected Bluetooth keyboard whose name matches `pattern` (a regular expression source), or null. */
async function bluetoothBatteryLinux(pattern) {
  let re;
  try {
    re = new RegExp(String(pattern || 'AULA|F75|F87').slice(0, 64), 'i');
  } catch (_) {
    return null;
  }
  return fromPowerSupply(re) || (await fromBluetoothctl(re));
}

module.exports = { bluetoothBatteryLinux, fromPowerSupply, parseBatteryPercentage, parseDevices };
