'use strict';

/*
 * Uninstalling from Windows Settings (Apps) removes the app's data too: the installer is told to delete the data folder
 * (settings and what the app remembers). electron-builder keeps it when the installer runs as an update.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

test('the Windows installer deletes the app data when the app is uninstalled', () => {
  assert.equal(pkg.build.nsis.deleteAppDataOnUninstall, true);
});

test('the data folder is the one named after the product, so that is the one the installer clears', () => {
  assert.equal(pkg.productName, 'Aula Control');
  assert.equal(pkg.build.productName, 'Aula Control');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.ok(!/setPath\(\s*['"]userData['"]/.test(main), 'main.js does not move the data folder somewhere the installer does not clear');
});
