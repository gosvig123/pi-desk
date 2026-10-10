'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseModelEntries,
  parseModelList,
  piAgentEnv,
  buildTitlePrompt,
  cleanGeneratedTitle,
  takeGenerationBatch,
  titleGenerationArgs,
  titleGenerationBlocker,
} = require('../bin/pisesh');
const { hasTitle, saveFirstTitle, titleSettings } = require('../bin/session-titles');

test('parses canonical model ids from pi --list-models', () => {
  const output = [
    'provider      model          context  max-out  thinking  images',
    'openai        gpt-4o-mini    128K     16K      no        yes',
    'anthropic     claude-haiku   200K     8K       yes       yes',
    '',
  ].join('\n');
  assert.deepEqual(parseModelList(output), [
    'openai/gpt-4o-mini',
    'anthropic/claude-haiku',
  ]);
  assert.deepEqual(parseModelEntries(output), [
    { id: 'openai/gpt-4o-mini', thinking: false },
    { id: 'anthropic/claude-haiku', thinking: true },
  ]);
});

test('takes at most three concurrent generation jobs', () => {
  const queue = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(takeGenerationBatch(queue, 0), ['a', 'b', 'c']);
  assert.deepEqual(queue, ['d', 'e']);
  assert.deepEqual(takeGenerationBatch(queue, 3), []);
  assert.deepEqual(queue, ['d', 'e']);
  assert.deepEqual(takeGenerationBatch(queue, 2), ['d']);
  assert.deepEqual(queue, ['e']);
});

test('keeps provider extensions available while isolating title prompts', () => {
  const args = titleGenerationArgs('claude-bridge/claude-opus-4-8', 'low', 'prompt');
  assert.ok(args.includes('--no-context-files'));
  assert.ok(args.includes('--no-tools'));
  assert.ok(!args.includes('--no-extensions'));
  assert.equal(args[args.indexOf('--model') + 1], 'claude-bridge/claude-opus-4-8');
  assert.deepEqual(piAgentEnv({ PATH: '/bin' }, '/custom/agent'), {
    PATH: '/bin',
    PI_CODING_AGENT_DIR: '/custom/agent',
  });
});

test('protects manually edited titles from generated replacement', () => {
  assert.match(titleGenerationBlocker({ titleSource: 'manual' }), /manual title exists/);
  assert.equal(titleGenerationBlocker({ titleSource: 'llm' }), '');
  assert.equal(titleGenerationBlocker({}), '');
});

test('cleans and validates generated title output', () => {
  assert.equal(cleanGeneratedTitle('Title: “Auto Name Desk Sessions With LLM”\n'), 'Auto Name Desk Sessions With LLM');
  assert.equal(
    cleanGeneratedTitle("\u001b[31m'Fix CJK Layout in Session List.'\u001b[0m"),
    'Fix CJK Layout in Session List',
  );
  assert.throws(() => cleanGeneratedTitle('\n\n'), /exactly one line/);
  assert.throws(() => cleanGeneratedTitle('warning\nFix CJK Layout'), /exactly one line/);
  assert.throws(() => cleanGeneratedTitle('""'), /empty title/);
});

test('protects existing titles from automatic replacement', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisesh-meta-'));
  const file = path.join(dir, 'pisesh-meta.json');
  const settings = { model: 'openai-codex/gpt-5.6-luna', effort: 'off' };
  fs.writeFileSync(file, JSON.stringify({ overrides: { kept: { title: 'My name', titleSource: 'manual' }, other: { cwd: '/x' } } }));
  assert.equal(saveFirstTitle('kept', 'Generated', settings, file), false);
  assert.equal(saveFirstTitle('other', 'Generated', settings, file), true);
  const { overrides } = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(overrides.kept.title, 'My name');
  assert.deepEqual(overrides.other, { cwd: '/x', title: 'Generated', titleSource: 'llm', titleModel: settings.model, titleThinkingLevel: 'off' });
  assert.equal(hasTitle('other', file), true);
  assert.deepEqual(titleSettings({}), settings);
});

test('builds role-aware title context and excludes plans and tool results', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pisesh-title-'));
  const file = path.join(dir, 'session.jsonl');
  const entries = [
    { type: 'session', id: 'abc', cwd: '/work/sample-project' },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Refactor retry handling' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'I will inspect the implementation.' }, { type: 'toolCall', name: 'read' }] } },
    { type: 'message', message: { role: 'toolResult', content: [{ type: 'text', text: 'SECRET TOOL OUTPUT' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'Extracted a shared retry policy.' }], stopReason: 'stop' } },
    { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Keep the public API unchanged' }] } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'PARTIAL ABORTED RESPONSE' }], stopReason: 'aborted' } },
  ];
  fs.writeFileSync(file, entries.map(x => JSON.stringify(x)).join('\n'));
  const prompt = buildTitlePrompt(file, 1000);
  assert.match(prompt, /Working directory: sample-project/);
  assert.match(prompt, /User request 1: Refactor retry handling/);
  assert.match(prompt, /User request 2: Keep the public API unchanged/);
  assert.match(prompt, /Assistant evidence 1: Extracted a shared retry policy/);
  assert.doesNotMatch(prompt, /I will inspect the implementation/);
  assert.doesNotMatch(prompt, /SECRET TOOL OUTPUT/);
  assert.doesNotMatch(prompt, /PARTIAL ABORTED RESPONSE/);
  assert.match(prompt, /^Generate a concise 3-7 word title/);
});
