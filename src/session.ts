// The review in this Pi session: its state, what changes it, and what follows it on screen.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ENTRY_TYPE, INITIAL_STATE, rebuild, reduce, type ReviewEvent, type ReviewState } from "./state.ts";
import { WIDGET_KEY, widgetLine } from "./widget.ts";
import { Lines } from "./ui/draw.ts";

export const TOOL_NAMES = [
	"pr_triage",
	"pr_why",
	"pr_ac_matrix",
	"pr_interfaces",
	"pr_diagram",
	"pr_walkthrough",
	"pr_comment",
	"pr_submit",
];

export class ReviewSession {
	state: ReviewState = INITIAL_STATE;
	/** The context of the last event, command or tool call. */
	ctx: ExtensionContext | undefined;

	private readonly pi: ExtensionAPI;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	/** Record an event, apply it and redraw. */
	append(e: ReviewEvent): void {
		this.pi.appendEntry(ENTRY_TYPE, e);
		this.state = reduce(this.state, e);
		this.refresh();
	}

	/** Rebuild the state from the current branch, after a start, a resume or /tree. */
	load(ctx: ExtensionContext): void {
		this.ctx = ctx;
		this.state = rebuild(ctx.sessionManager.getBranch());
		this.refresh();
	}

	/** The review tools are active while a review is open, so other sessions do not pay for them. */
	private syncTools(): void {
		const want = Boolean(this.state.pr && !this.state.submitted);
		const active = this.pi.getActiveTools();
		const others = active.filter((t) => !TOOL_NAMES.includes(t));
		const next = want ? [...others, ...TOOL_NAMES] : others;
		if (next.length !== active.length) this.pi.setActiveTools(next);
	}

	refresh(): void {
		this.syncTools();
		const ctx = this.ctx;
		if (!ctx?.hasUI) return;
		if (!this.state.pr) return ctx.ui.setWidget(WIDGET_KEY, undefined);
		if (ctx.mode !== "tui") return ctx.ui.setWidget(WIDGET_KEY, [widgetLine(this.state, ctx.ui.theme)]);
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new Lines(() => [widgetLine(this.state, theme)]));
	}
}
