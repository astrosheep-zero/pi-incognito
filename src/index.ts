import { dirname } from "node:path";
import { writeSync } from "node:fs";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initializePrivate, isPrivate, privatePath, sweep } from "./storage.ts";

const STATE = "pi-incognito";
interface PrivateState {
	publicFile: string;
	publicLeaf?: string | null;
	model?: { provider: string; id: string };
	thinkingLevel?: ExtensionContext["thinkingLevel"];
	tools?: string[];
}
function privateState(ctx: ExtensionContext): PrivateState | undefined {
	const entry = ctx.sessionManager.getEntries().findLast(entry => entry.type === "custom" && entry.customType === STATE);
	return entry?.type === "custom" ? entry.data as PrivateState | undefined : undefined;
}
interface RestoreHook {
	selection(state: PrivateState): Promise<boolean>;
	tools(names: string[]): void;
}
// Runtime replacement reloads this module. Share only fresh-runtime callbacks, keyed
// by the actual manager, so withSession never calls the invalidated caller's pi.
const HOOKS = Symbol.for("pi-incognito.restore");
function restoreHooks(): WeakMap<object, RestoreHook> {
	const store = globalThis as { [HOOKS]?: WeakMap<object, RestoreHook> };
	return store[HOOKS] ??= new WeakMap();
}
function branch(manager: SessionManager, leaf: string | null): void {
	if (leaf) manager.branch(leaf);
	else manager.resetLeaf();
}

// One exit sweep per process, shared across /reload (which re-runs the factory).
const KEY = Symbol.for("pi-incognito.dirs");
function sessionDirs(): Set<string> {
	const store = globalThis as { [KEY]?: Set<string> };
	if (!store[KEY]) {
		const dirs = (store[KEY] = new Set());
		// Node's exit phase runs after Pi finishes every shutdown handler, so no manager can
		// write again. Unlinking earlier would let a late append recreate a regular file.
		process.once("exit", () => {
			for (const dir of dirs) {
				try { sweep(dir, { ownDisposed: true }); }
				catch { writeSync(2, "Incognito cleanup could not finish. Saved sessions remain intact.\n"); }
			}
		});
	}
	return store[KEY];
}

