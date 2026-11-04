// Small drawing helpers shared by the tool rows, the widget and the screens.
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { Hunk } from "../diff.ts";

/** A component that draws its lines for the width it gets, each cut to fit. */
export class Lines implements Component {
	private readonly draw: (width: number) => string[];

	constructor(draw: (width: number) => string[]) {
		this.draw = draw;
	}

	render(width: number): string[] {
		const w = Math.max(1, width);
		return this.draw(w).map((line) => fit(line, w));
	}

	invalidate(): void {}
}

export const fit = (line: string, width: number) =>
	visibleWidth(line) <= width ? line : truncateToWidth(line, width, "…");

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Word-wrapped, every line after the first indented by `indent` spaces. */
export function wrap(text: string, width: number, indent = 0): string[] {
	const pad = " ".repeat(indent);
	return wrapTextWithAnsi(text, Math.max(10, width - indent)).map((l, i) => (i ? pad + l : l));
}

/** `◆ pr triage  extra`, the head of every tool row. */
export function title(theme: Theme, name: string, extra = ""): string {
	return `${theme.fg("accent", "◆")} ${theme.fg("toolTitle", theme.bold(name))}${extra ? `  ${theme.fg("muted", extra)}` : ""}`;
}

/** ` TEXT ` on a coloured background. */
export function badge(theme: Theme, color: ThemeColor, text: string): string {
	return theme.fg(color, theme.inverse(theme.bold(` ${text} `)));
}

/** A bar of `width` cells split in proportion to the parts. */
export function bar(theme: Theme, parts: readonly [number, ThemeColor][], width: number, total?: number): string {
	const sum = total ?? parts.reduce((s, [n]) => s + n, 0);
	let used = 0;
	let out = "";
	for (const [n, color] of parts) {
		const cells = sum ? Math.min(width - used, Math.round((n / sum) * width)) : 0;
		out += theme.fg(color, "█".repeat(cells));
		used += cells;
	}
	return out + theme.fg("dim", "░".repeat(Math.max(0, width - used)));
}

/** A hunk with new-file line numbers, additions and removals coloured. */
export function hunkLines(theme: Theme, h: Hunk): string[] {
	let n = h.newStart;
	const out = [theme.fg("dim", h.header)];
	for (const line of h.lines) {
		const mark = line[0];
		const gutter = theme.fg("dim", `${mark === "-" || mark === "\\" ? "" : n}`.padStart(5) + " │");
		const color = mark === "+" ? "toolDiffAdded" : mark === "-" ? "toolDiffRemoved" : "toolDiffContext";
		out.push(`${gutter}${theme.fg(color, line.replace(/\t/g, "  "))}`);
		if (mark !== "-" && mark !== "\\") n++;
	}
	return out;
}

/** The plain text of a failed call, in red. */
export function errorLines(theme: Theme, result: { content: { type: string; text?: string }[] }): Lines {
	const text = result.content.map((c) => c.text ?? "").join("\n");
	return new Lines((w) => wrap(theme.fg("error", `✗ ${text}`), w, 2));
}

/** `…3 more (ctrl+o to expand)` when a list was cut. */
export function more(theme: Theme, hidden: number, hint: string | undefined): string[] {
	return hidden > 0 ? [theme.fg("dim", `  …${hidden} more (${hint ?? "ctrl+o to expand"})`)] : [];
}

/** How the reviewer answered a confirm screen. */
export function outcomeLine(theme: Theme, outcome: string, note?: string): string {
	if (outcome === "changes") return theme.fg("warning", `↩ reviewer: ${note}`);
	if (outcome === "closed") return theme.fg("dim", "■ closed without an answer");
	return theme.fg("success", `✓ ${outcome}`);
}
