// Phase 2: one row per acceptance criterion, with the tests that cover it or the gap.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ReviewSession } from "../session.ts";
import { checkAcs, isComplete, type AcRow } from "../state.ts";
import { badge, bar, wrap } from "../ui/draw.ts";
import { registerPhaseTool } from "./common.ts";

const Params = Type.Object({
	rows: Type.Array(
		Type.Object({
			ac: Type.Integer({ description: "The criterion's number from pr_why, 1-based." }),
			tests: Type.Array(
				Type.Object({
					name: Type.String({ description: "The test's name." }),
					file: Type.Optional(Type.String()),
					why: Type.String({ description: "Why it covers the criterion, a few words." }),
				}),
				{ description: "Empty when no test covers it." },
			),
			gap: Type.Optional(Type.String({ description: "What is not tested, when tests is empty or partial." })),
		}),
		{ description: "Exactly one row per acceptance criterion. No rows for other tests." },
	),
});

export interface MatrixDetails {
	acs: string[];
	rows: AcRow[];
	/** Gaps with a draft comment when the matrix was saved. */
	commented: number[];
}

export function registerAcMatrixTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool(pi, session, {
		name: "pr_ac_matrix",
		label: "pr ac matrix",
		phase: "ac",
		description:
			"Phase 2. Show which tests cover each acceptance criterion, and the gaps. One row per criterion, no rows for other tests.",
		parameters: Params,
		async run(params, state) {
			const acs = state.acs!;
			const check = checkAcs(acs, params.rows, state.comments);
			if (check.unknown.length)
				throw new Error(`There is no AC ${check.unknown.join(", ")}. ACs are 1 to ${acs.length}.`);
			if (check.missing.length) throw new Error(`Add a row for AC ${check.missing.join(", ")}.`);
			session.append({ type: "matrix", rows: params.rows });
			const details: MatrixDetails = {
				acs,
				rows: [...params.rows].sort((a, b) => a.ac - b.ac),
				commented: check.gaps.filter((n) => !check.open.includes(n)),
			};
			const covered = `${acs.length - check.gaps.length}/${acs.length} covered.`;
			if (isComplete(session.state, "ac")) return { text: `${covered} Next: pr_interfaces.`, details };
			return {
				text: `${covered} Gaps without a comment: AC ${check.open.join(", ")}. Ask the reviewer about each gap and record it with pr_comment (set ac). The phase completes when every gap has a comment.`,
				details,
			};
		},
		call: (a) => (Array.isArray(a.rows) ? `${a.rows.length} rows` : ""),
		result(d, theme, width) {
			const gaps = d.rows.filter((r) => r.tests.length === 0).length;
			const out = [
				`${theme.bold("Coverage")} ${bar(
					theme,
					[
						[d.acs.length - gaps, "success"],
						[gaps, "error"],
					],
					Math.min(20, width - 30),
				)}  ${d.acs.length - gaps}/${d.acs.length} ACs`,
			];
			for (const row of d.rows) {
				const gap = row.tests.length === 0;
				const mark = gap ? theme.fg("error", "✗") : theme.fg("success", "✓");
				out.push(
					...wrap(
						`${mark} ${theme.fg("accent", `AC${row.ac}`.padEnd(5))}${theme.bold(d.acs[row.ac - 1] ?? "")}`,
						width,
						7,
					),
				);
				for (const t of row.tests)
					out.push(
						...wrap(
							`       ${theme.fg("success", "↳")} ${t.name}${t.file ? theme.fg("dim", ` ${t.file}`) : ""} ${theme.fg("muted", `· ${t.why}`)}`,
							width,
							9,
						),
					);
				if (row.gap || gap) {
					const state = !gap
						? ""
						: d.commented.includes(row.ac)
							? theme.fg("success", " ✎ commented")
							: theme.fg("warning", " ○ needs a comment");
					out.push(
						...wrap(
							`       ${badge(theme, gap ? "error" : "warning", "GAP")} ${row.gap ?? "no test covers this"}${state}`,
							width,
							9,
						),
					);
				}
			}
			return out;
		},
	});
}
