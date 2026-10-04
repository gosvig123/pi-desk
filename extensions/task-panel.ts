/**
 * Floating task panel in the shared right column (next to Git changes).
 *
 * Hidden by default. ctrl+alt+t shows and focuses it; Esc at list level gives
 * keys back to the editor and keeps the panel open; q or /desk-panel hides it.
 * Space toggles completion; ←→ switch lists and save the tasks CLI current list.
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, wrapTextWithAnsi, type TUI } from "@earendil-works/pi-tui";
import { TaskPanelModel, MIN_PANEL_HEIGHT, UNFOCUS, HIDE, TOGGLE, SET_LIST } from "../bin/task-panel.js";
import { loadTasks } from "../bin/tasks-data.js";
import { mutateTask, executeTaskRequest } from "../bin/tasks-mutations.js";
import { readTaskLinks } from "../bin/task-links.js";

const STACK_ID = "desk-tasks";
const STACK_ORDER = 20;
const SHORTCUT = "ctrl+alt+t";
const KEYS = ["up", "down", "left", "right", "enter", "escape", "space", "q"] as const;
const SET_LIST_DELAY_MS = 400;
const STACK_KEY = Symbol.for("pi.right-overlay-stack.v2");

type Stack = {
	register(ctx: ExtensionContext, id: string, order: number, factory: (tui: TUI, theme: Theme) => unknown): void;
	remove(id: string): void;
	setVisible(id: string, visible: boolean): void;
	focus(id: string): void;
	unfocus(id: string): void;
	isFocused(id: string): boolean;
	requestRender(): void;
};

let model = new TaskPanelModel();
let visible = false;
let registered = false;
let loading = false;
let lastCtx: ExtensionContext | undefined;
let listTimer: NodeJS.Timeout | undefined;

function stack() {
	const shared = (globalThis as Record<symbol, unknown>)[STACK_KEY] as Stack | undefined;
	if (!shared) throw new Error("shared right column is not loaded; enable the git-status-widget extension");
	return shared;
}

class TaskPanelItem {
	readonly minHeight = MIN_PANEL_HEIGHT;
	private focused = false;
	private ui;

	constructor(private tui: TUI, theme: Theme) {
		this.ui = {
			paint: (color: string, text: string) => theme.fg(color as Parameters<Theme["fg"]>[0], text),
			fit: (text: string, width: number) => truncateToWidth(text, width, "…", true),
			wrap: (text: string, width: number) => wrapTextWithAnsi(text, Math.max(1, width)),
		};
	}

	preferredHeight(width: number) { return model.preferredHeight(width, this.ui); }
	render(width: number, maxHeight: number) { return model.render(width, maxHeight, this.ui, this.focused); }
	setFocused(focused: boolean) { this.focused = focused; }
	invalidate() {}

	handleInput(data: string) {
		if (matchesKey(data, SHORTCUT)) return stack().unfocus(STACK_ID);
		const key = KEYS.find(name => matchesKey(data, name));
		if (!key) return;
		const action = model.handle(key);
		if (action === UNFOCUS) stack().unfocus(STACK_ID);
		if (action === HIDE) hide();
		// Check the object first: a stale CJS require cache after /reload can leave
		// TOGGLE/SET_LIST undefined, and `null?.type === undefined` would match.
		if (action && typeof action === "object") {
			if (action.type === TOGGLE) void save(`Toggle "${action.task.title}"`, () =>
				mutateTask("task.setCompleted", action.task, { completed: !action.task.completed }));
			if (action.type === SET_LIST) scheduleSetList(action.list);
		}
		this.tui.requestRender();
	}
}

// One write at a time; reload afterwards so the panel shows the saved state.
async function save(label: string, write: () => Promise<unknown>) {
	model.saving = true;
	stack().requestRender();
	let failure = "";
	try { await write(); }
	catch (error) { failure = `${label} failed: ${(error as Error).message}`; }
	model.saving = false;
	if (lastCtx) await refresh(lastCtx, true);
	if (failure) model.setError(failure);
	stack().requestRender();
}

// Arrow presses browse at once; only the list the user stops on is saved.
function scheduleSetList(list: string) {
	clearTimeout(listTimer);
	listTimer = setTimeout(() => {
		const revision = model.data.revisions?.[list];
		if (!revision) return model.setError(`Set current list "${list}" failed: list not loaded; press ←→ after refresh`);
		void save(`Set current list "${list}"`, async () => {
			const response = await executeTaskRequest({ schemaVersion: 1, operation: "list.setCurrent", list, expectedRevision: revision });
			if (response?.success !== true) throw new Error(`${response?.error?.message ?? "tasks api exec failed"}; reload before retrying`);
		});
	}, SET_LIST_DELAY_MS);
}

async function refresh(ctx: ExtensionContext, force = false) {
	lastCtx = ctx;
	if (!visible || (loading && !force)) return;
	loading = true;
	try {
		const linked = readTaskLinks()[ctx.sessionManager.getSessionId()]?.id ?? null;
		const data = await loadTasks();
		if (!model.saving) model.setData(data, linked);
	} catch (error) {
		model.setError(`Task panel refresh failed: ${(error as Error).message}`);
	} finally {
		loading = false;
		if (registered) stack().requestRender();
	}
}

function show(ctx: ExtensionContext) {
	const shared = stack();
	visible = true;
	if (!registered) shared.register(ctx, STACK_ID, STACK_ORDER, (tui, theme) => new TaskPanelItem(tui, theme));
	registered = true;
	shared.setVisible(STACK_ID, true);
	shared.focus(STACK_ID);
	// The column mounts asynchronously on first use; retry focus once it has a handle.
	if (!shared.isFocused(STACK_ID)) setTimeout(() => visible && shared.focus(STACK_ID), 0);
	void refresh(ctx);
}

function hide() {
	visible = false;
	if (registered) stack().setVisible(STACK_ID, false);
}

function guard(ctx: ExtensionContext, action: () => void) {
	if (ctx.mode !== "tui") return ctx.ui.notify("Task panel requires pi's interactive TUI", "warning");
	try { action(); }
	catch (error) { ctx.ui.notify(`Task panel: ${(error as Error).message}`, "error"); }
}

export default function (pi: ExtensionAPI) {
	pi.registerShortcut(SHORTCUT, {
		description: "Show or focus the Desk task panel",
		handler: ctx => guard(ctx, () => {
			if (visible && stack().isFocused(STACK_ID)) stack().unfocus(STACK_ID);
			else show(ctx);
		}),
	});
	pi.registerCommand("desk-panel", {
		description: "Toggle the Desk task panel",
		handler: async (_args, ctx) => guard(ctx, () => (visible ? hide() : show(ctx))),
	});
	pi.on("input", async (_event, ctx) => {
		void refresh(ctx);
		return { action: "continue" };
	});
	pi.on("tool_execution_end", async (_event, ctx) => { void refresh(ctx); });
	pi.on("session_start", async (_event, ctx) => {
		model = new TaskPanelModel();
		if (visible) void refresh(ctx);
	});
	pi.on("session_shutdown", async () => {
		clearTimeout(listTimer);
		if (registered) stack().remove(STACK_ID);
		registered = false;
		visible = false;
	});
}
