// One interactive screen for every phase that needs the reviewer: a row of pages, each with a body, a question
// and choices. A choice can ask for a note. A page can hold back the agent's view until the reviewer answered.
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Editor, type EditorTheme, matchesKey, type TUI } from "@earendil-works/pi-tui";
import { fit, wrap } from "./draw.ts";

export interface Choice {
	label: string;
	/** Ask for a note when picked. A string pre-fills it. */
	note?: string | true;
}

export interface Page {
	title: string;
	body(width: number): string[];
	question?: string;
	choices: Choice[];
	/** Shown once the reviewer answered: the agent's view. */
	reveal?(width: number): string[];
}

export interface Answer {
	choice: number;
	note?: string;
}

/**
 * Show the pages one by one. Resolves with an answer per page, or undefined when the reviewer pressed esc or
 * there is no UI. With `partial`, esc resolves with the answers given so far instead. RPC clients get a select
 * dialog per page, without the body.
 */
export async function runPages(
	ctx: ExtensionContext,
	heading: string,
	build: (theme: Theme) => Page[],
	signal?: AbortSignal,
	partial = false,
): Promise<Answer[] | undefined> {
	if (!ctx.hasUI) return undefined;
	if (ctx.mode !== "tui") return dialogs(ctx, heading, build(ctx.ui.theme), partial);
	return ctx.ui.custom<Answer[] | undefined>(
		(tui, theme, _keys, done) => {
			const close = () => done(undefined);
			if (signal?.aborted) queueMicrotask(close);
			signal?.addEventListener("abort", close, { once: true });
			return new Pages(tui, theme, heading, build(theme), partial, (answers) => {
				signal?.removeEventListener("abort", close);
				done(answers);
			});
		},
		{ blocked: { kind: "question", message: heading } },
	);
}

async function dialogs(
	ctx: ExtensionContext,
	heading: string,
	pages: Page[],
	partial: boolean,
): Promise<Answer[] | undefined> {
	const answers: Answer[] = [];
	const cancel = () => (partial ? answers : undefined);
	for (const page of pages) {
		const labels = page.choices.map((c) => c.label);
		const picked = await ctx.ui.select(`${heading} · ${page.title}: ${page.question ?? ""}`, labels);
		const choice = labels.indexOf(picked ?? "");
		if (choice < 0) return cancel();
		const note = page.choices[choice]!.note;
		const text = note === undefined ? "" : await ctx.ui.input(labels[choice]!, typeof note === "string" ? note : "");
		if (note !== undefined && !text?.trim()) return cancel();
		answers.push(text?.trim() ? { choice, note: text.trim() } : { choice });
	}
	return answers;
}

function editorTheme(theme: Theme): EditorTheme {
	return {
		borderColor: (s) => theme.fg("borderAccent", s),
		selectList: {
			selectedPrefix: (s) => theme.fg("accent", s),
			selectedText: (s) => theme.fg("accent", s),
			description: (s) => theme.fg("muted", s),
			scrollInfo: (s) => theme.fg("dim", s),
			noMatch: (s) => theme.fg("warning", s),
		},
	};
}

class Pages implements Component {
	/** pgup/pgdn scroll the page body, not the transcript. */
	readonly capturesViewportInput = true;
	private index = 0;
	private selected = 0;
	private scroll = 0;
	private revealing = false;
	private editor: Editor | undefined;
	private readonly answers: Answer[] = [];

	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly heading: string;
	private readonly pages: Page[];
	private readonly partial: boolean;
	private readonly done: (answers: Answer[] | undefined) => void;

	/** `pages` must not be empty. */
	constructor(
		tui: TUI,
		theme: Theme,
		heading: string,
		pages: Page[],
		partial: boolean,
		done: (answers: Answer[] | undefined) => void,
	) {
		this.tui = tui;
		this.theme = theme;
		this.heading = heading;
		this.pages = pages;
		this.partial = partial;
		this.done = done;
	}

	private get page(): Page {
		return this.pages[this.index]!;
	}

