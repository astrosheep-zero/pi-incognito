import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager, ModelRuntime, SettingsManager, createAgentSessionRuntime, createAgentSessionServices, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import incognito from "../src/index.ts";

export const PRIVATE = "PRIVATE_INCOGNITO_TEST_MARKER";

export async function harness(t: any, directory?: string) {
	const dir = directory ?? mkdtempSync(join(tmpdir(), "pi-incognito-test-"));
	const priorExitListeners = new Set(process.listeners("exit"));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: join(dir, "models.json"), modelsStorePath: join(dir, "models-store.json") });
	const model = modelRuntime.getModel("anthropic", "claude-sonnet-4-5")!;
	await modelRuntime.setRuntimeApiKey(model.provider, "dummy-offline-test-key");
	const errors: unknown[] = [], notifications: string[] = [];
	const statuses: (string | undefined)[] = [];
	let cancel: "new" | "resume" | undefined;
	const factory = async ({ cwd, sessionManager, sessionStartEvent }: any) => {
		const services = await createAgentSessionServices({ cwd, agentDir: dir, settingsManager, modelRuntime,
			resourceLoaderOptions: {
				noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true,
				agentsFilesOverride: () => ({ agentsFiles: [] }),
				extensionFactories: [incognito, pi => {
					pi.on("session_before_switch", event => event.reason === cancel ? { cancel: true } : undefined);
					pi.on("session_shutdown", (_event, ctx) => {
						if (JSON.stringify(ctx.sessionManager.getEntries()).includes(PRIVATE)) pi.appendEntry("late-shutdown", { marker: PRIVATE });
					});
				}],
			},
		});
		const result = await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model, tools: [] });
		// Only inference is synthetic; actual agent, persistence, extension and replacement pipelines run.
		result.session.agent.streamFunction = async () => {
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "done", reason: "stop", message: {
				role: "assistant", content: [{ type: "text", text: "reply" }], api: model.api, provider: model.provider, model: model.id,
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop", timestamp: Date.now(),
			} });
			stream.end(); return stream;
		};
		return { ...result, services, diagnostics: services.diagnostics };
	};
	let runtime = await createAgentSessionRuntime(factory, { cwd: dir, agentDir: dir, sessionManager: SessionManager.create(dir, dir) });
	const bind = async (session: typeof runtime.session) => {
		await session.bindExtensions({
			onError: error => errors.push(error),
			uiContext: {
				...session.extensionRunner.createCommandContext().ui,
				notify: message => { notifications.push(message); },
				setStatus: (key, value) => { if (key === "incognito") statuses.push(value); },
			},
			commandContextActions: {
				waitForIdle: async () => {},
				newSession: options => runtime.newSession(options),
				fork: (id, options) => runtime.fork(id, options),
				navigateTree: (id, options) => runtime.session.navigateTree(id, options),
				switchSession: (path, options) => runtime.switchSession(path, options),
				reload: () => runtime.session.reload(),
			},
		});
	};
	runtime.setRebindSession(bind);
	await bind(runtime.session);
	const command = async (args = "") => {
		const runner = runtime.session.extensionRunner;
		const command = runner.getRegisteredCommands().find(c => c.name === "incognito")!;
		const ctx = runner.createCommandContext();
		await command.handler(args, ctx);
	};
	t.after(async () => {
		await runtime.dispose();
		for (const listener of process.listeners("exit")) {
			if (!priorExitListeners.has(listener)) process.off("exit", listener);
		}
		rmSync(dir, { recursive: true, force: true });
	});
	return {
		dir, get runtime() { return runtime; }, errors, notifications, statuses, command,
		setCancel: (value: typeof cancel) => { cancel = value; },
		reopen: async (file: string) => {
			runtime = await createAgentSessionRuntime(factory, { cwd: dir, agentDir: dir, sessionManager: SessionManager.open(file) });
			runtime.setRebindSession(bind);
			await bind(runtime.session);
		},
	};
}

