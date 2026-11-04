import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	checkAcs,
	currentPhase,
	ENTRY_TYPE,
	gate,
	INITIAL_STATE,
	isComplete,
	rebuild,
	reduce,
	type ReviewEvent,
	type ReviewState,
} from "../src/state.ts";
import { DIFF, PR } from "./fixtures.ts";

const apply = (...events: ReviewEvent[]): ReviewState => events.reduce(reduce, INITIAL_STATE);
const start: ReviewEvent = { type: "start", pr: PR, diff: DIFF };
const comment = (ac?: number): ReviewEvent => ({
	type: "comment",
	comment: { body: "Add a test", blocking: false, ac },
});

describe("reduce and rebuild", () => {
	it("parses the diff on start and numbers comments", () => {
		const state = apply(start, comment(), comment());
		assert.equal(state.hunks.length, 4);
		assert.deepEqual(
			state.comments.map((c) => c.id),
			[1, 2],
		);
	});

	it("starts over on a new start", () => {
		const state = apply(start, { type: "triaged", behaviour: [0] }, comment(), start);
		assert.equal(state.behaviour, undefined);
		assert.deepEqual(state.comments, []);
	});

	it("rebuilds from the branch, skipping other entries", () => {
		const events: ReviewEvent[] = [start, { type: "triaged", behaviour: [0, 2] }, { type: "why", acs: ["A"] }];
		const entries = [
			{ type: "message" },
			...events.map((data) => ({ type: "custom", customType: ENTRY_TYPE, data })),
			{ type: "custom", customType: "other", data: { type: "why", acs: [] } },
		];
		assert.deepEqual(rebuild(entries), apply(...events));
	});

	it("merges visited hunks", () => {
		const state = apply(start, { type: "visited", hunks: [0, 1] }, { type: "visited", hunks: [1, 2] });
		assert.deepEqual(state.visited, [0, 1, 2]);
	});
});

describe("phases", () => {
	it("walks the phases in order", () => {
		let state = apply(start);
		assert.equal(currentPhase(state), "triage");
		state = apply(start, { type: "triaged", behaviour: [0, 2] });
		assert.equal(currentPhase(state), "why");
		state = reduce(state, { type: "why", acs: ["Resets the password", "Expires the link"] });
		state = reduce(state, {
			type: "matrix",
			rows: [
				{ ac: 1, tests: [{ name: "resets", why: "checks the hash" }] },
				{ ac: 2, tests: [] },
			],
		});
		assert.equal(currentPhase(state), "ac", "a gap without a comment keeps the phase open");
		state = reduce(state, comment(2));
		assert.equal(currentPhase(state), "interfaces");
		state = reduce(state, { type: "interfaces" });
		state = reduce(state, { type: "visited", hunks: [0] });
		assert.equal(currentPhase(state), "walkthrough", "behaviour hunk 2 not visited yet");
		state = reduce(state, { type: "visited", hunks: [2] });
		assert.equal(currentPhase(state), "submit");
		state = reduce(state, { type: "submitted", url: "u", verdict: "COMMENT" });
		assert.equal(currentPhase(state), undefined);
	});

	it("completes the walkthrough of a PR without behaviour hunks once it ran", () => {
		const state = apply(start, { type: "triaged", behaviour: [] });
		assert.equal(isComplete(state, "walkthrough"), false);
		assert.equal(isComplete(reduce(state, { type: "visited", hunks: [] }), "walkthrough"), true);
	});

	it("refuses tools out of order and allows going back", () => {
		assert.match(gate(INITIAL_STATE, "triage")!, /\/pr-review/);
		const state = apply(start, { type: "triaged", behaviour: [0] });
		assert.equal(gate(state, "triage"), undefined);
		assert.equal(gate(state, "why"), undefined);
		assert.equal(gate(state, "interfaces"), "Not yet: finish Why first with pr_why.");
		assert.equal(gate(state), undefined);
		assert.match(gate(reduce(state, { type: "submitted", url: "u", verdict: "APPROVE" }))!, /posted/);
	});
});

describe("checkAcs", () => {
	const acs = ["A", "B", "C"];

	it("finds gaps, missing rows, unknown rows and gaps without a comment", () => {
		const rows = [
			{ ac: 1, tests: [{ name: "t", why: "w" }] },
			{ ac: 2, tests: [] },
			{ ac: 4, tests: [] },
		];
		assert.deepEqual(checkAcs(acs, rows, []), { unknown: [4], missing: [3], gaps: [2, 4], open: [2, 4] });
	});

	it("counts a gap as handled once a comment names its AC", () => {
		const rows = acs.map((_, i) => ({ ac: i + 1, tests: [] }));
		const comments = [{ id: 1, body: "x", blocking: false, ac: 3 }];
		assert.deepEqual(checkAcs(acs, rows, comments).open, [1, 2]);
	});
});
