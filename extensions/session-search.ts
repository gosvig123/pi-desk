/**
 * session_lookup: find earlier Pi conversations by topic, so "the thread where
 * we…" does not need hand-written greps over session files.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchSessions } from "../bin/session-search.js";

const PARAMETERS = Type.Object({
	query: Type.String({ description: "Topic words: people, products, sites, file names, error text. Every word is matched separately; more matched words rank higher." }),
	cwd: Type.Optional(Type.String({ description: "Keep only conversations whose working directory contains this text, for example a repo name." })),
	since: Type.Optional(Type.String({ description: "Keep only conversations active since a date (YYYY-MM-DD) or a span like 7d or 2w." })),
	limit: Type.Optional(Type.Number({ description: "Results to return, 1-30. Defaults to 8." })),
});

type Result = ReturnType<typeof searchSessions>["results"][number];

function formatResult(result: Result, index: number): string {
	const lines = [
		`${index + 1}. ${result.title}`,
		`   ${result.updated} · ${result.cwd} · matched ${result.matched} words`,
		`   File: ${result.file}`,
		`   Excerpt: ${result.excerpt}`,
	];
	if (result.lastAnswer) lines.push(`   Last answer: ${result.lastAnswer}`);
	if (result.files.length) lines.push(`   Files written: ${result.files.join(", ")}`);
	if (result.urls.length) lines.push(`   URLs: ${result.urls.join(" ")}`);
	return lines.join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "session_lookup",
		label: "Session Lookup",
		description: "Find earlier Pi conversations (threads, sessions) by topic. Returns titles, dates, working directories, session file paths, excerpts, the last answer, and the files and URLs each conversation produced.",
		promptSnippet: "Find earlier Pi conversations by topic, folder, and date.",
		promptGuidelines: [
			"Use session_lookup first when the user refers to an earlier Pi thread, session, or conversation, or to something made in one (a sheet, diagram, file, or decision), before you grep session files yourself.",
			"Results rank by how many query words match. A top result that matches most words is usually the thread; read it instead of grepping session files to confirm one missing word. Grep only when session_lookup finds nothing relevant.",
			"If no relevant session is found, try session_search when available. To inspect a match, use session_read when available; otherwise read only the relevant part of its file; session files can be tens of megabytes.",
		],
		parameters: PARAMETERS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const limit = Math.max(1, Math.min(30, Math.floor(params.limit ?? 8)));
			const found = searchSessions({
				query: params.query,
				cwd: params.cwd,
				since: params.since,
				limit,
				excludeId: ctx.sessionManager.getSessionId() ?? "",
			});
			const header = `${found.total} conversations matched ${found.terms.join(" ")}; showing ${found.results.length}.`;
			const text = found.results.length ? [header, "", found.results.map(formatResult).join("\n\n")].join("\n") : `No conversation matched ${found.terms.join(" ")}. Try fewer or different words, or drop cwd and since.`;
			return { content: [{ type: "text", text }], details: found };
		},
	});
}
