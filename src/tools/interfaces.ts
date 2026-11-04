// Phase 3: the changed public interfaces, types and dependencies. The reviewer judges each flagged item before
// the agent's view appears.
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import type { ReviewSession } from "../session.ts";
import { badge, wrap } from "../ui/draw.ts";
import { runPages } from "../ui/pages.ts";
import { registerPhaseTool, stringEnum } from "./common.ts";

const GROUPS = ["names", "boundaries", "dependencies"] as const;
type Group = (typeof GROUPS)[number];

const Params = Type.Object({
	items: Type.Array(
		Type.Object({
			group: stringEnum(
				GROUPS,
				"names: public names and types. boundaries: APIs, modules, layers. dependencies: packages and imports.",
			),
			name: Type.String({ description: 'What changed, e.g. "createUser → registerUser".' }),
			change: Type.String({ description: "What changed about it, a few plain words." }),
			question: Type.Optional(Type.String({ description: "Flag the item: the question the reviewer judges first." })),
			view: Type.Optional(
				Type.String({ description: "Your view on the question, shown after the reviewer answered." }),
			),
		}),
	),
});

const JUDGEMENTS = ["Looks fine", "I have a concern", "Not sure"] as const;

type Item = Static<typeof Params>["items"][number];

export interface InterfacesDetails {
	items: (Item & { answer?: { choice: number; note?: string } })[];
	outcome: "answered" | "closed";
}

const GROUP_LABEL: Record<Group, string> = { names: "Names", boundaries: "Boundaries", dependencies: "Dependencies" };

function itemLines(theme: Theme, item: InterfacesDetails["items"][number], width: number): string[] {
	const a = item.answer;
	const mark = !item.question
		? theme.fg("dim", "·")
		: !a
			? theme.fg("warning", "⚑")
			: a.choice === 0
				? theme.fg("success", "✓")
				: a.choice === 1
					? theme.fg("error", "✗")
					: theme.fg("warning", "?");
	const out = wrap(`  ${mark} ${theme.bold(item.name)}  ${theme.fg("muted", item.change)}`, width, 6);
	if (item.question && a) {
		out.push(
			...wrap(`      ${theme.fg("dim", "you:")} ${JUDGEMENTS[a.choice]}${a.note ? ` · ${a.note}` : ""}`, width, 6),
		);
		if (item.view) out.push(...wrap(`      ${theme.fg("dim", "agent:")} ${theme.fg("muted", item.view)}`, width, 6));
	}
	return out;
}

export function registerInterfacesTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool(pi, session, {
		name: "pr_interfaces",
		label: "pr interfaces",
		phase: "interfaces",
		description:
			"Phase 3. Show changed public interfaces, types and dependencies, grouped as names, boundaries and dependencies. Flag items with a question: the reviewer answers each before seeing your view.",
		parameters: Params,
		async run(params, _state, ctx, signal) {
			const details: InterfacesDetails = { items: params.items.map((i) => ({ ...i })), outcome: "closed" };
			const flagged = details.items.filter((i) => i.question);
			const answers = !flagged.length
				? []
				: await runPages(
						ctx,
						"Interfaces",
						(theme) =>
							flagged.map((item) => ({
								title: `${GROUP_LABEL[item.group]}: ${item.name}`,
								body: (w) => [
									badge(theme, "accent", GROUP_LABEL[item.group].toUpperCase()),
									"",
									...wrap(item.change, w),
								],
								question: item.question!,
								choices: [{ label: JUDGEMENTS[0] }, { label: JUDGEMENTS[1], note: true }, { label: JUDGEMENTS[2] }],
								reveal: (w) => wrap(theme.fg("muted", item.view ?? "No view given."), w - 2),
							})),
						signal,
					);
			if (!answers) return { text: "The reviewer closed this before answering every flagged item. Ask why.", details };
			flagged.forEach((item, i) => (item.answer = answers[i]!));
			details.outcome = "answered";
			session.append({ type: "interfaces" });
			const lines = flagged.map((item) => {
				const a = item.answer!;
				return `- ${item.name}: ${JUDGEMENTS[a.choice]}${a.note ? `: ${a.note}` : ""}`;
			});
			return {
				text: [
					flagged.length ? "The reviewer answered:" : "Nothing flagged.",
					...lines,
					"Draft comments for concerns with pr_comment. Next: pr_diagram, then pr_walkthrough.",
				].join("\n"),
				details,
			};
		},
		call: (a) =>
			Array.isArray(a.items) ? `${a.items.length} items · ${a.items.filter((i) => i?.question).length} flagged` : "",
		result(d, theme, width) {
			const out: string[] = [];
			for (const group of GROUPS) {
				const items = d.items.filter((i) => i.group === group);
				if (!items.length) continue;
				out.push(`${theme.fg("accent", theme.bold(GROUP_LABEL[group]))} ${theme.fg("dim", `(${items.length})`)}`);
				for (const item of items) out.push(...itemLines(theme, item, width));
			}
			if (d.outcome === "closed") out.push(theme.fg("dim", "■ closed before every flagged item was answered"));
			return out;
		},
	});
}
