# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Background task sync without retention, with unchanged-data probes and bounded retry backoff.
- Bounded SSH conversation references, origin/stale indicators, manual continuation, and `/desk sync` status.
- Associate a conversation with a task: press `t` in Conversations or details, filter, and apply. The `No task` row clears the link. Links store task IDs, so renames and list moves keep them valid.
- Start a conversation from a task with `c` in the Tasks tab. `/desk` creates a new session in the current working directory, links it to the task, and names the session after the task.
- Show task-linked conversations in task details and the task title on the conversation row, search, and details, resolved from the loaded task by stable ID.

### Fixed
- Report a failed task-link save as `task link not saved: <cause>` instead of showing success.
- Lock and atomically replace the task-link file so concurrent pi-desk processes never lose a link. A lock held by a paused or crashed process is never stolen; the write fails with the lock path so a person can remove it.
- Block writes to an unreadable or damaged task-link file instead of erasing the links it holds.
- Create the task-link storage directory before locking, so the first write works when the agent directory does not exist yet.

## [0.3.0] - 2026-08-22

### Changed
- Make `/sesh` return the selected session to its extension and switch through pi's official `ctx.switchSession()` API instead of launching a nested pi process. Standalone `pisesh` still launches pi.
- Preserve `Enter` current-default and `o` session-recorded model and thinking behavior across native session switches.

### Fixed
- Forward custom cwd overrides when supported by pi, warn when pi ignores them, and skip switching when the selected session is already active.
- Keep interrupted-tool-call repair after confirming pi does not synthesize missing results during session loading.

## [0.2.0] - 2026-08-01

### Added
- Add background LLM title generation: `g` queues a session using the saved model and effort, while `G` opens generation settings. Up to three titles generate concurrently. Based on #2 by @ahoereth.

### Fixed
- Keep extension-backed model providers available while disabling context files, skills, prompt templates, and tools for title generation.
- Preserve manual titles during queued generation, reject malformed or control-sequence output, and report generation failures visibly.
- Forward custom agent directories to spawned pi processes and terminate cancelled generation processes safely.

## [0.1.13] - 2026-08-01

### Added
- Press `o` to resume with the model and thinking recorded in the session while `Enter` uses current defaults.
- Show the current-default and original-session resume modes in the session details view.
- Support `PI_AGENT_DIR` and `PI_SESSION_DIR`, including flat custom session directories.
- Add `pisesh --version` and `pisesh --clean-favorites`; press `x` in the TUI to remove stale favorites.
- Report successful orphan-call repairs and stop with a visible error when a session cannot be repaired safely.

### Fixed
- Resume favorite sessions with the current default provider, model, and thinking level instead of restoring stale values recorded in the session.
- Fall back to pi's native session restore when the settings file is unavailable or invalid.

## [0.1.12] - 2026-07-20

### Fixed
- Skip interrupted tool calls from assistant turns that ended with `error` or `aborted`, preventing OpenAI Responses from receiving an unmatched `function_call_output` after resume or fork.
- Remove incompatible synthetic results previously written by pisesh and repair their child links when affected sessions are resumed.

## [0.1.11] - 2026-07-14

### Fixed
- `/sesh` now launches the CLI bundled with the pi package instead of requiring `pisesh` on the user's `PATH`.
- Clarified that the standalone `pisesh` shell command requires `npm install -g pisesh`.

## [0.1.10] - 2026-06-09

### Fixed
- **Resume no longer crashes on sessions interrupted mid-tool-call.** If a session ended while a tool call was still in flight (e.g. an image generation cut off by a usage limit or a closed window), its transcript held a tool call with no recorded result. On resume, pi would re-fire that dead tool and the spawned process could exit non-zero, surfacing as `pisesh exited with code 1`, repeatedly. `resumeSession` now heals the target session first: every orphaned tool call gets a synthetic `[interrupted]` result injected before pi is spawned, so the resumed history is always well-formed and no dead tool is re-run. Idempotent, never throws, and writes a one-time `.bak-orphanheal` backup of the session before modifying it.

## [0.1.9] - 2026-06-03

### Fixed
- Name / cwd editor (`e`) now has a real caret. Arrow keys (and `Home` / `End`) move inside the text you already typed, so you can insert or delete in the middle instead of only at the end. Backspace, forward `Delete`, and inserts all act at the caret. Cursor moves by whole code points, so CJK and emoji never get split.

## [0.1.4] - 2026-06-03

### Added
- **`Here` tab** filters the list to sessions whose effective cwd matches the directory pisesh was launched from. Tab order is now **★ Favorites → Today → Here → All**.
- **Inline rename (`e`)** sets a custom display title that overrides the first-prompt label; renamed sessions are marked with a cyan `✎` in the list.
- **Edit cwd (`p`)** provides an arrow-key directory browser to re-point the working directory pi resumes into (also drives the `Here` filter).
- Per-session overrides (custom title / cwd) persist to `~/.pi/agent/pisesh-meta.json`, keyed by session id. Session jsonl files remain read-only.
- README terminal screenshots for the list view, rename panel, and cwd browser.

## [0.1.0] - 2026-05-31

Initial release.

### Added
- `pisesh` CLI binary with a keyboard-driven TUI that lists every pi session under `~/.pi/agent/sessions/`
- Tabs: **★ Favorites**, **Today**, **All**
- Star / unstar with `f` or Space; favorites persist to `~/.pi/agent/favorites.json`
- Search across id / project / first user prompt with `/`
- Session details view (`d`): full prompt, file path, byte size, timestamps
- `Enter` resumes the selected session via `pi --session <id> --session-dir <dir>` in the original cwd
- `[NOW]` badge marks the session belonging to the pi instance that spawned pisesh (set via `PISESH_CURRENT_SESSION` env var)
- Alternate screen buffer (`\x1b[?1049h`) so exit restores terminal byte-for-byte; no scrollback pollution
- CJK-aware truncation and padding (Hangul / CJK ideographs / emoji counted as 2 cells)
- Signal handlers (`SIGINT`, `SIGTERM`, `exit`) restore cursor + main buffer on unexpected exit
- Non-TUI CLI: `--list`, `--json`, `--star <id>`, `--unstar <id>`, `--help`
- Pi extension at `extensions/sesh.ts` registers `/sesh` slash command which spawns pisesh inside pi via `ui.custom` + `tui.stop()`
