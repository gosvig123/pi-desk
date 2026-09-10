'use strict';
const { safeText } = require('./tasks-data');
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const segments = text => Array.from(segmenter.segment(text), part => part.segment);
// Match the picker's wide-character ranges; combining marks occupy no extra cells.
const WIDE_RANGES = [[0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e],
  [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf],
  [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60],
  [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff],
  [0x1f900, 0x1f9ff], [0x20000, 0x2fffd]];
function charWidth(cp) {
  if (/\p{Mark}/u.test(String.fromCodePoint(cp)) || cp === 0x200d) return 0;
  return WIDE_RANGES.some(([start, end]) => cp >= start && cp <= end) ? 2 : 1;
}

function displayWidth(s) {
  let width = 0;
  for (const part of segments(s || '')) {
    if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(part)) width += 2;
    else for (const ch of part) width += charWidth(ch.codePointAt(0));
  }
  return width;
}


function clip(text, width) {
  let result = '';
  for (const part of segments(safeText(text))) {
    if (displayWidth(result + part) > width) break;
    result += part;
  }
  return result;
}
function ellipsize(text, width) {
  const clean = safeText(text);
  if (displayWidth(clean) <= width) return clean;
  return width > 0 ? clip(clean, width - 1) + '…' : '';
}
function wrap(text, width) {
  const rows = [];
  for (const paragraph of String(text).split('\n')) {
    let row = '';
    for (const part of segments(safeText(paragraph))) {
      if (displayWidth(row + part) > width && row) { rows.push(row); row = ''; }
      row += clip(part, width);
    }
    rows.push(row);
  }
  return rows;
}
function viewport(text, cursor, width) {
  const parts = segments(text);
  let left = parts.slice(0, cursor).map(safeText);
  while (displayWidth(left.join('')) > Math.max(0, width - 3)) left.shift();
  return clip((left.length < cursor ? '‹' : '') + left.join('') + '▏' + parts.slice(cursor).join(''), width);
}
module.exports = { segments, clip, ellipsize, wrap, viewport, displayWidth };
