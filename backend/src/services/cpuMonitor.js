/**
 * Lightweight CPU & memory usage sampler.
 * Samples every INTERVAL ms and keeps the last MAX_SAMPLES readings.
 *
 * Usage:
 *   const { startCpuMonitor, getCpuHistory, getCpuCurrent, getMemHistory, getMemCurrent } = require('./cpuMonitor');
 *   startCpuMonitor();                // call once at startup
 *   getCpuCurrent();                  // → 12.3  (percent)
 *   getCpuHistory();                  // → [{ ts, cpu }, …]
 *   getMemCurrent();                  // → 61  (MB)
 *   getMemHistory();                  // → [{ ts, mem }, …]
 */

const os = require('os');

const INTERVAL = 3000;   // sample every 3 s
const MAX_SAMPLES = 60;  // keep ~3 min of history

const cpuHistory = [];
const memHistory = [];
let prevCpuUsage = null;
let prevTime = null;
let timer = null;

function sample() {
  const cpuUsage = process.cpuUsage();
  const now = Date.now();
  const memMB = Math.round(process.memoryUsage().rss / 1024 / 1024);

  if (prevCpuUsage && prevTime) {
    const elapsedUs = (now - prevTime) * 1000; // wall-clock in µs
    const userDelta = cpuUsage.user - prevCpuUsage.user;
    const sysDelta  = cpuUsage.system - prevCpuUsage.system;
    const cpuPercent = Math.min(((userDelta + sysDelta) / elapsedUs) * 100, 100);

    const ts = new Date().toISOString();
    cpuHistory.push({ ts, cpu: Math.round(cpuPercent * 10) / 10 });
    if (cpuHistory.length > MAX_SAMPLES) cpuHistory.shift();

    memHistory.push({ ts, mem: memMB });
    if (memHistory.length > MAX_SAMPLES) memHistory.shift();
  }

  prevCpuUsage = cpuUsage;
  prevTime = now;
}

function startCpuMonitor() {
  if (timer) return;
  sample(); // prime the initial reading
  timer = setInterval(sample, INTERVAL);
  timer.unref(); // don't prevent process from exiting
}

function getCpuHistory() {
  return cpuHistory.slice();
}

function getCpuCurrent() {
  if (!cpuHistory.length) return 0;
  return cpuHistory[cpuHistory.length - 1].cpu;
}

function getMemHistory() {
  return memHistory.slice();
}

function getMemCurrent() {
  if (!memHistory.length) return Math.round(process.memoryUsage().rss / 1024 / 1024);
  return memHistory[memHistory.length - 1].mem;
}

module.exports = { startCpuMonitor, getCpuHistory, getCpuCurrent, getMemHistory, getMemCurrent };
