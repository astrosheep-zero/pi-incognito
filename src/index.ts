import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { initializePrivate, isPrivate, privatePath, sweep } from "./storage.ts";

const STATE = "pi-incognito";
function publicPath(ctx: ExtensionContext): string {
	const entry = ctx.sessionManager.getEntries().findLast(entry => entry.type === "custom" && entry.customType === STATE);
	const file = entry?.type === "custom" ? (entry.data as { publicFile?: string } | undefined)?.publicFile : undefined;
	if (!file) throw new Error("Incognito return path is missing.");
	return file;
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
			for (const dir of dirs) sweep(dir, { ownDisposed: true });
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
		const dir = ctx.sessionManager.getSessionDir();
		if (dir) {
			dirs.add(dir);
			// Leftovers from crashed processes are empty links; the public file was never touched.
			sweep(dir, { keep: ctx.sessionManager.getSessionFile() });
		}
		updateStatus(ctx);
	});
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
			if (busy || !ctx.isIdle()) {
				ctx.ui.notify("Wait until the agent is idle before toggling incognito.", "warning");
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
				if (active(ctx)) {
					// The fresh runtime reopens the untouched public file; the private manager is discarded.
					const result = await ctx.switchSession(publicPath(ctx), {
						withSession: async (fresh) => {
							// The private manager is disposed; its link is now safe to remove.
							sweep(dirname(file), { ownDisposed: true });
							updateStatus(fresh);
							fresh.ui.notify("Incognito off. Private messages were discarded.", "info");
						},
					});
					if (result.cancelled) ctx.ui.notify("Incognito remains on: exit cancelled.", "warning");
					return;
				}
				// Load the unchanged public entries through the private path, then redirect
				// that path to the null device. No entry replay or private SDK state changes.
				const entries = [ctx.sessionManager.getHeader(), ...ctx.sessionManager.getEntries()];
				const leaf = ctx.sessionManager.getLeafId();
				const target = privatePath(file);
				let failure: string | undefined;
				const result = await ctx.newSession({
					setup: async (manager) => {
						try {
							initializePrivate(target, entries, path => manager.setSessionFile(path));
							if (leaf) manager.branch(leaf);
							else manager.resetLeaf();
							manager.appendCustomEntry(STATE, { publicFile: file });
						} catch (error) {
							// Stay a PUBLIC session on initialization failure; never leave a
							// regular-file shadow active while implying privacy is enabled.
							manager.setSessionFile(file);
							failure = String(error);
							sweep(dirname(file), { ownDisposed: true });
						}
					},
					withSession: async (fresh) => {
						dirs.add(dirname(file));
						updateStatus(fresh);
						fresh.ui.notify(failure ? `Incognito was not enabled: ${failure}` : "Incognito on. New messages will not be saved.", failure ? "error" : "info");
					},
				});
				if (result.cancelled) ctx.ui.notify("Incognito was not enabled: session switch cancelled.", "warning");
			} catch (error) {
				ctx.ui.notify(`Incognito toggle failed: ${String(error)}`, "error");
			} finally {
				allowSwitch = false;
				busy = false;
			}
		},
	});
}
