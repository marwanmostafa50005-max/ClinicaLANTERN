// K04 wave adoption helper. Copies criteria/<ID>/criterion.json and cases/<ID>/ from the
// highest-<r> wave folder that holds the ID, refreshes the answer sheet entries from the
// (repaired) expected.part.json, and adds fresh IDs to criteria/active.json further when
// they are not there. Hand-apply only: the adopt-wave tool skips criteria already in the repo.
//
// Use: node tools\k04-adopt.mjs --ids ID1,ID2 --waves W1,W2 --sheet cases/expected.further.json [--ten]
//   --waves are tried in order; the FIRST wave holding the ID wins, so list newest first.
//   --ten: the IDs belong to the first ten; the sheet named is the signed sheet and no
//          further-list change is made.
// Importing this file writes nothing and does not exit. The copy runs only when the file is run on its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const BOARD = process.env.BOARD || path.resolve(REPO, '..', 'ClinicaLANTERN-AgentHub', 'fireup');

export function adoptK04(repo, board, argv) {
  const arg = (name) => {
    const at = argv.indexOf('--' + name);
    return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : '';
  };
  const ids = arg('ids').split(',').map(s => s.trim()).filter(Boolean);
  const waves = arg('waves').split(',').map(s => s.trim()).filter(Boolean);
  const sheetPath = arg('sheet') || 'cases/expected.further.json';
  const isTen = argv.includes('--ten');
  if (!ids.length || !waves.length) { console.log('need --ids and --waves'); return 2; }

  function refresh(rel, idList) {
    const sheet = JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
    for (const id of idList) {
      const part = JSON.parse(fs.readFileSync(path.join(repo, 'cases', id, 'expected.part.json'), 'utf8'));
      const fresh = new Map(part.map((e) => [e.file, e]));
      const out = [];
      const seen = new Set();
      for (const c of sheet.cases) {
        if (fresh.has(c.file)) { out.push(fresh.get(c.file)); seen.add(c.file); }
        else out.push(c);
      }
      for (const [file, entry] of fresh) if (!seen.has(file)) out.push(entry);
      sheet.cases = out;
    }
    fs.writeFileSync(path.join(repo, rel), JSON.stringify(sheet, null, 2) + '\n');
    return sheet;
  }

  const used = [];
  for (const id of ids) {
    const wave = waves.find((w) => fs.existsSync(path.join(board, 'w/kimiwork/waves', w, 'criteria', id)));
    if (!wave) { console.log('NO WAVE FOR', id); return 1; }
    const base = path.join(board, 'w/kimiwork/waves', wave);
    const critDir = path.join(repo, 'criteria', id);
    fs.mkdirSync(critDir, { recursive: true });
    fs.copyFileSync(path.join(base, 'criteria', id, 'criterion.json'), path.join(critDir, 'criterion.json'));
    const casesDir = path.join(repo, 'cases', id);
    fs.mkdirSync(casesDir, { recursive: true });
    for (const f of fs.readdirSync(path.join(base, 'cases', id))) {
      fs.copyFileSync(path.join(base, 'cases', id, f), path.join(casesDir, f));
    }
    used.push(`${id}<-${wave}`);
  }

  const sheet = refresh(sheetPath, ids);

  if (!isTen) {
    const activePath = path.join(repo, 'criteria', 'active.json');
    const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
    let added = 0;
    for (const id of ids) {
      if (!active.further.includes(id)) { active.further.push(id); added++; }
    }
    if (added) fs.writeFileSync(activePath, JSON.stringify(active, null, 2) + '\n');
    console.log('fresh IDs added to further:', added);
  }

  let stale = 0;
  for (const id of ids) {
    const part = JSON.parse(fs.readFileSync(path.join(repo, 'cases', id, 'expected.part.json'), 'utf8'));
    for (const p of part) {
      const s = sheet.cases.find((c) => c.file === p.file);
      if (!s || JSON.stringify(s) !== JSON.stringify(p)) { console.log('STALE', p.file); stale++; }
    }
  }
  console.log(used.join(' '));
  console.log('sheet cases:', sheet.cases.length, '| stale:', stale);
  return 0;
}

const calledDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (calledDirectly) process.exit(adoptK04(REPO, BOARD, process.argv));
