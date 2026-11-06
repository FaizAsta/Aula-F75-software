'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { loginItemOptions } = require('../login-item');

test('installed app starts with just --hidden', () => {
  const o = loginItemOptions({ isPackaged: true, appPath: 'C:\\x\\resources\\app.asar', execPath: 'C:\\Apps\\Aula Control\\Aula Control.exe' });
  assert.strictEqual(o.path, 'C:\\Apps\\Aula Control\\Aula Control.exe');
  assert.deepStrictEqual(o.args, ['--hidden']);
});

test('running from source passes the quoted app folder so electron.exe opens Aula Control', () => {
  const o = loginItemOptions({
    isPackaged: false,
    appPath: 'C:\\Users\\Some One\\Downloads\\aula-control',
    execPath: 'C:\\Users\\Some One\\Downloads\\aula-control\\node_modules\\electron\\dist\\electron.exe',
  });
  assert.deepStrictEqual(o.args, ['"C:\\Users\\Some One\\Downloads\\aula-control"', '--hidden']);
});

test('portable build uses the real .exe, not the temporary unpacked copy', () => {
  const o = loginItemOptions({
    isPackaged: true,
    appPath: 'C:\\Temp\\abc\\resources\\app.asar',
    execPath: 'C:\\Temp\\abc\\Aula Control.exe',
    portableFile: 'D:\\Tools\\Aula Control 1.1.2.exe',
  });
  assert.strictEqual(o.path, 'D:\\Tools\\Aula Control 1.1.2.exe');
});
