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
[ 1 Conversations ]   │   2 Ticks (3)   │   3 Review (2)   │   4 Tasks
```

- `Tab` / `h` / `l` cycles the row; `1`-`4` jump straight to a tab; `T` and `R` are shortcuts for Ticks and Review.
- `?` opens the full key map; any key closes it.
- The footer shows only the keys that work in the current tab, so it stays readable and never fills with stale hints.

## Conversations

- `Tab` switches between Conversations and Tasks.
- `T` jumps to Ticks and `R` to Review, both now peers of Conversations on the same row.
- `[` / `]` selects Favorites, Today, Here, or All.
- `↑` / `↓` selects a conversation. `/` searches.
- `f` / `Space` stars or unstars a conversation.
- `Enter` resumes with current default model and thinking settings.
- `o` resumes with the model and thinking saved in that session.
- `e` sets a display title. `g` queues model-generated titles; `G` opens settings.
- `p` changes the working directory used on resume. `d` opens details.
- `r` reloads conversations. `Esc` / `q` clears search or closes the picker.

`/desk` switches the current Pi session; it does not launch a second agent.
If the agent is working, the switch waits until it finishes. Closing the picker
leaves the current session running. Reload or session replacement cancels a queued
switch. Custom working directory overrides require a compatible Pi version.

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
- In the form, `Tab` changes field and `Ctrl-S` saves. `Esc` cancels.
- `s` cycles All, Pending, and Completed. `/` searches.
- `Enter` / `d` opens details. `r` reloads tasks.

Saves use stable task IDs and revision checks. A conflict does not overwrite newer
data: cancel the form, reload with `r`, and edit again. pi-desk does not run task
migration or sync commands.

## Ticks

The Ticks view is a tab: press `2` or `T`. Press `t` (lowercase) still links a
conversation to a task, so the two keys do not collide. It lists the jobs of the [pi-tick](https://github.com/earendil-works/pi)
extension from `~/.pi/agent/tick/jobs.json` and marks a job as running when its
`active/` record has a live process. Without tick jobs the view is empty and
nothing else changes.

- `T` switches Sessions and Ticks inside the Conversations tab.
- `↑` / `↓` selects a job; `r` reads the catalog again.
- `Enter` / `d` opens details: schedule, next fire, last run, transcript, prompt.
- `Space` enables or disables the job. `x` pressed twice runs it now.

Enable, disable, and run go through the `pi-tick` command line, the only writer of
the catalog. A manual run detaches, so the picker stays responsive; press `r`
afterwards to see the new state. A disabled job cannot be started from here.

## Review

The Review view is a tab: press `3` or `R`. It holds completed work
that nobody has acknowledged yet, newest first, from two sources:

- **chat** — a conversation whose last message is an assistant reply.
- **tick** — a finished pi-tick run, with the transcript output.

Only the last 14 days appear, at most 200 recent conversations and 100 runs. The
conversation you are in is never listed. The first run starts empty: everything
already on disk is marked reviewed once, so the list shows what happens next.

- `↑` / `↓` selects an entry. `Enter` opens it: a chat resumes, a tick shows its output.
- `d` opens the detail view for either kind and marks that entry reviewed.
- `a` marks the selected entry reviewed. `A` marks everything listed reviewed.
- `r` reads conversations and runs again. `Esc` / `q` quits.

Acknowledgements live in `~/.pi/agent/pisesh-review.json`; the newest 2000 keys
are kept for 90 days. pi-desk only reads sessions and transcripts, so reviewing
never changes a conversation or a tick job.

## Standalone command

```bash
npm install -g git+https://github.com/gosvig123/pi-desk.git
pi-desk
pi-desk --help
```

The standalone command launches Pi when resuming a conversation. Pi's extension
installation uses the bundled script and does not need this global installation.
The old `pisesh` shell command remains an alias. The Pi command is now `/desk`.

## Data compatibility

Existing favorites and overrides are reused without migration:

- `~/.pi/agent/favorites.json`
- `~/.pi/agent/pisesh-meta.json`
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
