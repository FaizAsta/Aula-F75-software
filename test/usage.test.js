'use strict';

/*
 * The tray tooltip's usage line. Electron lists every process of the app with its CPU (a share of one core) and its
 * working set (kilobytes); the line is the sum, with the CPU shown as a share of the whole PC like Task Manager does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, usageLine } = require('../usage.js');

const proc = (cpu, kb) => ({ cpu: { percentCPUUsage: cpu }, memory: { workingSetSize: kb } });
const GB = 1024 ** 3;

test('adds up every process and divides the CPU by the number of cores', () => {
  const u = summarize([proc(2, 60 * 1024), proc(1, 40 * 1024), proc(1, 20 * 1024)], 8, 16 * GB);
  assert.equal(u.cpu, 0.5, '4% of one core on 8 cores is 0.5% of the PC');
  assert.equal(u.mb, 120);
  assert.ok(Math.abs(u.ramPct - (120 / (16 * 1024)) * 100) < 1e-9);
});

test('the line reads like Task Manager', () => {
  assert.equal(usageLine([proc(0, 118 * 1024)], 4, 16 * GB), 'CPU 0.0%  RAM 118 MB (0.7%)');
  assert.equal(usageLine([proc(8, 200 * 1024)], 8, 8 * GB), 'CPU 1.0%  RAM 200 MB (2.4%)');
});

test('missing or odd data gives zeros, never NaN', () => {
  assert.equal(usageLine(undefined, 8, 16 * GB), 'CPU 0.0%  RAM 0 MB (0.0%)');
  assert.equal(usageLine([{}, null, { cpu: {}, memory: {} }], 0, 0), 'CPU 0.0%  RAM 0 MB (0.0%)');
});
