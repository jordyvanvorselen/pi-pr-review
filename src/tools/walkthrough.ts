// Phase 4: a stepper over the changed code in reading order. Each stop shows its diff hunk, the agent's summary
// and one question.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderDiagram } from "../diagram/index.ts";
import { commentableLine, findHunks, hunkLabel, normalize, refLabel } from "../diff.ts";
import type { ReviewSession } from "../session.ts";
import { badge, hunkLines, plural, wrap } from "../ui/draw.ts";
import { runPages, type Answer, type Page } from "../ui/pages.ts";
import { registerPhaseTool, stringEnum, unknownRefs } from "./common.ts";

const PARTS = ["entry", "core", "edge"] as const;
type Part = (typeof PARTS)[number];

const Params = Type.Object({
	stops: Type.Array(
		Type.Object({
			file: Type.String({ description: "Path as in the diff." }),
			start: Type.Integer({ description: "First line in the new file." }),
			end: Type.Integer({ description: "Last line in the new file." }),
			part: stringEnum(PARTS, "entry: where a call comes in. core: the main logic. edge: errors, limits, cleanup."),
			summary: Type.String({ description: "What this code does now, one or two plain sentences." }),
			question: Type.String({ description: "One focused question for the reviewer about this stop." }),
		}),
		{ description: "In reading order. Together they must cover every behaviour hunk." },
	),
});

const CHOICES = ["Looks good", "Answer the question", "Leave a comment", "Blocking comment"] as const;
const PART_COLOR = { entry: "accent", core: "warning", edge: "muted" } as const;

export interface WalkthroughDetails {
	stops: { label: string; part: Part; summary: string; answer?: { choice: number; note?: string } }[];
	completed: boolean;
}

/** The hunks of the stops the reviewer answered. `answers` may stop short when the reviewer left early. */
export function visitedHunks(hunksOf: number[][], answers: readonly (Answer | undefined)[]): number[] {
	return [...new Set(hunksOf.filter((_, i) => answers[i]).flat())];
}

export function registerWalkthroughTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool(pi, session, {
		name: "pr_walkthrough",
		label: "pr walkthrough",
		phase: "walkthrough",
		description:
			"Phase 4. Walk the reviewer through the changed code in reading order: entry, core, edges. Each stop shows its diff hunk, your summary and one focused question. The stops must cover every behaviour hunk.",
		parameters: Params,
		async run(params, state, ctx, signal) {
			const unknown = unknownRefs(state, params.stops);
			if (unknown.length) throw new Error(`Not in the diff: ${unknown.join(", ")}.`);
			const stops = [...params.stops].sort((a, b) => PARTS.indexOf(a.part) - PARTS.indexOf(b.part));
			const hunksOf = stops.map((s) => findHunks(state.hunks, s));
			const seen = new Set(hunksOf.flat());
			const missing = (state.behaviour ?? []).filter((i) => !seen.has(i)).map((i) => hunkLabel(state.hunks[i]!));
			if (missing.length) throw new Error(`Add stops for these behaviour hunks: ${missing.join(", ")}.`);

			const details: WalkthroughDetails = {
				stops: stops.map((s) => ({ label: refLabel(s), part: s.part, summary: s.summary })),
				completed: false,
			};
			const diagram = state.diagram;
			const answers = await runPages(
				ctx,
				"Walkthrough",
				(theme) => [
					...(diagram
						? [
								{
									title: "Map",
									body: (w: number) => renderDiagram(diagram, w, theme),
									choices: [{ label: "Start the walkthrough" }],
								},
							]
						: []),
					...stops.map((s, i): Page => ({
						title: `Stop ${i + 1}/${stops.length} ${refLabel(s)}`,
						body: (w) => [
							...wrap(`${badge(theme, PART_COLOR[s.part], s.part.toUpperCase())} ${s.summary}`, w),
							"",
							...hunksOf[i]!.flatMap((h) => hunkLines(theme, state.hunks[h]!)),
						],
						question: s.question,
						choices: CHOICES.map((label, c) => (c ? { label, note: true } : { label })),
					})),
				],
				signal,
				true,
			);
			if (!answers)
				return { text: "The reviewer left the walkthrough before the last stop. Ask where to pick up.", details };
			const stopAnswers = answers.slice(diagram ? 1 : 0);
			details.completed = stops.every((_, i) => stopAnswers[i]);
			const report = stops.flatMap((s, i) => {
				const a = stopAnswers[i];
				if (!a) return [];
				details.stops[i]!.answer = a;
				if (a.choice >= 2) {
					const line = commentableLine(state.hunks, s);
					const where = line ? { file: normalize(s.file), line } : {};
					const body = line ? a.note! : `${refLabel(s)}: ${a.note}`;
					session.append({ type: "comment", comment: { ...where, body, blocking: a.choice === 3 } });
				}
				return `- Stop ${i + 1} ${refLabel(s)}: ${CHOICES[a.choice]}${a.note ? `: ${a.note}` : ""}`;
			});
			const visited = visitedHunks(hunksOf, stopAnswers);
			if (visited.length) session.append({ type: "visited", hunks: visited });
			const comments = stopAnswers.filter((a) => a.choice >= 2).length;
			const unvisited = (state.behaviour ?? []).filter((i) => !visited.includes(i));
			return {
				text: [
					`${details.completed ? "Walkthrough done." : `The reviewer left the walkthrough after ${plural(report.length, "stop")}.`} ${plural(comments, "comment")} drafted.`,
					...report,
					...(unvisited.length
						? [`Not visited yet: ${unvisited.map((i) => hunkLabel(state.hunks[i]!)).join(", ")}.`]
						: []),
					details.completed
						? "Reply briefly to the reviewer's answers. Next: pr_submit."
						: "Reply briefly to the reviewer's answers, then ask where to pick up.",
				].join("\n"),
				details,
			};
		},
		call: (a) => (Array.isArray(a.stops) ? plural(a.stops.length, "stop") : ""),
		result(d, theme, width) {
			const marks = [
				theme.fg("success", "✓"),
				theme.fg("accent", "↩"),
				theme.fg("warning", "✎"),
				theme.fg("error", "✗"),
			];
			const out = d.stops.flatMap((s, i) => {
				const mark = s.answer ? marks[s.answer.choice]! : theme.fg("dim", "○");
				const head = `${mark} ${String(i + 1).padStart(2)} ${badge(theme, PART_COLOR[s.part], s.part.toUpperCase().padEnd(5))} ${s.label}  ${theme.fg("muted", s.summary)}`;
				const note = s.answer?.note
					? wrap(`        ${theme.fg("dim", `${CHOICES[s.answer.choice]}:`)} ${s.answer.note}`, width, 8)
					: [];
				return [head, ...note];
			});
			if (!d.completed) out.push(theme.fg("dim", "■ left before the last stop"));
			return out;
		},
	});
}
