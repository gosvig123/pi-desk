'use strict';

// The only write path to the tick schedule: pi-tick's own CLI. Reads never
// come through here — ticks-data.js reads jobs.json directly.

const { execFile, spawn } = require('node:child_process');
const { tickPaths } = require('./ticks-data');

const TIMEOUT_MS = 15000;

function setTickEnabled(id, enabled, dir) {
  return new Promise((resolve, reject) => {
    const args = [tickPaths(dir).cli, enabled ? 'enable' : 'disable', id];
    execFile(process.execPath, args, { timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, error => {
      if (!error) return resolve();
      reject(new Error(error.killed
        ? `pi-tick ${enabled ? 'enable' : 'disable'} timed out`
        : `pi-tick ${enabled ? 'enable' : 'disable'} failed; press r to check the job`));
    });
  });
}

// A run can last minutes, so detach it: the TUI stays responsive and the
// runner keeps its own logs. Status appears under active/ on the next reload.
function runTickNow(id, dir) {
  const child = spawn(process.execPath, [tickPaths(dir).cli, 'run', id, '--manual'],
    { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return Promise.resolve();
}

module.exports = { setTickEnabled, runTickNow };
