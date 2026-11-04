// What every review tool shares: the phase gate, a short text for the model, a visual for the reviewer.
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Static, type TSchema, Type, type TUnsafe } from "typebox";
import { findHunks, refLabel, type Ref } from "../diff.ts";
import type { ReviewSession } from "../session.ts";
import { gate, type Phase, type Pr, type ReviewState } from "../state.ts";
import { errorLines, Lines, title } from "../ui/draw.ts";

export function stringEnum<T extends string>(values: readonly T[], description: string): TUnsafe<T> {
	return Type.Unsafe<T>({ type: "string", enum: [...values], description });
}

export const refFields = {
	file: Type.String({ description: "Path as in the diff, e.g. src/api/user.ts" }),
	start: Type.Optional(Type.Integer({ description: "First line in the new file. Omit for the whole file." })),
	end: Type.Optional(Type.Integer({ description: "Last line in the new file." })),
};

export type OpenState = ReviewState & { pr: Pr };

export interface Outcome<D> {
	/** Short, for the model. */
	text: string;
	details: D;
	isError?: boolean;
}

export interface RenderOptions {
	expanded: boolean;
	/** `ctrl+o to expand`, with the user's key. */
	hint: string;
}

export interface ToolSpec<P extends TSchema, D> {
	name: string;
	label: string;
	/** The phase whose gate the tool passes. Without one, the tool only needs an open review. */
	phase?: Phase;
	description: string;
	parameters: P;
	run(params: Static<P>, state: OpenState, ctx: ExtensionContext, signal: AbortSignal | undefined): Promise<Outcome<D>>;
	/** What the call row says next to the tool name. Arguments may still be streaming in. */
	call(args: Partial<Static<P>>): string;
	/** The visual for a finished call. */
	result(details: D, theme: Theme, width: number, options: RenderOptions): string[];
}

export function registerPhaseTool<P extends TSchema, D>(
	pi: ExtensionAPI,
	session: ReviewSession,
	spec: ToolSpec<P, D>,
) {
	pi.registerTool({
		name: spec.name,
		label: spec.label,
		description: spec.description,
		parameters: spec.parameters,
		defaultActive: false,
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			session.ctx = ctx;
			const why = gate(session.state, spec.phase);
			if (why) throw new Error(why);
			const out = await spec.run(params, session.state as OpenState, ctx, signal);
			return {
				content: [{ type: "text", text: out.text }],
				details: out.details,
				...(out.isError ? { isError: true } : {}),
			};
		},
		renderCall(args, theme) {
			return new Lines(() => [title(theme, spec.label, spec.call((args ?? {}) as Partial<Static<P>>))]);
		},
		renderResult(result, options, theme, context) {
			if (options.isPartial) return new Lines(() => [theme.fg("warning", "◉ waiting for you…")]);
			if (context.isError || !result.details) return errorLines(theme, result);
			const hint = context.keyHint("app.tools.expand", "to expand");
			return new Lines((w) => spec.result(result.details as D, theme, w, { expanded: options.expanded, hint }));
		},
	});
}

/** Labels of the refs that match no hunk. */
export function unknownRefs(state: ReviewState, refs: readonly Ref[]): string[] {
	return refs.filter((r) => findHunks(state.hunks, r).length === 0).map(refLabel);
}

/** A list cut to `max` entries unless expanded. */
export function cap<T>(items: readonly T[], expanded: boolean, max = 8): { shown: readonly T[]; hidden: number } {
	const shown = expanded ? items : items.slice(0, max);
	return { shown, hidden: items.length - shown.length };
}
