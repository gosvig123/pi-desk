/**
 * Automatic Desk titles, the way Zed titles agent threads: when a turn ends
 * and the conversation has no Desk title yet, generate a short title in the
 * background and save it in pisesh-meta.json. The title also becomes the Pi
 * session name (/resume, footer, cmux tab) while the session has no name.
 * A failed attempt leaves the session untitled, so the next turn retries.
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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

// Name the session only when it is still the current one and has no name, so
// a /name or a launch name (--name) is kept.
function nameSession(pi: ExtensionAPI, sessionManager: ExtensionContext["sessionManager"], id: string, title: string | undefined): void {
	if (!title || sessionManager.getSessionId() !== id || sessionManager.getSessionName()) return;
	pi.setSessionName(title);
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
		if (!id || !file || running.has(id) || !isDeskSession(file)) return;
		// Sessions titled before titles became Pi names get the name now.
		if (hasTitle(id)) { nameSession(pi, ctx.sessionManager, id, readMeta().overrides[id]?.title); return; }

		const settings = titleSettings(readMeta().settings);
		running.add(id);
		// Do not hold the turn open: the title arrives in the background.
		void generateTitle(file, settings)
			.then((title: string) => {
				saveFirstTitle(id, title, settings);
				try { nameSession(pi, ctx.sessionManager, id, readMeta().overrides[id]?.title); } catch { /* the session was replaced meanwhile */ }
			})
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
