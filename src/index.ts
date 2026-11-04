import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommands } from "./commands.ts";
import { ReviewSession } from "./session.ts";
import { registerAcMatrixTool } from "./tools/ac-matrix.ts";
import { registerCommentTool } from "./tools/comment.ts";
import { registerDiagramTool } from "./tools/diagram.ts";
import { registerInterfacesTool } from "./tools/interfaces.ts";
import { registerSubmitTool } from "./tools/submit.ts";
import { registerTriageTool } from "./tools/triage.ts";
import { registerWalkthroughTool } from "./tools/walkthrough.ts";
import { registerWhyTool } from "./tools/why.ts";

export default function prReviewExtension(pi: ExtensionAPI): void {
	const session = new ReviewSession(pi);
	for (const register of [
		registerTriageTool,
		registerWhyTool,
		registerAcMatrixTool,
		registerInterfacesTool,
		registerDiagramTool,
		registerWalkthroughTool,
		registerCommentTool,
		registerSubmitTool,
	])
		register(pi, session);
	registerCommands(pi, session);

	pi.on("session_start", async (_event, ctx) => session.load(ctx));
	pi.on("session_tree", async (_event, ctx) => session.load(ctx));
	pi.on("session_shutdown", async () => {
		session.ctx = undefined;
	});
}
