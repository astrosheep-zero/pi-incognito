import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { blackHole, isPrivate, privatePath, sweep, writePublicCopy } from "./storage.ts";

const publicPath = (file: string) => file.replace(/\.incognito-\d+-[0-9a-f]{8}\.jsonl$/, ".jsonl");

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
					const result = await ctx.switchSession(publicPath(file), {
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
				// Copy the public history into a private session whose file is a /dev/null link.
				const entries = [ctx.sessionManager.getHeader(), ...ctx.sessionManager.getEntries()];
				const target = privatePath(file);
				const result = await ctx.newSession({
					setup: async (manager) => {
						writePublicCopy(target, entries);
						manager.setSessionFile(target);
						blackHole(target);
					},
					withSession: async (fresh) => {
						dirs.add(dirname(target));
						updateStatus(fresh);
						fresh.ui.notify("Incognito on. New messages will not be saved.", "info");
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
