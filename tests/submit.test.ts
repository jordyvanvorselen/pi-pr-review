import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ReviewEvent } from "../src/state.ts";
import { DIFF, PR } from "./fixtures.ts";
import { type GhReply, started, text } from "./harness.ts";

const READY: ReviewEvent[] = [
	{ type: "start", pr: PR, diff: DIFF },
	{ type: "triaged", behaviour: [0] },
	{ type: "why", acs: ["Resets the password"] },
	{ type: "matrix", rows: [{ ac: 1, tests: [{ name: "resets", why: "checks the hash" }] }] },
	{ type: "interfaces" },
	{ type: "visited", hunks: [0] },
	{ type: "comment", comment: { file: "src/user.ts", line: 12, body: "Name this resetToken.", blocking: false } },
	{ type: "comment", comment: { body: "Add a changelog entry.", blocking: false } },
];

const REVIEW_URL = "https://github.com/acme/shop/pull/7#pullrequestreview-1";
const posted = (): GhReply => ({ stdout: JSON.stringify({ html_url: REVIEW_URL }) });

describe("pr_submit never posts without the reviewer's confirmation", () => {
	it("sends nothing to GitHub without a UI to confirm", async () => {
		const h = await started({ events: READY, hasUI: false, gh: posted });
		const result = await h.call("pr_submit", { summary: "Good." });
		assert.match(text(result), /Nothing was sent to GitHub/);
		assert.deepEqual(h.gh, []);
		assert.equal(h.state.submitted, undefined);
	});

	it("sends nothing when the reviewer cancels at the confirmation", async () => {
		const h = await started({ events: READY, gh: posted, replies: ["Keep", "Keep", "Cancel"] });
		assert.match(text(await h.call("pr_submit", { summary: "Good." })), /cancelled\. Nothing was posted/);
		assert.deepEqual(h.gh, []);
		assert.equal(h.state.submitted, undefined);
	});

	it("sends nothing when the reviewer presses esc on a draft or at the confirmation", async () => {
		for (const replies of [[undefined], ["Keep", "Keep", undefined]]) {
			const h = await started({ events: READY, gh: posted, replies });
			assert.match(text(await h.call("pr_submit", { summary: "Good." })), /Nothing was posted/);
			assert.deepEqual(h.gh, []);
		}
	});
});

describe("pr_submit", () => {
	it("posts one review with the kept drafts once the reviewer confirms", async () => {
		const h = await started({ events: READY, gh: posted, replies: ["Keep", "Drop", "Post: Comment"] });
		const result = await h.call("pr_submit", { summary: "Good." });
		assert.equal(h.gh.length, 1);
		assert.deepEqual(h.gh[0]!.slice(0, 4), ["api", "--method", "POST", "repos/acme/shop/pulls/7/reviews"]);
		assert.deepEqual(h.posted, [
			{
				commit_id: "abc123",
				event: "COMMENT",
				body: "Good.",
				comments: [{ path: "src/user.ts", line: 12, side: "RIGHT", body: "Name this resetToken." }],
			},
		]);
		assert.equal(h.state.submitted, REVIEW_URL);
		assert.equal(h.state.comments.length, 1, "the dropped draft is gone");
		assert.match(text(result), /Posted: Comment with 1 inline comment/);
	});

	it("posts the reviewer's edits to drafts, blocking and summary", async () => {
		const h = await started({
			events: READY,
			gh: posted,
			replies: ["Edit", "Call it resetToken.", "Keep, make it blocking", "Edit the summary", "Needs work.", "Post"],
		});
		await h.call("pr_submit", { summary: "Good." });
		assert.match(h.asked.at(-1)!, /Post this review/);
		assert.deepEqual(h.posted, [
			{
				commit_id: "abc123",
				event: "REQUEST_CHANGES",
				body: "Needs work.\n\n- **Blocking:** Add a changelog entry.",
				comments: [{ path: "src/user.ts", line: 12, side: "RIGHT", body: "Call it resetToken." }],
			},
		]);
	});

	it("keeps the drafts and says nothing was posted when GitHub refuses the review", async () => {
		const h = await started({
			events: READY,
			gh: () => ({ code: 1, stderr: "HTTP 422: Validation Failed" }),
			replies: ["Keep", "Keep", "Post"],
		});
		await assert.rejects(h.call("pr_submit", { summary: "Good." }), /HTTP 422[\s\S]*Nothing was posted/);
		assert.equal(h.state.submitted, undefined);
		assert.equal(h.state.comments.length, 2);
	});
});