export default function incognito(pi: ExtensionAPI): void {
	let allowSwitch = false;
	let busy = false;
	const dirs = sessionDirs();
	const active = (ctx: ExtensionContext) => isPrivate(ctx.sessionManager.getSessionFile());
	const updateStatus = (ctx: ExtensionContext) => {
		ctx.ui.setStatus("incognito", active(ctx) ? "👻" : undefined);
	};
	const block = (ctx: ExtensionContext) => {
		ctx.ui.notify("Incognito: run /incognito before switching, forking, or cloning sessions.", "warning");
		return { cancel: true };
	};

	pi.on("session_start", (_event, ctx) => {
		restoreHooks().set(ctx.sessionManager, {
			selection: async state => {
				if (state.model) {
					const model = ctx.modelRegistry.find(state.model.provider, state.model.id);
					if (!model || !(await pi.setModel(model))) {
						ctx.ui.notify(`Incognito could not restore model ${state.model.provider}/${state.model.id}. Select a model before continuing.`, "error");
						return false;
					}
				}
				if (state.thinkingLevel !== undefined) pi.setThinkingLevel(state.thinkingLevel);
				if (state.tools) pi.setActiveTools(state.tools);
				return true;
			},
			tools: names => pi.setActiveTools(names),
		});
		const dir = ctx.sessionManager.getSessionDir();
		if (dir) {
			dirs.add(dir);
			// Reclaim dead-process links/aliases and public-only bootstrap copies.
			try { sweep(dir, { keep: ctx.sessionManager.getSessionFile() }); }
			catch { ctx.ui.notify("Incognito cleanup is unavailable. Saved sessions remain intact.", "warning"); }
		}
		updateStatus(ctx);
	});
	pi.on("session_shutdown", (_event, ctx) => { restoreHooks().delete(ctx.sessionManager); });
	pi.on("session_before_fork", (_event, ctx) => {
		if (active(ctx)) return block(ctx);
	});
	pi.on("session_before_switch", (_event, ctx) => {
		if (!active(ctx) || allowSwitch) return;
		return block(ctx);
	});
	pi.registerCommand("incognito", {
		description: "Toggle incognito and show its status",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Use /incognito without arguments to toggle incognito.", "warning");
				return;
			}
			if (busy || !ctx.isIdle() || ctx.hasPendingMessages()) {
				ctx.ui.notify("Wait until the agent is idle and queued messages are cleared before toggling incognito.", "warning");
				return;
			}
			const file = ctx.sessionManager.getSessionFile();
			if (!file) {
				ctx.ui.notify("This session is already memory-only.", "info");
				return;
			}
			busy = true;
			allowSwitch = true;
			try {
				const closing = active(ctx);
				const saved = closing ? privateState(ctx) : undefined;
				if (closing && !saved?.publicFile) throw new Error("Incognito return path is missing.");
				const publicFile = saved?.publicFile ?? file;
				// Only public history enters the replacement runtime, on either edge.
				const source = closing ? SessionManager.open(publicFile, dirname(publicFile)) : ctx.sessionManager;
				let leaf = source.getLeafId();
				if (closing && saved?.publicLeaf === null) leaf = null;
				else if (closing && saved?.publicLeaf && source.getEntry(saved.publicLeaf)) leaf = saved.publicLeaf;
				const entries = [source.getHeader(), ...source.getEntries()];
				const state: PrivateState = saved ? { ...saved, publicLeaf: leaf } : {
					publicFile, publicLeaf: leaf,
					model: ctx.model && { provider: ctx.model.provider, id: ctx.model.id },
					thinkingLevel: ctx.thinkingLevel,
					tools: pi.getActiveTools(),
				};
				// A marker from an older extension has only the return path.
				if (closing && !state.model && source instanceof SessionManager) {
					const context = source.buildSessionContext();
					if (context.model) state.model = { provider: context.model.provider, id: context.model.modelId };
					state.thinkingLevel ??= context.thinkingLevel as ExtensionContext["thinkingLevel"];
				}
				const dir = dirname(publicFile);
				const target = privatePath(publicFile);
				let destination!: SessionManager;
				let failure: string | undefined;
				const result = await ctx.newSession({
					setup: async manager => {
						destination = manager;
						try {
							initializePrivate(target, entries, path => manager.setSessionFile(path), dir);
							branch(manager, leaf);
							manager.appendCustomEntry(STATE, state);
						} catch (error) {
							// Never imply privacy while a failed bootstrap is a regular file.
							manager.setSessionFile(publicFile);
							branch(manager, leaf && manager.getEntry(leaf) ? leaf : null);
							failure = String(error);
							try { sweep(dir, { ownDisposed: true }); } catch { /* Public-only residue can be swept later. */ }
						}
					},
					withSession: async fresh => {
						dirs.add(dir);
						if (failure) {
							updateStatus(fresh);
							fresh.ui.notify(`${closing ? "Incognito off, but state restoration failed" : "Incognito was not enabled"}: ${failure}`, "error");
							return;
						}
						// All session_start handlers (including late tool registration) finished.
						const hook = restoreHooks().get(fresh.sessionManager);
						if (!hook || !(await hook.selection(state))) {
							fresh.ui.notify("Incognito remains on: selection restoration failed.", "error");
							return;
						}
						if (closing) {
							// Restore selection while writes still go to null. A hidden child
							// lets public tree navigation refresh the EXACT parent, even when
							// that parent is a user/custom-message entry or null. No replay or
							// private SDK access; the navigation marker never reaches disk.
							branch(destination, leaf);
							const marker = destination.appendCustomMessageEntry(STATE, "", false);
							destination.resetLeaf();
							const navigation = await fresh.navigateTree(marker);
							if (navigation.cancelled) {
								branch(destination, leaf);
								fresh.ui.notify("Incognito remains on: branch restoration cancelled.", "warning");
								return;
							}
							if (state.tools) hook.tools(state.tools);
							// Reopening drops all temporary restoration entries. The finalized
							// messages already match this branch, so no refresh API is needed.
							destination.setSessionFile(publicFile);
							branch(destination, leaf);
							try { sweep(dir, { ownDisposed: true }); }
							catch { fresh.ui.notify("Incognito cleanup could not finish. Saved sessions remain intact.", "warning"); }
						}
						updateStatus(fresh);
						fresh.ui.notify(closing ? "Incognito off. Private messages were discarded." : "Incognito on. New messages will not be saved.", "info");
					},
				});
				if (result.cancelled) ctx.ui.notify(closing ? "Incognito remains on: exit cancelled." : "Incognito was not enabled: session switch cancelled.", "warning");
			} finally {
				allowSwitch = false;
				busy = false;
			}
		},
	});
}
