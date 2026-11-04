import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { currentPhase, type Phase, PHASES, type ReviewEvent } from "../src/state.ts";
import { DIFF, PR } from "./fixtures.ts";
import { started, text } from "./harness.ts";

// Hunks of DIFF: 0 src/user.ts:10-14, 1 src/user.ts:41, 2 src/new.ts:1-2, 3 src/gone.ts:1-2 (deleted).
const STEPS: ReviewEvent[] = [
	{ type: "start", pr: PR, diff: DIFF },
	{ type: "triaged", behaviour: [0, 2] },
	{ type: "why", acs: ["Resets the password", "Expires the link"] },
	{
		type: "matrix",
		rows: [
			{ ac: 1, tests: [{ name: "resets", why: "checks the hash" }] },
			{ ac: 2, tests: [{ name: "expires", why: "moves the clock" }] },
		],
	},
	{ type: "interfaces" },
	{ type: "visited", hunks: [0, 2] },
];

/** The events of a review whose open phase is `phase`. */
const reviewAt = (phase: Phase) => STEPS.slice(0, PHASES.indexOf(phase) + 1);

const TRIAGE = {
	items: [
		{ file: "src/user.ts", start: 10, end: 14, kind: "behaviour", note: "hash the token" },
		{ file: "src/user.ts", start: 41, kind: "tidying", note: "rename" },
		{ file: "src/new.ts", kind: "behaviour", note: "new mailer" },
		{ file: "src/gone.ts", kind: "tidying", note: "dead code" },
	],
	hotspots: [{ file: "src/user.ts", line: 12, risk: "high", why: "token compare" }],
};

const WHY = { why: "Users forget passwords.", source: "PROJ-1", acs: ["Resets", "Expires"], gaps: [] };

const BOX = "╭───────╮\n│ Panel │\n╰───────╯";

describe("phase order", () => {
	it("refuses every tool before /pr-review", async () => {
		const h = await started();
		await assert.rejects(h.call("pr_comment", { body: "x" }), /No review in progress/);
	});

	it("refuses a phase tool before its phase and names the tool to finish first", async () => {
		const h = await started({ events: reviewAt("triage") });
		await assert.rejects(h.call("pr_why", WHY), /finish Triage first with pr_triage/);
		assert.equal(h.asked.length, 0);
	});

	it("refuses every tool once the review is posted", async () => {
		const h = await started({ events: [...STEPS, { type: "submitted", url: "u", verdict: "APPROVE" }] });
		await assert.rejects(h.call("pr_triage", TRIAGE), /review is posted/);
	});

	it("lets the reviewer go back to an earlier phase and keeps later work", async () => {
		const h = await started({ events: reviewAt("submit"), replies: ["Looks right"] });
		await h.call("pr_triage", { ...TRIAGE, items: TRIAGE.items.map((i) => ({ ...i, kind: "behaviour" })) });
		assert.deepEqual(h.state.behaviour, [0, 1, 2, 3]);
		assert.equal(h.state.acs?.length, 2);
		assert.equal(currentPhase(h.state), "walkthrough", "the new behaviour hunks still need a visit");
	});
});

describe("pr_triage", () => {
	it("records the behaviour hunks once the reviewer acknowledges the split", async () => {
		const h = await started({ events: reviewAt("triage"), replies: ["Looks right"] });
		const result = await h.call("pr_triage", TRIAGE);
		assert.deepEqual(h.state.behaviour, [0, 2]);
		assert.equal(currentPhase(h.state), "why");
		assert.match(text(result), /2 behaviour hunks.*pr_why/);
	});

	it("sends the reviewer's correction back to the agent and records nothing", async () => {
		const h = await started({ events: reviewAt("triage"), replies: ["Something is off", "line 41 is behaviour"] });
		const result = await h.call("pr_triage", TRIAGE);
		assert.match(text(result), /The reviewer says: line 41 is behaviour/);
		assert.equal(h.state.behaviour, undefined);
	});

	it("records nothing when the reviewer closes triage", async () => {
		const h = await started({ events: reviewAt("triage"), replies: [undefined] });
		assert.match(text(await h.call("pr_triage", TRIAGE)), /closed triage/);
		assert.equal(h.state.behaviour, undefined);
	});

	it("refuses a triage that skips a hunk or names a file outside the diff", async () => {
		const h = await started({ events: reviewAt("triage") });
		await assert.rejects(
			h.call("pr_triage", { ...TRIAGE, items: TRIAGE.items.slice(1) }),
			/Missing 1: src\/user.ts:10-14/,
		);
		const outside = { ...TRIAGE, items: [...TRIAGE.items, { file: "src/nope.ts", kind: "tidying", note: "" }] };
		await assert.rejects(h.call("pr_triage", outside), /Not in the diff: src\/nope.ts/);
		assert.equal(h.asked.length, 0);
	});
});

