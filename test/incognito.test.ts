import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, lstatSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, PRIVATE } from "./harness.ts";
import { initializePrivate, isPrivate, privatePath } from "../src/storage.ts";

function scan(dir: string): string[] {
	return readdirSync(dir).flatMap(name => {
		const path = join(dir, name), stat = lstatSync(path);
		if (stat.isSymbolicLink()) return [];
		if (stat.isDirectory()) return scan(path);
		return readFileSync(path).includes(PRIVATE) ? [path] : [];
	});
}
const links = (dir: string) => readdirSync(dir).filter(name => lstatSync(join(dir, name)).isSymbolicLink());

test("saved session: public file never touched; private writes vanish; guards; reload; off returns", async t => {
	const h = await harness(t);
	await h.runtime.session.prompt("public before");
	const file = h.runtime.session.sessionFile!;
	const before = readFileSync(file);
	await h.command();
	const sm = h.runtime.session.sessionManager;
	assert.ok(isPrivate(sm.getSessionFile()));
	assert.ok(!readdirSync(h.dir).some(name => name.startsWith(".incognito-public-")));
	assert.notEqual(sm.getSessionFile(), file);
	assert.equal(h.statuses.at(-1), "👻");
	assert.match(h.notifications.at(-1)!, /Incognito on/);
	assert.ok(JSON.stringify(sm.getEntries()).includes("public before"));
	await h.runtime.session.prompt(PRIVATE);
	sm.appendCustomEntry("private", { marker: PRIVATE });
	const user = sm.getBranch().find(entry => entry.type === "message" && entry.message.role === "user")!;
	sm.appendCompaction(PRIVATE, user.id, 100);
	(sm as any)._rewriteFile();
	assert.deepEqual(scan(h.dir), []);
	assert.deepEqual(readFileSync(file), before);
	for (const position of ["before", "at"] as const) {
		assert.deepEqual(await h.runtime.fork(sm.getLeafId()!, { position }), { cancelled: true });
	}
	assert.deepEqual(await h.runtime.newSession(), { cancelled: true });
	assert.deepEqual(await h.runtime.switchSession(file), { cancelled: true });
	await h.runtime.session.reload();
	assert.equal(h.statuses.at(-1), "👻");
	await h.command("status");
	assert.ok(isPrivate(h.runtime.session.sessionFile));
	await h.command();
	assert.equal(h.runtime.session.sessionFile, file);
	assert.equal(h.statuses.at(-1), undefined);
	assert.match(h.notifications.at(-1)!, /Incognito off/);
	assert.deepEqual(readFileSync(file), before);
	assert.ok(!JSON.stringify(h.runtime.session.sessionManager.getEntries()).includes(PRIVATE));
	assert.deepEqual(links(h.dir), []); // Late shutdown append went to the link before removal.
	await h.runtime.session.prompt("public after");
	assert.ok(readFileSync(file, "utf8").includes("public after"));
	assert.deepEqual(scan(h.dir), []);
	assert.deepEqual(h.errors, []);
});

test("blank session: first prompt can be private; off leaves no files at all", async t => {
	const h = await harness(t);
	const file = h.runtime.session.sessionFile!;
	await h.command();
	assert.ok(isPrivate(h.runtime.session.sessionFile));
	await h.runtime.session.prompt(PRIVATE);
	await h.command();
	assert.equal(h.runtime.session.sessionFile, file);
	assert.equal(h.runtime.session.sessionManager.getEntries().filter(e => e.type === "message").length, 0);
	assert.deepEqual(links(h.dir), []);
	assert.ok(!existsSync(file));
	await h.runtime.session.prompt("first public message");
	assert.ok(readFileSync(file, "utf8").includes("first public message"));
	assert.deepEqual(scan(h.dir), []);
	assert.deepEqual(h.errors, []);
});

test("cancelled toggles never pretend to succeed", async t => {
	const h = await harness(t);
	await h.runtime.session.prompt("public");
	const file = h.runtime.session.sessionFile!;
	h.setCancel("new");
	await h.command();
	assert.equal(h.runtime.session.sessionFile, file);
	h.setCancel(undefined);
	await h.command();
	h.setCancel("resume");
	await h.command();
	assert.ok(isPrivate(h.runtime.session.sessionFile));
	assert.match(h.notifications.at(-1)!, /remains on/);
	assert.deepEqual(h.errors, []);
});

test("next start sweeps links left by dead processes and keeps live ones", async t => {
	const h = await harness(t);
	await h.runtime.session.prompt("public");
	await h.command();
	const live = h.runtime.session.sessionFile!;
	const dead = privatePath(join(h.dir, "public.jsonl")).replace(/incognito-\d+-/, "incognito-999999-");
	if (process.platform === "win32") initializePrivate(dead, [{ public: true }], () => {}, h.dir);
	else (await import("node:fs")).symlinkSync("/dev/null", dead);
	assert.ok(isPrivate(dead));
	const staleCopy = join(h.dir, ".incognito-public-999999-orphan");
	const liveCopy = join(h.dir, `.incognito-public-${process.pid}-live`);
	for (const dir of [staleCopy, liveCopy]) {
		mkdirSync(dir);
		writeFileSync(join(dir, "public.jsonl"), "public only");
	}
	await h.runtime.session.reload();
	assert.ok(isPrivate(live));
	assert.ok(!isPrivate(dead));
	assert.ok(!existsSync(staleCopy));
	assert.ok(existsSync(liveCopy));
});
