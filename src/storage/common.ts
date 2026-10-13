import { lstatSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SweepOptions {
	keep?: string;
	ownDisposed?: boolean;
}

export function writePublicCopy(file: string, entries: unknown[]): void {
	writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
}

export function checkPrivate(file: string | undefined, check: (file: string) => boolean): boolean {
	if (!file) return false;
	try { return check(file); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}

export function canSweep(pid: number, options: SweepOptions): boolean {
	if (pid === process.pid) return options.ownDisposed === true;
	try { process.kill(pid, 0); return false; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "EPERM"; }
}

export function sessionFiles(dir: string): string[] {
	try { return readdirSync(dir); }
	catch { return []; }
}

export function sweepBootstrapCopies(dir: string, options: SweepOptions): void {
	for (const name of sessionFiles(dir)) {
		const match = /^\.incognito-public-(\d+)-/.exec(name);
		if (!match || !canSweep(Number(match[1]), options)) continue;
		const file = join(dir, name);
		if (lstatSync(file).isDirectory()) rmSync(file, { recursive: true, force: true });
	}
}
