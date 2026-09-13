# Cross-machine sync

Desk uses **tasks-go** as the task source of truth. Its existing configured GitHub Gist merges task files. Conversation **references** contain only origin, session ID/path, working directory, name, modification time, and task link. They travel over your existing trusted SSH connection. Transcripts, prompts, tool output, credentials, and settings are not copied.

## Installed services

`bin/desk-sync.py` runs independently of Pi and the Desk UI. Python 3, Git, SSH, and a tasks-go binary with `sync --no-prune` are required. Private configuration lives in `~/.pi/agent/desk-sync/config.json`:

```json
{
  "origin": "mac",
  "peerOrigin": "devbox",
  "tasks": "/absolute/path/to/tasks",
  "sshHost": "devbox",
  "remotePython": "/usr/bin/python3",
  "remoteScript": "/home/dev/.pi/agent/git/github.com/gosvig123/pi-desk/bin/desk-sync.py"
}
```

The passive peer uses only `origin`, `peerOrigin`, and `tasks`. One SSH connection exchanges both origin-owned snapshots; no reverse SSH access or public server is needed. Do not copy configuration or credentials between machines. Keep the directory mode 0700 and configuration mode 0600.

On this installation, macOS LaunchAgent `com.pi-desk.sync` has `StartInterval=30` and `RunAtLoad=true`. Linux user timer `pi-desk-sync.timer` runs `pi-desk-sync.service` 30 seconds after the previous run completes. It has a 15-second initial delay and 1-second timer accuracy. These are user services: the Mac must be awake and logged in; Linux needs an active user manager (linger is enabled on this devbox). Existing daily tasks-go retention schedules remain unchanged.

Each pass scans references, exchanges them (on the Mac), then invokes `tasks sync --no-prune`. This path uses the existing task storage lock and merge/conflict rules, skips pruning, and compares task content plus remote Git HEAD before cloning. A failed probe does not mark the sync successful. Unchanged task passes perform only `git ls-remote`; changed tasks use the existing merge engine. Equal managed snapshots do not create timestamp-only commits, so idle peers do not keep changing Git HEAD for each other. Network Git transfers fail on 20 seconds of zero throughput. The runner does not kill a task write transaction on a wall-clock timeout. Runs cannot overlap on one machine.

Failures back off from 60 seconds to at most five minutes while task files stay unchanged; a local edit retries on the next pass. `TaskSyncConflict` in `/desk sync` means run `tasks sync --no-prune` to inspect and resolve the source-list conflict, not force/adopt either side.

Typical visibility is 30–60 seconds plus network time. The picker refreshes every 30 seconds and does not replace open edit forms. `/desk sync` shows last results and their age. Raw service status is in `desk-sync/status.json`; only error classes are recorded, never task data or tokens.

## Continue a conversation

In `/desk`, open Conversations → All (or Today). Remote rows show `[origin]`; a snapshot older than two minutes shows `offline/stale`. Enter opens a **manual continuation** dialog with a shell command. Standalone Desk prints that command. Nothing executes automatically.

Close **that conversation** on its origin first, then run the command in a terminal. From Mac to devbox the command uses the existing SSH alias. On devbox, Mac references give a command to run on the Mac: reverse SSH is not configured. Local `pi` must be on PATH in the origin terminal.

**Limitation:** Pi/Desk has no shared per-session writer lock or reliable ownership record for older live sessions. Desk cannot safely start another Pi process for a reference. It therefore provides explicit manual guidance, not automatic resume/attach, and does not require closing unrelated conversations. The dialog cannot verify that the origin session has stopped. The origin and its workspace must remain available; there is no offline transcript continuation.

## Bounds and failures

At most 500 most recently modified conversations are exported. A scan visits at most 20,000 file entries and reads at most a bounded header plus 64 KiB from the head and tail of each changed session; unchanged sessions use cached metadata. Names deep in an uncached transcript can be absent; unnamed sessions show their ID instead of copying prompt text. Each JSON file/transfer is limited to 1 MiB. Exceeding a limit or receiving malformed data preserves the previous peer snapshot. Paths are data, never automatic shell instructions. Manual commands use shell quoting.

Only the origin replaces its snapshot. Successful snapshots remove deleted references; an unavailable origin leaves cached references visible. No peer rewrites session files, favorites, review data, or task-link sidecars. Task links are read-only reference metadata; edit them on the origin. Task conflicts remain tasks-go conflicts and require normal user resolution; the background runner never forces a push or chooses a losing source-list edit.

The configured Gist is the existing tasks destination, not a new upload destination. Its Git history retains the four completed tasks pruned by the pre-existing CLI startup maintenance encountered during deployment. Nothing was restored or deleted by this change.

## Check and control

```sh
/desk sync
# macOS
launchctl print gui/$(id -u)/com.pi-desk.sync
launchctl bootout gui/$(id -u)/com.pi-desk.sync
# Linux
systemctl --user status pi-desk-sync.timer pi-desk-sync.service
systemctl --user disable --now pi-desk-sync.timer
# source checks
python3 test/desk-sync.test.py
npm test
```

Reload existing Pi sessions with `/reload` for the new `/desk sync` command and manual reference dialog. The background service needs no Pi restart. Reopen an already-open picker to load its new code. Source checkouts can contain unrelated uncommitted work; preserve it before package updates.
