import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { isPrivate, sweep } from "../src/storage.ts";

const PRIVATE = "PRIVATE_CLI_SMOKE_MARKER";
function clean(dir: string): void {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name), st = lstatSync(path);
		if (st.isSymbolicLink()) continue;
		if (st.isDirectory()) clean(path);
		else assert.ok(!readFileSync(path).includes(PRIVATE), `Private text leaked to ${path}`);
	}
}

test("real Pi CLI RPC smoke: blank toggle, reply, guards, saved toggle, shutdown and restart", { timeout: 90_000 }, async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-incognito-cli-"));
	const sessions = join(dir, "sessions");
	const client = new RpcClient({
		cliPath: fileURLToPath(new URL("./cli.js", import.meta.resolve("@earendil-works/pi-coding-agent"))),
		cwd: dir,
		env: { PI_CODING_AGENT_DIR: join(dir, "agent"), PI_OFFLINE: "1" },
		provider: "incognito-smoke", model: "offline",
		args: ["--no-extensions", "--no-skills", "--no-prompt-templates", "--session-dir", sessions,
			"-e", fileURLToPath(new URL("../src/index.ts", import.meta.url)),
			"-e", fileURLToPath(new URL("./offline-provider.ts", import.meta.url))],
	});
	try {
		await client.start();
		const original = (await client.getState()).sessionFile!;
		assert.ok(!existsSync(original));
		await client.prompt("/incognito");
		assert.ok(isPrivate((await client.getState()).sessionFile));
		await client.promptAndWait(PRIVATE);
		assert.match((await client.getLastAssistantText())!, /PRIVATE_CLI_SMOKE_MARKER/);
		assert.deepEqual(await client.clone(), { cancelled: true });
		const { entries } = await client.getEntries();
		const user = entries.find(entry => entry.type === "message" && entry.message.role === "user")!;
		assert.deepEqual(await client.fork(user.id), { cancelled: true });
		clean(dir);
		await client.prompt("/incognito");
		assert.equal((await client.getState()).sessionFile, original);
		assert.ok(!existsSync(original));
		await client.promptAndWait("PUBLIC_CLI_MESSAGE");
		const before = readFileSync(original);
		await client.prompt("/incognito");
		await client.promptAndWait(PRIVATE);
		assert.deepEqual(readFileSync(original), before);
		await client.prompt("/incognito");
		assert.deepEqual(readFileSync(original), before);
		assert.ok(!JSON.stringify(await client.getEntries()).includes(PRIVATE));
		// RpcClient.stop uses process termination. A new CLI startup cleans the
		// abandoned alias/link, without altering the discoverable public file.
		await client.prompt("/incognito");
		const abandoned = (await client.getState()).sessionFile!;
		await client.stop();
		await client.start();
		await client.getState();
		assert.ok(!isPrivate(abandoned));
		assert.deepEqual(readFileSync(original), before);
		clean(dir);
	} finally {
		await client.stop();
		sweep(sessions);
		rmSync(dir, { recursive: true, force: true });
	}
});
