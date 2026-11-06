# Pi Desk

A keyboard-driven workspace for Pi conversations, and task links.

## Language

**Favorites view**: The conversation view with two stacked sections: Favorites and Snoozed.

**Favorites section**: Starred conversations that are not currently snoozed.

**Snoozed conversation**: A starred conversation deferred until a chosen duration expires or the user restores it.




**Display title**: The name Desk shows for a conversation, stored in `pisesh-meta.json` by session id, never in the session file. It is manual (set with `e`) or generated (by the title model). Without one, Desk shows the first prompt.

**Session search index**: One cached summary per top-level session file (Desk title, user messages, last answer, files written, URLs) that `session_lookup` ranks; subagent runs and forks are not separate rows.

**Task panel**: The floating view of one tasks list or one opened task, shown in pi's right column. It is hidden, unfocused (visible, keys go to the editor), or focused (keys go to the panel).

## Relationships

- Conversations and Tasks are the two main tabs; the **Favorites view** belongs to Conversations.
- A starred conversation appears in either the **Favorites section** or Snoozed, never both at once.
- The **Task panel** opens on the task linked to the current conversation, else on the tasks CLI's current list. Switching lists in the panel also changes the tasks CLI's current list.
- A conversation gets a generated **Display title** after its first finished turn, unless it already has one; a manual one is never replaced.
