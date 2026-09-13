/**
 * pi-desk slash command
 *
 * `/desk` temporarily hands the terminal to the bundled picker. The picker
 * returns one selection on a private fd: a session path to resume, or a task to
 * start a new conversation for. Standalone `pi-desk` still launches pi itself.
 */

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runPicker } from "../bin/picker-run.js";
import { syncStatus } from "../bin/remote-conversations.js";
import {
	applyPendingSwitch,
	SessionSwitchGuard,
} from "../bin/session-switch.js";
import {
	recordPendingTaskLink,
	startTaskConversation,
} from "../bin/task-conversation.js";

type ThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

type TaskLink = { id: string; title: string; list: string };

type ResumeSelection = {
	version: 1;
	sessionPath: string;
	resumeMode: "defaults" | "session";
	cwdOverride?: string;
	model?: string;
	thinking?: ThinkingLevel;
	repaired?: number;
};

type NewConversationSelection = {
	version: 1;
	newConversation: { task: TaskLink };
};

type RemoteConversationSelection = { version: 1; remoteConversation: { notice: string; command: string } };
type PiseshSelection = ResumeSelection | NewConversationSelection | RemoteConversationSelection;

type PickerResult = {
	code: number | null;
	selection?: PiseshSelection;
	error?: string;
};

type PendingSwitch = Pick<
	ResumeSelection,
	"sessionPath" | "cwdOverride" | "model" | "thinking" | "repaired"
>;

const processState = globalThis as typeof globalThis & {
	__piseshPendingSwitch?: PendingSwitch;
};

function sameSession(left: string | undefined, right: string): boolean {
	return left ? path.resolve(left) === path.resolve(right) : false;
}

// Start a fresh conversation for one task. The link travels through the
// environment, so the replacement session's own extension instance records it
// after session_start, when that session id exists (see bin/task-conversation.js).
export default function (pi: ExtensionAPI) {
	const switchGuard = new SessionSwitchGuard(pi);

	// A conversation started for a task arrives with its link in the environment
	// (see startTaskConversation). Record it for this session and name the
	// session after the task.
	pi.on("session_start", async (_event, ctx) => {
		recordPendingTaskLink(ctx, {
			setName: (name: string) => pi.setSessionName(name),
			notify: (message: string, level: "info" | "error") =>
				ctx.ui.notify(message, level),
		});
	});

	// A successful switch loads a fresh extension instance before the old command
	// returns. Plain pending data on globalThis lets that new instance apply the
	// selected model and thinking without touching stale pre-switch pi/ctx objects.
	pi.on("session_start", async (event, ctx) => {
		const pending = processState.__piseshPendingSwitch;
		if (
			event.reason !== "resume" ||
			!pending ||
			!sameSession(ctx.sessionManager.getSessionFile(), pending.sessionPath)
		) {
			return;
		}
		processState.__piseshPendingSwitch = undefined;
		await applyPendingSwitch(pending, ctx, pi);
	});

	pi.registerCommand("desk", {
		description: "Browse conversations and manage tasks in pi-desk",
		handler: async (_args, ctx) => {
			if (_args.trim() === "sync") {
				ctx.ui.notify(syncStatus(), "info");
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/desk requires pi's interactive TUI", "warning");
				return;
			}

			const currentId = ctx.sessionManager.getSessionId();
			const result = await ctx.ui.custom<PickerResult>(
				(tui, _theme, _keybindings, done) => {
					tui.stop();
					process.stdout.write("\x1b[2J\x1b[H");
					void runPicker(currentId).then((pickerResult) => {
						tui.start();
						tui.requestRender(true);
						done(pickerResult as PickerResult);
					});
					return { render: () => [], invalidate: () => {} };
				},
			);

			if (!result) return;
			if (result.error) {
				ctx.ui.notify(`pi-desk: ${result.error}`, "error");
				return;
			}
			if (result.code !== 0 && result.code !== null) {
				ctx.ui.notify(`pi-desk exited with code ${result.code}`, "warning");
				return;
			}
			const selection = result.selection;
			if (!selection) return;

			if ("remoteConversation" in selection) {
				// Guidance only: never start a second writer for an origin session.
				await ctx.ui.editor(selection.remoteConversation.notice, selection.remoteConversation.command);
				return;
			}

			if ("newConversation" in selection) {
				await startTaskConversation(selection.newConversation.task, ctx, switchGuard);
				return;
			}

			const currentFile = ctx.sessionManager.getSessionFile();
			if (sameSession(currentFile, selection.sessionPath)) {
				ctx.ui.notify("That session is already active", "info");
				return;
			}

			if (!(await switchGuard.wait(ctx))) return;

			const pending: PendingSwitch = {
				sessionPath: selection.sessionPath,
				cwdOverride: selection.cwdOverride,
				model: selection.model,
				thinking: selection.thinking,
				repaired: selection.repaired,
			};
			processState.__piseshPendingSwitch = pending;

			try {
				const switchSession = ctx.switchSession as (
					sessionPath: string,
					options?: { cwdOverride?: string },
				) => Promise<{ cancelled: boolean }>;
				const switched = await switchSession(
					selection.sessionPath,
					selection.cwdOverride
						? { cwdOverride: selection.cwdOverride }
						: undefined,
				);
				if (switched.cancelled) {
					processState.__piseshPendingSwitch = undefined;
					ctx.ui.notify("Resume cancelled", "info");
				}
			} finally {
				switchGuard.finish();
				if (processState.__piseshPendingSwitch === pending) {
					processState.__piseshPendingSwitch = undefined;
				}
			}
		},
	});
}
