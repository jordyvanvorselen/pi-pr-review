// Phase 0: how big the PR is, which hunks tidy and which change behaviour, and where the risk is.
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { churn, findHunks, hunkLabel, refLabel } from "../diff.ts";
import type { ReviewSession } from "../session.ts";
import { badge, bar, more, outcomeLine, plural, wrap } from "../ui/draw.ts";
import { runPages } from "../ui/pages.ts";
import { cap, refFields, registerPhaseTool, stringEnum, unknownRefs } from "./common.ts";

/** Changed lines above which a PR is hard to review well. */
export const SIZE_LIMIT = 400;

const KINDS = ["tidying", "behaviour"] as const;
const RISKS = ["high", "medium", "low"] as const;
type Risk = (typeof RISKS)[number];

const Params = Type.Object({
	items: Type.Array(
		Type.Object({
			...refFields,
			kind: stringEnum(KINDS, "tidying: renames, moves, formatting, no behaviour change. behaviour: anything else."),
			note: Type.String({ description: "A few plain words on what changed." }),
		}),
		{ description: "Cover every hunk of the diff. A whole file is fine when all of it is one kind." },
	),
	hotspots: Type.Array(
		Type.Object({
			file: Type.String(),
			line: Type.Optional(Type.Integer()),
			risk: stringEnum(RISKS, "How much could go wrong here."),
			why: Type.String({ description: "One short sentence." }),
		}),
	),
});

export interface TriageDetails {
	number: number;
	size: number;
	behaviourLines: number;
	tidyingLines: number;
	items: { label: string; kind: (typeof KINDS)[number]; note: string; lines: number }[];
	hotspots: { label: string; risk: Risk; why: string }[];
	outcome: "acknowledged" | "changes" | "closed";
	note?: string;
}

const RISK_COLOR = { high: "error", medium: "warning", low: "muted" } as const;

function triageLines(d: TriageDetails, theme: Theme, width: number, expanded = true, hint = ""): string[] {
	const cells = Math.max(10, Math.min(30, width - 40));
	const over = d.size > SIZE_LIMIT;
	const size = `${theme.bold("Size ")} ${bar(theme, [[Math.min(d.size, SIZE_LIMIT), over ? "error" : "success"]], cells, SIZE_LIMIT)}  ${d.size} / ${SIZE_LIMIT} lines`;
	const split =
		`${theme.bold("Split")} ${bar(
			theme,
			[
				[d.behaviourLines, "accent"],
				[d.tidyingLines, "muted"],
			],
			cells,
		)}  ` +
		`${theme.fg("accent", `● behaviour ${d.behaviourLines}`)}  ${theme.fg("muted", `✎ tidying ${d.tidyingLines}`)}`;
	const out = [
		size,
		...(over ? [theme.fg("error", `  ⚠ over ${SIZE_LIMIT} changed lines: hard to review well, ask for a split`)] : []),
		split,
	];
	const sorted = [...d.items].sort((a, b) => (a.kind === b.kind ? b.lines - a.lines : a.kind === "behaviour" ? -1 : 1));
	const items = cap(sorted, expanded);
	const labelWidth = Math.min(36, Math.max(...items.shown.map((i) => i.label.length), 4));
	for (const i of items.shown) {
		const mark = i.kind === "behaviour" ? theme.fg("accent", "●") : theme.fg("muted", "✎");
		out.push(
			`  ${mark} ${i.label.padEnd(labelWidth)} ${theme.fg("dim", String(i.lines).padStart(4))}  ${theme.fg("muted", i.note)}`,
		);
	}
	out.push(...more(theme, items.hidden, hint));
	if (d.hotspots.length) out.push("", theme.bold("Risk hotspots"));
	for (const h of d.hotspots)
		out.push(
			...wrap(
				`  ${badge(theme, RISK_COLOR[h.risk], h.risk.toUpperCase())} ${h.label}  ${theme.fg("muted", h.why)}`,
				width,
				4,
			),
		);
	return out;
}

export function registerTriageTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool(pi, session, {
		name: "pr_triage",
		label: "pr triage",
		phase: "triage",
		description:
			"Phase 0. Show the reviewer the PR's size, every hunk split into tidying and behaviour, and the risk hotspots. The reviewer acknowledges or corrects it.",
		parameters: Params,
		async run(params, state, ctx, signal) {
			const unknown = unknownRefs(state, params.items);
			if (unknown.length) throw new Error(`Not in the diff: ${unknown.join(", ")}.`);
			const behaviour = new Set<number>();
			const tidying = new Set<number>();
			for (const item of params.items)
				for (const i of findHunks(state.hunks, item)) (item.kind === "behaviour" ? behaviour : tidying).add(i);
			const missing = state.hunks
				.map((h, i) => (behaviour.has(i) || tidying.has(i) ? "" : hunkLabel(h)))
				.filter(Boolean);
			if (missing.length)
				throw new Error(
					`Classify every hunk. Missing ${missing.length}: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", …" : ""}`,
				);
			const lines = (hunks: Iterable<number>) => [...hunks].reduce((n, i) => n + churn(state.hunks[i]!), 0);
			const details: TriageDetails = {
				number: state.pr.number,
				size: state.pr.additions + state.pr.deletions,
				behaviourLines: lines(behaviour),
				tidyingLines: lines([...tidying].filter((i) => !behaviour.has(i))),
				items: params.items.map((item) => ({
					label: refLabel(item),
					kind: item.kind,
					note: item.note,
					lines: lines(findHunks(state.hunks, item)),
				})),
				hotspots: params.hotspots.map((h) => ({
					label: refLabel({ file: h.file, start: h.line }),
					risk: h.risk,
					why: h.why,
				})),
				outcome: "closed",
			};
			const answers = await runPages(
				ctx,
				"Triage",
				(theme) => [
					{
						title: `PR #${details.number} ${state.pr.title}`,
						body: (w) => triageLines(details, theme, w),
						question: "Does this split look right?",
						choices: [{ label: "Looks right, continue" }, { label: "Something is off", note: true }],
					},
				],
				signal,
			);
			const answer = answers?.[0];
			if (!answer) return { text: "The reviewer closed triage without acknowledging it. Ask what to change.", details };
			if (answer.choice === 1) {
				details.outcome = "changes";
				details.note = answer.note!;
				return { text: `The reviewer says: ${answer.note}\nFix the triage and call pr_triage again.`, details };
			}
			details.outcome = "acknowledged";
			session.append({ type: "triaged", behaviour: [...behaviour] });
			return {
				text: `Triage acknowledged: ${plural(behaviour.size, "behaviour hunk")}. Next: ask the user for the ticket or acceptance criteria, then call pr_why.`,
				details,
			};
		},
		call: (a) =>
			Array.isArray(a.items) ? `${plural(a.items.length, "item")} · ${plural(a.hotspots?.length ?? 0, "hotspot")}` : "",
		result(d, theme, width, { expanded, hint }) {
			return [...triageLines(d, theme, width, expanded, hint), outcomeLine(theme, d.outcome, d.note)];
		},
	});
}
