// Applies the Australian SNOMED CT-AU derived brand names to the criteria files.
// Reads two files from the board (pack\snomed\): SNOMED_ADD_BRANDS.json and SNOMED_NAME_FIXES.json.
// It only ever ADDS (and, for the five hand mends Claude ordered on 19 November, moves or respells
// one listed brand). Nothing else is touched. Safe to run again and again: every change checks
// first whether it is already there. Plain names only: no identifier, no SNOMED full name.
//
// Run: node tools\apply-snomed.mjs          (from the repository root)
// Additions need no rescoring: no history loses a name.
// Importing this file writes nothing. The criteria change only when the file is run on its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const DIR = process.env.SNOMED_DIR || path.resolve(REPO, '..', 'ClinicaLANTERN-AgentHub', 'fireup', 'pack', 'snomed');

const lower = s => String(s).toLowerCase();
const hasName = (list, name) => Array.isArray(list) && list.some(x => lower(x) === lower(name));
const isObject = v => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------- the five hand mends of 19 November (Claude, from SNOMED_BRANDS_FOR_RULING.json) ----------

const MENDS = [
  { brand: 'Dithiazide', from: 'diltiazem', to: 'hydrochlorothiazide', criteria: ['OPTIMISE-T2-07'], kind: 'move' },
  { brand: 'Nurofen Caplets', to: 'Nurofen Caplet', criteria: ['POPI-04'], kind: 'respell' },
  { brand: 'Risperdal Quicklets', to: 'Risperdal Quicklet', criteria: ['EU7-F65'], kind: 'respell' },
  { brand: 'Snuzaid Tabs', to: 'Snuzaid Tab', criteria: ['STOPP-D14', 'STOPP-D24', 'STOPP-D25'], kind: 'respell' }
];

export function applySnomed(repo, dir) {
  const readJson = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, ''));
  const stats = { addBrands: { criteria: 0, added: 0, present: 0, noGroup: 0 }, nameFixes: { criteria: 0, added: 0, present: 0 }, mends: { done: 0, present: 0 } };

  function loadCriterion(id) {
    const file = path.join(repo, 'criteria', id, 'criterion.json');
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8');
    return { file, text, json: JSON.parse(text) };
  }

  function saveCriterion(c) {
    // Keep the file's own line ends: some criterion files are CRLF (the sign-off byte guard cares).
    let text = JSON.stringify(c.json, null, 2) + '\n';
    if (c.text.includes('\r\n')) text = text.replace(/\n/g, '\r\n');
    if (text === c.text) return false;
    fs.writeFileSync(c.file, text);
    return true;
  }

  function groupOf(c, ref) {
    const groups = Array.isArray(c.json.medicine_groups) ? c.json.medicine_groups : [];
    if (typeof ref === 'number' && Number.isInteger(ref)) return groups[ref - 1] ?? null;   // the file numbers from 1
    if (typeof ref === 'string') return groups.find(g => lower(g.name) === lower(ref)) ?? null;
    return null;
  }

  function applyAddBrands() {
    const data = readJson('SNOMED_ADD_BRANDS.json');
    const byId = data.criteria ?? {};
    for (const [id, rows] of Object.entries(byId)) {
      const c = loadCriterion(id);
      if (!c) { console.log(`no file for ${id} (add brands)`); continue; }
      let changed = false;
      for (const row of Array.isArray(rows) ? rows : []) {
        const g = groupOf(c, row.group);
        if (!g) { stats.addBrands.noGroup++; console.log(`${id}: group ${JSON.stringify(row.group)} not found`); continue; }
        if (!isObject(g.brands)) g.brands = {};
        const key = Object.keys(g.brands).find(k => lower(k) === lower(row.ingredient));
        const target = key ?? row.ingredient;
        if (!key) { g.brands[target] = []; changed = true; }
        if (!Array.isArray(g.brands[target])) g.brands[target] = [];
        for (const brand of row.add ?? []) {
          if (hasName(g.brands[target], brand)) { stats.addBrands.present++; continue; }
          g.brands[target].push(brand);
          stats.addBrands.added++;
          changed = true;
        }
      }
      if (changed) { saveCriterion(c); stats.addBrands.criteria++; }
    }
  }

  function applyNameFixes() {
    const data = readJson('SNOMED_NAME_FIXES.json');
    for (const row of data.names ?? []) {
      if (row.action !== 'ADD_NAME') continue;
      for (const id of row.criteria ?? []) {
        const c = loadCriterion(id);
        if (!c) { console.log(`no file for ${id} (name fix)`); continue; }
        let changed = false;
        for (const g of Array.isArray(c.json.medicine_groups) ? c.json.medicine_groups : []) {
          if (!Array.isArray(g.ingredients) || !hasName(g.ingredients, row.listed_name)) continue;
          if (hasName(g.ingredients, row.australian_name)) { stats.nameFixes.present++; continue; }
          g.ingredients.push(row.australian_name);
          if (isObject(g.brands) && hasName(Object.keys(g.brands), row.listed_name)) {
            const key = Object.keys(g.brands).find(k => lower(k) === lower(row.listed_name));
            g.brands[row.australian_name] = Array.isArray(g.brands[key]) ? [...g.brands[key]] : [];
          }
          stats.nameFixes.added++;
          changed = true;
        }
        if (changed) { saveCriterion(c); stats.nameFixes.criteria++; }
      }
    }
  }

  function applyMends() {
    for (const mend of MENDS) {
      for (const id of mend.criteria) {
        const c = loadCriterion(id);
        if (!c) { console.log(`no file for ${id} (mend)`); continue; }
        let changed = false;
        for (const g of Array.isArray(c.json.medicine_groups) ? c.json.medicine_groups : []) {
          if (!isObject(g.brands)) continue;
          for (const key of Object.keys(g.brands)) {
            if (!Array.isArray(g.brands[key])) continue;
            if (mend.kind === 'move' && lower(key) === lower(mend.to)) continue;   // it already lives there
            const at = g.brands[key].findIndex(x => lower(x) === lower(mend.brand));
            if (at === -1) continue;
            if (mend.kind === 'respell') {
              if (!hasName(g.brands[key], mend.to)) g.brands[key][at] = mend.to;
              else g.brands[key].splice(at, 1);
              stats.mends.done++;
              changed = true;
            } else if (mend.kind === 'move') {
              g.brands[key].splice(at, 1);
              const toKey = Object.keys(g.brands).find(k => lower(k) === lower(mend.to)) ?? mend.to;
              if (!Array.isArray(g.brands[toKey])) g.brands[toKey] = [];
              if (!hasName(g.brands[toKey], mend.brand)) g.brands[toKey].push(mend.brand);
              stats.mends.done++;
              changed = true;
            }
          }
        }
        if (changed) { saveCriterion(c); }
        else stats.mends.present++;
      }
    }
  }

  applyAddBrands();
  applyNameFixes();
  applyMends();
  console.log(JSON.stringify(stats, null, 1));
  return stats;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) applySnomed(REPO, DIR);
