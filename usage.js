'use strict';

/*
 * What the app itself costs, for the tray tooltip. Pure functions over what Electron's app.getAppMetrics() returns, so
 * they run in the tests without Electron.
 *
 * getAppMetrics lists every process the app has (main, window, GPU, utility). Each one reports its CPU as a share of ONE
 * core since the previous call (so 100 can be passed on a many-core PC) and its working set in kilobytes. Task Manager
 * shows CPU as a share of the whole PC, so the sum is divided by the number of cores.
 */

/** { cpu: percent of the whole PC, mb: megabytes in use, ramPct: percent of the PC's memory } */
function summarize(metrics, cores, totalBytes) {
  const list = Array.isArray(metrics) ? metrics : [];
  const n = Math.max(1, Number(cores) || 1);
  let cpu = 0;
  let kb = 0;
  for (const p of list) {
    if (p && p.cpu && Number.isFinite(p.cpu.percentCPUUsage)) cpu += p.cpu.percentCPUUsage;
    if (p && p.memory && Number.isFinite(p.memory.workingSetSize)) kb += p.memory.workingSetSize;
  }
  const mb = kb / 1024;
  const ramPct = totalBytes > 0 ? ((mb * 1024 * 1024) / totalBytes) * 100 : 0;
  return { cpu: Math.max(0, cpu / n), mb, ramPct };
}

/** "CPU 0.3%  RAM 118 MB (0.7%)" */
function usageLine(metrics, cores, totalBytes) {
  const u = summarize(metrics, cores, totalBytes);
  return `CPU ${u.cpu.toFixed(1)}%  RAM ${Math.round(u.mb)} MB (${u.ramPct.toFixed(1)}%)`;
}

module.exports = { summarize, usageLine };
