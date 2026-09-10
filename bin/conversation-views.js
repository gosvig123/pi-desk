'use strict';

const { tabBar } = require('./tab-bar');
const CONVERSATIONS_TAB = 'Conversations';
const CONVERSATION_VIEWS = Object.freeze(['★ Favorites', 'Today', 'Here', 'All']);

class ConversationViews {
  constructor() { this.index = 0; }

  get current() { return CONVERSATION_VIEWS[this.index]; }

  handle(str) {
    if (str !== '[' && str !== ']') return false;
    this.index = (this.index + (str === ']' ? 1 : 3)) % CONVERSATION_VIEWS.length;
    return true;
  }

  labels(width = Infinity, active) {
    return tabBar(CONVERSATION_VIEWS, this.index, width, active);
  }

  filter(sessions, cwd, now = new Date()) {
    if (this.current === '★ Favorites') return sessions.filter(session => session.favored);
    if (this.current === 'Today') {
      const today = now.toLocaleDateString('sv-SE');
      return sessions.filter(session => new Date(session.mtime).toLocaleDateString('sv-SE') === today);
    }
    if (this.current === 'Here') {
      return sessions.filter(session => (session.effectiveCwd || '').replace(/\/+$/, '') === cwd.replace(/\/+$/, ''));
    }
    return sessions;
  }
}

module.exports = { CONVERSATIONS_TAB, CONVERSATION_VIEWS, ConversationViews };
