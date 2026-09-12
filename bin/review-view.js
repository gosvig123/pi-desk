'use strict';

// The Review list inside the Conversations tab. Holds no data of its own:
// review-data.js builds the entries, review-store.js records what was seen, and
// opening a conversation is delegated back to the picker.

const { collectReview, REVIEW_WINDOW_DAYS } = require('./review-data');
const { reviewRows, reviewDetailRows, reviewSummary } = require('./review-presentation');
const { clip } = require('./task-layout');
const { styleReviewRow } = require('./task-styles');
const { safeText } = require('./tasks-data');

const LIST = 'list';
const DETAILS = 'details';
const REVIEW_TAB = 'Review';

class ReviewView {
  constructor(refresh, { load, store, openConversation } = {}) {
    this.refresh = refresh;
    this.load = load ?? (() => collectReview({ reviewed: store }));
    this.store = store;
    this.openConversation = openConversation ?? (() => {});
    this.entries = [];
    this.error = '';
    this.cursor = 0;
    this.mode = LIST;
    this.detailsEntry = null;
    this.detailOffset = 0;
    this.notice = '';
    this.loading = false;
    this.started = false;
  }

  visible() { return this.entries; }

  async reload() {
    if (this.loading) return;
    this.started = true;
    const selected = this.visible()[this.cursor]?.key;
    const previous = this.cursor;
    this.loading = true;
    try { this.entries = await this.load(); this.error = ''; }
    catch (error) { this.entries = []; this.error = safeText(error.message); }
    if (this.store?.fresh && this.entries.length) {
      this.store.mark(this.entries.map(entry => entry.key));
      this.notice = `Review starts empty: ${this.entries.length} earlier items marked reviewed`;
      this.entries = [];
    }
    const index = this.visible().findIndex(entry => entry.key === selected);
    this.cursor = index >= 0 ? index : Math.min(previous, Math.max(0, this.visible().length - 1));
    this.loading = false;
    this.refresh();
  }

  acknowledge(entries) {
    const keys = entries.filter(Boolean).map(entry => entry.key);
    if (!keys.length) return;
    this.store?.mark(keys);
    this.notice = `reviewed ${keys.length === 1 ? entries[0].title : `${keys.length} entries`}`;
    void this.reload();
  }

  openEntry(entry) {
    if (!entry) return;
    this.acknowledge([entry]);
    if (entry.kind === 'conversation') this.openConversation(entry);
  }

  // The details view is a read: it acknowledges the entry and stays put. The
  // opened entry is remembered, because acknowledging removes it from the list.
  preview(entry) {
    this.mode = DETAILS;
    this.detailsEntry = entry;
    this.detailOffset = 0;
    this.acknowledge([entry]);
  }

  handle(str, key) {
    const k = key.name;
    if (this.mode === DETAILS) return this.handleDetails(str, k);
    const entry = this.visible()[this.cursor];
    const last = Math.max(0, this.visible().length - 1);
    if (k === 'up' || k === 'k') this.cursor = Math.max(0, this.cursor - 1);
    else if (k === 'down' || k === 'j') this.cursor = Math.min(last, this.cursor + 1);
    else if (k === 'home') this.cursor = 0;
    else if (k === 'end') this.cursor = last;
    else if (k === 'pageup') this.cursor = Math.max(0, this.cursor - 10);
    else if (k === 'pagedown') this.cursor = Math.min(last, this.cursor + 10);
    else if (k === 'r') void this.reload();
    else if (k === 'return' && entry) {
      if (entry.kind === 'tick') this.preview(entry);
      else this.openEntry(entry);
    } else if (k === 'd' && entry) this.preview(entry);
    else if (str === 'a') this.acknowledge([entry]);
    else if (str === 'A') this.acknowledge(this.visible());
    return true;
  }

  handleDetails(str, k) {
    if (['escape', 'q', 'd', 'return'].includes(k)) { this.mode = LIST; this.detailsEntry = null; }
    else if (['down', 'j', 'pagedown'].includes(k)) this.detailOffset += k === 'pagedown' ? 5 : 1;
    else if (['up', 'k', 'pageup'].includes(k)) {
      this.detailOffset = Math.max(0, this.detailOffset - (k === 'pageup' ? 5 : 1));
    } else if (str === 'a') this.acknowledge(this.visible());
    return true;
  }

  lines(height, width = 78) {
    if (!this.started) void this.reload();
    const rows = this.headerRows(width);
    const available = Math.max(1, height - rows.length);
    const body = this.mode === DETAILS
      ? this.detailLines(width, available)
      : reviewRows(this, available, width);
    return [...rows, ...body].slice(0, height);
  }

  headerRows(width) {
    const rows = [`Review: ${reviewSummary(this)} · last ${REVIEW_WINDOW_DAYS} days`];
    if (this.loading) rows.push('Loading review…');
    if (this.error) rows.push(`Error: ${this.error} — press r to retry`);
    // A notice belongs to the action that caused it, so it shows once.
    if (this.notice) { rows.push(this.notice); this.notice = ''; }
    return rows.map(row => clip(row, width));
  }

  detailLines(width, height) {
    const rows = reviewDetailRows(this.detailsEntry, width);
    this.detailOffset = Math.min(this.detailOffset, Math.max(0, rows.length - height));
    return rows.slice(this.detailOffset, this.detailOffset + height);
  }

  renderLines(height, width) {
    const rows = this.lines(height, width);
    if (this.mode === DETAILS || this.error) return rows;
    return rows.map(row => styleReviewRow(row, width));
  }

  help() {
    if (this.mode === DETAILS) return '↑↓ scroll · Esc back · a reviewed all';
    if (this.loading) return 'Reading conversations and tick runs…';
    return '↑↓ move · ? keys · Enter opens · d details · a reviewed · A all';
  }
}

module.exports = { ReviewView, REVIEW_TAB };
