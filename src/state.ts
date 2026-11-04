// The review as events in the session, the state they build, and which phase is open.
import type { Diagram } from "./diagram/index.ts";
import { parseDiff, type Hunk } from "./diff.ts";

export const ENTRY_TYPE = "pr-review";

export const PHASES = ["triage", "why", "ac", "interfaces", "walkthrough", "submit"] as const;
export type Phase = (typeof PHASES)[number];

export const PHASE_LABEL: Record<Phase, string> = {
	triage: "Triage",
	why: "Why",
	ac: "AC matrix",
	interfaces: "Interfaces",
	walkthrough: "Walkthrough",
	submit: "Submit",
};

export const PHASE_TOOL: Record<Phase, string> = {
	triage: "pr_triage",
	why: "pr_why",
	ac: "pr_ac_matrix",
	interfaces: "pr_interfaces",
	walkthrough: "pr_walkthrough",
	submit: "pr_submit",
};

export interface Pr {
	owner: string;
	repo: string;
	number: number;
	title: string;
	url: string;
	author: string;
	/** The head commit, for the review's `commit_id`. */
	head: string;
	additions: number;
	deletions: number;
}

export interface DraftComment {
	id: number;
	/** No file: the comment goes into the review body. */
	file?: string | undefined;
	line?: number | undefined;
	body: string;
	blocking: boolean;
	/** The acceptance criterion this comment is about, 1-based. */
	ac?: number | undefined;
}

export interface AcTest {
	name: string;
	file?: string | undefined;
	why: string;
}

export interface AcRow {
	ac: number;
	tests: AcTest[];
	/** What is missing, when no test covers the criterion. */
	gap?: string | undefined;
}

export type Verdict = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export type ReviewEvent =
	| { type: "start"; pr: Pr; diff: string }
	| { type: "triaged"; behaviour: number[] }
	| { type: "why"; acs: string[] }
	| { type: "matrix"; rows: AcRow[] }
	| { type: "interfaces" }
	| { type: "diagram"; diagram: Diagram }
	| { type: "visited"; hunks: number[] }
	| { type: "comment"; comment: Omit<DraftComment, "id"> }
	| { type: "comments"; comments: DraftComment[] }
	| { type: "submitted"; url: string; verdict: Verdict };

export interface ReviewState {
	pr?: Pr;
	hunks: Hunk[];
	/** Hunk indexes that change behaviour. Set once triage is acknowledged. */
	behaviour?: number[];
	/** Confirmed acceptance criteria. */
	acs?: string[];
	matrix?: AcRow[];
	interfaces: boolean;
	/** The last diagram of the changed parts, the walkthrough's map. */
	diagram?: Diagram;
	/** Hunk indexes the walkthrough showed the reviewer. */
	visited?: number[];
	comments: DraftComment[];
	/** The posted review's URL. */
	submitted?: string;
}

export const INITIAL_STATE: ReviewState = { hunks: [], interfaces: false, comments: [] };

export function reduce(state: ReviewState, e: ReviewEvent): ReviewState {
	switch (e.type) {
		case "start":
			return { ...INITIAL_STATE, pr: e.pr, hunks: parseDiff(e.diff) };
		case "triaged":
			return { ...state, behaviour: e.behaviour };
		case "why":
			return { ...state, acs: e.acs };
		case "matrix":
			return { ...state, matrix: e.rows };
		case "interfaces":
			return { ...state, interfaces: true };
		case "diagram":
			return { ...state, diagram: e.diagram };
		case "visited":
			return { ...state, visited: [...new Set([...(state.visited ?? []), ...e.hunks])] };
		case "comment": {
			const id = Math.max(0, ...state.comments.map((c) => c.id)) + 1;
			return { ...state, comments: [...state.comments, { ...e.comment, id }] };
		}
		case "comments":
			return { ...state, comments: e.comments };
		case "submitted":
			return { ...state, submitted: e.url };
	}
}

interface EntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

/** The state on a branch, rebuilt from its entries. */
export function rebuild(entries: readonly EntryLike[]): ReviewState {
	return entries
		.filter((e) => e.type === "custom" && e.customType === ENTRY_TYPE && typeof e.data === "object" && e.data)
		.map((e) => e.data as ReviewEvent)
		.reduce(reduce, INITIAL_STATE);
}

export interface AcCheck {
	/** Rows for criteria that do not exist. */
	unknown: number[];
	/** Criteria without a row. */
	missing: number[];
	/** Criteria no test covers. */
	gaps: number[];
	/** Gaps without a draft comment. */
	open: number[];
}

export function checkAcs(acs: readonly string[], rows: readonly AcRow[], comments: readonly DraftComment[]): AcCheck {
	const numbers = acs.map((_, i) => i + 1);
	const gaps = rows.filter((r) => r.tests.length === 0).map((r) => r.ac);
	return {
		unknown: rows.map((r) => r.ac).filter((n) => !numbers.includes(n)),
		missing: numbers.filter((n) => !rows.some((r) => r.ac === n)),
		gaps,
		open: gaps.filter((n) => !comments.some((c) => c.ac === n)),
	};
}

export function isComplete(state: ReviewState, phase: Phase): boolean {
	switch (phase) {
		case "triage":
			return state.behaviour !== undefined;
		case "why":
			return state.acs !== undefined;
		case "ac": {
			if (!state.acs || !state.matrix) return false;
			const c = checkAcs(state.acs, state.matrix, state.comments);
			return c.unknown.length + c.missing.length + c.open.length === 0;
		}
		case "interfaces":
			return state.interfaces;
		case "walkthrough":
			return state.visited !== undefined && (state.behaviour ?? []).every((i) => state.visited!.includes(i));
		case "submit":
			return state.submitted !== undefined;
	}
}

/** The first phase that is not complete, or undefined when the review is posted. */
export function currentPhase(state: ReviewState): Phase | undefined {
	return PHASES.find((p) => !isComplete(state, p));
}

/**
 * Why a phase's tool cannot run now, or undefined when it can. Going back to a phase is fine. Without a phase,
 * only whether a review is open.
 */
export function gate(state: ReviewState, phase?: Phase): string | undefined {
	if (!state.pr) return "No review in progress. Ask the user to run /pr-review.";
	if (state.submitted) return "This review is posted. Run /pr-review to start another.";
	const current = currentPhase(state)!;
	if (phase && PHASES.indexOf(phase) > PHASES.indexOf(current))
		return `Not yet: finish ${PHASE_LABEL[current]} first with ${PHASE_TOOL[current]}.`;
	return undefined;
}
