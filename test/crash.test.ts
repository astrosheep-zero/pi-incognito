import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readdirSync, readFileSync, lstatSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


for (const mode of ["normal", "SIGKILL"] as const) {
	test(`real process ${mode}: public prefix survives and private writes do not`, { timeout: 20_000 }, async () => {
		const dir = mkdtempSync(join(tmpdir(), "pi-incognito-exit-"));
		const program = `
			import assert from "node:assert/strict";
			import { readFileSync } from "node:fs";
			import { harness, PRIVATE } from ${JSON.stringify(new URL("./harness.ts", import.meta.url).href)};
						const h = await harness({ after() {} }, ${JSON.stringify(dir)});
			await h.runtime.session.prompt("public prefix");
			const file = h.runtime.session.sessionFile;
			const before = readFileSync(file, "utf8");
			await h.command();
			await h.runtime.session.prompt(PRIVATE);
			await h.runtime.session.reload();
			h.runtime.session.sessionManager._rewriteFile();
			if (${JSON.stringify(mode)} === "normal") await h.runtime.dispose(); // late shutdown append runs here
			assert.deepEqual(h.errors, []);
			process.send({ file, before, marker: PRIVATE }, () => {
				if (${JSON.stringify(mode)} === "normal") process.exit(0);
				else setInterval(() => {}, 1000);
			});
		`;
		const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", program], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
		const exited = once(child, "exit");
		try {
			const [{ file, before, marker }] = await Promise.race([
				once(child, "message"),
				exited.then(([code]) => { throw new Error(`Child exited before ready: ${code}`); }),
			]);
			if (mode === "SIGKILL") child.kill("SIGKILL");
			const [code, signal] = await exited;
			if (mode === "normal") {
				assert.equal(code, 0);
				assert.deepEqual(readdirSync(dir).filter(n => lstatSync(join(dir, n)).isSymbolicLink()), []);
			} else {
				assert.equal(signal, "SIGKILL");
			}
			// The public file is never modified, in either case.
			assert.equal(readFileSync(file, "utf8"), before);
			assert.ok(!existsSync(file + ".pre-incognito"));
			for (const name of readdirSync(dir)) {
				const path = join(dir, name);
				if (lstatSync(path).isFile()) assert.ok(!readFileSync(path).includes(marker));
			}
		} finally {
			if (child.exitCode === null && child.signalCode === null) {
				child.kill("SIGKILL");
				await exited;
			}
			rmSync(dir, { recursive: true, force: true });
		}
	});
}
