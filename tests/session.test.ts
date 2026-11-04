import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_NAMES } from "../src/session.ts";
import type { ReviewEvent } from "../src/state.ts";
import { DIFF, PR } from "./fixtures.ts";
import { type GhReply, harness, started } from "./harness.ts";

const START: ReviewEvent = { type: "start", pr: PR, diff: DIFF };
const TRIAGED: ReviewEvent = { type: "triaged", behaviour: [0] };
const reviewTools = (active: string[]) => TOOL_NAMES.filter((t) => active.includes(t));

describe("session", () => {
	it("rebuilds the review from the branch on start and turns the review tools on", async () => {
		const h = await started({ events: [START, TRIAGED] });
		assert.deepEqual(h.state.behaviour, [0]);
		assert.deepEqual(reviewTools(h.activeTools), TOOL_NAMES);
		assert.deepEqual(h.widget, [
			"PR #7  ✓ Triage › ◉ Why › ○ AC matrix › ○ Interfaces › ○ Walkthrough › ○ Submit   ✎ no drafts",
		]);
		await assert.rejects(h.call("pr_ac_matrix", { rows: [] }), /finish Why first/);
	});

	it("keeps the review tools off without a review and after it is posted", async () => {
		assert.deepEqual(reviewTools((await started()).activeTools), []);
		const posted = await started({ events: [START, { type: "submitted", url: "u", verdict: "APPROVE" }] });
		assert.deepEqual(reviewTools(posted.activeTools), []);
	});

	it("follows /tree back to an earlier point of the review", async () => {
		const h = await started({ events: [START, TRIAGED] });
		h.branch.splice(1);
		await h.fire("session_tree");
		await assert.rejects(h.call("pr_why", {}), /finish Triage first/);
	});
});

const VIEW = {
	number: 7,
	title: "Reset passwords",
	url: "https://github.com/acme/shop/pull/7",
	author: { login: "sam" },
	headRefOid: "abc123",
	additions: 6,
	deletions: 4,
	body: "Fixes PROJ-1.",
};

const github = (args: string[]): GhReply =>
	args[1] === "view" ? { stdout: JSON.stringify(VIEW) } : args[1] === "diff" ? { stdout: DIFF } : { code: 1 };

describe("/pr-review", () => {
	it("loads the PR it is given and hands the agent its instructions", async () => {
		const h = harness({ gh: github });
		await h.command("pr-review", " 7 ");
		assert.deepEqual(
			h.gh.map((a) => a.slice(0, 3)),
			[
				["pr", "view", "7"],
				["pr", "diff", VIEW.url],
			],
		);
		assert.deepEqual(h.state.pr, PR);
		assert.equal(h.state.hunks.length, 4);
		assert.equal(h.sessionName, "Review #7: Reset passwords");
		assert.match(h.userMessages[0]!.text, /^Review pull request #7: Reset passwords[\s\S]*Fixes PROJ-1\./);
		assert.equal(h.userMessages[0]!.options, undefined);
		assert.deepEqual(reviewTools(h.activeTools), TOOL_NAMES);
	});

	it("asks gh for the current branch's PR without an argument, and queues behind a running agent", async () => {
		const h = harness({ gh: github, idle: false });
		await h.command("pr-review");
		assert.deepEqual(h.gh[0]!.slice(0, 3), ["pr", "view", "--json"]);
		assert.deepEqual(h.userMessages[0]!.options, { deliverAs: "followUp" });
	});

	it("reports a gh failure and starts nothing", async () => {
		const h = harness({ gh: () => ({ code: 1, stderr: "no pull requests found for branch" }) });
		await h.command("pr-review");
		assert.match(h.notified[0]!, /Could not load the PR: no pull requests found/);
		assert.deepEqual(h.branch, []);
		assert.deepEqual(h.userMessages, []);
	});

	it("asks before dropping a review in progress, and keeps it when the reviewer says no", async () => {
		const h = await started({ events: [START, TRIAGED], gh: github, replies: [undefined] });
		await h.command("pr-review", "8");
		assert.match(h.asked[0]!, /Start a new review/);
		assert.deepEqual(h.gh, []);
		assert.deepEqual(h.state.behaviour, [0]);
	});

	it("starts over when the reviewer agrees to drop the review in progress", async () => {
		const h = await started({ events: [START, TRIAGED], gh: github, replies: ["yes"] });
		await h.command("pr-review", "7");
		assert.equal(h.state.behaviour, undefined);
		assert.equal(h.gh.length, 2);
	});
});
