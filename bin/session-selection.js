'use strict';

// Picker → extension handoff values.
//
// The full-screen picker writes one JSON object to a private fd. Two shapes
// exist: resuming a session file, and starting a new conversation for a task.
// Every field is validated here, because a malformed selection must never
// change the running session.
const path = require('node:path');

const SELECTION_VERSION = 1;
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function parseTaskLink(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('picker returned a new conversation without a task');
  }
  const data = value;
  if (typeof data.id !== 'string' || !data.id.trim()) {
    throw new Error('picker returned a new conversation with an invalid task id');
  }
  return {
    id: data.id.trim(),
    title: typeof data.title === 'string' ? data.title : '',
    list: typeof data.list === 'string' ? data.list : '',
  };
}

// Optional resume fields: a malformed value must not silently change a resume.
function parseResumeOptions(data) {
  if (data.cwdOverride !== undefined && typeof data.cwdOverride !== 'string') {
    throw new Error('picker returned an invalid cwd override');
  }
  if (data.model !== undefined && typeof data.model !== 'string') {
    throw new Error('picker returned an invalid model');
  }
  if (data.thinking !== undefined && !THINKING_LEVELS.includes(data.thinking)) {
    throw new Error('picker returned an invalid thinking level');
  }
  if (data.repaired !== undefined && (!Number.isInteger(data.repaired) || data.repaired < 0)) {
    throw new Error('picker returned an invalid repair count');
  }
}

function parseResumeSelection(data) {
  if (
    typeof data.sessionPath !== 'string' ||
    !path.isAbsolute(data.sessionPath) ||
    (data.resumeMode !== 'defaults' && data.resumeMode !== 'session')
  ) {
    throw new Error('picker returned an invalid session selection');
  }
  parseResumeOptions(data);
  return data;
}

// Returns undefined when the picker returned nothing at all.
function parseSelection(raw) {
  if (!raw.trim()) return undefined;
  let value;
  try { value = JSON.parse(raw); }
  catch { throw new Error('picker returned invalid JSON'); }
  if (!value || typeof value !== 'object') {
    throw new Error('picker returned a non-object selection');
  }
  if (value.version !== SELECTION_VERSION) {
    throw new Error('picker returned an invalid selection version');
  }
  if (value.remoteConversation !== undefined) {
    const data = value.remoteConversation;
    if (!data || ['notice', 'command'].some(key => typeof data[key] !== 'string' || data[key].length > 8192 || /[\x00-\x1f\x7f]/.test(data[key]))) {
      throw new Error('picker returned invalid remote continuation guidance');
    }
    return { version: SELECTION_VERSION, remoteConversation: { notice: data.notice, command: data.command } };
  }
  if (value.newConversation !== undefined) {
    const request = value.newConversation || {};
    return { version: SELECTION_VERSION, newConversation: { task: parseTaskLink(request.task) } };
  }
  return parseResumeSelection(value);
}

module.exports = { parseSelection };
