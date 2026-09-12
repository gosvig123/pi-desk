'use strict';

// The active tab stays whole, so the numbered jump key is always readable even
// when the other four labels do not fit.
function tabBar(labels, selected, width, active = text => text) {
  const cells = labels.map((label, index) => index === selected ? `[ ${label} ]` : `  ${label}  `);
  for (const separator of ['   │   ', ' │ ']) {
    if (cells.join(separator).length <= width) {
      return cells.map((cell, index) => index === selected ? active(cell) : cell).join(separator);
    }
  }
  const current = cells[selected].trim();
  const clipped = current.length <= width ? current : current.slice(0, Math.max(0, width - 1)) + '…';
  return active(clipped);
}

module.exports = { tabBar };
