// A small unified diff parser: the hunks of `gh pr diff`, and how to find them by file and line range.

export interface Hunk {
	file: string;
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	/** The `@@ … @@` line. */
	header: string;
	/** The body lines, each starting with " ", "+", "-" or "\". */
	lines: string[];
}

/** Where in the diff, as the agent names it. No range means the whole file. */
export interface Ref {
	file: string;
	start?: number | undefined;
	end?: number | undefined;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(text: string): Hunk[] {
	const hunks: Hunk[] = [];
	let file = "";
	let old = "";
	let hunk: Hunk | undefined;
	for (const line of text.split("\n")) {
		if (line.startsWith("diff --git ")) {
			hunk = undefined;
			file = / b\/(.+)$/.exec(line)?.[1] ?? "";
		} else if (!hunk && line.startsWith("--- ")) old = line.slice(4).replace(/^a\//, "");
		else if (!hunk && line.startsWith("+++ ")) file = line === "+++ /dev/null" ? old : line.slice(6);
		else if (HUNK.test(line)) {
			const [, os, ol, ns, nl] = HUNK.exec(line)!;
			hunk = {
				file,
				oldStart: Number(os),
				oldLines: ol === undefined ? 1 : Number(ol),
				newStart: Number(ns),
				newLines: nl === undefined ? 1 : Number(nl),
				header: line,
				lines: [],
			};
			hunks.push(hunk);
		} else if (hunk && /^[ +\-\\]/.test(line)) hunk.lines.push(line);
		else hunk = undefined;
	}
	return hunks;
}

export const normalize = (file: string) =>
	file
		.trim()
		.replace(/^@/, "")
		.replace(/^(\.\/|[ab]\/)/, "");

/** The new-file lines a hunk spans, or the old-file lines for a hunk that only deletes. */
export function span(h: Hunk): [number, number] {
	return h.newLines ? [h.newStart, h.newStart + h.newLines - 1] : [h.oldStart, h.oldStart + h.oldLines - 1];
}

/** Indexes of the hunks in `ref`'s file that overlap its range. */
export function findHunks(hunks: readonly Hunk[], ref: Ref): number[] {
	const file = normalize(ref.file);
	const start = ref.start ?? 1;
	const end = ref.end ?? ref.start ?? Infinity;
	const out: number[] = [];
	hunks.forEach((h, i) => {
		const [s, e] = span(h);
		if (h.file === file && s <= end && start <= e) out.push(i);
	});
	return out;
}

/** True when `line` of the new file is in the diff, so GitHub takes an inline comment on it. */
export function lineInDiff(hunks: readonly Hunk[], file: string, line: number): boolean {
	return hunks.some((h) => {
		if (h.file !== normalize(file)) return false;
		let n = h.newStart;
		for (const l of h.lines) {
			if (l[0] === "-" || l[0] === "\\") continue;
			if (n === line) return true;
			n++;
		}
		return false;
	});
}

/** The last line of `ref`'s range that takes an inline comment, if any. */
export function commentableLine(hunks: readonly Hunk[], ref: Ref): number | undefined {
	const start = ref.start ?? 1;
	for (let n = ref.end ?? start; n >= start; n--) if (lineInDiff(hunks, ref.file, n)) return n;
	return undefined;
}

/** Lines added and removed in a hunk. */
export function churn(h: Hunk): number {
	return h.lines.filter((l) => l[0] === "+" || l[0] === "-").length;
}

export const refLabel = (ref: Ref) =>
	ref.start === undefined
		? normalize(ref.file)
		: `${normalize(ref.file)}:${ref.start}${ref.end !== undefined && ref.end !== ref.start ? `-${ref.end}` : ""}`;

export const hunkLabel = (h: Hunk) => {
	const [s, e] = span(h);
	return `${h.file}:${s}${e > s ? `-${e}` : ""}`;
};
