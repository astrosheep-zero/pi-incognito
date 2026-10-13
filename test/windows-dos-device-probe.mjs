import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs';
const file = process.env.PI_DEVICE_PATH;
if (process.env.PI_DEVICE_PHASE === 'public') {
  assert.equal(readFileSync(file, 'utf8'), 'public prefix');
} else {
  assert.equal(readFileSync(file, 'utf8'), '');
  appendFileSync(file, 'PRIVATE_DOS_DEVICE_MARKER');
  assert.equal(readFileSync(file, 'utf8'), '');
  writeFileSync(file, 'PRIVATE_DOS_DEVICE_REWRITE');
  assert.equal(readFileSync(file, 'utf8'), '');
  assert.ok(statSync(file).isCharacterDevice());
}
console.log(JSON.stringify({ file, phase: process.env.PI_DEVICE_PHASE, size: statSync(file).size, character: statSync(file).isCharacterDevice() }));
