/**
 * pi-desk slash command
 *
 * `/desk` temporarily hands the terminal to the bundled picker. The picker
 * returns a session path on a private fd; this extension then asks pi to switch
 * its current runtime. Standalone `pi-desk` still launches pi itself.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import type { Readable } from "node:stream";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { SessionSwitchGuard } from "../bin/session-switch.js";

// Static package path, no user-controlled segments.
const PISESH_CLI = path.resolve(__dirname, "../bin/pisesh"); // pi-lens-ignore: ts-path-traversal
const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

type PiseshSelection = {
	version: 1;
	sessionPath: string;
	resumeMode: "defaults" | "session";
	cwdOverride?: string;
	model?: string;
	thinking?: ThinkingLevel;
	repaired?: number;
};

type PickerResult = {
	code: number | null;
	selection?: PiseshSelection;
	error?: string;
};

type PendingSwitch = Pick<
	PiseshSelection,
	"sessionPath" | "cwdOverride" | "model" | "thinking" | "repaired"
>;

const processState = globalThis as typeof globalThis & {
	__piseshPendingSwitch?: PendingSwitch;
};

function parseSelection(raw: string): PiseshSelection | undefined {
	if (!raw.trim()) return undefined;

	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw new Error("picker returned invalid JSON");
	}
	if (!value || typeof value !== "object") {
		throw new Error("picker returned a non-object selection");
	}
	const data = value as Record<string, unknown>;
	if (
		data.version !== 1 ||
		typeof data.sessionPath !== "string" ||
		!path.isAbsolute(data.sessionPath) ||
		(data.resumeMode !== "defaults" && data.resumeMode !== "session")
	) {
		throw new Error("picker returned an invalid session selection");
	}
	if (data.cwdOverride !== undefined && typeof data.cwdOverride !== "string") {
		throw new Error("picker returned an invalid cwd override");
	}
	if (data.model !== undefined && typeof data.model !== "string") {
		throw new Error("picker returned an invalid model");
	}
	if (
		data.thinking !== undefined &&
		!THINKING_LEVELS.includes(data.thinking as ThinkingLevel)
	) {
		throw new Error("picker returned an invalid thinking level");
	}
	if (
		data.repaired !== undefined &&
		(!Number.isInteger(data.repaired) || (data.repaired as number) < 0)
	) {
		throw new Error("picker returned an invalid repair count");
	}
	return data as PiseshSelection;
}

function runPisesh(currentSessionId: string | undefined): Promise<PickerResult> {
	return new Promise((resolve) => {
		let output = "";
		let settled = false;
		const finish = (result: PickerResult) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		// fd 3 carries one small JSON result while stdin/stdout/stderr remain the
		// real terminal used by the full-screen picker.
		const child = spawn("node", [PISESH_CLI], {
			stdio: ["inherit", "inherit", "inherit", "pipe"],
			env: {
				...process.env,
				PISESH_SELECT_FD: "3",
				PISESH_CWD: process.cwd(),
				...(currentSessionId
					? { PISESH_CURRENT_SESSION: currentSessionId }
					: {}),
			},
		});
		const resultPipe = child.stdio[3] as Readable | null;
		resultPipe?.setEncoding("utf8");
		resultPipe?.on("data", (chunk: string) => {
			output += chunk;
		});
		child.on("close", (code) => {
			if (code !== 0) return finish({ code });
			try {
				finish({ code, selection: parseSelection(output) });
			} catch (error) {
				finish({
					code,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		});
		child.on("error", (error) => {
			process.stdout.write(
				`\x1b[31mpi-desk failed to launch: ${error.message}\x1b[0m\n`,
			);
			finish({ code: 127, error: error.message });
		});
	});
}

function sameSession(left: string | undefined, right: string): boolean {
	return left ? path.resolve(left) === path.resolve(right) : false;
}

export default function (pi: ExtensionAPI) {
	const switchGuard = new SessionSwitchGuard(pi);
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

		if (pending.model) {
			const separator = pending.model.indexOf("/");
			const model =
				separator > 0
					? ctx.modelRegistry.find(
							pending.model.slice(0, separator),
							pending.model.slice(separator + 1),
						)
					: undefined;
			if (!model || !(await pi.setModel(model))) {
				ctx.ui.notify(
					`Could not apply resume model: ${pending.model}`,
					"warning",
				);
			}
		}
		if (pending.thinking) {
			pi.setThinkingLevel(
				pending.thinking as Parameters<typeof pi.setThinkingLevel>[0],
			);
		}
		if (pending.repaired) {
			ctx.ui.notify(
				`Repaired ${pending.repaired} interrupted tool call${pending.repaired === 1 ? "" : "s"} before resume`,
				"warning",
			);
		}
		if (
			pending.cwdOverride &&
			path.resolve(ctx.cwd) !== path.resolve(pending.cwdOverride)
		) {
			ctx.ui.notify(
				"This pi version did not apply the selected cwd override; update pi to a version that supports it",
				"warning",
			);
		}
	});

	pi.registerCommand("desk", {
		description: "Browse conversations and manage tasks in pi-desk",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/desk requires pi's interactive TUI", "warning");
				return;
			}

			const currentId = ctx.sessionManager.getSessionId();
			const result = await ctx.ui.custom<PickerResult>(
				(tui, _theme, _keybindings, done) => {
					tui.stop();
					process.stdout.write("\x1b[2J\x1b[H");
					void runPisesh(currentId).then((pickerResult) => {
						tui.start();
						tui.requestRender(true);
						done(pickerResult);
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
