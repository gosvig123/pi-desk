'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { safeText } = require('./tasks-data');

function read(file) {
  if (fs.statSync(file).size > 1024 * 1024) throw new Error('reference file too large');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
const agentDir = () => path.resolve(process.env.PI_AGENT_DIR || process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), '.pi/agent'));
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

function remoteConversations(dir = agentDir(), now = Date.now()) {
  try {
    const config = read(path.join(dir, 'desk-sync/config.json'));
    const peer = read(path.join(dir, 'desk-sync/peer.json'));
    if (peer.version !== 1 || peer.origin !== config.peerOrigin || !Array.isArray(peer.sessions) || peer.sessions.length > 500) return [];
    const fresh = Math.min(peer.receivedAt || 0, peer.generatedAt || 0) * 1000 > now - 120000;
    return peer.sessions.filter(row => /^[a-f0-9-]{32,36}$/i.test(row.id) && typeof row.file === 'string' && row.file.startsWith('/') && row.file.endsWith('.jsonl') && typeof row.cwd === 'string' && row.cwd.startsWith('/') && !/[\x00-\x1f\x7f]/.test(row.file + row.cwd) && Number.isFinite(row.mtime)).map(row => {
      const origin = safeText(peer.origin);
      const command = `cd ${quote(row.cwd)} && pi --session ${quote(row.file)}`;
      const sshHost = typeof config.sshHost === 'string' && /^[A-Za-z0-9_.@-]+$/.test(config.sshHost) && !config.sshHost.startsWith('-') ? config.sshHost : null;
      return {
        id: `${origin}:${row.id}`, remoteId: row.id, remote: true, origin,
        ts: new Date(row.mtime * 1000).toISOString(), mtime: new Date(row.mtime * 1000),
        cwd: row.cwd, effectiveCwd: row.cwd, project: origin, projectSlug: origin,
        file: row.file, size: 0, prompt: '', favored: false, isCurrent: false,
        titleOverride: '', titleSource: '', titleModel: '', titleThinkingLevel: '', cwdOverride: '',
        task: row.task || null,
        title: `[${origin}${fresh ? '' : ' · offline/stale'}] ${safeText(row.title) || row.id.slice(0, 8)}`,
        resumeCommand: sshHost ? `ssh -t ${quote(sshHost)} ${quote(command)}` : command,
        resumeNotice: `Manual continuation on ${origin}: close this conversation there first (ownership unknown). ${sshHost ? 'Run copied SSH command in a terminal.' : 'Run copied command in a terminal on the origin; reverse SSH is not configured.'}`,
      };
    });
  } catch { return []; }
}

function syncStatus(dir = agentDir()) {
  try {
    const status = read(path.join(dir, 'desk-sync/status.json'));
    return ['tasks', 'references', 'transport'].map(name => {
      const s = status[name];
      return `${name}: ${s?.ok ? 'ok' : (s?.error || 'not run')}${s ? ` (${Math.max(0, Math.round(Date.now()/1000-s.at))}s ago)` : ''}${s?.retryAt > Date.now()/1000 ? `; retry in ${Math.ceil(s.retryAt-Date.now()/1000)}s` : ''}${s?.error === 'TaskSyncConflict' ? '; resolve with tasks sync --no-prune (no force/adopt)' : ''}`;
    }).join(' · ');
  } catch { return 'Desk sync not configured or service has not run. See docs/sync.md.'; }
}
module.exports = { remoteConversations, syncStatus, quote };
