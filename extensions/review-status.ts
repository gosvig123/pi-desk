/**
 * Footer count of unreviewed Tick results, so finished runs are visible
 * without opening /desk. Uses the same data and review marks as the
 * Favorites view; reviewing there clears the count on the next check.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ReviewStore, agentDir } from "../bin/review-store.js";
import { loadTickResults } from "../bin/tick-results.js";

const STATUS_KEY = "desk-review";
const CHECK_MS = 30_000;

// Changes to any of these files can change the count.
function sources(): string[] {
	const dir = agentDir();
	return [
		path.join(process.env.PI_TICK_DATA_DIR || path.join(dir, "tick"), "runs.jsonl"),
		path.join(dir, "desk-sync", "peer.json"),
		new ReviewStore().file,
	];
}

function signature(): string {
	return sources().map(file => {
		try { return fs.statSync(file).mtimeMs; } catch { return 0; }
	}).join(":");
}

function statusText(ctx: ExtensionContext): string | undefined {
	const pending = loadTickResults(new ReviewStore()).filter((entry: { reviewed: boolean }) => !entry.reviewed);
	if (!pending.length) return undefined;
	const failed = pending.filter((entry: { outcome: string }) => entry.outcome === "failed").length;
	const theme = ctx.ui.theme;
	const label = `${pending.length} tick result${pending.length === 1 ? "" : "s"} to review`;
	return theme.fg("accent", "◆ ") + theme.fg("muted", label)
		+ (failed ? theme.fg("error", ` · ${failed} failed`) : "") + theme.fg("dim", " · /desk");
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let last = "";

	const refresh = (ctx: ExtensionContext, force = false) => {
		const current = signature();
		if (!force && current === last) return;
		last = current;
		try { ctx.ui.setStatus(STATUS_KEY, statusText(ctx)); }
		catch { ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("warning", "tick results unreadable · /desk")); }
	};

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		clearInterval(timer);
		refresh(ctx, true);
		timer = setInterval(() => refresh(ctx), CHECK_MS);
		timer.unref?.();
	});

	pi.on("session_shutdown", async () => {
		clearInterval(timer);
		timer = undefined;
	});
}
