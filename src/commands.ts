// `/pr-review [pr]`: resolve the PR, store it, and hand the agent its instructions.
import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseDiff } from "./diff.ts";
import { fetchPr, type PrBundle } from "./github.ts";
import type { ReviewSession } from "./session.ts";

const PROMPT_FILE = new URL("../prompts/review.md", import.meta.url);
const BODY_LIMIT = 4000;

/** The instructions with the PR filled in. */
export function reviewPrompt(template: string, { pr, body, diff }: PrBundle): string {
	const files = new Set(parseDiff(diff).map((h) => h.file)).size;
	const text = body.trim() || "(none)";
	const vars: Record<string, string | number> = {
		number: pr.number,
		title: pr.title,
		url: pr.url,
		author: pr.author,
		size: pr.additions + pr.deletions,
		files,
		body: text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}…` : text,
	};
	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => String(vars[key] ?? match));
}

export function registerCommands(pi: ExtensionAPI, session: ReviewSession): void {
	pi.registerCommand("pr-review", {
		description: "Review a pull request: /pr-review [number or URL], the current branch's PR by default",
		handler: async (args, ctx) => {
			session.ctx = ctx;
			const open = session.state.pr && !session.state.submitted ? session.state.pr : undefined;
			if (open && ctx.hasUI) {
				const ok = await ctx.ui.confirm("Start a new review?", `This drops the review of #${open.number} in progress.`);
				if (!ok) return;
			}
			let bundle: PrBundle;
			try {
				ctx.ui.setWorkingMessage("Fetching the pull request…");
				bundle = await fetchPr(pi.exec.bind(pi), args.trim(), ctx.cwd);
			} catch (error) {
				ctx.ui.notify(`Could not load the PR: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			} finally {
				ctx.ui.setWorkingMessage();
			}
			session.append({ type: "start", pr: bundle.pr, diff: bundle.diff });
			pi.setSessionName(`Review #${bundle.pr.number}: ${bundle.pr.title}`);
			const prompt = reviewPrompt(await readFile(PROMPT_FILE, "utf8"), bundle);
			pi.sendUserMessage(prompt, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
		},
	});
}