describe("pr_why", () => {
	it("records the acceptance criteria once the reviewer confirms them", async () => {
		const h = await started({ events: reviewAt("why"), replies: ["Yes"] });
		assert.match(text(await h.call("pr_why", WHY)), /Confirmed 2 acceptance criteria/);
		assert.deepEqual(h.state.acs, ["Resets", "Expires"]);
	});

	it("records nothing when the reviewer corrects them", async () => {
		const h = await started({ events: reviewAt("why"), replies: ["Correct it", "AC2 is wrong"] });
		assert.match(text(await h.call("pr_why", WHY)), /AC2 is wrong/);
		assert.equal(h.state.acs, undefined);
	});
});

describe("pr_ac_matrix", () => {
	const covered = { ac: 1, tests: [{ name: "resets", why: "checks the hash" }] };

	it("refuses rows for criteria that do not exist and criteria without a row", async () => {
		const h = await started({ events: reviewAt("ac") });
		await assert.rejects(h.call("pr_ac_matrix", { rows: [covered, { ac: 3, tests: [] }] }), /There is no AC 3/);
		await assert.rejects(h.call("pr_ac_matrix", { rows: [covered] }), /Add a row for AC 2/);
		assert.equal(h.state.matrix, undefined);
	});

	it("keeps the phase open until every gap has a comment", async () => {
		const h = await started({ events: reviewAt("ac") });
		const result = await h.call("pr_ac_matrix", { rows: [covered, { ac: 2, tests: [], gap: "no expiry test" }] });
		assert.match(text(result), /1\/2 covered\. Gaps without a comment: AC 2/);
		assert.equal(currentPhase(h.state), "ac");

		const comment = await h.call("pr_comment", { body: "Test the expiry.", ac: 2 });
		assert.match(text(comment), /Every AC gap has a comment\. Next: pr_interfaces/);
		assert.equal(currentPhase(h.state), "interfaces");
	});

	it("completes the phase when every criterion has a test", async () => {
		const h = await started({ events: reviewAt("ac") });
		const rows = [covered, { ac: 2, tests: [{ name: "expires", why: "clock" }] }];
		assert.match(text(await h.call("pr_ac_matrix", { rows })), /2\/2 covered\. Next: pr_interfaces/);
		assert.equal(currentPhase(h.state), "interfaces");
	});
});

describe("pr_interfaces", () => {
	const items = [
		{ group: "names", name: "reset → resetPassword", change: "renamed" },
		{ group: "dependencies", name: "bcrypt", change: "added", question: "Is bcrypt fine here?", view: "Yes." },
	];

	it("asks only about flagged items and reports the answers", async () => {
		const h = await started({ events: reviewAt("interfaces"), replies: ["I have a concern", "use argon2"] });
		const result = await h.call("pr_interfaces", { items });
		assert.equal(h.asked.length, 2, "one choice and its note, for the one flagged item");
		assert.match(text(result), /- bcrypt: I have a concern: use argon2/);
		assert.equal(currentPhase(h.state), "walkthrough");
	});

	it("completes without asking when nothing is flagged", async () => {
		const h = await started({ events: reviewAt("interfaces") });
		assert.match(text(await h.call("pr_interfaces", { items: items.slice(0, 1) })), /Nothing flagged/);
		assert.equal(h.state.interfaces, true);
	});

	it("records nothing when the reviewer leaves before answering", async () => {
		const h = await started({ events: reviewAt("interfaces"), replies: [undefined] });
		assert.match(text(await h.call("pr_interfaces", { items })), /closed this/);
		assert.equal(h.state.interfaces, false);
	});
});

