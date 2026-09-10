'use strict';
const { displayWidth } = require('./task-layout');
const STYLE = Object.freeze({ reset: '\x1b[0m', selected: '\x1b[7m', bold: '\x1b[1m',
  dim: '\x1b[2m', accent: '\x1b[36m', warning: '\x1b[33m', error: '\x1b[31m' });

// Apply terminal styles only after plain text has been sanitized and clipped.
function styleTaskRow(row, width) {
  if (row.startsWith('▶')) {
    return STYLE.selected + STYLE.bold + row + ' '.repeat(Math.max(0, width - displayWidth(row))) + STYLE.reset;
  }
  if (row.startsWith('│')) return STYLE.accent + row + STYLE.reset;
  if (row.startsWith('Error:')) return STYLE.error + row + STYLE.reset;
  if (row.startsWith('List:') || row.startsWith('Search:')) return STYLE.bold + STYLE.accent + row + STYLE.reset;
  if (/^ {6}Overdue\b/.test(row)) return STYLE.warning + row + STYLE.reset;
  if (/^ {6}/.test(row) || /^  \[x\]/.test(row) || /^\d+\/\d+ ·/.test(row)) return STYLE.dim + row + STYLE.reset;
  return row;
}

module.exports = { styleTaskRow };
