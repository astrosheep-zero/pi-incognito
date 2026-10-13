import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkPrivate, writePublicCopy, type SweepOptions } from "./common.ts";

const DEVICE_NAME = /^\\\\\?\\GLOBALROOT\\\?\?\\(pi-incognito-\d+-[0-9a-f]{8})$/i;

function device(action: string, args: string[] = []): void {
	const script = fileURLToPath(new URL("./windows-device.ps1", import.meta.url));
	const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", action, ...args], { encoding: "utf8", windowsHide: true });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.trim() || `Windows device operation failed (${result.status}).`);
}

export function privatePath(_publicFile: string, token: string): string {
	return `\\\\?\\GLOBALROOT\\??\\pi-incognito-${token}`;
}

export function isPrivate(file: string | undefined): boolean {
	return checkPrivate(file, file => DEVICE_NAME.test(file) && statSync(file).isCharacterDevice());
}

export function initializePrivate(target: string, entries: unknown[], load: (path: string) => void, sessionDir: string): void {
	const name = DEVICE_NAME.exec(target)?.[1];
	if (!name) throw new Error("Invalid Windows incognito path.");
	const directory = mkdtempSync(join(sessionDir, `.incognito-public-${process.pid}-`));
	const copy = join(directory, "public.jsonl");
	try {
		writePublicCopy(copy, entries);
		device("map", ["-Name", name, "-File", copy]);
		load(target);
		device("redirect", ["-Name", name, "-File", copy]);
		if (!isPrivate(target)) throw new Error("Windows null-device verification failed.");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

export function sweep(_dir: string, options: SweepOptions): void {
	device("sweep", ["-OwnerPid", String(options.ownDisposed ? process.pid : 0), "-Keep", DEVICE_NAME.exec(options.keep ?? "")?.[1] ?? "none"]);
}
