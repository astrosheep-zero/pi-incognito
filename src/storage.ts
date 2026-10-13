import { lstatSync, readdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// Private sessions live beside the public one as `<name>.incognito-<pid>.jsonl`,
// linked to /dev/null. The public file is never modified.
const PRIVATE_NAME = /\.incognito-(\d+)-[0-9a-f]{8}\.jsonl$/;

export function privatePath(publicFile: string): string {
	const name = basename(publicFile).replace(/\.jsonl$/, "");
	return join(dirname(publicFile), `${name}.incognito-${process.pid}-${randomUUID().slice(0, 8)}.jsonl`);
}

export function isPrivate(file: string | undefined): boolean {
	if (!file || !PRIVATE_NAME.test(file)) return false;
	try {
		return lstatSync(file).isSymbolicLink() && readlinkSync(file) === "/dev/null";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

/** Write public entries so Pi can load them, then atomically replace the file with the null link. */
export function writePublicCopy(file: string, entries: unknown[]): void {
	if (process.platform === "win32") throw new Error("Incognito requires a Unix /dev/null device.");
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
