// A fake Pi for the whole extension. Dialogs answer from a script, `gh` runs through a fake, and appended
// entries land on a branch the session rebuilds from. Runs in RPC mode, so the review screens are select and
// input dialogs.
import { readFileSync } from "node:fs";
import prReviewExtension from "../src/index.ts";
import { ENTRY_TYPE, rebuild, type ReviewEvent } from "../src/state.ts";

export const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

/**
 * The reviewer's next answer: a choice's label (its start is enough), a note's text, `"yes"` to a confirm,
 * or undefined for esc.
 */
export type Reply = string | undefined;

export interface GhReply {
	code?: number;
	stdout?: string;
	stderr?: string;
}

interface Tool {
	execute(id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: unknown): Promise<ToolResult>;
}

export interface ToolResult {
	content: { type: "text"; text: string }[];
	details: unknown;
	isError?: boolean;
}

type Handler = (event: unknown, ctx: unknown) => Promise<void>;

export function harness(
	options: {
		/** The review so far, on the branch before the session starts. */
		events?: ReviewEvent[];
		replies?: Reply[];
		hasUI?: boolean;
		/** Answers each `gh` call. Default: success with no output. */
		gh?: (args: string[]) => GhReply;
		idle?: boolean;
	} = {},
) {
	const replies = [...(options.replies ?? [])];
	const branch: { type: string; customType: string; data: unknown }[] = (options.events ?? []).map((data) => ({
		type: "custom",
		customType: ENTRY_TYPE,
		data,
	}));
	const tools = new Map<string, Tool>();
	const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
	const handlers = new Map<string, Handler>();
	const record = {
		/** The titles of the dialogs the reviewer saw. */
		asked: [] as string[],
		gh: [] as string[][],
		/** The JSON each `gh api --input` call sent. */
		posted: [] as unknown[],
		notified: [] as string[],
		userMessages: [] as { text: string; options: unknown }[],
		sessionName: "",
		widget: undefined as unknown,
	};
	let active = ["read", "bash"];

	const reply = (title: string): Reply => {
		record.asked.push(title);
		if (!replies.length) throw new Error(`No reply scripted for: ${title}`);
		return replies.shift();
	};

	const ui = {
		theme: plainTheme,
		async select(title: string, labels: string[]) {
			const r = reply(title);
			if (r === undefined) return undefined;
			const label = labels.find((l) => l.startsWith(r));
			if (!label) throw new Error(`No choice "${r}" in: ${labels.join(" | ")}`);
			return label;
		},
		input: async (title: string) => reply(title),
		confirm: async (title: string) => reply(title) === "yes",
		notify: (message: string) => record.notified.push(message),
		setWidget: (_key: string, content: unknown) => (record.widget = content),
		setWorkingMessage: () => {},
	};

	const ctx = {
		cwd: "/repo",
		mode: "rpc",
		hasUI: options.hasUI ?? true,
		ui,
		isIdle: () => options.idle ?? true,
		sessionManager: { getBranch: () => branch },
	};

	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerTool: (tool: Tool & { name: string }) => tools.set(tool.name, tool),
		registerCommand: (name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
			commands.set(name, command.handler),
		appendEntry: (customType: string, data: unknown) => branch.push({ type: "custom", customType, data }),
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => (active = [...names]),
		setSessionName: (name: string) => (record.sessionName = name),
		sendUserMessage: (text: string, options: unknown) => record.userMessages.push({ text, options }),
		async exec(command: string, args: string[]) {
			if (command !== "gh") throw new Error(`Unexpected command: ${command}`);
			record.gh.push(args);
			const input = args.indexOf("--input");
			if (input >= 0) record.posted.push(JSON.parse(readFileSync(args[input + 1]!, "utf8")));
			const r = options.gh?.(args) ?? {};
			return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "", killed: false };
		},
	};

	prReviewExtension(pi as never);

	const fire = (event: string) => handlers.get(event)!({ type: event }, ctx);

	return {
		asked: record.asked,
		gh: record.gh,
		posted: record.posted,
		notified: record.notified,
		userMessages: record.userMessages,
		get sessionName() {
			return record.sessionName;
		},
		get widget() {
			return record.widget;
		},
		branch,
		get state() {
			return rebuild(branch);
		},
		get activeTools() {
			return active;
		},
		/** Run a tool like Pi does. Rejects when the tool throws. */
		call: (name: string, params: object) => tools.get(name)!.execute("call-1", params, undefined, undefined, ctx),
		command: (name: string, args = "") => commands.get(name)!(args, ctx),
		fire,
	};
}

/** A harness whose session has started on the review so far. */
export async function started(options: Parameters<typeof harness>[0] = {}) {
	const h = harness(options);
	await h.fire("session_start");
	return h;
}

export const text = (result: ToolResult) => result.content.map((c) => c.text).join("\n");
