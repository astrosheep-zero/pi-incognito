import { appendFileSync, lstatSync, readFileSync, readlinkSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.PI_RAW_NULL_DIR;
const rows = [];
for (const name of readdirSync(dir)) {
  const file = join(dir, name), row = { name };
  for (const [key, action] of Object.entries({
    readlink: () => readlinkSync(file),
    lstat: () => lstatSync(file).isSymbolicLink(),
    read: () => readFileSync(file, 'utf8'),
    append: () => { appendFileSync(file, 'PRIVATE_NATIVE_MARKER'); return readFileSync(file, 'utf8'); },
    rewrite: () => { writeFileSync(file, 'PRIVATE_NATIVE_REWRITE'); return readFileSync(file, 'utf8'); },
    stat: () => { const st = statSync(file); return { size: st.size, character: st.isCharacterDevice(), file: st.isFile() }; },
  })) {
    try { row[key] = { ok: true, value: action() }; }
    catch (error) { row[key] = { ok: false, code: error.code, message: error.message }; }
  }
  rows.push(row);
}
console.log(JSON.stringify(rows, null, 2));
