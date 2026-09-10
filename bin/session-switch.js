'use strict';

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

module.exports = { SessionSwitchGuard };
