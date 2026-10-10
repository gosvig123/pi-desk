'use strict';

// LLM display titles for Desk conversations, modeled on Zed's thread titles:
// a short 3-7 word title, generated in a separate `pi --print` call and stored
// in pisesh-meta.json (see bin/session-meta.js) with titleSource "llm". A
// manual title always wins and is never replaced by a generated one.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { metaFile, readMeta, updateMeta } = require('./session-meta');

// Same model as Zed's `agent.thread_summary_model` (openai-subscribed is
// pi's openai-codex provider). `G` in the picker saves a different one.
const DEFAULT_TITLE_MODEL = 'openai-codex/gpt-5.6-luna';
// Marks the title call's own pi process, so its extensions do not title it.
const TITLE_CHILD_ENV = 'PI_DESK_TITLE_CHILD';
const TITLE_TIMEOUT_MS = 120000;

const TITLE_PROMPT = `Generate a concise 3-7 word title for this conversation, omitting punctuation.
Go straight to the title, without any preamble and prefix like \`Here's a concise suggestion:...\` or \`Title:\`.
If the conversation is about a specific subject, include it in the title.
Be descriptive. DO NOT speak in the first person.`;

const TITLE_SYSTEM_PROMPT = 'You name coding conversations so they are easy to find in a list. Output only the requested title on one line.';

function titleSettings(settings = {}) {
  if (!settings.titleModel) return { model: DEFAULT_TITLE_MODEL, effort: 'off' };
  return { model: settings.titleModel, effort: settings.titleThinkingLevel || 'off' };
}

function textFromContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.filter(x => x && x.type === 'text' && x.text).map(x => x.text.trim()).filter(Boolean).join('\n');
}

function boundTitleContext(text, maxChars) {
  if (text.length <= maxChars) return text;
  const marker = '\n\n[earlier context omitted]\n\n';
  if (maxChars <= marker.length) return text.slice(0, maxChars);
  const available = maxChars - marker.length;
  const head = Math.floor(available * 0.4);
  return text.slice(0, head) + marker + text.slice(-(available - head));
}

// User requests and final assistant text, without tool calls, tool results,
// or aborted/errored replies.
function buildTitlePrompt(file, maxChars = 16000) {
  const userRequests = [];
  const assistantReports = [];
  let sessionCwd = '';
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (obj.type === 'session' && !sessionCwd && typeof obj.cwd === 'string') {
        sessionCwd = obj.cwd.trim();
        continue;
      }
      if (obj.type !== 'message' || !obj.message) continue;
      const { role, content, stopReason } = obj.message;
      if (role !== 'user' && role !== 'assistant') continue;
      const text = textFromContent(content);
      if (!text) continue;
      if (role === 'user') {
        userRequests.push(`User request ${userRequests.length + 1}: ${text}`);
        continue;
      }
      const hasToolCall = Array.isArray(content) && content.some(x => x && x.type === 'toolCall');
      if (!hasToolCall && stopReason !== 'error' && stopReason !== 'aborted') {
        assistantReports.push(`Assistant evidence ${assistantReports.length + 1}: ${text}`);
      }
    }
  } catch (e) { throw new Error(`could not read session: ${e.message}`); }
  if (!userRequests.length && !assistantReports.length) throw new Error('no conversation text found');

  const userText = userRequests.join('\n\n');
  const assistantText = assistantReports.join('\n\n');
  const totalBudget = Math.max(0, maxChars);
  let userBudget = Math.min(userText.length, Math.floor(totalBudget * 0.7));
  let assistantBudget = Math.min(assistantText.length, totalBudget - userBudget);
  let remaining = totalBudget - userBudget - assistantBudget;
  const extraUser = Math.min(remaining, userText.length - userBudget);
  userBudget += extraUser;
  remaining -= extraUser;
  assistantBudget += Math.min(remaining, assistantText.length - assistantBudget);

  const sections = [];
  const cwdParts = sessionCwd.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
  if (cwdParts.length) sections.push(`Session context:\nWorking directory: ${cwdParts[cwdParts.length - 1]}`);
  if (userText) sections.push(`User requests:\n${boundTitleContext(userText, userBudget)}`);
  if (assistantText) sections.push(`Assistant replies:\n${boundTitleContext(assistantText, assistantBudget)}`);
  return `${TITLE_PROMPT}\n\nConversation:\n${sections.join('\n\n')}`;
}

function cleanGeneratedTitle(output) {
  const safeOutput = String(output || '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '');
  const lines = safeOutput.split(/\r?\n/)
    .map(line => line.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (lines.length !== 1) throw new Error('model must return exactly one line');
  const title = lines[0]
    .replace(/^title\s*:\s*/i, '')
    .replace(/^["'“”‘’`*]+|["'“”‘’`*.]+$/g, '')
    .trim();
  if (!title) throw new Error('model returned an empty title');
  return [...title].slice(0, 100).join('');
}

function titleGenerationArgs(model, effort, prompt) {
  return [
    '--print', '--no-session', '--no-context-files',
    '--no-skills', '--no-prompt-templates', '--no-tools',
    '--system-prompt', TITLE_SYSTEM_PROMPT,
    '--model', model, '--thinking', effort, prompt,
  ];
}

function spawnTitleChild(model, effort, prompt, env = process.env) {
  return spawn('pi', titleGenerationArgs(model, effort, prompt), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...env, [TITLE_CHILD_ENV]: '1' },
  });
}

// Generate one title. Rejects with the operation, model, and cause.
function generateTitle(file, { model, effort }, env = process.env) {
  return new Promise((resolve, reject) => {
    let prompt;
    try { prompt = buildTitlePrompt(file); }
    catch (e) { return reject(e); }
    const child = spawnTitleChild(model, effort, prompt, env);
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, TITLE_TIMEOUT_MS);
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', e => { clearTimeout(timer); reject(new Error(`could not start pi: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`${model} timed out after ${TITLE_TIMEOUT_MS / 1000} seconds`));
      const detail = (stderr.trim() || stdout.trim()).split('\n').pop();
      if (code !== 0) return reject(new Error(`${model} failed${detail ? `: ${detail}` : ` with exit ${code}`}`));
      try { resolve(cleanGeneratedTitle(stdout)); }
      catch (e) { reject(new Error(`${model} returned no usable title: ${e.message}`)); }
    });
  });
}

function titleGenerationBlocker(target) {
  return target && target.titleSource === 'manual'
    ? 'manual title exists; clear it with e before generating'
    : '';
}

function hasTitle(sessionId, file = metaFile()) {
  return Boolean(readMeta(file).overrides[sessionId]?.title);
}

// Save a generated title only while the session still has none, so a title
// set meanwhile (manual or `g`) is kept. Returns whether it was saved.
function saveFirstTitle(sessionId, title, { model, effort }, file = metaFile()) {
  let saved = false;
  updateMeta(data => {
    const entry = data.overrides[sessionId] || {};
    if (entry.title) return;
    data.overrides[sessionId] = { ...entry, title, titleSource: 'llm', titleModel: model, titleThinkingLevel: effort };
    saved = true;
  }, file);
  return saved;
}

module.exports = {
  DEFAULT_TITLE_MODEL,
  TITLE_CHILD_ENV,
  TITLE_TIMEOUT_MS,
  titleSettings,
  buildTitlePrompt,
  cleanGeneratedTitle,
  titleGenerationArgs,
  spawnTitleChild,
  generateTitle,
  titleGenerationBlocker,
  hasTitle,
  saveFirstTitle,
};
