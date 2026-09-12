'use strict';

const { loadTicks } = require('./ticks-data');
const { tickRows, tickDetailRows, tickSummary } = require('./tick-presentation');
const { runTickNow, setTickEnabled } = require('./tick-actions');
const { clip } = require('./task-layout');
const { styleTickRow } = require('./task-styles');
const { safeText } = require('./tasks-data');

const LIST = 'list';
const DETAILS = 'details';
const TICKS_TAB = 'Ticks';

class TicksView {
  constructor(refresh, load = loadTicks, actions = { run: runTickNow, toggle: setTickEnabled }) {
    this.refresh = refresh;
    this.load = load;
    this.actions = actions;
    this.data = { jobs: [], error: '' };
    this.cursor = 0;
    this.mode = LIST;
    this.detailOffset = 0;
    this.notice = '';
    this.confirm = '';
    this.busy = false;
    this.loading = false;
    this.started = false;
  }

  visible() { return this.data.jobs; }

  async reload() {
    if (this.loading) return;
    this.started = true;
    const selected = this.visible()[this.cursor]?.id;
    const previous = this.cursor;
    this.loading = true;
    try { this.data = await this.load(); }
    catch (error) { this.data = { jobs: [], error: safeText(error.message) }; }
    const index = this.visible().findIndex(job => job.id === selected);
    this.cursor = index >= 0 ? index : Math.min(previous, Math.max(0, this.visible().length - 1));
    this.loading = false;
    this.refresh();
  }

  async act(kind, job) {
    this.busy = true;
    this.notice = '';
    this.refresh();
    try {
      if (kind === 'run') {
        await this.actions.run(job.id);
        this.notice = `started ${job.id} — press r to refresh status`;
      } else {
        await this.actions.toggle(job.id, !job.enabled);
        this.notice = `${job.id} ${job.enabled ? 'disabled' : 'enabled'}`;
        await this.reload();
      }
    } catch (error) {
      this.notice = `Error: ${safeText(error.message)}`;
    } finally { this.busy = false; this.refresh(); }
  }

  run() {
    const job = this.visible()[this.cursor];
    if (!job || this.busy) return;
    if (this.confirm !== job.id) { this.confirm = job.id; this.notice = ''; return; }
    this.confirm = '';
    if (!job.enabled) { this.notice = `${job.id} is disabled — Space enables it first`; return; }
    void this.act('run', job);
  }

  handle(str, key) {
    const k = key.name;
    if (this.busy) return true;
    if (this.confirm && str !== 'x') this.confirm = '';
    if (this.mode === DETAILS) return this.handleDetails(k);
    const job = this.visible()[this.cursor];
    const last = Math.max(0, this.visible().length - 1);
    if (k === 'up' || k === 'k') this.cursor = Math.max(0, this.cursor - 1);
    else if (k === 'down' || k === 'j') this.cursor = Math.min(last, this.cursor + 1);
    else if (k === 'home') this.cursor = 0;
    else if (k === 'end') this.cursor = last;
    else if (k === 'pageup') this.cursor = Math.max(0, this.cursor - 10);
    else if (k === 'pagedown') this.cursor = Math.min(last, this.cursor + 10);
    else if (k === 'r') void this.reload();
    else if ((k === 'return' || k === 'd') && job) { this.mode = DETAILS; this.detailOffset = 0; }
    else if (str === ' ' || k === 'space') { if (job) void this.act('toggle', job); }
    else if (str === 'x') this.run();
    return true;
  }

  handleDetails(k) {
    if (['escape', 'q', 'd', 'return'].includes(k)) this.mode = LIST;
    else if (['down', 'j', 'pagedown'].includes(k)) this.detailOffset += k === 'pagedown' ? 5 : 1;
    else if (['up', 'k', 'pageup'].includes(k)) {
      this.detailOffset = Math.max(0, this.detailOffset - (k === 'pageup' ? 5 : 1));
    }
    return true;
  }

  lines(height, width = 78) {
    if (!this.started) void this.reload();
    const rows = this.headerRows(width);
    const available = Math.max(1, height - rows.length);
    const body = this.mode === DETAILS
      ? this.detailLines(width, available)
      : tickRows(this, available, width);
    return [...rows, ...body].slice(0, height);
  }

  headerRows(width) {
    const rows = [`Jobs: ${tickSummary(this)}`];
    if (this.loading) rows.push('Loading ticks…');
    if (this.data.error) rows.push(`Error: ${this.data.error} — press r to retry`);
    // A notice belongs to the action that caused it, so it shows once.
    if (this.notice) { rows.push(this.notice); this.notice = ''; }
    if (this.confirm) rows.push(`Run ${this.confirm}? press x again · any other key cancels`);
    return rows.map(row => clip(row, width));
  }

  detailLines(width, height) {
    const rows = tickDetailRows(this.visible()[this.cursor], width);
    this.detailOffset = Math.min(this.detailOffset, Math.max(0, rows.length - height));
    return rows.slice(this.detailOffset, this.detailOffset + height);
  }

  renderLines(height, width) {
    const rows = this.lines(height, width);
    if (this.mode === DETAILS || this.data.error) return rows;
    return rows.map(row => styleTickRow(row, width));
  }

  help() {
    if (this.mode === DETAILS) return '↑↓ scroll · Esc back · r reload';
    if (this.busy) return 'Waiting for pi-tick…';
    return '↑↓ move · ? keys · Enter details · Space on/off · x run · r reload';
  }}

module.exports = { TicksView, TICKS_TAB };
