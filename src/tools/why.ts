// Phase 1: why the PR exists, where that comes from, what the diff misses, and the acceptance criteria.
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ReviewSession } from "../session.ts";
import { badge, outcomeLine, plural, wrap } from "../ui/draw.ts";
import { runPages } from "../ui/pages.ts";
import { registerPhaseTool, stringEnum } from "./common.ts";

const GAPS = ["missing", "extra", "unclear"] as const;

const Params = Type.Object({
	why: Type.String({ description: "Why this PR exists, in one or two plain sentences." }),
	source: Type.String({
		description: 'Where the why comes from, e.g. "PROJ-123: Reset password" or "PR description".',
	}),
	acs: Type.Array(Type.String(), { description: "The acceptance criteria, one short sentence each." }),
	gaps: Type.Array(
		Type.Object({
			kind: stringEnum(
				GAPS,
				"missing: asked for, not in the diff. extra: in the diff, not asked for. unclear: the ticket is vague.",
			),
			text: Type.String(),
		}),
		{ description: "Differences between the ticket and the diff. Empty when they match." },
	),
});

export interface WhyDetails {
	why: string;
	source: string;
	acs: string[];
	gaps: { kind: (typeof GAPS)[number]; text: string }[];
	outcome: "confirmed" | "changes" | "closed";
	note?: string;
}

const GAP_COLOR = { missing: "error", extra: "warning", unclear: "muted" } as const;

function whyLines(d: WhyDetails, theme: Theme, width: number): string[] {
	return [
		...wrap(`${theme.fg("accent", theme.bold("Why"))}  ${d.why}`, width, 5),
		theme.fg("dim", `     from ${d.source}`),
		"",
		theme.bold(`Acceptance criteria (${d.acs.length})`),
		...d.acs.flatMap((ac, i) => wrap(`  ${theme.fg("accent", `AC${i + 1}`.padEnd(5))}${ac}`, width, 7)),
		...(d.gaps.length ? ["", theme.bold("Ticket vs diff")] : []),
		...d.gaps.flatMap((g) => wrap(`  ${badge(theme, GAP_COLOR[g.kind], g.kind.toUpperCase())} ${g.text}`, width, 4)),
	];
}

export function registerWhyTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool(pi, session, {
		name: "pr_why",
		label: "pr why",
		phase: "why",
		description:
			"Phase 1. Show why the PR exists, its source ticket, gaps between ticket and diff, and numbered acceptance criteria. The reviewer confirms or corrects them.",
		parameters: Params,
		async run(params, _state, ctx, signal) {
			const details: WhyDetails = { ...params, outcome: "closed" };
			const answers = await runPages(
				ctx,
				"Why",
				(theme) => [
					{
						title: "Intent and acceptance criteria",
						body: (w) => whyLines(details, theme, w),
						question: "Is this the why, and are these the acceptance criteria?",
						choices: [{ label: "Yes, confirm" }, { label: "Correct it", note: true }],
					},
				],
				signal,
			);
			const answer = answers?.[0];
			if (!answer) return { text: "The reviewer closed this without confirming. Ask what to change.", details };
			if (answer.choice === 1) {
				details.outcome = "changes";
				details.note = answer.note!;
				return { text: `The reviewer says: ${answer.note}\nFix it and call pr_why again.`, details };
			}
			details.outcome = "confirmed";
			session.append({ type: "why", acs: params.acs });
			return { text: `Confirmed ${params.acs.length} acceptance criteria. Next: pr_ac_matrix.`, details };
		},
		call: (a) => (Array.isArray(a.acs) ? `${plural(a.acs.length, "AC")} · ${plural(a.gaps?.length ?? 0, "gap")}` : ""),
		result(d, theme, width) {
			return [...whyLines(d, theme, width), outcomeLine(theme, d.outcome, d.note)];
		},
	});
}
