'use strict';

// These fixed tab labels use one terminal cell per character.
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

function navigationHint(width, conversations) {
  if (!conversations) return 'Tab switch tab';
  const full = 'Tab switch tab · [ previous view · ] next view';
  return width >= full.length ? full : 'Tab tabs · [ prev view · ] next view';
}

module.exports = { tabBar, navigationHint };
