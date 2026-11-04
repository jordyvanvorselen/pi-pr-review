// `pr_comment`: a draft review comment, at any time. Nothing is posted until pr_submit.
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { lineInDiff, normalize } from "../diff.ts";
import type { ReviewSession } from "../session.ts";
import { isComplete, type DraftComment } from "../state.ts";
import { badge, plural, wrap } from "../ui/draw.ts";
import { registerPhaseTool } from "./common.ts";

const Params = Type.Object({
	file: Type.Optional(Type.String({ description: "Omit file and line for a comment on the whole PR." })),
	line: Type.Optional(Type.Integer({ description: "A line of the new file that is in the diff." })),
	body: Type.String({ description: "The comment, in plain language." }),
	blocking: Type.Optional(Type.Boolean({ description: "True when the PR should not merge without a fix." })),
	ac: Type.Optional(Type.Integer({ description: "The acceptance criterion this is about, e.g. for a test gap." })),
});

/** `BLOCKING src/a.ts:12  body`. */
export function commentLine(theme: Theme, c: Omit<DraftComment, "id">, width: number): string[] {
	const where = c.file ? `${c.file}${c.line ? `:${c.line}` : ""}` : "whole PR";
	const tag = c.blocking ? badge(theme, "error", "BLOCKING") : badge(theme, "muted", "NOTE");
	const ac = c.ac !== undefined ? theme.fg("accent", ` AC${c.ac}`) : "";
	return wrap(`${tag}${ac} ${theme.fg("dim", where)}  ${c.body}`, width, 4);
}

export function registerCommentTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool(pi, session, {
		name: "pr_comment",
		label: "pr comment",
		description:
			"Add a draft review comment at any time: file and line, or neither for the whole PR. Drafts are posted only with pr_submit.",
		parameters: Params,
		async run(params, state) {
			if ((params.file === undefined) !== (params.line === undefined))
				throw new Error("Give both file and line, or neither.");
			if (params.file && !lineInDiff(state.hunks, params.file, params.line!))
				throw new Error(`${params.file}:${params.line} is not in the diff. Use a changed line, or omit file and line.`);
			if (params.ac !== undefined && !(state.acs && params.ac >= 1 && params.ac <= state.acs.length))
				throw new Error(`There is no AC ${params.ac}.`);
			const wasDone = isComplete(state, "ac");
			const comment = {
				...params,
				...(params.file ? { file: normalize(params.file) } : {}),
				blocking: params.blocking ?? false,
			};
			session.append({ type: "comment", comment });
			const n = session.state.comments.length;
			const next =
				!wasDone && isComplete(session.state, "ac") ? " Every AC gap has a comment. Next: pr_interfaces." : "";
			return { text: `Draft saved (${plural(n, "draft")}).${next}`, details: comment };
		},
		call: (a) => (a.file ? `${a.file}${a.line ? `:${a.line}` : ""}` : ""),
		result: (c, theme, width) => commentLine(theme, c, width),
	});
}