describe("pr_diagram", () => {
	it("rejects a misaligned diagram with findings and records nothing", async () => {
		const h = await started({ events: reviewAt("walkthrough") });
		const result = await h.call("pr_diagram", { title: "Flow", body: "╭──────╮\n│ Orders │\n╰──────╯" });
		assert.equal(result.isError, true);
		assert.equal(h.state.diagram, undefined);
	});

	it("keeps a clean diagram and shows it as the walkthrough's map", async () => {
		const h = await started({ events: reviewAt("walkthrough"), replies: ["Start", "Looks good", "Looks good"] });
		await h.call("pr_diagram", { title: "Flow", body: BOX });
		assert.equal(h.state.diagram?.body, BOX);
		await h.call("pr_walkthrough", { stops: [stop("src/user.ts", 10, 14), stop("src/new.ts", 1, 2)] });
		assert.match(h.asked[0]!, /Walkthrough · Map/);
		assert.equal(currentPhase(h.state), "submit");
	});
});

function stop(file: string, start: number, end: number, part = "core") {
	return { file, start, end, part, summary: "Does a thing.", question: "Is this right?" };
}

describe("pr_walkthrough", () => {
	it("refuses stops that miss a behaviour hunk", async () => {
		const h = await started({ events: reviewAt("walkthrough") });
		await assert.rejects(
			h.call("pr_walkthrough", { stops: [stop("src/user.ts", 10, 14)] }),
			/Add stops for these behaviour hunks: src\/new.ts:1-2/,
		);
	});

	it("shows entry stops first, drafts comments on the stop's last diff line and marks every stop visited", async () => {
		const h = await started({
			events: reviewAt("walkthrough"),
			replies: ["Looks good", "Blocking comment", "Hash before compare", "Leave a comment", "Why delete this?"],
		});
		const stops = [stop("src/user.ts", 10, 14), stop("src/new.ts", 1, 2, "entry"), stop("src/gone.ts", 1, 2, "edge")];
		const result = await h.call("pr_walkthrough", { stops });
		assert.match(h.asked[0]!, /Stop 1\/3 src\/new.ts:1-2/);
		assert.deepEqual(
			h.state.comments.map(({ file, line, body, blocking }) => ({ file, line, body, blocking })),
			[
				{ file: "src/user.ts", line: 14, body: "Hash before compare", blocking: true },
				{ file: undefined, line: undefined, body: "src/gone.ts:1-2: Why delete this?", blocking: false },
			],
			"a stop without a new line puts its comment in the review body",
		);
		assert.deepEqual(h.state.visited, [2, 0, 3]);
		assert.equal(currentPhase(h.state), "submit");
		assert.match(text(result), /Walkthrough done\. 2 comments drafted/);
	});

	it("counts only the stops answered before esc and keeps the phase open", async () => {
		const h = await started({ events: reviewAt("walkthrough"), replies: ["Looks good", undefined] });
		const result = await h.call("pr_walkthrough", { stops: [stop("src/user.ts", 10, 14), stop("src/new.ts", 1, 2)] });
		assert.deepEqual(h.state.visited, [0]);
		assert.equal(currentPhase(h.state), "walkthrough");
		assert.match(text(result), /left the walkthrough after 1 stop/);
		assert.match(text(result), /Not visited yet: src\/new.ts:1-2/);
	});

	it("records no visit when the reviewer leaves at the first stop", async () => {
		const h = await started({ events: reviewAt("walkthrough"), replies: [undefined] });
		await h.call("pr_walkthrough", { stops: [stop("src/user.ts", 10, 14), stop("src/new.ts", 1, 2)] });
		assert.equal(h.state.visited, undefined);
	});
});

describe("pr_comment", () => {
	it("saves a draft in any phase, with the path as in the diff", async () => {
		const h = await started({ events: reviewAt("triage") });
		assert.match(text(await h.call("pr_comment", { file: "./src/user.ts", line: 11, body: "Nice." })), /1 draft/);
		assert.deepEqual(h.state.comments, [{ id: 1, file: "src/user.ts", line: 11, body: "Nice.", blocking: false }]);
	});

	it("refuses a line outside the diff, so GitHub never rejects the review for it", async () => {
		const h = await started({ events: reviewAt("triage") });
		await assert.rejects(
			h.call("pr_comment", { file: "src/user.ts", line: 30, body: "x" }),
			/src\/user.ts:30 is not in the diff/,
		);
		await assert.rejects(h.call("pr_comment", { file: "src/user.ts", body: "x" }), /both file and line/);
		assert.deepEqual(h.state.comments, []);
	});

	it("refuses an AC that does not exist", async () => {
		const h = await started({ events: reviewAt("ac") });
		await assert.rejects(h.call("pr_comment", { body: "x", ac: 3 }), /There is no AC 3/);
	});
});
