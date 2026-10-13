import { lstatSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { canSweep, checkPrivate, sessionFiles, writePublicCopy, type SweepOptions } from "./common.ts";

const PRIVATE_NAME = /\.incognito-(\d+)-[0-9a-f]{8}\.jsonl$/;

export function privatePath(publicFile: string, token: string): string {
	const name = basename(publicFile).replace(/\.jsonl$/, "");
	return join(dirname(publicFile), `${name}.incognito-${token}.jsonl`);
}

export function isPrivate(file: string | undefined): boolean {
	return checkPrivate(file, file => PRIVATE_NAME.test(file) && lstatSync(file).isSymbolicLink() && readlinkSync(file) === "/dev/null");
}

export function initializePrivate(target: string, entries: unknown[], load: (path: string) => void, _sessionDir: string): void {
	writePublicCopy(target, entries);
	load(target);
	const temporary = `${target}.${randomUUID()}.tmp`;
	symlinkSync("/dev/null", temporary);
	try { renameSync(temporary, target); }
	catch (error) { unlinkSync(temporary); throw error; }
}

/** Never unlink while a manager can write: its next append would create a real file. */
export function sweep(dir: string, options: SweepOptions): void {
	for (const name of sessionFiles(dir)) {
		const match = PRIVATE_NAME.exec(name);
		const file = join(dir, name);
		if (!match || file === options.keep || !isPrivate(file) || !canSweep(Number(match[1]), options)) continue;
		try { unlinkSync(file); } catch {}
	}
}
