// Test-only provider: real CLI/model pipeline, no credentials or network requests.
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function offlineProvider(pi: ExtensionAPI): void {
	pi.registerProvider("incognito-smoke", {
		api: "incognito-smoke",
		baseUrl: "https://unused.invalid",
		apiKey: "offline-test-key",
		models: [{
			id: "offline", name: "Offline smoke test", reasoning: false, input: ["text"],
			contextWindow: 64000, maxTokens: 1024,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		}],
		streamSimple(model, context) {
			const stream = createAssistantMessageEventStream();
			const latest = context.messages.findLast(message => message.role === "user");
			const text = "offline reply: " + JSON.stringify(latest?.content);
			const message: AssistantMessage = {
				role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
				usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop", timestamp: Date.now(),
			};
			stream.push({ type: "start", partial: message });
			message.content.push({ type: "text", text: "" });
			stream.push({ type: "text_start", contentIndex: 0, partial: message });
			message.content[0] = { type: "text", text };
			stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
			stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
			stream.push({ type: "done", reason: "stop", message });
			stream.end();
			return stream;
		},
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (JSON.stringify(ctx.sessionManager.getEntries()).includes("PRIVATE_CLI_SMOKE_MARKER")) {
			pi.appendEntry("late-smoke-shutdown", { marker: "PRIVATE_CLI_SMOKE_MARKER" });
		}
	});
}
