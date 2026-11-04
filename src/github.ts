// Everything that talks to GitHub, through the `gh` CLI.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DraftComment, Pr, Verdict } from "./state.ts";

type Exec = ExtensionAPI["exec"];

async function gh(exec: Exec, args: string[], cwd: string): Promise<string> {
	const result = await exec("gh", args, { cwd });
	if (result.code !== 0) throw new Error(result.stderr.trim() || `gh ${args.slice(0, 2).join(" ")} failed`);
	return result.stdout;
}

export interface PrBundle {
	pr: Pr;
	/** The PR description. */
	body: string;
	diff: string;
}

/** The PR for a number or URL, or for the current branch when `ref` is empty. */
export async function fetchPr(exec: Exec, ref: string, cwd: string): Promise<PrBundle> {
	const fields = "number,title,url,author,headRefOid,additions,deletions,body";
	const view = JSON.parse(await gh(exec, ["pr", "view", ...(ref ? [ref] : []), "--json", fields], cwd));
	const [, owner = "", repo = ""] = /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\//.exec(view.url) ?? [];
	const diff = await gh(exec, ["pr", "diff", view.url], cwd);
	return {
		pr: {
			owner,
			repo,
			number: view.number,
			title: view.title,
			url: view.url,
			author: view.author?.login ?? "",
			head: view.headRefOid,
			additions: view.additions,
			deletions: view.deletions,
		},
		body: view.body ?? "",
		diff,
	};
}

export interface ReviewPayload {
	commit_id: string;
	event: Verdict;
	body: string;
	comments: { path: string; line: number; side: "RIGHT"; body: string }[];
}

const commentText = (c: DraftComment) =>
	`${c.blocking ? "**Blocking:** " : ""}${c.ac !== undefined ? `(AC ${c.ac}) ` : ""}${c.body.trim()}`;

/** One review: inline comments on their lines, the rest in the body under the summary. */
export function buildReview(
	pr: Pr,
	comments: readonly DraftComment[],
	verdict: Verdict,
	summary: string,
): ReviewPayload {
	const inline = comments.filter((c) => c.file && c.line);
	const general = comments.filter((c) => !(c.file && c.line));
	const body = [summary.trim(), ...(general.length ? ["", ...general.map((c) => `- ${commentText(c)}`)] : [])];
	return {
		commit_id: pr.head,
		event: verdict,
		body: body.join("\n").trim(),
		comments: inline.map((c) => ({ path: c.file!, line: c.line!, side: "RIGHT", body: commentText(c) })),
	};
}

/** Post the review. Returns its URL. */
export async function postReview(exec: Exec, pr: Pr, payload: ReviewPayload, cwd: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "pi-pr-review-"));
	const file = join(dir, "review.json");
	try {
		await writeFile(file, JSON.stringify(payload));
		const path = `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`;
		const out = await gh(exec, ["api", "--method", "POST", path, "--input", file], cwd);
		return (JSON.parse(out) as { html_url?: string }).html_url ?? pr.url;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
