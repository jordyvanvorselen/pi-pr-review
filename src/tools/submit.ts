// Wrap-up: the reviewer edits or drops each draft, picks a verdict and confirms. Then one GitHub review is posted.
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findHunks, type Hunk } from "../diff.ts";
import { buildReview, postReview } from "../github.ts";
import type { ReviewSession } from "../session.ts";
import type { DraftComment, Verdict } from "../state.ts";
import { badge, hunkLines, plural, wrap } from "../ui/draw.ts";
import { runPages, type Page } from "../ui/pages.ts";
import { commentLine } from "./comment.ts";
import { registerPhaseTool } from "./common.ts";

const Params = Type.Object({
	summary: Type.String({
		description: "The review's opening text: what the PR does well and what must change, plain and short.",
	}),
});

const VERDICT_LABEL: Record<Verdict, string> = {
	APPROVE: "Approve",
	REQUEST_CHANGES: "Request changes",
	COMMENT: "Comment",
};
const VERDICT_COLOR = { APPROVE: "success", REQUEST_CHANGES: "error", COMMENT: "accent" } as const;

export interface SubmitDetails {
	outcome: "posted" | "cancelled" | "no-ui";
	verdict?: Verdict;
	inline: number;
	general: number;
	url?: string;
}

/** The verdict the drafts suggest, first, then the others. */
export function verdictOrder(comments: readonly DraftComment[]): Verdict[] {
	const first: Verdict = comments.some((c) => c.blocking) ? "REQUEST_CHANGES" : comments.length ? "COMMENT" : "APPROVE";
	return [first, ...(["REQUEST_CHANGES", "COMMENT", "APPROVE"] as const).filter((v) => v !== first)];
}

/** The review as GitHub will show it: the body with the general comments, then the inline comments. */
function previewLines(theme: Theme, body: string, comments: DraftComment[], width: number): string[] {
	const inline = comments.filter((c) => c.file && c.line);
	return [
		...wrap(body, width),
		"",
		theme.bold(plural(inline.length, "inline comment")),
		...inline.flatMap((c) => commentLine(theme, c, width)),
	];
}

/** One draft with the hunk it is on: keep, edit, flip blocking or drop. */
function draftPage(theme: Theme, hunks: readonly Hunk[], c: DraftComment, title: string): Page {
	const at = c.file && c.line ? findHunks(hunks, { file: c.file, start: c.line }) : [];
	return {
		title,
		body: (w) => [
			...commentLine(theme, c, w),
			...(at.length ? [""] : []),
			...at.flatMap((h) => hunkLines(theme, hunks[h]!)),
		],
		question: "Keep this comment?",
		choices: [
			{ label: "Keep" },
			{ label: "Edit", note: c.body },
			{ label: c.blocking ? "Keep, not blocking" : "Keep, make it blocking" },
			{ label: "Drop" },
		],
	};
}

export function registerSubmitTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool<typeof Params, SubmitDetails>(pi, session, {
		name: "pr_submit",
		label: "pr submit",
		phase: "submit",
		description:
			"Wrap-up. The reviewer edits or drops each draft comment, picks a verdict and confirms. Then one GitHub review with inline comments is posted. Nothing is posted without that confirmation.",
		parameters: Params,
		async run(params, state, ctx, signal) {
			const counts = { inline: 0, general: 0 };
			if (!ctx.hasUI)
				return {
					text: "Not posted: no UI to confirm the review. Nothing was sent to GitHub.",
					details: { outcome: "no-ui", ...counts },
				};
			const cancelled = {
				text: "The reviewer cancelled. Nothing was posted.",
				details: { outcome: "cancelled" as const, ...counts },
			};

			const drafts = state.comments;
			const answers = !drafts.length
				? []
				: await runPages(
						ctx,
						"Submit",
						(theme) => drafts.map((c, i) => draftPage(theme, state.hunks, c, `Comment ${i + 1}/${drafts.length}`)),
						signal,
					);
			if (!answers) return cancelled;
			const kept = drafts.flatMap((c, i): DraftComment[] => {
				const a = answers[i]!;
				if (a.choice === 3) return [];
				if (a.choice === 2) return [{ ...c, blocking: !c.blocking }];
				return [a.note ? { ...c, body: a.note } : c];
			});
			if (JSON.stringify(kept) !== JSON.stringify(drafts)) session.append({ type: "comments", comments: kept });

			const verdicts = verdictOrder(kept);
			let summary = params.summary;
			for (;;) {
				const { body } = buildReview(state.pr, kept, "COMMENT", summary);
				const confirm = await runPages(
					ctx,
					"Submit",
					(theme) => [
						{
							title: `Post one review to ${state.pr.owner}/${state.pr.repo}#${state.pr.number}`,
							body: (w) => previewLines(theme, body, kept, w),
							question: "Post this review?",
							choices: [
								...verdicts.map((v, i) => ({ label: `Post: ${VERDICT_LABEL[v]}${i ? "" : " (suggested)"}` })),
								{ label: "Edit the summary", note: summary },
								{ label: "Cancel" },
							],
						},
					],
					signal,
				);
				const a = confirm?.[0];
				if (!a || a.choice === verdicts.length + 1) return cancelled;
				if (a.choice === verdicts.length) {
					summary = a.note!;
					continue;
				}
				const verdict = verdicts[a.choice]!;
				const payload = buildReview(state.pr, kept, verdict, summary);
				const details: SubmitDetails = {
					outcome: "posted",
					verdict,
					inline: payload.comments.length,
					general: kept.length - payload.comments.length,
				};
				let url: string;
				try {
					url = await postReview(pi.exec.bind(pi), state.pr, payload, ctx.cwd);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					throw new Error(`GitHub did not take the review: ${message}\nNothing was posted. The drafts are kept.`, {
						cause: error,
					});
				}
				session.append({ type: "submitted", url, verdict });
				return {
					text: `Posted: ${VERDICT_LABEL[verdict]} with ${plural(details.inline, "inline comment")}. ${url}`,
					details: { ...details, url },
				};
			}
		},
		call: () => "",
		result(d, theme) {
			if (d.outcome === "no-ui") return [theme.fg("warning", "■ not posted: no UI to confirm it")];
			if (d.outcome === "cancelled") return [theme.fg("dim", "■ cancelled, nothing posted")];
			return [
				`${theme.fg("success", "✓ posted")} ${badge(theme, VERDICT_COLOR[d.verdict!], VERDICT_LABEL[d.verdict!].toUpperCase())} ${theme.fg("muted", `${plural(d.inline, "inline comment")} · ${d.general} general`)}`,
				theme.fg("dim", `  ${d.url}`),
			];
		},
	});
}
