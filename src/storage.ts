import { randomUUID } from "node:crypto";
import * as unix from "./storage/unix.ts";
import * as windows from "./storage/windows.ts";
import { sweepBootstrapCopies, type SweepOptions } from "./storage/common.ts";

// Select once; commands and lifecycle code never need platform branches.
const backend = process.platform === "win32" ? windows : unix;

export function privatePath(publicFile: string): string {
	return backend.privatePath(publicFile, `${process.pid}-${randomUUID().slice(0, 8)}`);
}

export const isPrivate = backend.isPrivate;
export const initializePrivate = backend.initializePrivate;

export function sweep(dir: string, options: SweepOptions = {}): void {
	backend.sweep(dir, options);
	sweepBootstrapCopies(dir, options);
}