	handleInput(data: string): void {
		if (this.editor) {
			if (matchesKey(data, "escape")) this.editor = undefined;
			else this.editor.handleInput(data);
		} else if (matchesKey(data, "escape")) return this.done(this.partial ? this.answers : undefined);
		else if (matchesKey(data, "pageDown")) this.scroll += 10;
		else if (matchesKey(data, "pageUp")) this.scroll = Math.max(0, this.scroll - 10);
		else if (matchesKey(data, "left")) this.back();
		else if (this.revealing) {
			if (matchesKey(data, "enter") || matchesKey(data, "right") || data === " ") this.next();
		} else if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
		else if (matchesKey(data, "down")) this.selected = Math.min(this.page.choices.length - 1, this.selected + 1);
		else if (matchesKey(data, "enter")) this.pick(this.selected);
		else if (/^[1-9]$/.test(data) && Number(data) <= this.page.choices.length) this.pick(Number(data) - 1);
		this.tui.requestRender();
	}

	private pick(choice: number): void {
		this.selected = choice;
		const { note } = this.page.choices[choice]!;
		if (note === undefined) return this.record({ choice });
		const editor = new Editor(this.tui, editorTheme(this.theme));
		editor.focused = true;
		editor.setText(typeof note === "string" ? note : "");
		editor.onSubmit = (text) => {
			if (!text.trim()) return;
			this.editor = undefined;
			this.record({ choice, note: text.trim() });
			this.tui.requestRender();
		};
		this.editor = editor;
	}

	private record(answer: Answer): void {
		this.answers[this.index] = answer;
		if (this.page.reveal) this.revealing = true;
		else this.next();
	}

	private next(): void {
		if (this.index === this.pages.length - 1) return this.done(this.answers.slice(0, this.pages.length));
		this.index++;
		this.reset();
	}

	private back(): void {
		if (this.revealing) this.revealing = false;
		else if (this.index > 0) {
			this.index--;
			this.reset();
		}
	}

	private reset(): void {
		this.selected = this.answers[this.index]?.choice ?? 0;
		this.scroll = 0;
		this.revealing = false;
	}

	render(width: number): string[] {
		const { theme, page } = this;
		const w = Math.max(20, width);
		const dots = this.pages.map((_, i) =>
			theme.fg(
				i < this.index ? "success" : i === this.index ? "accent" : "dim",
				i < this.index ? "●" : i === this.index ? "◉" : "○",
			),
		);
		const head = `${theme.fg("accent", theme.bold(this.heading))} ${theme.fg("dim", "·")} ${theme.bold(page.title)}`;
		const progress =
			this.pages.length > 1 ? `${dots.join("")} ${theme.fg("dim", `${this.index + 1}/${this.pages.length}`)}` : "";

		const bottom: string[] = [""];
		if (page.question) bottom.push(...wrap(theme.bold(page.question), w));
		if (this.revealing && page.reveal) {
			const answer = this.answers[this.index]!;
			const picked = page.choices[answer.choice]!.label;
			bottom.push(
				`${theme.fg("success", "✓")} ${theme.fg("muted", "you:")} ${picked}${answer.note ? theme.fg("muted", ` · ${answer.note}`) : ""}`,
			);
			bottom.push("", theme.fg("accent", "Agent's view"), ...page.reveal(w).map((l) => `  ${l}`));
		} else
			page.choices.forEach((c, i) => {
				const on = i === this.selected;
				const label = `${i + 1}. ${c.label}${c.note !== undefined ? " …" : ""}`;
				bottom.push(on ? theme.fg("accent", `› ${theme.bold(label)}`) : `  ${label}`);
			});
		if (this.editor) bottom.push(...this.editor.render(w));
		const keys = this.editor
			? "↵ save · shift+↵ new line · esc back"
			: this.revealing
				? "↵ continue · ← answer again · esc cancel"
				: `↑↓ pick · ↵ choose${this.index ? " · ← back" : ""} · esc cancel`;
		bottom.push("", theme.fg("dim", keys));

		const body = page.body(w);
		const room = Math.max(5, this.tui.terminal.rows - bottom.length - 6);
		this.scroll = Math.min(this.scroll, Math.max(0, body.length - room));
		const shown = body.slice(this.scroll, this.scroll + room);
		const hidden = body.length - this.scroll - shown.length;
		const scrollHint =
			this.scroll || hidden > 0
				? [
						theme.fg(
							"dim",
							`${this.scroll ? `↑ ${this.scroll} above · ` : ""}${hidden > 0 ? `↓ ${hidden} more · ` : ""}pgup/pgdn`,
						),
					]
				: [];
		return [
			theme.fg("borderAccent", "─".repeat(w)),
			progress ? `${head}  ${progress}` : head,
			"",
			...shown,
			...scrollHint,
			...bottom,
		].map((l) => fit(l, w));
	}

	invalidate(): void {}
}
