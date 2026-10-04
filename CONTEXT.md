# Pi Desk

A keyboard-driven workspace for Pi conversations, task links, and finished tick results.

## Language

**Favorites view**: The conversation view with three stacked sections: Favorites, Snoozed, and Tick results.

**Favorites section**: Starred conversations that are not currently snoozed.

**Snoozed conversation**: A starred conversation deferred until a chosen duration expires or the user restores it.

**Tick result**: The saved output and outcome of one finished pi-tick run, not the tick job's description or schedule.

**Reviewed result**: A tick result the user has opened or explicitly marked reviewed.

**Task panel**: The floating view of one tasks list or one opened task, shown in pi's right column. It is hidden, unfocused (visible, keys go to the editor), or focused (keys go to the panel).

## Relationships

- Conversations and Tasks are the two main tabs; the **Favorites view** belongs to Conversations.
- A starred conversation appears in either the **Favorites section** or Snoozed, never both at once.
- One tick job can produce many **Tick results**; each run has its own review status.
- The **Task panel** opens on the task linked to the current conversation, else on the tasks CLI's current list. Switching lists in the panel also changes the tasks CLI's current list.
- A **Reviewed result** stays visible in Tick results; conversation favorites do not require review status.
