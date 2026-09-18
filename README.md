# pi-desk

Conversations and tasks in one keyboard-driven workspace for [Pi](https://github.com/earendil-works/pi).

Forked from [Blue-B/pisesh](https://github.com/Blue-B/pisesh). The original history,
author credit, and [MIT license](LICENSE) are preserved.

## Install

```bash
pi install git:github.com/gosvig123/pi-desk
```

Restart Pi or run `/reload`, then open `/desk`.
Remove the original package from Pi settings if it is still installed.

On another machine, install Pi and run the same install command.
This installs the extension, not your conversations, favorites, or task data.

To get updates:

```bash
pi update git:github.com/gosvig123/pi-desk
```

The Tasks tab requires the `tasks` CLI from tasks-go on PATH. It uses schema
version 1 through `tasks api lists`, `snapshot`, and `exec`. Missing task support
does not prevent use of Conversations. Node.js 18 or newer is required.

## Navigation

One row holds every destination, numbered so the jump keys are visible:

```
[ 1 Conversations ]   │   2 Tasks
```

- `Tab` switches tabs; `1` and `2` jump to Conversations and Tasks. Letter keys do not change tabs.
- `?` opens the full key map; any key closes it.
- The footer shows only the keys that work in the current tab, so it stays readable and never fills with stale hints.

## Conversations

- `Tab` switches between Conversations and Tasks.
- `[` / `]` selects Favorites, Today, Here, or All.
- `↑` / `↓` selects a conversation. `/` searches.
- `f` / `Space` stars or unstars a conversation. Unstarring also cancels its snooze.
- `s` snoozes a conversation, or restores one selected in Snoozed.
- `Enter` resumes with current default model and thinking settings.
- `o` resumes with the model and thinking saved in that session.
- `e` sets a display title. `g` queues model-generated titles; `G` opens settings.
- `p` changes the working directory used on resume. `d` opens details.
- `t` associates the conversation with a task. Type to filter, `Enter` applies, `Esc` cancels, and the `No task` row clears the link.
- `r` reloads conversations and tick results. `Esc` / `q` clears search or closes the picker.

Conversation rows put the title first, then the project and time when there is
space. Full paths, title origin, model settings, and task links stay in details.
Favorites has three stacked sections: **Favorites**, **Snoozed**, and **Tick results**.
Arrow keys move through them in order, skipping empty sections. Search applies
to all three sections. Today, Here, and All remain conversation-only views.

`/desk` switches the current Pi session; it does not launch a second agent.
If the agent is working, the switch waits until it finishes. Starting a conversation
from a task replaces the current session with a new, task-linked session. Closing
the picker leaves the current session running. Reload or session replacement
cancels a queued switch. Custom working directory overrides require a compatible
Pi version.

Title generation sends up to 16 KB of session text to the selected model provider
and may incur charges. It excludes tool results and disables tools, context files,
skills, and prompt templates for the generation call.

## Tasks

Wide terminals show a task board: Overdue, Today, Upcoming, No date, and Completed.
Small terminals show a list.

- `↑` / `↓` selects a task; `←` / `→` moves between board columns.
- `l` selects a task list; `[` / `]` cycles lists.
- `Space` completes or reopens a task.
- `n` adds a task. `e` edits its title, due date, and description.
- `c` starts a new conversation for the selected task. The conversation is linked to that task and named after it.
- In the form, `Tab` changes field and `Ctrl-S` saves. `Esc` cancels.
- `s` cycles All, Pending, and Completed. `/` searches.
- `Enter` / `d` opens details. `r` reloads tasks.

Saves use stable task IDs and revision checks. A conflict does not overwrite newer
data: cancel the form, reload with `r`, and edit again. pi-desk does not run task
migration or sync commands.

## Snoozed conversations

Press `s` on a local conversation. Leave the duration blank for no timer, or use
`30m`, `2h`, `1d`, or `1w` (up to 365 days). `Enter` confirms; `Esc` cancels.
Snoozing stars the conversation and moves it out of active Favorites. Press `s`
on a snoozed conversation to restore it immediately.

Timed snoozes return to Favorites at the next list refresh (within 30 seconds
while the list is open), or when the picker is reopened. No background job is
created. Snoozes are stored alongside title overrides in `pisesh-meta.json` and
do not change session history. They do not hide conversations from Today, Here,
or All. Remote conversations must be snoozed on their origin machine.

## Tick results

The bottom section of Favorites reads finished runs from
`~/.pi/agent/tick/runs.jsonl` (or `PI_TICK_DATA_DIR`). It shows up to 100 recent
runs, one row per run, newest first. Rows show result previews, not job prompts
or schedules. Each result is marked **new** or **reviewed**. Existing review
marks are reused; unmarked results start as new, including on first use.

- `Enter` / `d` opens the output and marks that run reviewed.
- `a` marks the selected run reviewed without opening it.
- `↑` / `↓` scrolls output; `Esc` returns to the list.
- Reviewed results stay visible. Conversation favorites do not have review badges.

Output uses the last assistant reply found in the final 256 KB of the run
transcript, up to 32,000 characters. If unavailable, it shows the saved preview.
The details include the transcript path. The list refreshes every 30 seconds or
with `r`. Job enable/disable/run controls remain in pi-tick, not pi-desk.

Review marks live in `~/.pi/agent/pisesh-review.json`; the newest 2000 keys are
kept for 90 days. Reviewing never changes transcripts or tick jobs.

## Cross-machine sync

The separately configured background service checks tasks and conversation
references every 30 seconds. It uses the existing task Gist and trusted SSH,
without copying transcripts or pruning tasks. Run `/desk sync` for status.
Remote conversations provide manual continuation guidance, not automatic resume.
See [Cross-machine sync](docs/sync.md) for setup, limits, and service controls.

## Conversation and task links

One conversation can be associated with one task. The link stores the task ID,
so task renames and list moves never break it. Task titles come from the tasks CLI
when it answers, and from the stored fallback when it does not.

- Tasks tab `c`: start a new conversation for a task. `/desk` creates the session
  in the current working directory, links it to the task, and names it after the
  task. The session appears in Conversations after its first assistant response.
- Conversations tab `t` or details `t`: link or unlink an existing conversation.
- Task details list the linked conversations. Open them from the Conversations tab.

pi-desk never mutates a task for a link. The association lives in
`~/.pi/agent/pisesh-task-links.json`. Each update takes a bounded lock and
replaces the file atomically, so two pi-desk processes cannot lose a link. A
lock held by a paused or crashed process is never stolen: the update fails with
`task links are locked by another process` and names the lock file to delete
when no pi-desk is running. A failed save is reported as
`task link not saved: <cause>` and the previous link stays in place.

## Standalone command

```bash
npm install -g git+https://github.com/gosvig123/pi-desk.git
pi-desk
pi-desk --help
```

The standalone command launches Pi when resuming a conversation and when starting
a task conversation. Pi's extension installation uses the bundled script and does
not need this global installation. Task links from the standalone command need the
same package installed as a Pi extension, because that extension records the new
session ID. The old `pisesh` shell command remains an alias. The Pi command is now
`/desk`.

## Data compatibility

Existing favorites and overrides are reused without migration:

- `~/.pi/agent/favorites.json`
- `~/.pi/agent/pisesh-meta.json`
- `~/.pi/agent/pisesh-task-links.json` (conversation → task links)
- `~/.pi/agent/sessions/`

Existing `PISESH_*` environment variables and internal script paths remain
compatible. Session history is unchanged except for the existing orphaned-tool-call
repair, which writes a backup before repair. Task data stays owned by tasks-go.

## Development

Use a separate checkout, not Pi's managed package cache:

```bash
git clone https://github.com/gosvig123/pi-desk.git
cd pi-desk
npm test
pi install .
```

Commit and push changes normally. Then update the Git package on other machines.
Do not leave uncommitted work in Pi's managed checkout: package updates can reset
and clean it. Distribution uses Git; no npm release is required.

The [pisesh reference](docs/pisesh-reference.md) preserves the prior documentation,
including legacy names and install commands. [Upstream release history](CHANGELOG.md)
and the original preview images remain available for reference.
