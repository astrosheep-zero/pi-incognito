import { lstatSync, mkdtempSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

// Unix: private null-device link. Windows: a logon-scoped DOS-device alias.
const PRIVATE_NAME = /\.incognito-(\d+)-[0-9a-f]{8}\.jsonl$/;
const DEVICE_NAME = /^\\\\\?\\GLOBALROOT\\\?\?\\(pi-incognito-\d+-[0-9a-f]{8})$/i;

function device(action: string, args: string[] = []): void {
	const script = fileURLToPath(new URL("./windows-device.ps1", import.meta.url));
	const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Action", action, ...args], { encoding: "utf8", windowsHide: true });
	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(result.stderr.trim() || `Windows device operation failed (${result.status}).`);
}

export function privatePath(publicFile: string): string {
	const id = randomUUID().slice(0, 8);
	if (process.platform === "win32") return `\\\\?\\GLOBALROOT\\??\\pi-incognito-${process.pid}-${id}`;
	const name = basename(publicFile).replace(/\.jsonl$/, "");
	return join(dirname(publicFile), `${name}.incognito-${process.pid}-${id}.jsonl`);
}

export function isPrivate(file: string | undefined): boolean {
	if (!file) return false;
	try {
		if (process.platform === "win32") return DEVICE_NAME.test(file) && statSync(file).isCharacterDevice();
		return PRIVATE_NAME.test(file) && lstatSync(file).isSymbolicLink() && readlinkSync(file) === "/dev/null";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** Write public entries so Pi can load them, then atomically replace the file with the null link. */
export function writePublicCopy(file: string, entries: unknown[]): void {
	writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
}

export function blackHole(file: string): void {
	const temporary = `${file}.${randomUUID()}.tmp`;
	symlinkSync("/dev/null", temporary);
	try {
		renameSync(temporary, file);
	} catch (error) {
		unlinkSync(temporary);
		throw error;
	}
}

/** Load public history, then redirect the SAME path before any private input can run. */
export function initializePrivate(target: string, entries: unknown[], load: (path: string) => void): void {
	if (process.platform !== "win32") {
		writePublicCopy(target, entries);
		load(target);
		blackHole(target);
		return;
	}
	const name = DEVICE_NAME.exec(target)?.[1];
	if (!name) throw new Error("Invalid Windows incognito path.");
	const directory = mkdtempSync(join(tmpdir(), "pi-incognito-public-"));
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

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Remove null links that no live manager can write. Never unlink a link still in use:
 * the next append would recreate it as a regular file containing private data.
 */
export function sweep(dir: string, options: { keep?: string; ownDisposed?: boolean } = {}): void {
	if (process.platform === "win32") {
		device("sweep", ["-OwnerPid", String(options.ownDisposed ? process.pid : 0), "-Keep", DEVICE_NAME.exec(options.keep ?? "")?.[1] ?? "none"]);
		return;
	}
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const match = PRIVATE_NAME.exec(name);
		const file = join(dir, name);
		if (!match || file === options.keep || !isPrivate(file)) continue;
		const pid = Number(match[1]);
		if (pid === process.pid ? options.ownDisposed : !alive(pid)) {
			try { unlinkSync(file); } catch {}
		}
	}
}
