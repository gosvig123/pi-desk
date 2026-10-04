'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Run the real picker in a terminal, with isolated sessions and sidecar files.
test('a new session keeps its prompt title across all conversation views', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-title-'));
  try {
    const sessions = path.join(dir, 'sessions');
    fs.mkdirSync(sessions);
    const entries = [
      { type: 'session', id: 'desk-title-check', cwd: dir, timestamp: new Date().toISOString() },
      { type: 'message', message: { role: 'system', content: 'x'.repeat(110 * 1024) } },
      { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Validate new conversation title' }] } },
    ];
    fs.writeFileSync(path.join(sessions, 'new.jsonl'), entries.map(JSON.stringify).join('\n'));
    const result = spawnSync('python3', ['-c', `
import os, pty, select, subprocess, time, fcntl, termios, struct
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 35, 160, 0, 0))
p = subprocess.Popen([os.environ['NODE'], os.environ['PICKER']], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
def frame(key=b''):
    if key: os.write(master, key)
    output = b''
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready: output += os.read(master, 65536)
        elif output: return output.decode('utf-8', errors='replace')
    raise AssertionError('picker did not render')
try:
    initial = frame()
    assert 'Validate new conversation title' not in initial, 'unstarred session in Favorites'
    for view in ['Today', 'Here', 'All']:
        output = frame(b']')
        assert 'Validate new conversation title' in output, (view, output)
        assert '(no prompt)' not in output, view
        assert '[NOW]' in output, view
    frame(b'f')  # star the selected conversation
    output = frame(b']')
    assert 'Validate new conversation title' in output, ('Favorites', output)
    print('PASS: Today, Here, All, Favorites show the new session title')
finally:
    p.kill()
    p.wait(timeout=5)
    os.close(master)
`], {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, NODE: process.execPath, PICKER: path.resolve(__dirname, '../bin/pisesh'),
        PI_AGENT_DIR: dir, PI_CODING_AGENT_DIR: dir, PI_SESSION_DIR: sessions,
        PI_TICK_DATA_DIR: path.join(dir, 'tick'), PISESH_CWD: dir, PISESH_CURRENT_SESSION: 'desk-title-check' },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
