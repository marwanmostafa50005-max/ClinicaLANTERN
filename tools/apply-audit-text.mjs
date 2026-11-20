// Applies the audit's words-only field patches (BOARD\pack\audit\AUDIT_TEXT_PATCHES.json):
// { "id", "field", "whole_field", "why" }. The named field of the criterion file is replaced
// by whole_field. No rescoring is needed: no medicine list, rule or history changes here.
// Idempotent: run it again any time, including after adopting a wave (a wave overwrites the
// whole file and can lose a patch; rerun to put it back). Run: node tools\apply-audit-text.mjs
// Importing this file writes nothing. The criteria change only when the file is run on its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DIR = process.env.AUDIT_DIR || path.resolve(REPO, '..', 'ClinicaLANTERN-AgentHub', 'fireup', 'pack', 'audit');
const PATCH_FILE = path.join(DIR, 'AUDIT_TEXT_PATCHES.json');

export function applyAuditText(repo, patchFile) {
  const patches = JSON.parse(fs.readFileSync(patchFile, 'utf8').replace(/^\uFEFF/, ''));
  const rows = Array.isArray(patches) ? patches : patches.patches ?? [];
  const stats = { applied: 0, already: 0, noFile: 0, noField: 0 };

  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || typeof row.field !== 'string' || typeof row.whole_field !== 'string') continue;
    const file = path.join(repo, 'criteria', row.id, 'criterion.json');
    if (!fs.existsSync(file)) { stats.noFile++; console.log(`no file for ${row.id}`); continue; }
    const text = fs.readFileSync(file, 'utf8');
    const j = JSON.parse(text);
    if (!(row.field in j)) { stats.noField++; console.log(`${row.id}: no field ${row.field}`); continue; }
    if (j[row.field] === row.whole_field) { stats.already++; continue; }
    j[row.field] = row.whole_field;
    let out = JSON.stringify(j, null, 2) + '\n';
    if (text.includes('\r\n')) out = out.replace(/\n/g, '\r\n');
    fs.writeFileSync(file, out);
    stats.applied++;
    console.log(`${row.id}: ${row.field} patched (${String(row.why).slice(0, 80)}...)`);
  }
  console.log(JSON.stringify(stats));
  return stats;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) applyAuditText(REPO, PATCH_FILE);
