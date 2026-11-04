import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DIFF } from "./fixtures.ts";
import { churn, commentableLine, findHunks, hunkLabel, lineInDiff, parseDiff, refLabel } from "../src/diff.ts";

describe("parseDiff", () => {
	const hunks = parseDiff(DIFF);

	it("reads every hunk with its file and ranges", () => {
		assert.deepEqual(
			hunks.map((h) => [h.file, h.oldStart, h.oldLines, h.newStart, h.newLines, h.lines.length]),
			[
				["src/user.ts", 10, 4, 10, 5, 6],
				["src/user.ts", 40, 1, 41, 1, 3],
				["src/new.ts", 0, 0, 1, 2, 2],
				["src/gone.ts", 1, 2, 0, 0, 2],
			],
		);
	});

	it("keeps a removed line that looks like a file header", () => {
		assert.equal(hunks[3]!.lines[0], "--- not a header");
	});

	it("counts changed lines and labels hunks", () => {
		assert.deepEqual(hunks.map(churn), [3, 2, 2, 2]);
		assert.deepEqual(hunks.map(hunkLabel), [
			"src/user.ts:10-14",
			"src/user.ts:41",
			"src/new.ts:1-2",
			"src/gone.ts:1-2",
		]);
	});
});

describe("findHunks", () => {
	const hunks = parseDiff(DIFF);

	it("finds every hunk of a file without a range", () => {
		assert.deepEqual(findHunks(hunks, { file: "src/user.ts" }), [0, 1]);
	});

	it("finds the hunks a range overlaps", () => {
		assert.deepEqual(findHunks(hunks, { file: "src/user.ts", start: 14, end: 50 }), [0, 1]);
		assert.deepEqual(findHunks(hunks, { file: "src/user.ts", start: 20, end: 30 }), []);
		assert.deepEqual(findHunks(hunks, { file: "src/user.ts", start: 41 }), [1]);
	});

	it("accepts git and relative path prefixes", () => {
		assert.deepEqual(findHunks(hunks, { file: "b/src/new.ts" }), [2]);
		assert.deepEqual(findHunks(hunks, { file: "./src/gone.ts", start: 1, end: 1 }), [3]);
	});

	it("labels refs", () => {
		assert.equal(refLabel({ file: "a/x.ts", start: 3, end: 3 }), "x.ts:3");
		assert.equal(refLabel({ file: "x.ts", start: 3, end: 9 }), "x.ts:3-9");
	});
});

describe("lineInDiff", () => {
	const hunks = parseDiff(DIFF);

	it("takes added and context lines of the new file", () => {
		assert.equal(lineInDiff(hunks, "src/user.ts", 10), true);
		assert.equal(lineInDiff(hunks, "src/user.ts", 12), true);
		assert.equal(lineInDiff(hunks, "src/user.ts", 14), true);
		assert.equal(lineInDiff(hunks, "src/user.ts", 41), true);
	});

	it("refuses lines outside the hunks and in other files", () => {
		assert.equal(lineInDiff(hunks, "src/user.ts", 15), false);
		assert.equal(lineInDiff(hunks, "src/user.ts", 42), false);
		assert.equal(lineInDiff(hunks, "src/other.ts", 10), false);
	});

	it("finds the last commentable line of a range", () => {
		assert.equal(commentableLine(hunks, { file: "src/user.ts", start: 12, end: 20 }), 14);
		assert.equal(commentableLine(hunks, { file: "src/gone.ts", start: 1, end: 2 }), undefined);
	});
});
