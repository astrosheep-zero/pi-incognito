import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { win32 } from 'node:path';
const device = process.env.PI_DEVICE_PATH;
const candidates = device.endsWith(':') ? [`${device}\\public.jsonl`, `\\\\.\\${device}`, `\\\\?\\GLOBALROOT\\??\\${device}`] : [`\\\\.\\${device}\\public.jsonl`, `\\\\.\\${device}`, `\\\\?\\GLOBALROOT\\??\\${device}`, `\\\\?\\GLOBALROOT\\??\\${device}\\public.jsonl`];
const rows = [];
for (const file of candidates) {
  const row = { file, resolved: win32.resolve(file) };
  for (const [key, action] of Object.entries({
    read: () => readFileSync(file, 'utf8'),
    append: () => { appendFileSync(file, 'PRIVATE_DOS_DEVICE_MARKER'); return readFileSync(file, 'utf8'); },
    rewrite: () => { writeFileSync(file, 'PRIVATE_DOS_DEVICE_REWRITE'); return readFileSync(file, 'utf8'); },
    stat: () => { const st = statSync(file); return { size: st.size, character: st.isCharacterDevice() }; },
  })) {
    try { row[key] = { ok: true, value: action() }; }
    catch (error) { row[key] = { ok: false, code: error.code, message: error.message }; }
  }
  rows.push(row);
}
console.log(JSON.stringify({ device, phase: process.env.PI_DEVICE_PHASE, rows }, null, 2));
