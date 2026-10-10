/**
 * Automatic Desk titles, the way Zed titles agent threads: when a turn ends
 * and the conversation has no Desk title yet, generate a short title in the
 * background and save it in pisesh-meta.json. The session file is not changed.
 * A failed attempt leaves the session untitled, so the next turn retries.
 */

import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readMeta, sessionsRoot } from "../bin/session-meta.js";
import {
	TITLE_CHILD_ENV,
	generateTitle,
	hasTitle,
	saveFirstTitle,
	titleSettings,
} from "../bin/session-titles.js";

function isDeskSession(file: string): boolean {
	const relative = path.relative(sessionsRoot(), path.resolve(file));
	return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export default function (pi: ExtensionAPI) {
	// Title calls in flight in this process, by session id.
	const running = new Set<string>();
	let warned = false;

	pi.on("agent_end", async (_event, ctx) => {
		// Print runs are scripted (ticks, title calls); subagents are not Desk rows.
		if (ctx.mode === "print" || process.env[TITLE_CHILD_ENV] || process.env.PI_SUBAGENT_CHILD === "1") return;
		const id = ctx.sessionManager.getSessionId();
		const file = ctx.sessionManager.getSessionFile();
		if (!id || !file || running.has(id) || !isDeskSession(file) || hasTitle(id)) return;

		const settings = titleSettings(readMeta().settings);
		running.add(id);
		// Do not hold the turn open: the title arrives in the background.
		void generateTitle(file, settings)
			.then((title: string) => { saveFirstTitle(id, title, settings); })
			.catch((error: Error) => {
				if (warned) return;
				warned = true;
				try {
					ctx.ui.notify(`pi-desk: could not title this conversation: ${error.message.replace(/[.\s]+$/, "")}. It retries after the next turn; press G in /desk to pick another model.`, "warning");
				} catch { /* the session was replaced meanwhile */ }
			})
			.finally(() => running.delete(id));
	});
}
