// `pr_diagram`: a Unicode diagram of the changed parts, checked for alignment before the reviewer sees it.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	DIAGRAM_GUIDE,
	type Diagram,
	diagramMaxWidth,
	DiagramSchema,
	renderDiagram,
	validateDiagram,
} from "../diagram/index.ts";
import type { ReviewSession } from "../session.ts";
import { registerPhaseTool } from "./common.ts";

export function registerDiagramTool(pi: ExtensionAPI, session: ReviewSession): void {
	registerPhaseTool<typeof DiagramSchema, Diagram>(pi, session, {
		name: "pr_diagram",
		label: "pr diagram",
		phase: "walkthrough",
		description: `Phase 4. Show the reviewer a Unicode diagram of the parts this PR changes, before pr_walkthrough. Mark parts [new], [changed] or [removed]. It is checked for alignment first; when rejected, fix the findings and send it again.\n\n${DIAGRAM_GUIDE}`,
		parameters: DiagramSchema,
		async run(params) {
			const check = validateDiagram(params, { maxWidth: diagramMaxWidth() });
			if (!check.ok || !check.diagram) return { text: check.summary, details: params, isError: true };
			session.append({ type: "diagram", diagram: check.diagram });
			return { text: "The reviewer sees the diagram. Next: pr_walkthrough.", details: check.diagram };
		},
		call: (a) => (typeof a.title === "string" ? `"${a.title}"` : ""),
		result: (d, theme, width) => renderDiagram(d, width, theme),
	});
}
