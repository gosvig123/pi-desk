'use strict';

const path = require('node:path');

class SessionSwitchGuard {
  constructor(pi) {
    this.live = true;
    this.version = 0;
    this.switching = false;
    pi.on('session_shutdown', () => { this.live = false; this.version++; });
    pi.on('session_before_switch', (_event, ctx) => {
      if (!this.switching || ctx.isIdle()) return;
      ctx.ui.notify('The agent is still working. Staying in this session; open /sesh again when it finishes.', 'info');
      return { cancel: true };
    });
  }

  async wait(ctx) {
    if (!this.live) return false;
    const version = ++this.version;
    if (!ctx.isIdle()) {
      ctx.ui.notify('The agent will keep working. Sesh will switch sessions after it finishes.', 'info');
    }
    await ctx.waitForIdle();
    if (!this.live || version !== this.version) return false;
    if (!ctx.isIdle()) {
      ctx.ui.notify('Another run started. Staying in this session; open /sesh again when it finishes.', 'info');
      return false;
    }
    this.switching = true;
    return true;
  }

  finish() { this.switching = false; }
}

// Apply the model, thinking level, and notices queued by a resume selection.
// Kept out of the extension so the resume handoff stays testable on its own.
async function applyPendingSwitch(pending, ctx, pi) {
  await applyResumeModel(pending, ctx, pi);
  if (pending.thinking) pi.setThinkingLevel(pending.thinking);
  if (pending.repaired) {
    ctx.ui.notify(
      `Repaired ${pending.repaired} interrupted tool call${pending.repaired === 1 ? '' : 's'} before resume`,
      'warning',
    );
  }
  if (pending.cwdOverride && path.resolve(ctx.cwd) !== path.resolve(pending.cwdOverride)) {
    ctx.ui.notify(
      'This pi version did not apply the selected cwd override; update pi to a version that supports it',
      'warning',
    );
  }
}

async function applyResumeModel(pending, ctx, pi) {
  if (!pending.model) return;
  const separator = pending.model.indexOf('/');
  const model = separator > 0
    ? ctx.modelRegistry.find(pending.model.slice(0, separator), pending.model.slice(separator + 1))
    : undefined;
  if (model && (await pi.setModel(model))) return;
  ctx.ui.notify(`Could not apply resume model: ${pending.model}`, 'warning');
}

module.exports = { SessionSwitchGuard, applyPendingSwitch };
