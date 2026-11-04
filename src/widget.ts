// The line above the editor: the PR, the phases with check marks, the open phase and the draft comments.
import type { Theme } from "@earendil-works/pi-coding-agent";
import { currentPhase, isComplete, PHASE_LABEL, PHASES, type ReviewState } from "./state.ts";
import { plural } from "./ui/draw.ts";

export const WIDGET_KEY = "pr-review";

export function widgetLine(state: ReviewState, theme: Theme): string {
	const pr = state.pr;
	if (!pr) return "";
	const head = theme.fg("accent", theme.bold(`PR #${pr.number}`));
	if (state.submitted) return `${head} ${theme.fg("success", "✓ review posted")} ${theme.fg("dim", state.submitted)}`;
	const current = currentPhase(state);
	const phases = PHASES.map((p) => {
		if (p === current) return theme.fg("accent", theme.bold(`◉ ${PHASE_LABEL[p]}`));
		return isComplete(state, p) ? theme.fg("success", `✓ ${PHASE_LABEL[p]}`) : theme.fg("dim", `○ ${PHASE_LABEL[p]}`);
	}).join(theme.fg("dim", " › "));
	const blocking = state.comments.filter((c) => c.blocking).length;
	const drafts = state.comments.length
		? `${theme.fg("warning", `✎ ${plural(state.comments.length, "draft")}`)}${blocking ? theme.fg("error", ` · ${blocking} blocking`) : ""}`
		: theme.fg("dim", "✎ no drafts");
	return `${head}  ${phases}   ${drafts}`;
}
