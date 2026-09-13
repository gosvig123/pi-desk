'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseSelection } = require('./session-selection');

const PICKER_CLI = path.join(__dirname, 'pisesh');

// Run the bundled picker on the real terminal and read its one JSON selection
// from fd 3: a session to resume, or a task to start a conversation for.
// Returns { code, selection } or { code, error }; a non-zero code means the
// picker exited before choosing.
function runPicker(currentSessionId) {
  return new Promise(resolve => {
    let output = '';
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const child = spawn('node', [PICKER_CLI], {
      stdio: ['inherit', 'inherit', 'inherit', 'pipe'],
      env: pickerEnv(currentSessionId),
    });
    const resultPipe = child.stdio[3];
    resultPipe?.setEncoding('utf8');
    resultPipe?.on('data', chunk => { output += chunk; });
    child.on('close', code => finish(closeResult(code, output)));
    child.on('error', error => {
      process.stdout.write(`\x1b[31mpi-desk failed to launch: ${error.message}\x1b[0m\n`);
      finish({ code: 127, error: error.message });
    });
  });
}

// A picker that exits non-zero chose nothing; a zero exit must carry a valid
// selection, so a malformed result is reported instead of acted on.
function closeResult(code, output) {
  if (code !== 0) return { code };
  try { return { code, selection: parseSelection(output) }; }
  catch (error) { return { code, error: error.message }; }
}

// fd 3 stays private to the picker result; stdin/stdout/stderr remain the real
// terminal used by the full-screen picker.
function pickerEnv(currentSessionId) {
  return {
    ...process.env,
    PISESH_SELECT_FD: '3',
    PISESH_CWD: process.cwd(),
    ...(currentSessionId ? { PISESH_CURRENT_SESSION: currentSessionId } : {}),
  };
}

module.exports = { runPicker };
