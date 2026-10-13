// Run on a real Windows host; reports candidates without assuming Win32 path semantics.
import { appendFileSync, lstatSync, mkdtempSync, openSync, closeSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'win32') throw new Error('Windows probe requires Windows');
const dir = mkdtempSync(join(tmpdir(), 'pi-windows-null-'));
const candidates = ['NUL', '\\\\.\\NUL', '\\\\?\\NUL', '\\\\?\\GLOBALROOT\\Device\\Null', '\\Device\\Null', '\\??\\NUL', '\\GLOBAL??\\NUL', join(dir, 'NUL')];
const rows = [];
const step = (row, name, action) => {
  try { row[name] = { ok: true, value: action() }; }
  catch (error) { row[name] = { ok: false, code: error.code, message: error.message }; }
};
try {
  for (let i = 0; i < candidates.length; i++) {
    const target = candidates[i];
    const file = join(dir, `private-${i}.jsonl`), temporary = file + '.link';
    const row = { target };
    writeFileSync(file, 'public\n');
    step(row, 'create', () => { symlinkSync(target, temporary, 'file'); return readlinkSync(temporary); });
    if (!row.create.ok) { rows.push(row); continue; }
    step(row, 'rename', () => { renameSync(temporary, file); return lstatSync(file).isSymbolicLink(); });
    if (!row.rename.ok) { rows.push(row); continue; }
    step(row, 'read', () => readFileSync(file, 'utf8'));
    step(row, 'stat', () => { const st = statSync(file); return { size: st.size, character: st.isCharacterDevice(), file: st.isFile() }; });
    step(row, 'append', () => { appendFileSync(file, 'PRIVATE_WINDOWS_MARKER\n'); return readFileSync(file, 'utf8'); });
    step(row, 'rewrite', () => { writeFileSync(file, 'PRIVATE_WINDOWS_REWRITE\n'); return readFileSync(file, 'utf8'); });
    step(row, 'wx', () => { const fd = openSync(file, 'wx'); closeSync(fd); return 'opened'; });
    step(row, 'readlinkAfter', () => readlinkSync(file));
    rows.push(row);
  }
  const direct = [];
  for (const path of ['NUL', '\\\\.\\NUL', '\\\\?\\GLOBALROOT\\Device\\Null', join(dir, 'NUL.foo'), join(dir, 'NUL')]) {
    const row = { path };
    step(row, 'read', () => readFileSync(path, 'utf8'));
    step(row, 'append', () => { appendFileSync(path, 'DIRECT_PRIVATE_MARKER'); return readFileSync(path, 'utf8'); });
    step(row, 'rewrite', () => { writeFileSync(path, 'DIRECT_PRIVATE_REWRITE'); return readFileSync(path, 'utf8'); });
    step(row, 'stat', () => { const st = statSync(path); return { size: st.size, character: st.isCharacterDevice(), file: st.isFile() }; });
    direct.push(row);
  }
  console.log(JSON.stringify({ platform: process.platform, node: process.version, rows, direct, regularFiles: readdirSync(dir).filter(name => lstatSync(join(dir, name)).isFile()) }, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
