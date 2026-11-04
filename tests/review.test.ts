import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewPrompt } from "../src/commands.ts";
import { buildReview } from "../src/github.ts";
import type { DraftComment } from "../src/state.ts";
import { verdictOrder } from "../src/tools/submit.ts";
import { visitedHunks } from "../src/tools/walkthrough.ts";
import { DIFF, PR } from "./fixtures.ts";

const comments: DraftComment[] = [
	{ id: 1, file: "src/user.ts", line: 12, body: "Name this resetToken. ", blocking: false },
	{ id: 2, file: "src/new.ts", line: 1, body: "This can throw.", blocking: true },
	{ id: 3, body: "No test for expiry.", blocking: false, ac: 2 },
];

describe("buildReview", () => {
	it("puts file comments inline and the rest in the body", () => {
		assert.deepEqual(buildReview(PR, comments, "REQUEST_CHANGES", " Good start. "), {
			commit_id: "abc123",
			event: "REQUEST_CHANGES",
			body: "Good start.\n\n- (AC 2) No test for expiry.",
			comments: [
				{ path: "src/user.ts", line: 12, side: "RIGHT", body: "Name this resetToken." },
				{ path: "src/new.ts", line: 1, side: "RIGHT", body: "**Blocking:** This can throw." },
			],
		});
	});

	it("posts only the summary without comments", () => {
		const payload = buildReview(PR, [], "APPROVE", "Looks good.");
		assert.equal(payload.body, "Looks good.");
		assert.deepEqual(payload.comments, []);
	});
});

describe("verdictOrder", () => {
	it("suggests the verdict the drafts call for first", () => {
		assert.deepEqual(verdictOrder(comments), ["REQUEST_CHANGES", "COMMENT", "APPROVE"]);
		assert.deepEqual(verdictOrder([comments[0]!]), ["COMMENT", "REQUEST_CHANGES", "APPROVE"]);
		assert.deepEqual(verdictOrder([]), ["APPROVE", "REQUEST_CHANGES", "COMMENT"]);
	});
});

describe("reviewPrompt", () => {
	it("fills in the PR and keeps unknown placeholders", () => {
		const text = reviewPrompt("#{{number}} {{title}}: {{size}} lines, {{files}} files. {{body}} {{nope}}", {
			pr: PR,
			body: "",
			diff: DIFF,
		});
		assert.equal(text, "#7 Reset passwords: 10 lines, 3 files. (none) {{nope}}");
	});
});

describe("visitedHunks", () => {
	const hunksOf = [[0], [1, 2], [2], [3]];

	it("counts every stop when the reviewer reached the end", () => {
		const answers = hunksOf.map(() => ({ choice: 0 }));
		assert.deepEqual(visitedHunks(hunksOf, answers), [0, 1, 2, 3]);
	});

	it("counts only the stops answered before esc", () => {
		assert.deepEqual(visitedHunks(hunksOf, [{ choice: 0 }, { choice: 2, note: "Why?" }]), [0, 1, 2]);
		assert.deepEqual(visitedHunks(hunksOf, []), []);
	});
});
