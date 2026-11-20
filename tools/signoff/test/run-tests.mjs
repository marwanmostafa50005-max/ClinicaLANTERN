// Tests for the sign-off tool. Run:  node tools\signoff\test\run-tests.mjs
// They use a throwaway COPY of some criteria in the temp folder. The real folders are only read.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, startServer, runApply, freePort, removeFolder, REAL_REPO, TOOL } from './fixture.mjs';
import * as lib from '../lib.mjs';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(true);
    console.log('ok    ' + name);
  } catch (e) {
    results.push(false);
    console.log('FAIL  ' + name);
    console.log('      ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 30).join('\n      '));
  }
}

const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const REVIEWER = 'Zo\u00eb Test-Reviewer';

/** What a signed file must be, worked out a second way: the old bytes with only the two values swapped. */
function expectedSigned(buf, name, date) {
  const asBytes = s => Buffer.from(s, 'utf8').toString('latin1');
  const t = buf.toString('latin1');
  const a = t.replace('"draft": true', () => '"draft": false');
  assert.notEqual(a, t, 'the file had no "draft": true');
  const b = a.replace('"signed_by_clinical_reviewer": null', () => asBytes(`"signed_by_clinical_reviewer": { "name": ${JSON.stringify(name)}, "date": ${JSON.stringify(date)} }`));
  assert.notEqual(b, a, 'the file had no "signed_by_clinical_reviewer": null');
  return Buffer.from(b, 'latin1');
}

// ---------- A. the library on its own ----------

await check('A1 signature edit keeps every other byte (LF file)', () => {
  const buf = fs.readFileSync(path.join(REAL_REPO, 'criteria', 'STOPP-C10', 'criterion.json'));
  const out = lib.signedBytes(buf, 'A. Reviewer', '2026-11-19');
  assert.ok(out.equals(expectedSigned(buf, 'A. Reviewer', '2026-11-19')));
  assert.ok(!buf.toString('latin1').includes('\r\n'));
});

await check('A2 signature edit keeps CRLF line ends and writes a name with an accent as UTF-8', () => {
  const buf = Buffer.from('{\r\n  "id": "X",\r\n  "note": "caf\u00e9 \u2265 5",\r\n  "draft": true,\r\n  "signed_by_clinical_reviewer": null\r\n}\r\n', 'utf8');
  const out = lib.signedBytes(buf, REVIEWER, '2026-11-19');
  assert.ok(out.equals(expectedSigned(buf, REVIEWER, '2026-11-19')));
  const j = JSON.parse(out.toString('utf8'));
  assert.deepEqual(j, { id: 'X', note: 'caf\u00e9 \u2265 5', draft: false, signed_by_clinical_reviewer: { name: REVIEWER, date: '2026-11-19' } });
  assert.equal(out.toString('utf8').split('\r\n').length, 7);
});

await check('A3 signature edit adds the two fields when a file has neither', () => {
  const buf = Buffer.from('{\n  "id": "X",\n  "urgency": "routine"\n}\n', 'utf8');
  const out = lib.signedBytes(buf, 'A B', '2026-11-19').toString('utf8');
  assert.equal(out, '{\n  "id": "X",\n  "urgency": "routine",\n  "draft": false,\n  "signed_by_clinical_reviewer": { "name": "A B", "date": "2026-11-19" }\n}\n');
  const one = lib.signedBytes(Buffer.from('{"id":"X"}', 'utf8'), 'A B', '2026-11-19').toString('utf8');
  assert.deepEqual(JSON.parse(one), { id: 'X', draft: false, signed_by_clinical_reviewer: { name: 'A B', date: '2026-11-19' } });
  assert.ok(one.startsWith('{"id":"X"'));
});

await check('A4 signature edit touches only the top level, whatever the strings hold', () => {
  const text = '{"a":"x\\"}{ \\"draft\\": true","draft":true,"b":[1,{"draft":true,"signed_by_clinical_reviewer":null}],"signed_by_clinical_reviewer":null,"z":"}"}';
  const out = lib.signedBytes(Buffer.from(text, 'utf8'), 'A B', '2026-11-19').toString('utf8');
  assert.equal(out, '{"a":"x\\"}{ \\"draft\\": true","draft":false,"b":[1,{"draft":true,"signed_by_clinical_reviewer":null}],"signed_by_clinical_reviewer":{ "name": "A B", "date": "2026-11-19" },"z":"}"}');
});

await check('A5 signature edit keeps a byte order mark, and refuses a file it cannot edit safely', () => {
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{ "draft": true, "signed_by_clinical_reviewer": null }', 'utf8')]);
  const out = lib.signedBytes(bom, 'A B', '2026-11-19');
  assert.deepEqual([...out.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.throws(() => lib.signedBytes(Buffer.from('[1,2]', 'utf8'), 'A B', '2026-11-19'));
  assert.throws(() => lib.signedBytes(Buffer.from('{"draft":true,"draft":true}', 'utf8'), 'A B', '2026-11-19'));
  assert.throws(() => lib.signedBytes(Buffer.from('{"draft":true', 'utf8'), 'A B', '2026-11-19'));
});

await check('A6 wave notes are read in every way the drafters wrote them', () => {
  const ids = ['STOPP-B1', 'STOPP-B10', 'STOPP-C8', 'START-D3', 'BRISNIK-OP-INSO1', 'OPTIMISE-T3-08'];
  const text = [
    '# W999 wave notes', '', 'Shared doubts for all: the licence is proposed.',
    'STOPP-B1 | A | Digoxin title | Doubts: (1) first. (2) second.',
    '- STOPP-B10 | class B | Loop diuretic title | Check: brands from memory.',
    '- STOPP-C8, class B, Anticoagulant for a first leg clot beyond 6 months. Doubts: (1) one. (2) two.',
    "- START-D3 | B | No cholinesterase inhibitor. Doubts: the stage cannot be proven.",
    'BRISNIK-OP-INSO1 | class B (only pos-nofact written) | Tricyclic for sleep | The statement says for insomnia.',
    'OPTIMISE-T3-08 | C | Vitamin D for people at risk | Not drafted. Finding would be an absent medicine.',
    'ALL | Urgency is routine.'
  ].join('\n');
  const { byId, common } = lib.parseWaveNotes(text, ids);
  assert.deepEqual(byId.get('STOPP-B1'), { klass: 'A', beside: '', title: 'Digoxin title', text: '(1) first. (2) second.' });
  assert.deepEqual(byId.get('STOPP-B10'), { klass: 'B', beside: '', title: 'Loop diuretic title', text: 'brands from memory.' });
  assert.deepEqual(byId.get('STOPP-C8'), { klass: 'B', beside: '', title: 'Anticoagulant for a first leg clot beyond 6 months', text: '(1) one. (2) two.' });
  assert.deepEqual(byId.get('START-D3'), { klass: 'B', beside: '', title: 'No cholinesterase inhibitor', text: 'the stage cannot be proven.' });
  assert.deepEqual(byId.get('BRISNIK-OP-INSO1'), { klass: 'B', beside: 'only pos-nofact written', title: 'Tricyclic for sleep', text: 'The statement says for insomnia.' });
  assert.deepEqual(byId.get('OPTIMISE-T3-08'), { klass: 'C', beside: '', title: 'Vitamin D for people at risk', text: 'Not drafted. Finding would be an absent medicine.' });
  assert.deepEqual(common, ['W999 wave notes', 'Shared doubts for all: the licence is proposed.', 'Urgency is routine.']);
  assert.deepEqual(lib.splitNumbered('Lead. (1) one (2019 to 2020). (2) two (5 mL). (3) three.'), { lead: 'Lead.', items: ['one (2019 to 2020).', 'two (5 mL).', 'three.'] });
  assert.equal(lib.splitNumbered('No numbers here (1) only one.'), null);
});

await check('A7 CSV reading handles quotes, commas inside quotes and CRLF', () => {
  const rows = lib.readCsvTable('a,b,c\r\n1,"x, ""y""",3\r\n\r\n4,5,6');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, "y"', '3'], ['4', '5', '6']]);
});

await check('A8 a test that sets only the repository can never reach the real waves, board or results', () => {
  const cfg = lib.loadConfig({ SIGNOFF_REPO: 'C:\\somewhere\\else' });
  assert.equal(cfg.waves, null);
  assert.equal(cfg.board, null);
  assert.equal(cfg.run0, null);
  assert.equal(cfg.summary, null);
  assert.equal(cfg.gemini, null);
  assert.equal(cfg.audit, null);
  assert.equal(lib.auditOf(cfg, 'STOPP-C10'), null);
  assert.deepEqual(lib.auditsOf(cfg), {});
  assert.equal(cfg.ledger, path.resolve('C:\\somewhere\\else', 'docs', 'signoff', 'ledger.json'));
  const real = lib.loadConfig({});
  assert.equal(real.repo, REAL_REPO);
  assert.equal(real.port, 8790);
  assert.ok(real.waves.endsWith(path.join('ClinicaLANTERN-Lantern-runtime', 'waves-claude')));
  assert.ok(real.board.endsWith(path.join('ClinicaLANTERN-AgentHub', 'fireup', 'w', 'kimiwork', 'waves')));
  assert.equal(lib.allowed('C:\\x\\sealed\\a.json'), false);
  assert.equal(lib.allowed('C:\\x\\founder-review-queue\\a.json'), false);
  assert.equal(lib.allowed('C:\\x\\synthetic_cases.py'), false);
  assert.equal(lib.allowed('C:\\x\\criteria\\STOPP-C10\\criterion.json'), true);
});

await check('A9 the fingerprints of a file follow its words, not its layout', () => {
  const text = fs.readFileSync(path.join(REAL_REPO, 'criteria', 'STOPP-C10', 'criterion.json'), 'utf8');
  const j = JSON.parse(text);
  const parts = lib.contentParts(j);
  assert.deepEqual(Object.keys(parts), Object.keys(j).filter(k => k !== 'draft' && k !== 'signed_by_clinical_reviewer').sort());
  // Laid out again: CRLF, other spacing, the fields in another order, signed. The words are the same.
  const reordered = Object.fromEntries(Object.keys(j).reverse().map(k => [k, j[k]]));
  reordered.draft = false;
  reordered.signed_by_clinical_reviewer = { name: 'A B', date: '2026-11-19' };
  const again = JSON.parse(JSON.stringify(reordered, null, '\t').replace(/\n/g, '\r\n'));
  assert.deepEqual(lib.changedParts(parts, lib.contentParts(again)), []);
  assert.equal(lib.sameWordsAs({ parts }, lib.contentParts(again)), true);
  // One brand added, one word changed: exactly those two parts differ.
  const edited = structuredClone(j);
  Object.values(edited.medicine_groups[0].brands)[0].push('Newbrand');
  edited.rule_for_models += ' Always.';
  assert.deepEqual(lib.changedParts(parts, lib.contentParts(edited)), ['medicine_groups', 'rule_for_models']);
  assert.equal(lib.sameWordsAs({ parts }, lib.contentParts(edited)), false);
  // The order inside a list is part of the words. A field that is added or removed counts as a change.
  const swapped = structuredClone(j);
  swapped.medicine_groups.reverse();
  assert.deepEqual(lib.changedParts(parts, lib.contentParts(swapped)), ['medicine_groups']);
  const added = { ...j, extra_field: 1 };
  assert.deepEqual(lib.changedParts(parts, lib.contentParts(added)), ['extra_field']);
  // With no fingerprints kept, nothing is taken to be the same.
  assert.equal(lib.sameWordsAs({}, parts), false);
  assert.equal(lib.sameWordsAs({ parts: {} }, {}), false);
  assert.equal(lib.sameWordsAs({ parts }, null), false);
  assert.deepEqual(lib.noteParts('Line one.  \r\nLine two.\r\n'), lib.noteParts('Line one.\nLine two.'));
  assert.notDeepEqual(lib.noteParts('Line one.'), lib.noteParts('Line one!'));
});

await check('A10 a half-written temporary file left by a save that was cut short is removed by a later save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-temps-'));
  try {
    const file = path.join(dir, 'ledger.json');
    const old = path.join(dir, 'ledger.json.tmp-1234-1700000000000');
    const fresh = path.join(dir, 'ledger.json.tmp-1234-1700000000001');
    const other = path.join(dir, 'ledger.json.tmp-notes.txt');
    for (const f of [old, fresh, other]) fs.writeFileSync(f, '{ "half":');
    const longAgo = new Date(Date.now() - 10 * 60000);
    fs.utimesSync(old, longAgo, longAgo);
    lib.writeWhole(file, '{"ok":true}\n');
    assert.equal(fs.readFileSync(file, 'utf8'), '{"ok":true}\n');
    assert.equal(fs.existsSync(old), false);                  // older than a minute: removed
    assert.equal(fs.existsSync(fresh), true);                 // may belong to a save that is running: left alone
    assert.equal(fs.existsSync(other), true);                 // not one of ours: left alone
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await check('A11 a short write is continued until every byte is there, and a write that makes no progress keeps the old file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-short-'));
  const file = path.join(dir, 'ledger.json');
  const whole = '{"whole":true,"pad":"xxxxxxxx"}\n';
  const real = fs.writeSync;
  try {
    fs.writeFileSync(file, '{"old":true}\n');
    fs.writeSync = function (fd, buf, offset, length, position) {
      if (Buffer.isBuffer(buf) && typeof length === 'number') return real.call(fs, fd, buf, offset, Math.min(1, length), position);
      return real.call(fs, fd, buf, offset, length, position);
    };
    lib.writeWhole(file, whole);
    assert.equal(fs.readFileSync(file, 'utf8'), whole);
    fs.writeFileSync(file, '{"old":true}\n');
    fs.writeSync = function () { return 0; };
    assert.throws(() => lib.writeWhole(file, whole), /not written in full/);
    assert.equal(fs.readFileSync(file, 'utf8'), '{"old":true}\n');
  } finally {
    fs.writeSync = real;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

await check('A12 the question rules are written out in full, including the defaults', () => {
  const read = id => JSON.parse(fs.readFileSync(path.join(REAL_REPO, 'criteria', id, 'criterion.json'), 'utf8'));
  const mhra = lib.factRuleLines(read('MHRA-16').needs_facts[0]);
  assert.ok(mhra.includes('Asked when a medicine of group A is supplied.'));
  assert.ok(mhra.some(l => l.startsWith('Answers: ') && l.includes('(the fact is met)') && l.includes('(the fact is not met)') && l.includes('(not known, and a possible finding stays)')));
  const start = read('START-I3');
  const asked = lib.factRuleLines(start.needs_facts[0]);
  assert.ok(asked.includes('Asked for every patient. The pharmacist may answer it or leave it.'));
  assert.ok(asked.includes('A standing question is not asked when a medicine of group B was supplied in the last 6 months.'));
  assert.ok(asked.includes('Answers: Currently has symptoms from vaginal atrophy (the fact is met); No current symptoms from vaginal atrophy (the fact is not met); Not known (not known, and a possible finding stays).'));
  assert.ok(lib.factRuleLines({ kind: 'condition', what: 'X' }).includes('Answers: Yes (the fact is met), No (the fact is not met), Not known (a possible finding stays).'));
  assert.deepEqual(lib.criterionRuleLines(start), ['A standing question is withheld unless the patient is female. A missing sex is still asked.']);
  assert.deepEqual(lib.criterionRuleLines(read('SCOTRESP-01')), [
    'The application counts supplies of group A over 12 months (any run of months), only when the form has: inhaler.'
  ]);
  assert.ok(lib.factRuleLines(read('UKKA-T2D-1B').needs_facts[1]).includes('Asked only when a possible finding is waiting for this fact.'));
});

await check('A13 an audit of an earlier text cannot sign the new text, apply uses the recorded name, and a withdrawn decision is not written', async () => {
  const ids = ['MHRA-16', 'START-I3', 'SCOTRESP-01', 'STOPP-C10', 'STOPP-B13'];
  const small = makeFixture({ repoIds: ids, waves: [] });
  const port = await freePort();
  const srv = await startServer(small.env, port);
  const b = srv.base;
  const g = async p => { const r = await fetch(b + p); return { status: r.status, body: await r.json() }; };
  const p = async (pth, body) => {
    const r = await fetch(b + pth, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signoff': '1' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const fileOfId = id => path.join(small.repo, 'criteria', id, 'criterion.json');
  const readLedger = () => JSON.parse(fs.readFileSync(small.ledger, 'utf8'));
  try {
    const page = await (await fetch(b + '/')).text();
    assert.ok(page.includes('f.rules'));
    assert.ok(page.includes('questionRules'));
    assert.ok(page.includes('S.undo.token'));
    assert.ok(page.includes('This audit was made for an earlier text.'));
    assert.ok(!page.includes('\u2014'));
    const mhra = (await g('/api/criterion?id=MHRA-16')).body;
    assert.ok(mhra.criterion.facts[0].rules.includes('Asked when a medicine of group A is supplied.'));
    const start = (await g('/api/criterion?id=START-I3')).body;
    assert.ok(start.criterion.questionRules.includes('A standing question is withheld unless the patient is female. A missing sex is still asked.'));
    assert.ok(start.criterion.facts[0].rules.includes('Asked for every patient. The pharmacist may answer it or leave it.'));
    const scot = (await g('/api/criterion?id=SCOTRESP-01')).body;
    assert.ok(scot.criterion.questionRules[0].includes('counts supplies of group A over 12 months'));
    assert.equal((await p('/api/reviewer', { name: REVIEWER })).status, 200);
    const scotFile = fileOfId('SCOTRESP-01');
    const scotBytes = fs.readFileSync(scotFile);
    fs.writeFileSync(scotFile, scotBytes.toString('utf8').replace('"routine"', '"same_day"'));
    assert.equal((await g('/api/list')).body.entries.find(e => e.id === 'SCOTRESP-01').canSign, false);
    const refused = await p('/api/sign', { id: 'SCOTRESP-01', file_hash: (await g('/api/criterion?id=SCOTRESP-01')).body.hash });
    assert.equal(refused.status, 403);
    assert.match(refused.body.message, /earlier text/);
    fs.writeFileSync(scotFile, scotBytes);
    assert.equal((await g('/api/list')).body.entries.find(e => e.id === 'SCOTRESP-01').canSign, true);
    for (const id of ['STOPP-C10', 'STOPP-B13', 'MHRA-16']) {
      assert.equal((await p('/api/sign', { id, file_hash: (await g('/api/criterion?id=' + id)).body.hash })).status, 200);
    }
    const ledger = readLedger();
    ledger.reviewer = 'Bob Later';
    fs.writeFileSync(small.ledger, JSON.stringify(ledger, null, 2) + '\n');
    const laid = buf => {
      const j = JSON.parse(buf.toString('utf8'));
      return Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(j).reverse().map(k => [k, j[k]])), null, 4).replace(/\n/g, '\r\n') + '\r\n', 'utf8');
    };
    const b13 = fileOfId('STOPP-B13');
    const b13before = fs.readFileSync(b13);
    fs.writeFileSync(b13, lib.signedBytes(laid(b13before), 'Bob Other', '2020-01-01'));
    const mhraFile = fileOfId('MHRA-16');
    const mhraDate = ledger.entries['MHRA-16'].at.slice(0, 10);
    const mhraLaid = laid(fs.readFileSync(mhraFile));
    fs.writeFileSync(mhraFile, lib.signedBytes(mhraLaid, REVIEWER, mhraDate));
    const named = await runApply(small.env);
    assert.match(named.out, new RegExp(`\\nSIGNED\\s+STOPP-C10\\s.*as ${REVIEWER}`));
    assert.equal(JSON.parse(fs.readFileSync(fileOfId('STOPP-C10'), 'utf8')).signed_by_clinical_reviewer.name, REVIEWER);
    assert.match(named.out, /NOT SIGNED\s+STOPP-B13\s+The file is already signed by Bob Other on 2020-01-01/);
    assert.equal(JSON.parse(fs.readFileSync(b13, 'utf8')).signed_by_clinical_reviewer.name, 'Bob Other');
    assert.match(named.out, /ALREADY SIGNED\s+MHRA-16\s.*laid out again/);
    assert.equal(fs.readFileSync(mhraFile, 'utf8'), lib.signedBytes(mhraLaid, REVIEWER, mhraDate).toString('utf8'));
    // A withdrawal that is finished before apply starts does not get written. The file stays as it was.
    const startFile = fileOfId('START-I3');
    const startBefore = fs.readFileSync(startFile);
    assert.equal((await p('/api/sign', { id: 'START-I3', file_hash: (await g('/api/criterion?id=START-I3')).body.hash })).status, 200);
    assert.equal((await p('/api/withdraw', { id: 'START-I3' })).status, 200);
    const withdrawn = await runApply(small.env);
    assert.ok(!/\nSIGNED\s+START-I3\s/.test(withdrawn.out), withdrawn.out);
    assert.ok(fs.readFileSync(startFile).equals(startBefore));
  } finally {
    await srv.stop();
    removeFolder(small.root);
  }
});

await check('A14 a condition fact shows the shared medicine list, and a missing or unreadable file changes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-markers-'));
  const repo = path.join(dir, 'repo');
  const file = lib.markersFile(repo);
  const heart = {
    condition: 'chronic heart failure',
    question: 'Does this patient have chronic heart failure?',
    fact_names: ['Heart failure', 'chronic heart failure'],
    points_to_it: [
      { ingredient: 'sacubitril with valsartan', brands: ['Entresto'], forms: [], also_points_to: [] },
      { ingredient: 'digoxin', brands: ['Lanoxin', 'Sigmaxin'], forms: [], also_points_to: [] }
    ],
    also_used_for_it: [{ ingredient: 'ramipril', brands: ['Tritace'] }, { ingredient: 'spironolactone', brands: [] }],
    no_medicine_points_to_it: 'A diagnosis written on the record still counts.',
    what_the_list_misses: 'A medicine supplied under a name that is not in this list.'
  };
  const doc = { what_this_is: 'test', version: '2026-11-20', conditions: [heart, {
    condition: 'myasthenia gravis', question: 'Does this patient have myasthenia gravis?',
    fact_names: ['Myasthenia gravis'], points_to_it: [{ ingredient: 'pyridostigmine', brands: ['Mestinon'] }],
    also_used_for_it: [], no_medicine_points_to_it: '', what_the_list_misses: ''
  }] };
  const criterion = { id: 'X', needs_facts: [{ kind: 'condition', what: 'Chronic heart failure' }], statement: 'same words' };
  const parts = lib.contentParts(criterion);
  try {
    assert.equal(lib.readConditionMarkers(repo), null);
    assert.equal(lib.conditionMarkerLines(null, 'Chronic heart failure'), null);
    assert.equal(lib.conditionListsView(null), null);

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(file); // a path that cannot be read as the list
    assert.equal(lib.readConditionMarkers(repo), null);
    fs.rmSync(file, { recursive: true });

    fs.writeFileSync(file, '{');
    assert.equal(lib.readConditionMarkers(repo), null, 'a file that is not the list is not an error');

    const realRead = fs.readFileSync;
    const deny = function (p, ...rest) {
      if (String(p) === file) { const err = new Error('denied'); err.code = 'EACCES'; throw err; }
      return realRead.call(fs, p, ...rest);
    };
    fs.writeFileSync(file, JSON.stringify(doc));
    fs.readFileSync = deny;
    try {
      assert.equal(lib.readConditionMarkers(repo), null);
    } finally {
      fs.readFileSync = realRead;
    }

    const read = lib.readConditionMarkers(repo);
    assert.equal(read.conditions.length, 2);
    const lines = lib.conditionMarkerLines(read, '  CHRONIC HEART FAILURE  ');
    assert.equal(lines[0], 'Medicines that point to this condition (the application asks about it when one is supplied): sacubitril with valsartan (Entresto) source not recorded; digoxin (Lanoxin, Sigmaxin) source not recorded');
    assert.equal(lines[1], 'Other medicines used for it, which have other uses (never asked alone): ramipril (Tritace); spironolactone');
    assert.equal(lines[2], 'No medicine points to this condition: A diagnosis written on the record still counts.');
    assert.equal(lines[3], 'What the list can miss: A medicine supplied under a name that is not in this list.');
    assert.deepEqual(lib.conditionMarkerLines(read, 'Heart failure'), lines);
    assert.deepEqual(lib.conditionMarkerLines(read, 'Ventricular tachycardia'), [lib.CONDITION_LIST_PENDING]);
    fs.readFileSync = deny;
    try {
      assert.deepEqual(lib.conditionMarkerLines(lib.readConditionMarkers(repo), 'Chronic heart failure'), lines, 'the same file time and size is remembered');
    } finally {
      fs.readFileSync = realRead;
    }
    const grown = structuredClone(doc);
    grown.conditions[0].points_to_it.push({ ingredient: 'ivabradine', brands: ['Coralan'] });
    fs.writeFileSync(file, JSON.stringify(grown));
    assert.ok(lib.conditionMarkerLines(lib.readConditionMarkers(repo), 'Chronic heart failure')[0].endsWith('ivabradine (Coralan) source not recorded'));
    assert.deepEqual(lib.contentParts(criterion), parts);
    assert.equal(JSON.stringify(lib.contentParts(criterion)).includes('Entresto'), false);
  } finally {
    removeFolder(dir);
  }
});

await check('G-LIST-SOURCES each medicine is followed by its source, and only an https page is a link', () => {
  const httpsItem = { ingredient: 'digoxin', brands: ['Lanoxin', 'Sigmaxin'], source: 'PBS restriction', page: 'https://www.pbs.gov.au/medicine/digoxin' };
  const wordsOnly = { ingredient: 'ramipril', brands: ['Tritace'], source: 'registered indication' };
  const neither = { ingredient: 'spironolactone', brands: [] };
  const notHttps = { ingredient: 'furosemide', brands: ['Lasix'], source: 'PBS restriction', page: 'http://example.com/x' };
  assert.deepEqual(lib.sourceShow(httpsItem), { words: 'PBS restriction', href: 'https://www.pbs.gov.au/medicine/digoxin' });
  assert.deepEqual(lib.sourceShow(wordsOnly), { words: 'registered indication', href: '' });
  assert.deepEqual(lib.sourceShow(neither), { words: 'source not recorded', href: '' });
  assert.deepEqual(lib.sourceShow(notHttps), { words: 'PBS restriction http://example.com/x', href: '' });
  const doc = {
    conditions: [{
      condition: 'x', question: 'q', fact_names: ['X'],
      points_to_it: [httpsItem, neither],
      also_used_for_it: [wordsOnly, notHttps],
      no_medicine_points_to_it: '', what_the_list_misses: ''
    }]
  };
  const lines = lib.conditionMarkerLines(doc, 'X');
  assert.equal(lines[0], 'Medicines that point to this condition (the application asks about it when one is supplied): digoxin (Lanoxin, Sigmaxin) PBS restriction; spironolactone source not recorded');
  assert.equal(lines[1], 'Other medicines used for it, which have other uses (never asked alone): ramipril (Tritace) registered indication; furosemide (Lasix) PBS restriction http://example.com/x');
  const meds = lib.conditionMarkerMeds(doc, 'X');
  assert.equal(meds.pointing[0].href, 'https://www.pbs.gov.au/medicine/digoxin');
  assert.equal(meds.pointing[0].words, 'PBS restriction');
  assert.equal(meds.pointing[1].words, 'source not recorded');
  assert.equal(meds.pointing[1].href, '');
  assert.equal(meds.other[0].href, '');
  assert.equal(meds.other[1].href, '');
  const criterion = { id: 'X', needs_facts: [{ kind: 'condition', what: 'X' }], statement: 'same words' };
  const parts = lib.contentParts(criterion);
  assert.deepEqual(lib.contentParts(criterion), parts);
  assert.equal(JSON.stringify(parts).includes('pbs.gov.au'), false);
  const page = fs.readFileSync(path.join(REAL_REPO, 'tools', 'signoff', 'page.html'), 'utf8');
  assert.match(page, /function markerMedicineLine/);
  assert.match(page, /rel: 'noopener'/);
  assert.match(page, /target: '_blank'/);
  assert.match(page, /f\.markerMeds/);
  assert.match(page, /https:\\\/\\\//);
  assert.equal(page.includes('\u2014'), false);
});

await check('G-LISTS-1 a list decision is a fingerprint of the condition, and a damaged lists file is left as it is', () => {
  const canon = v => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v);
  const anaemia = {
    condition: '  Anaemia ', question: 'Does this patient have anaemia?', fact_names: ['Anaemia'],
    points_to_it: [{ ingredient: 'ferrous sulfate', brands: ['Ferro-Grad'] }],
    also_used_for_it: [{ ingredient: 'folic acid', brands: [] }]
  };
  const same = { fact_names: ['Anaemia'], also_used_for_it: [{ brands: [], ingredient: 'folic acid' }], condition: '  Anaemia ', question: 'Does this patient have anaemia?', points_to_it: [{ brands: ['Ferro-Grad'], ingredient: 'ferrous sulfate' }] };
  const fp = lib.listFingerprint(anaemia);
  assert.equal(fp, crypto.createHash('sha256').update(Buffer.from(JSON.stringify(canon(anaemia)), 'utf8')).digest('hex'));
  assert.equal(lib.listFingerprint(same), fp);
  assert.equal(lib.listLedgerKey(anaemia), 'anaemia');
  assert.deepEqual(lib.listMedicineNames(anaemia), ['ferrous sulfate (Ferro-Grad)', 'folic acid']);
  const saved = { decision: 'right', note: '', at: '2026-11-20T22:00:00+11:00', by: 'A', fingerprint: fp, medicines: lib.listMedicineNames(anaemia) };
  assert.equal(lib.listDecisionOf(saved, anaemia).state, 'right');
  const grown = structuredClone(anaemia);
  grown.points_to_it = [{ ingredient: 'iron', brands: [] }];
  grown.also_used_for_it = [];
  const again = lib.listDecisionOf(saved, grown);
  assert.equal(again.state, 'changed_since');
  assert.deepEqual(again.added, ['iron']);
  assert.deepEqual(again.removed, ['ferrous sulfate (Ferro-Grad)', 'folic acid']);
  const unnamed = lib.listDecisionOf({ decision: 'change', note: 'add iron', at: 't', by: 'A', fingerprint: 'stale' }, anaemia);
  assert.equal(unnamed.namesKnown, false);
  assert.deepEqual(unnamed.added, []);
  const kidney = { condition: 'Chronic kidney disease', question: 'q', fact_names: ['CKD'], points_to_it: [], also_used_for_it: [] };
  const doc = { conditions: [anaemia, kidney, { condition: 'Asthma', question: 'q', fact_names: ['Asthma'], points_to_it: [], also_used_for_it: [] }] };
  const counts = lib.listDecisionCounts(doc, { lists: { anaemia: saved, 'chronic kidney disease': { decision: 'change', note: 'x', at: 't', by: 'A', fingerprint: 'stale', medicines: [] } } });
  assert.deepEqual(counts, { right: 1, change: 0, notLookedAt: 1, changedSince: 1 });
  const shown = lib.criteriaShowingCondition({
    entries: [
      { id: 'STOPP-C10', label: 'STOPP C10', n: '1', json: { needs_facts: [{ kind: 'Condition', what: ' anaemia ' }] } },
      { id: 'X', label: 'X', n: '', json: { needs_facts: [{ kind: 'age', what: 'anaemia' }] } }
    ]
  }, anaemia);
  assert.deepEqual(shown, [{ id: 'STOPP-C10', label: 'STOPP C10', n: '1' }]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-lists-'));
  const ledgerFile = path.join(dir, 'ledger.json');
  fs.writeFileSync(ledgerFile, '{"reviewer":"","entries":{}}\n');
  const cfg = lib.loadConfig({ SIGNOFF_REPO: dir, SIGNOFF_LEDGER: ledgerFile });
  const listsFile = lib.listsLedgerFile(cfg);
  try {
    assert.deepEqual(lib.readListsLedger(cfg), { version: 1, lists: {} });
    assert.equal(fs.existsSync(listsFile), false);
    lib.writeListsLedger(cfg, { version: 1, lists: { Anaemia: saved } });
    const round = lib.readListsLedger(cfg);
    assert.deepEqual(Object.keys(round.lists.anaemia), ['decision', 'note', 'at', 'by', 'fingerprint', 'medicines']);
    assert.equal(round.lists.anaemia.decision, 'right');
    assert.equal(fs.readFileSync(ledgerFile, 'utf8'), '{"reviewer":"","entries":{}}\n');
    const backups = fs.readdirSync(path.join(dir, 'backups'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^lists-ledger-\d{4}-\d{2}-\d{2}-\d{2}00\.json$/);
    const kept = fs.readFileSync(listsFile);
    lib.writeListsLedger(cfg, { lists: { anaemia: saved } });
    assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1);
    fs.writeFileSync(listsFile, '{');
    assert.throws(() => lib.readListsLedger(cfg), lib.LedgerError);
    assert.equal(fs.readFileSync(listsFile, 'utf8'), '{');
    assert.ok(fs.readFileSync(path.join(dir, 'backups', backups[0])).equals(kept));
  } finally {
    removeFolder(dir);
  }
});

// ---------- B. the server, on a copy ----------

const proposed = JSON.parse(fs.readFileSync(path.join(REAL_REPO, 'criteria', 'active.proposed.json'), 'utf8'));
const repoIds = [...proposed.active, ...proposed.reserves, 'DEMO-NSAID-ANTICOAG'];
const fx = makeFixture({ repoIds, waves: ['W101', 'W108', 'W116', 'W133', 'W151'] });
const port = await freePort();
const server = await startServer(fx.env, port);
const base = server.base;
console.log(`\nCopy of ${fx.ids.length} criteria in ${fx.root}\nServer on ${base}\n`);

const get = async p => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const post = async (p, body, headers = { 'Content-Type': 'application/json', 'X-Signoff': '1' }) => {
  const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const raw = (method, p, headers, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
    let text = '';
    res.on('data', c => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, text }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});
const ledger = () => JSON.parse(fs.readFileSync(fx.ledger, 'utf8'));
const fileOf = id => {
  for (const dir of [path.join(fx.repo, 'criteria'), ...fs.readdirSync(fx.waves).map(w => path.join(fx.waves, w, 'criteria'))]) {
    const f = path.join(dir, id, 'criterion.json');
    if (fs.existsSync(f)) return f;
  }
  throw new Error('no file for ' + id);
};
const entryOf = async id => (await get('/api/list')).body.entries.find(e => e.id === id);
const sign = async (id, hash) => post('/api/sign', { id, file_hash: hash ?? (await entryOf(id)).hash });
const undo = async token => post('/api/undo', { token: token !== undefined ? token : ((await get('/api/list')).body.undo || {}).token });
const TOTAL = 19 + 8 + 8 + 8 + 8 + 1;

await check('B1 list: one entry for each criterion, in reading order, with the demo left out', async () => {
  const { status, body } = await get('/api/list');
  assert.equal(status, 200);
  assert.equal(body.entries.length, TOTAL);
  assert.deepEqual(body.entries.slice(0, 10).map(e => e.id), proposed.active);
  // The nine reserves were taken into use as further criteria on 18 November (commit 35c4cf1):
  // they keep no R-number and sit in the further section, sorted with it by family and id.
  const byId = new Map(body.entries.map(e => [e.id, e]));
  assert.ok(proposed.reserves.every(id => byId.get(id).set === 'further' && byId.get(id).n === ''));
  assert.deepEqual(body.entries.slice(10, 12).map(e => e.id), ['BRISNIK-HR-A3', 'BRISNIK-HR-F2']);
  assert.deepEqual(body.entries.slice(0, 19).map(e => e.n), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '', '', '', '', '', '', '', '', '']);
  assert.ok(body.entries.slice(0, 10).every(e => e.set === 'ten') && body.entries.slice(10).every(e => e.set === 'further'));
  const rest = body.entries.slice(19).map(e => e.id);
  assert.deepEqual(rest.slice(0, 3), ['EU7-F08', 'EU7-F14', 'EU7-F56']);              // after the nine folded reserves: EU(7)-PIM, then its number order (F14 is one of the nine)
  assert.ok(rest.indexOf('EU7-F63') < rest.indexOf('OPTIMISE-T2-16') && rest.indexOf('OPTIMISE-T2-26') < rest.indexOf('START-L4') && rest.indexOf('START-L4') < rest.indexOf('STOPP-C8'));
  assert.ok(rest.indexOf('STOPP-C9') < rest.indexOf('STOPP-D1') && rest.indexOf('STOPP-D1') < rest.indexOf('STOPP-D10'));   // D1 before D10
  assert.ok(!body.entries.some(e => e.id === 'DEMO-NSAID-ANTICOAG'));
  assert.deepEqual(body.tally.leftOut.map(x => x.id), ['DEMO-NSAID-ANTICOAG']);
  assert.deepEqual(body.counts, { total: TOTAL, signed: 0, change: 0, left: TOTAL - 3, notDrafted: 3, lookAgain: 0, notDraftedDone: 0 });
  assert.equal(body.tally.repo, 19);
  assert.equal(body.tally.drafts, TOTAL - 19 - 3);
  assert.equal(body.tally.expected, TOTAL);
  assert.deepEqual(body.tally.missing, []);
  assert.equal(body.reviewer, '');
  assert.equal(body.tally.setsFrom, 'active.json');
});

await check('B2 the page itself is served, with its name box', async () => {
  const r = await fetch(base + '/');
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.ok(r.headers.get('content-type').startsWith('text/html'));
  assert.ok(text.includes('Your name as clinical reviewer'));
  assert.ok(!text.includes('\u2014'), 'an em dash is on the page');
  assert.ok(text.includes('f.rules') && text.includes('questionRules') && text.includes('S.undo.token'));
  assert.ok(text.includes('This audit was made for an earlier text.'));
  const mark = await fetch(base + '/mark.svg');
  assert.ok((await mark.text()).includes('<svg'));
});

await check('B3 one of the first ten: every part of the criterion, its histories, its result and its doubts', async () => {
  const { body: d } = await get('/api/criterion?id=STOPP-C10');
  const file = JSON.parse(fs.readFileSync(fileOf('STOPP-C10'), 'utf8'));
  assert.equal(d.hash, sha(fileOf('STOPP-C10')));
  assert.equal(d.label, 'STOPP C10');
  assert.equal(d.set, 'ten');
  assert.equal(d.n, '1');
  assert.equal(d.criterion.statement, file.statement);
  assert.equal(d.criterion.origin, 'published');
  assert.equal(d.criterion.source.credit, file.source.credit);
  assert.equal(d.criterion.rule, file.rule_for_models);
  assert.equal(d.criterion.ask, file.ask_the_gp);
  assert.equal(d.criterion.cannot, file.cannot_be_seen);
  assert.equal(d.criterion.urgency, 'same_day');
  assert.deepEqual(d.criterion.groups.map(g => g.key), ['A', 'B']);
  assert.deepEqual(d.criterion.groups[0].ingredients, file.medicine_groups[0].ingredients);
  // The Australian brand names were added from the SNOMED release check on 19 November; the first
  // two stay first, the rest of the list belongs to the file itself.
  const celecoxib = d.criterion.groups[0].brands.find(b => b[0] === 'celecoxib')[1];
  assert.deepEqual(celecoxib.slice(0, 2), ['Celebrex', 'Celaxib']);
  assert.deepEqual(celecoxib, file.medicine_groups[0].brands.celecoxib);
  assert.equal(d.criterion.groups[0].note, file.medicine_groups[0].note);
  assert.deepEqual(d.criterion.facts, []);
  assert.deepEqual(d.histories.list.map(h => [h.file, h.kind]), [['pos-brand.csv', 'positive'], ['pos-buried.csv', 'positive'], ['near-miss.csv', 'near_miss']]);
  assert.ok(d.histories.list[0].about.startsWith('Mobic'));
  assert.equal(d.result.word, 'PASS');
  assert.equal(d.result.bucket, 'pass');
  assert.match(d.result.older, /changed since that run/);                        // run 0 scored an earlier wording; the page says so (brands were added 19 November)
  assert.equal(d.opinion, null);
  assert.ok(d.doubts.list[0].from.includes('criteria sheet'));
  assert.ok(d.doubts.list[0].lines.some(l => l.startsWith('1. Brands that may be uncommon')));
  assert.ok(d.doubts.questions.some(l => l.includes('G1.')));
  assert.equal(d.status.state, 'unsigned');
  assert.equal(d.file.where, 'the repository');
});

await check('B4 a history in another folder that also plants this criterion is shown', async () => {
  const { body: d } = await get('/api/criterion?id=STOPP-C14');
  const extra = d.histories.list.find(h => h.folder === 'STOPP-C13');
  assert.ok(extra && extra.file === 'pos-buried.csv' && extra.tag === 'Also planted');
  const { body: h } = await get('/api/history?id=STOPP-C14&folder=STOPP-C13&file=pos-buried.csv');
  assert.ok(h.lines.some(l => l.cited));
});

await check('B5 a criterion that needs a fact: the fact, the wave line and the notes for the whole wave', async () => {
  const { body: d } = await get('/api/criterion?id=OPTIMISE-T2-22');
  assert.equal(d.facts, true);
  assert.equal(d.klass, 'B');
  assert.deepEqual(d.criterion.facts.map(f => f.kind), ['result']);
  assert.ok(d.criterion.facts[0].what.startsWith('TSH'));
  assert.deepEqual(d.histories.list.map(h => h.file), ['pos-fact.csv', 'pos-nofact.csv', 'near-miss.csv']);
  assert.ok(d.doubts.list[0].from.includes('W116'));
  assert.ok(d.doubts.list[0].text.startsWith('depression is inferred'));
  assert.ok(d.doubts.waveNotes.lines.some(l => l.startsWith('Common doubts for every OPTIMISE item')));
  assert.equal(d.result.word, 'Not scored yet');
  assert.equal(d.file.wave, 'W116');
  const numbered = (await get('/api/criterion?id=EU7-F01')).body.doubts.list[0];
  assert.equal(numbered.items.length, 12);
  assert.ok(numbered.items[0].startsWith('Statement: written in the entrant'));
  const comma = (await get('/api/criterion?id=STOPP-C8')).body.doubts.list[0];
  assert.ok(comma.items.length >= 2 && comma.items[0].startsWith('a first DVT cannot be proved'));
});

await check('B6 a criterion that was not drafted is shown with the reason and the published statement', async () => {
  const { body: d } = await get('/api/criterion?id=OPTIMISE-T2-16');
  assert.equal(d.kind, 'not_drafted');
  assert.equal(d.label, 'OPTIMISE T2-16');
  assert.equal(d.title, 'Metformin trial in prediabetes if lifestyle education was ineffective');
  assert.equal(d.family, 'OPTIMISE');
  assert.ok(d.notDrafted.reason.includes('lifestyle programme did not work'));
  assert.equal(d.notDrafted.published.statement, 'ii.if ineffective, consider a trial of metformin');
  assert.equal(d.criterion, undefined);
  assert.equal(d.status.state, 'nd_open');
  assert.ok(d.doubts.list[0].text.startsWith('Not drafted:'));
  assert.deepEqual(d.histories.list, []);
});

await check('B7 the rows of a history, numbered as the engine numbers them, with the planted lines marked', async () => {
  const { body: h } = await get('/api/history?id=STOPP-C10&file=pos-brand.csv');
  const part = JSON.parse(fs.readFileSync(path.join(fx.repo, 'cases', 'STOPP-C10', 'expected.part.json'), 'utf8'));
  const must = part[0].findings[0].must_cite.flat().sort();
  assert.equal(h.lines.length, 37);
  assert.deepEqual(h.lines.filter(l => l.cited).map(l => l.id).sort(), must);
  assert.deepEqual(h.lines[21], { id: 'L022', cited: true, type: '', date: '2026-06-17', what: 'Mobic 15 mg tablet', brandOnly: true, quantity: '30', repeats: '3', directions: 'Take ONE tablet daily with food', prescriber: 'Dr B. Sample' });
  assert.deepEqual(h.patient, { ref: 'F-C10-01', age: '71', sex: 'M' });
  const { body: f } = await get('/api/history?id=OPTIMISE-T2-22&file=pos-fact.csv');
  assert.equal(f.lines[16].type, 'result');
  assert.equal(f.lines[16].what, 'TSH: 2.1 mIU/L');
  assert.equal(f.lines[16].cited, true);
  assert.equal((await get('/api/history?id=STOPP-C10&file=near-miss.csv')).body.lines.filter(l => l.cited).length, 0);
});

await check('B8 only this page on this computer can write, and no address reaches another file', async () => {
  const hash = (await entryOf('STOPP-C10')).hash;
  const body = JSON.stringify({ id: 'STOPP-C10', file_hash: hash });
  assert.equal((await raw('POST', '/api/sign', { 'Content-Type': 'application/json', Host: `127.0.0.1:${port}` }, body)).status, 403);                  // no page header
  assert.equal((await raw('POST', '/api/sign', { 'Content-Type': 'application/json', 'X-Signoff': '1', Host: 'evil.example' }, body)).status, 403);     // wrong host
  assert.equal((await raw('POST', '/api/sign', { 'Content-Type': 'application/json', 'X-Signoff': '1', Host: `127.0.0.1:${port}`, Origin: 'http://evil.example' }, body)).status, 403);
  assert.equal((await raw('POST', '/api/sign', { 'Content-Type': 'text/plain', 'X-Signoff': '1', Host: `127.0.0.1:${port}` }, body)).status, 415);
  assert.equal((await raw('GET', '/api/list', { Host: 'evil.example' })).status, 403);
  assert.equal((await get('/api/history?id=STOPP-C10&file=..%2F..%2Fcriteria%2FSTOPP-C10%2Fcriterion.json')).status, 404);
  assert.equal((await get('/api/history?id=STOPP-C10&file=expected.part.json')).status, 404);
  assert.equal((await get('/api/criterion?id=..%2F..%2Fx')).status, 404);
  assert.equal((await get('/api/criterion?id=DEMO-NSAID-ANTICOAG')).status, 404);
  assert.equal((await fetch(base + '/server.mjs')).status, 404);
});

await check('B9 reading writes nothing, and nothing can be signed before the name is given', async () => {
  const r = await sign('STOPP-C10');
  assert.equal(r.status, 400);
  assert.equal(r.body.message, 'Type your name first.');
  assert.equal(fs.existsSync(fx.ledger), false);
  assert.equal(fs.existsSync(path.dirname(fx.ledger)), false);
});

await check('B10 the name is asked once and kept in the ledger', async () => {
  assert.equal((await post('/api/reviewer', { name: ' ' })).status, 400);
  const r = await post('/api/reviewer', { name: `  ${REVIEWER}  ` });
  assert.equal(r.status, 200);
  assert.deepEqual(ledger(), { reviewer: REVIEWER, entries: {} });
  assert.equal((await get('/api/list')).body.reviewer, REVIEWER);
});

await check('B11 a signature is tied to the file that was shown', async () => {
  const wrong = await sign('STOPP-C10', '0'.repeat(64));
  assert.equal(wrong.status, 409);
  assert.equal(wrong.body.changed, true);
  assert.deepEqual(ledger().entries, {});
  const before = Date.now();
  const r = await sign('STOPP-C10');
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.state, 'signed');
  assert.equal(r.body.counts.signed, 1);
  assert.equal(r.body.counts.left, TOTAL - 3 - 1);
  const e = ledger().entries['STOPP-C10'];
  assert.deepEqual(Object.keys(e), ['decision', 'note', 'at', 'file_hash', 'reviewer', 'parts']);
  assert.equal(e.reviewer, REVIEWER);
  assert.deepEqual(e.parts, lib.contentParts(JSON.parse(fs.readFileSync(fileOf('STOPP-C10'), 'utf8'))));   // the fingerprints of what he read
  assert.equal(e.decision, 'signed');
  assert.equal(e.note, '');
  assert.equal(e.file_hash, sha(fileOf('STOPP-C10')));
  assert.match(e.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.ok(Math.abs(new Date(e.at).getTime() - before) < 5000);
  const backups = fs.readdirSync(path.join(path.dirname(fx.ledger), 'backups'));
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^ledger-\d{4}-\d{2}-\d{2}-\d{2}00\.json$/);
  assert.equal(fs.readdirSync(path.dirname(fx.ledger)).filter(n => n.includes('.tmp-')).length, 0);
  const again = await sign('STOPP-C10');
  assert.equal(again.status, 200);
  assert.equal(ledger().entries['STOPP-C10'].at, e.at);                 // signing twice changes nothing
  assert.equal((await get('/api/criterion?id=STOPP-C10')).body.status.state, 'signed');
});

await check('B12 needs a change: his words are kept', async () => {
  const hash = (await entryOf('STOPP-B3')).hash;
  assert.equal((await post('/api/change', { id: 'STOPP-B3', file_hash: hash, note: '   ' })).status, 400);
  const note = 'Strike Tensig and Bicard.\nAdd "Betaloc CR".';
  const r = await post('/api/change', { id: 'STOPP-B3', file_hash: hash, note });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.state, 'change');
  assert.equal(r.body.counts.change, 1);
  const e = ledger().entries['STOPP-B3'];
  assert.equal(e.decision, 'change');
  assert.equal(e.note, note);
  assert.equal(e.file_hash, hash);
  assert.equal((await get('/api/criterion?id=STOPP-B3')).body.status.note, note);
  const over = await sign('STOPP-B3', hash);                                 // one key press must not replace his written words
  assert.equal(over.status, 409);
  assert.ok(over.body.message.startsWith('You asked for a change here.'));
  assert.equal(ledger().entries['STOPP-B3'].note, note);
});

await check('B13 undo takes back the last click, one click at a time', async () => {
  let r = await undo();
  assert.equal(r.status, 200);
  assert.equal(r.body.id, 'STOPP-B3');
  assert.equal(ledger().entries['STOPP-B3'], undefined);
  assert.equal(r.body.entry.state, 'unsigned');
  r = await undo();
  assert.equal(r.body.id, 'STOPP-C10');
  assert.deepEqual(ledger().entries, {});
  assert.equal(r.body.counts.signed, 0);
  r = await undo();
  assert.equal(r.status, 409);
  assert.equal(r.body.message, 'There is nothing to undo.');
});

await check('B28 an undo token from an earlier click does not undo a later decision', async () => {
  await sign('STOPP-C10');
  const first = (await get('/api/list')).body.undo.token;
  await sign('STOPP-B11');
  const stale = await undo(first);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.message, 'That undo is for a different click. Nothing was changed.');
  assert.equal(ledger().entries['STOPP-C10'].decision, 'signed');
  assert.equal(ledger().entries['STOPP-B11'].decision, 'signed');
  assert.equal((await undo()).body.id, 'STOPP-B11');
  assert.equal(ledger().entries['STOPP-B11'], undefined);
  assert.equal(ledger().entries['STOPP-C10'].decision, 'signed');
  assert.equal((await undo()).body.id, 'STOPP-C10');
  assert.equal(ledger().entries['STOPP-C10'], undefined);
});

await check('B14 a signature can be withdrawn, and the withdrawal can be undone', async () => {
  await sign('STOPP-C10');
  const at = ledger().entries['STOPP-C10'].at;
  let r = await post('/api/withdraw', { id: 'STOPP-C10' });
  assert.equal(r.status, 200);
  assert.equal(r.body.entry.state, 'unsigned');
  assert.equal(ledger().entries['STOPP-C10'], undefined);
  r = await undo();
  assert.equal(r.body.entry.state, 'signed');
  assert.equal(ledger().entries['STOPP-C10'].at, at);
});

await check('B15 when the file changes after signing, the entry says so and asks for a second look', async () => {
  const file = fileOf('EU7-F01');
  await sign('EU7-F01');
  const oldHash = ledger().entries['EU7-F01'].file_hash;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"Gelusil"', '"Gelusil", "Gelusil Forte"'));
  assert.notEqual(sha(file), oldHash);
  const list = (await get('/api/list')).body;
  assert.equal(list.entries.find(e => e.id === 'EU7-F01').state, 'look_again');
  assert.equal(list.counts.lookAgain, 1);
  assert.equal(list.counts.signed, 1);                                       // only STOPP-C10 counts as signed
  const d = (await get('/api/criterion?id=EU7-F01')).body;
  assert.equal(d.status.state, 'look_again');
  assert.equal(d.status.was, 'signed');
  assert.equal(d.hash, sha(file));
  assert.ok(JSON.stringify(d.criterion.groups).includes('Gelusil Forte'));
  assert.equal((await sign('EU7-F01', oldHash)).status, 409);                // the old version cannot be signed any more
  const refused = await sign('EU7-F01', d.hash);
  assert.equal(refused.status, 403);
  assert.match(refused.body.message, /earlier text/);
  assert.equal(ledger().entries['EU7-F01'].file_hash, oldHash);
  const audit = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
  audit['EU7-F01'].parts = lib.contentParts(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.writeFileSync(fx.audit, JSON.stringify(audit));
  const r = await sign('EU7-F01', d.hash);
  assert.equal(r.body.entry.state, 'signed');
  assert.equal(ledger().entries['EU7-F01'].file_hash, sha(file));
});

await check('B16 a criterion that was not drafted: agreeing is kept apart from the signatures', async () => {
  const nd = await entryOf('OPTIMISE-T2-16');
  const r = await sign('OPTIMISE-T2-16', nd.hash);
  assert.equal(r.body.entry.state, 'nd_agreed');
  const l = ledger();
  assert.equal(l.entries['OPTIMISE-T2-16'], undefined);
  assert.equal(l.not_drafted_agreed['OPTIMISE-T2-16'].file_hash, sha(path.join(fx.waves, 'W116', 'criteria', 'OPTIMISE-T2-16', 'NOT_DRAFTED.md')));
  assert.equal(r.body.counts.notDrafted, 3);
  assert.equal(r.body.counts.notDraftedDone, 1);
  assert.equal(r.body.counts.signed, 2);
  const c = await post('/api/change', { id: 'OPTIMISE-T2-18', file_hash: (await entryOf('OPTIMISE-T2-18')).hash, note: 'Draft it with the missing line dropped.' });
  assert.equal(c.body.entry.state, 'nd_change');
  assert.equal(ledger().entries['OPTIMISE-T2-18'].decision, 'change');
  assert.equal(c.body.counts.change, 0);                                     // counted under not drafted, not under to change
  assert.equal(c.body.counts.notDraftedDone, 2);
});

await check('B17 one entry for each number: repository, then a repaired wave on the board, then the board, then the drafts', async () => {
  const src = path.join(fx.waves, 'W101', 'criteria', 'EU7-F02');
  await sign('EU7-F02');
  assert.equal((await get('/api/criterion?id=EU7-F02')).body.file.where, 'the drafts (waves-claude)');
  fs.cpSync(src, path.join(fx.board, 'W101', 'criteria', 'EU7-F02'), { recursive: true });           // the same bytes on the board
  let d = (await get('/api/criterion?id=EU7-F02')).body;
  assert.equal(d.file.where, 'the build board');
  assert.equal(d.status.state, 'signed');                                                            // same file, the signature still stands
  assert.deepEqual(d.histories.list.map(h => h.file).sort(), ['near-miss.csv', 'pos-brand.csv', 'pos-buried.csv']);   // histories fall back to the drafts
  const repaired = path.join(fx.board, 'W101-r1', 'criteria', 'EU7-F02');
  fs.mkdirSync(repaired, { recursive: true });
  fs.writeFileSync(path.join(repaired, 'criterion.json'), fs.readFileSync(path.join(src, 'criterion.json'), 'utf8').replace('"routine"', '"same_day"'));
  fs.writeFileSync(path.join(fx.board, 'W101-r1', 'WAVE.md'), 'EU7-F02 | A | Repaired | Urgency corrected after review.\n');
  fs.mkdirSync(path.join(fx.board, 'W101-r2', 'criteria'), { recursive: true });                     // a later repair that does not hold this one
  d = (await get('/api/criterion?id=EU7-F02')).body;
  assert.equal(d.file.where, 'a repaired wave on the build board');
  assert.equal(d.file.wave, 'W101-r1');
  assert.equal(d.urgent, true);
  assert.equal(d.status.state, 'look_again');
  assert.equal(d.file.others.length, 2);
  assert.ok(d.doubts.list[0].from.includes('W101-r1') && d.doubts.list[0].text === 'Urgency corrected after review.');
  assert.ok(d.doubts.list[1].from.includes('W101') && d.doubts.list[1].items.length > 3);            // the first drafter's doubts are still shown
  fs.cpSync(src, path.join(fx.repo, 'criteria', 'EU7-F02'), { recursive: true });                    // and the repository wins over all of them
  d = (await get('/api/criterion?id=EU7-F02')).body;
  assert.equal(d.file.where, 'the repository');
  assert.equal(d.status.state, 'signed');
  const list = (await get('/api/list')).body;
  assert.equal(list.entries.length, TOTAL);
  assert.equal(list.entries.filter(e => e.id === 'EU7-F02').length, 1);
  assert.equal(list.tally.repo, 20);
  fs.rmSync(path.join(fx.repo, 'criteria', 'EU7-F02'), { recursive: true });
  assert.equal((await get('/api/criterion?id=EU7-F02')).body.file.wave, 'W101-r1');
});

await check('B18 scored results and second opinions are picked up as soon as the files appear', async () => {
  assert.equal((await entryOf('EU7-F03')).result, 'none');
  fs.writeFileSync(fx.summary, JSON.stringify({ criteria: [
    { id: 'EU7-F01', wave: 'W101', result: 'NOT PASSING', reason: 'One planted finding was missed: pos-buried.', run: 'r7' },
    { id: 'EU7-F02', wave: 'W101', result: 'PASS', reason: '', run: 'r7' },
    { id: 'EU7-F03', wave: 'W101', result: 'PASS', reason: '', run: 'r7' },
    { id: 'eu7 f07', wave: 'W101', result: 'PASS', reason: '', run: 'r7' },
    { id: 'OPTIMISE-T2-16', wave: 'W116', result: 'NOT DRAFTED', reason: 'Not testable.', run: 'r7' }
  ] }));
  fs.writeFileSync(path.join(fx.gemini, 'batch-1.json'), JSON.stringify([
    { criterion: 'EU7-F01', verdict: 'doubt', points: ['Alu-Tab is a phosphate binder.', 'One short supply should not count.'] },
    { criterion: 'EU7-F03', verdict: 'agree', points: [] },
    { criterion: 'EU7 F06', verdict: 'agree', points: [] }
  ]));
  const list = (await get('/api/list')).body.entries;
  const of = id => list.find(e => e.id === id);
  assert.deepEqual([of('EU7-F07').result, of('EU7-F06').opinion], ['pass', 'agree']);     // a number written with a space or in small letters still finds its criterion
  assert.deepEqual([of('EU7-F01').result, of('EU7-F02').result, of('EU7-F03').result, of('OPTIMISE-T2-16').result, of('STOPP-C10').result, of('EU7-F04').result],
    ['fail', 'pass', 'pass', 'none', 'pass', 'none']);
  assert.deepEqual([of('EU7-F01').opinion, of('EU7-F03').opinion, of('EU7-F04').opinion], ['doubt', 'agree', '']);
  const d = (await get('/api/criterion?id=EU7-F01')).body;
  assert.equal(d.result.word, 'Not passing');
  assert.deepEqual(d.result.lines, ['One planted finding was missed: pos-buried.']);
  assert.ok(d.result.from.includes('W101') && d.result.from.includes('r7'));
  assert.equal(d.result.older, '');                                           // the scored copy is the copy shown
  assert.deepEqual(d.opinion.points, ['Alu-Tab is a phosphate binder.', 'One short supply should not count.']);
  assert.equal(d.opinion.file, 'batch-1.json');
  const repaired = (await get('/api/criterion?id=EU7-F02')).body;
  assert.equal(repaired.result.word, 'PASS');
  assert.ok(repaired.result.older.includes('W101'));                          // scored before the repair: the page says so
  assert.equal((await get('/api/criterion?id=OPTIMISE-T2-16')).body.result.word, 'Not drafted');
  await new Promise(r => setTimeout(r, 400));
  fs.writeFileSync(path.join(fx.gemini, 'batch-2.json'), JSON.stringify([{ criterion: 'EU7-F01', verdict: 'wrong', points: ['The statement names aluminium only.'] }]));
  const newer = (await get('/api/criterion?id=EU7-F01')).body.opinion;
  assert.equal(newer.verdict, 'wrong');
  assert.equal(newer.count, 2);
});

await check('B19 search covers names, numbers and medicines', async () => {
  const { texts } = (await get('/api/search-index')).body;
  assert.equal(Object.keys(texts).length, TOTAL);
  assert.ok(texts['STOPP-C10'].includes('celebrex') && texts['STOPP-C10'].includes('warfarin') && texts['STOPP-C10'].includes('stopp c10'));
  assert.ok(texts['OPTIMISE-T2-16'].includes('metformin trial'));
  assert.ok(Object.entries(texts).filter(([, t]) => t.includes('warfarin')).length >= 3);
});

await check('B20 a damaged ledger is never overwritten', async () => {
  const good = fs.readFileSync(fx.ledger);
  fs.writeFileSync(fx.ledger, '{ "reviewer": "x", "entries": { broken');
  const list = await get('/api/list');
  assert.equal(list.status, 500);
  assert.ok(list.body.message.includes('damaged') && list.body.ledger === true);
  const r = await post('/api/sign', { id: 'STOPP-B11', file_hash: sha(fileOf('STOPP-B11')) });
  assert.equal(r.status, 500);
  assert.equal(fs.readFileSync(fx.ledger, 'utf8'), '{ "reviewer": "x", "entries": { broken');
  fs.writeFileSync(fx.ledger, good);
  assert.equal((await get('/api/list')).status, 200);
});

await check('B21 a file that cannot be read is listed, says so, and cannot be signed', async () => {
  const file = fileOf('EU7-F05');
  const good = fs.readFileSync(file);
  fs.writeFileSync(file, '{ "id": "EU7-F05", "label": ');
  const e = await entryOf('EU7-F05');
  assert.equal(e.bad, true);
  assert.equal((await get('/api/list')).body.entries.length, TOTAL);                 // it still counts as one of the criteria
  const d = (await get('/api/criterion?id=EU7-F05')).body;
  assert.ok(d.error.includes('not valid JSON'));
  assert.equal(d.criterion, undefined);
  const r = await sign('EU7-F05', d.hash);
  assert.equal(r.status, 400);
  assert.equal(ledger().entries['EU7-F05'], undefined);
  const c = await post('/api/change', { id: 'EU7-F05', file_hash: d.hash, note: 'This file is broken.' });   // but it can be reported
  assert.equal(c.body.entry.state, 'change');
  fs.writeFileSync(file, good);
  assert.equal((await entryOf('EU7-F05')).state, 'look_again');
  assert.equal((await post('/api/withdraw', { id: 'EU7-F05' })).body.entry.state, 'unsigned');
});

await check('B22 a criterion that is drafted after he agreed to leave it out comes back for a look', async () => {
  const dir = path.join(fx.waves, 'W116', 'criteria', 'OPTIMISE-T2-26');
  const r = await sign('OPTIMISE-T2-26');
  assert.equal(r.body.entry.state, 'nd_agreed');
  fs.copyFileSync(path.join(fx.waves, 'W116', 'criteria', 'OPTIMISE-T2-25', 'criterion.json'), path.join(dir, 'criterion.json'));
  const e = await entryOf('OPTIMISE-T2-26');
  assert.equal(e.kind, 'criterion');
  assert.equal(e.state, 'look_again');
  const d = (await get('/api/criterion?id=OPTIMISE-T2-26')).body;
  assert.equal(d.status.was, 'agreed');
  const counts = (await get('/api/list')).body.counts;
  assert.equal(counts.notDrafted, 2);
  assert.equal(counts.signed + counts.change + counts.left + counts.notDrafted, TOTAL);
  fs.rmSync(path.join(dir, 'criterion.json'));
  assert.equal((await entryOf('OPTIMISE-T2-26')).state, 'nd_agreed');
  await post('/api/withdraw', { id: 'OPTIMISE-T2-26' });
  assert.equal(ledger().not_drafted_agreed['OPTIMISE-T2-26'], undefined);
});

await check('B23 what someone else added to the ledger file is kept when a click is saved', async () => {
  const l = ledger();
  l.added_by_someone_else = { keep: true };
  fs.writeFileSync(fx.ledger, JSON.stringify(l, null, 2));
  await sign('STOPP-B11');
  const now = ledger();
  assert.deepEqual(now.added_by_someone_else, { keep: true });
  assert.equal(now.entries['STOPP-B11'].decision, 'signed');
  assert.deepEqual(Object.keys(now).slice(0, 2), ['reviewer', 'entries']);
  await post('/api/withdraw', { id: 'STOPP-B11' });
});

await check('B24 a second copy of the page on the same port says so and stops', async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [path.join(TOOL, 'server.mjs')], { env: { ...process.env, ...fx.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const code = await new Promise(resolve => child.on('exit', resolve));
  assert.equal(code, 1);
  assert.ok(out.includes(`Port ${port} is already in use`), out);
  assert.equal((await get('/api/list')).status, 200);                               // the first one is still running
});

await check('B25 a file that is only laid out again keeps its signature. A changed word asks for a second look and names the part', async () => {
  const id = 'EU7-F04';
  const file = fileOf(id);
  const original = fs.readFileSync(file);
  const j = JSON.parse(original.toString('utf8'));
  const againBefore = (await get('/api/list')).body.counts.lookAgain;
  assert.equal((await sign(id)).body.entry.state, 'signed');
  // 1. The same words: CRLF line ends, wider spacing, the fields in another order.
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.keys(j).reverse().map(k => [k, j[k]])), null, 4).replace(/\n/g, '\r\n'));
  assert.notEqual(sha(file), ledger().entries[id].file_hash);
  let d = (await get('/api/criterion?id=' + id)).body;
  assert.equal(d.status.state, 'signed');
  assert.equal(d.status.sameWords, true);
  assert.equal(d.status.applied, false);
  assert.equal((await entryOf(id)).state, 'signed');
  assert.equal((await get('/api/list')).body.counts.lookAgain, againBefore);
  // 2. One sentence is added to what the letter asks: look again, and the page is told which part changed.
  const edited = structuredClone(j);
  edited.ask_the_gp += ' Please reply within a week.';
  fs.writeFileSync(file, JSON.stringify(edited, null, 2) + '\n');
  d = (await get('/api/criterion?id=' + id)).body;
  assert.equal(d.status.state, 'look_again');
  assert.equal(d.status.was, 'signed');
  assert.deepEqual(d.status.changed, ['ask_the_gp']);
  assert.equal((await sign(id, ledger().entries[id].file_hash)).status, 409);          // the version he signed can no longer be signed
  // 3. A change request follows the same rule.
  fs.writeFileSync(file, original);
  await post('/api/withdraw', { id });
  await post('/api/change', { id, file_hash: sha(file), note: 'Check the brands.' });
  fs.writeFileSync(file, original.toString('utf8').replace(/\n/g, '\r\n'));
  assert.equal((await entryOf(id)).state, 'change');
  const two = structuredClone(j);
  two.medicine_groups[0].ingredients.push('added-ingredient');
  two.urgency = two.urgency === 'routine' ? 'same_day' : 'routine';
  fs.writeFileSync(file, JSON.stringify(two, null, 2) + '\n');
  d = (await get('/api/criterion?id=' + id)).body;
  assert.equal(d.status.state, 'look_again');
  assert.equal(d.status.was, 'change');
  assert.equal(d.status.note, 'Check the brands.');
  assert.deepEqual(d.status.changed, ['medicine_groups', 'urgency']);
  // 4. The note of one that was not drafted: new line ends keep the agreement, a new word does not.
  const nd = path.join(fx.waves, 'W116', 'criteria', 'OPTIMISE-T2-16', 'NOT_DRAFTED.md');
  const ndText = fs.readFileSync(nd);
  assert.equal((await entryOf('OPTIMISE-T2-16')).state, 'nd_agreed');
  fs.writeFileSync(nd, ndText.toString('utf8').replace(/\r?\n/g, '\r\n') + '\r\n\r\n');
  assert.equal((await entryOf('OPTIMISE-T2-16')).state, 'nd_agreed');
  fs.writeFileSync(nd, ndText.toString('utf8') + '\nOne more reason.\n');
  assert.equal((await entryOf('OPTIMISE-T2-16')).state, 'nd_open');
  fs.writeFileSync(nd, ndText);
  assert.equal((await entryOf('OPTIMISE-T2-16')).state, 'nd_agreed');
  fs.writeFileSync(file, original);
  assert.equal((await post('/api/withdraw', { id })).body.entry.state, 'unsigned');
});

await check('B26 undo of a change request hands his words back, so that the page can put them in the box again', async () => {
  const id = 'EU7-F04';
  const note = 'Strike the second brand.\nIt is not sold here.';
  assert.equal((await post('/api/change', { id, file_hash: (await entryOf(id)).hash, note })).status, 200);
  const r = await undo();
  assert.equal(r.status, 200);
  assert.equal(r.body.id, id);
  assert.equal(r.body.note, note);
  assert.equal(r.body.entry.state, 'unsigned');
  assert.equal(ledger().entries[id], undefined);
  await sign(id);
  const s = await undo();                                                             // a signature has no words to hand back
  assert.equal(s.body.id, id);
  assert.equal(s.body.note, '');
  assert.equal(ledger().entries[id], undefined);
});

await check('B27 the ledger file is put back when it is removed from the disk while the page is running', async () => {
  const before = JSON.parse(fs.readFileSync(fx.ledger, 'utf8'));
  const listBefore = (await get('/api/list')).body;
  assert.ok(Object.keys(before.entries).length >= 3);
  fs.rmSync(fx.ledger);                                                               // the file alone
  const list = (await get('/api/list')).body;
  assert.equal(list.putBack, listBefore.putBack + 1);
  assert.equal(list.reviewer, REVIEWER);
  assert.deepEqual(list.counts, listBefore.counts);
  assert.deepEqual(ledger(), before);
  fs.rmSync(path.dirname(fx.ledger), { recursive: true });                            // the whole folder, backups and all
  assert.equal((await sign('EU7-F04')).status, 200);                                  // the next click finds nothing on disk
  assert.deepEqual(Object.keys(ledger().entries).sort(), [...Object.keys(before.entries), 'EU7-F04'].sort());
  assert.equal(ledger().reviewer, REVIEWER);
  assert.equal(fs.readdirSync(path.join(path.dirname(fx.ledger), 'backups')).length, 1);
  await post('/api/withdraw', { id: 'EU7-F04' });
  assert.deepEqual(ledger(), before);
  assert.ok(server.output().includes('The ledger file was missing from the disk. It was put back'));
});

// ---------- C. apply.mjs, on the copy ----------

const allFiles = () => {
  const out = {};
  const walk = dir => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) walk(p); else if (d.name === 'criterion.json' || d.name === 'NOT_DRAFTED.md') out[p] = sha(p);
    }
  };
  walk(path.join(fx.repo, 'criteria'));
  walk(fx.waves);
  walk(fx.board);
  return out;
};

const originals = {};
const toSign = ['STOPP-C10', 'STOPP-B13', 'EU7-F57', 'START-L4'];        // LF, non-ASCII, CRLF with a very long statement, CRLF
for (const id of ['STOPP-B13', 'EU7-F57', 'START-L4', 'STOPP-D8']) await sign(id);
for (const id of [...toSign, 'STOPP-D8', 'EU7-F01']) originals[id] = fs.readFileSync(fileOf(id));
await post('/api/change', { id: 'STOPP-B3', file_hash: (await entryOf('STOPP-B3')).hash, note: 'Strike Tensig and Bicard.\n\nAdd "Betaloc CR" under metoprolol.' });
fs.writeFileSync(fileOf('STOPP-D8'), fs.readFileSync(fileOf('STOPP-D8'), 'utf8').replace('"Valium"', '"Valium", "Valium Roche"'));   // changed after signing
const staleD8 = fs.readFileSync(fileOf('STOPP-D8'));
const changesFile = path.join(path.dirname(fx.ledger), 'changes.md');

await check('C1 the dry run says what it would do and writes nothing', async () => {
  assert.equal(fs.readFileSync(fileOf('START-L4'), 'latin1').includes('\r\n'), true);
  const before = allFiles();
  const ledgerBefore = fs.readFileSync(fx.ledger, 'utf8');
  const { code, out } = await runApply(fx.env, ['--dry-run']);
  assert.equal(code, 2, out);
  for (const id of [...toSign, 'EU7-F01']) assert.match(out, new RegExp(`WOULD SIGN\\s+${id}\\s`), out);
  assert.match(out, /NOT SIGNED\s+STOPP-D8\s+The file changed after it was signed/);
  assert.match(out, /NOT SIGNED\s+EU7-F02\s+The file changed after it was signed/);
  assert.ok(out.includes('Changes asked for: 2 (STOPP-B3, OPTIMISE-T2-18).'));
  assert.ok(out.includes('Summary: 5 would be signed, 0 already signed, 2 not signed, 2 to change.'));
  assert.ok(out.includes('Nothing was written'));
  assert.deepEqual(allFiles(), before);
  assert.equal(fs.readFileSync(fx.ledger, 'utf8'), ledgerBefore);
  assert.equal(fs.existsSync(changesFile), false);
});

await check('C2 the real run signs each file that is still the file he saw, and changes nothing else in it', async () => {
  const at = Object.fromEntries(Object.entries(ledger().entries).map(([id, e]) => [id, e.at]));
  const { code, out } = await runApply(fx.env);
  assert.equal(code, 2, out);
  for (const id of [...toSign, 'EU7-F01']) {
    assert.match(out, new RegExp(`\\nSIGNED\\s+${id}\\s`), out);
    const date = at[id].slice(0, 10);
    const now = fs.readFileSync(fileOf(id));
    assert.ok(now.equals(expectedSigned(originals[id], REVIEWER, date)), `${id}: more than the two fields changed`);
    const before = JSON.parse(originals[id].toString('utf8'));
    const after = JSON.parse(now.toString('utf8'));
    assert.deepEqual(after, { ...before, draft: false, signed_by_clinical_reviewer: { name: REVIEWER, date } });
    const e = ledger().entries[id];
    assert.equal(e.applied_hash, sha(fileOf(id)));
    assert.match(e.applied_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(e.file_hash, crypto.createHash('sha256').update(originals[id]).digest('hex'));     // the hash of what he was shown is kept
  }
  assert.equal(fs.readFileSync(fileOf('START-L4'), 'latin1').split('\r\n').length, originals['START-L4'].toString('latin1').split('\r\n').length);
  assert.match(out, /NOT SIGNED\s+STOPP-D8\s+The file changed after it was signed/);
  assert.ok(fs.readFileSync(fileOf('STOPP-D8')).equals(staleD8));                                    // never signed, never touched
  assert.equal(JSON.parse(staleD8.toString('utf8')).signed_by_clinical_reviewer, null);
  assert.equal(ledger().entries['STOPP-D8'].applied_hash, undefined);
  assert.ok(out.includes('Summary: 5 signed now, 0 already signed, 2 not signed, 2 to change.'));
});

await check('C3 the changes are written out in his own words, one section for each criterion', async () => {
  const md = fs.readFileSync(changesFile, 'utf8');
  assert.ok(md.startsWith('# Changes asked for by the clinical reviewer'));
  assert.ok(md.includes(`Reviewer: ${REVIEWER}.`));
  assert.ok(md.includes('## STOPP B3 (STOPP-B3): Beta-blocker with verapamil or diltiazem'));
  assert.ok(md.includes('> Strike Tensig and Bicard.\n>\n> Add "Betaloc CR" under metoprolol.'));
  assert.ok(md.includes('## OPTIMISE T2-18 (OPTIMISE-T2-18): Levothyroxine if TSH is above 10 in SMI'));
  assert.ok(md.includes('> Draft it with the missing line dropped.'));
  assert.ok(md.includes('This criterion was not drafted.'));
  assert.ok(md.includes('## Not drafted: the reviewer agrees to leave these out'));
  assert.ok(md.includes('- OPTIMISE T2-16 (OPTIMISE-T2-16)'));
  assert.equal((md.match(/^## /gm) || []).length, 3);
  assert.ok(!md.includes('\u2014'));
});

await check('C4 after the run the page shows the signatures as final, and they cannot be withdrawn there', async () => {
  const d = (await get('/api/criterion?id=STOPP-C10')).body;
  assert.equal(d.status.state, 'signed');
  assert.equal(d.status.applied, true);
  assert.deepEqual(d.status.fileSigned, { name: REVIEWER, date: ledger().entries['STOPP-C10'].at.slice(0, 10) });
  const w = await post('/api/withdraw', { id: 'STOPP-C10' });
  assert.equal(w.status, 409);
  assert.ok(w.body.message.includes('already been written into the file'));
  const counts = (await get('/api/list')).body.counts;
  assert.equal(counts.signed, 5);
  assert.equal(counts.lookAgain, 2);
  assert.equal(counts.signed + counts.change + counts.left + counts.notDrafted, TOTAL);
});

await check('C5 a second run finds them already signed and writes nothing more', async () => {
  const before = allFiles();
  const { code, out } = await runApply(fx.env);
  assert.equal(code, 2);
  for (const id of [...toSign, 'EU7-F01']) assert.match(out, new RegExp(`ALREADY SIGNED\\s+${id}\\s`));
  assert.ok(out.includes('Summary: 0 signed now, 5 already signed, 2 not signed, 2 to change.'));
  assert.deepEqual(allFiles(), before);
});

await check('C6 a changed text is signed only after the audit is of that text, and the run then ends clean', async () => {
  for (const id of ['STOPP-D8', 'EU7-F02']) {
    const d = (await get('/api/criterion?id=' + id)).body;
    assert.equal(d.status.state, 'look_again');
    const refused = await sign(id, d.hash);
    assert.equal(refused.status, 403);
    assert.match(refused.body.message, /earlier text/);
    const top = id === 'EU7-F02'
      ? path.join(fx.board, 'W101-r1', 'criteria', 'EU7-F02', 'criterion.json')
      : fileOf(id);
    const audit = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
    audit[id].parts = lib.contentParts(JSON.parse(fs.readFileSync(top, 'utf8')));
    fs.writeFileSync(fx.audit, JSON.stringify(audit));
    assert.equal((await sign(id, d.hash)).body.entry.state, 'signed');
  }
  const { code, out } = await runApply(fx.env);
  assert.equal(code, 0, out);
  assert.match(out, /\nSIGNED\s+STOPP-D8\s/);
  assert.match(out, /\nSIGNED\s+EU7-F02\s.*W101-r1/);                         // written into the newest copy, the repaired one
  const date = ledger().entries['STOPP-D8'].at.slice(0, 10);
  assert.ok(fs.readFileSync(fileOf('STOPP-D8')).equals(expectedSigned(staleD8, REVIEWER, date)));
  const r1 = JSON.parse(fs.readFileSync(path.join(fx.board, 'W101-r1', 'criteria', 'EU7-F02', 'criterion.json'), 'utf8'));
  assert.equal(r1.draft, false);
  assert.equal(r1.signed_by_clinical_reviewer.name, REVIEWER);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fx.waves, 'W101', 'criteria', 'EU7-F02', 'criterion.json'), 'utf8')).draft, true);   // older copies are left alone
  assert.equal(JSON.parse(fs.readFileSync(path.join(fx.board, 'W101', 'criteria', 'EU7-F02', 'criterion.json'), 'utf8')).draft, true);
});

await check('C7 a change asked for after the signature was written is listed with a warning', async () => {
  const d = (await get('/api/criterion?id=STOPP-B13')).body;
  const r = await post('/api/change', { id: 'STOPP-B13', file_hash: d.hash, note: 'Strike finerenone after all.' });
  assert.equal(r.body.entry.state, 'change');
  const { code, out } = await runApply(fx.env, ['--dry-run']);
  assert.equal(code, 0, out);
  const real = await runApply(fx.env);
  assert.equal(real.code, 0, real.out);
  const md = fs.readFileSync(changesFile, 'utf8');
  const section = md.slice(md.indexOf('## STOPP B13'));
  assert.ok(section.includes('This file carries a signature. Clear it when the change is made'));
  assert.ok(section.includes('> Strike finerenone after all.'));
});

await check('C8 with no ledger there is nothing to do, and an unknown option is refused', async () => {
  const none = await runApply({ ...fx.env, SIGNOFF_LEDGER: path.join(fx.root, 'nowhere', 'ledger.json') });
  assert.equal(none.code, 0);
  assert.ok(none.out.includes('There is no ledger yet.'));
  assert.equal(fs.existsSync(path.join(fx.root, 'nowhere')), false);
  const bad = await runApply(fx.env, ['--force']);
  assert.equal(bad.code, 1);
});

await check('C9 apply signs a file that was only laid out again after he signed it, and refuses one in which a word changed', async () => {
  const a = 'EU7-F03';
  const b = 'EU7-F04';
  for (const id of [a, b]) assert.equal((await sign(id)).body.entry.state, 'signed');
  const ja = JSON.parse(fs.readFileSync(fileOf(a), 'utf8'));
  const laid = JSON.stringify(Object.fromEntries(Object.keys(ja).reverse().map(k => [k, ja[k]])), null, 4).replace(/\n/g, '\r\n') + '\r\n';
  fs.writeFileSync(fileOf(a), laid);                                                    // other line ends, other spacing, other order: the same words
  const jb = JSON.parse(fs.readFileSync(fileOf(b), 'utf8'));
  jb.urgency = jb.urgency === 'routine' ? 'same_day' : 'routine';
  fs.writeFileSync(fileOf(b), JSON.stringify(jb, null, 2) + '\n');                      // one value changed
  const staleB = fs.readFileSync(fileOf(b));
  const dry = await runApply(fx.env, ['--dry-run']);
  assert.match(dry.out, new RegExp(`WOULD SIGN\\s+${a}\\s.*laid out again`));
  assert.match(dry.out, new RegExp(`NOT SIGNED\\s+${b}\\s+The file changed after it was signed`));
  assert.equal(fs.readFileSync(fileOf(a), 'utf8'), laid);
  const real = await runApply(fx.env);
  assert.equal(real.code, 2, real.out);
  assert.match(real.out, new RegExp(`\\nSIGNED\\s+${a}\\s.*laid out again`));
  const now = fs.readFileSync(fileOf(a), 'utf8');
  const date = ledger().entries[a].at.slice(0, 10);
  assert.equal(now, laid.replace('"draft": true', '"draft": false')
    .replace('"signed_by_clinical_reviewer": null', `"signed_by_clinical_reviewer": { "name": ${JSON.stringify(REVIEWER)}, "date": "${date}" }`));
  assert.deepEqual(JSON.parse(now), { ...JSON.parse(laid), draft: false, signed_by_clinical_reviewer: { name: REVIEWER, date } });
  assert.ok(fs.readFileSync(fileOf(b)).equals(staleB));                                 // refused, and left as it is
  let d = (await get('/api/criterion?id=' + a)).body;
  assert.equal(d.status.state, 'signed');
  assert.equal(d.status.applied, true);
  d = (await get('/api/criterion?id=' + b)).body;
  assert.equal(d.status.state, 'look_again');
  assert.deepEqual(d.status.changed, ['urgency']);
  // The signed file is laid out once more: it still counts as signed and final, and apply leaves it alone.
  const relaid = JSON.stringify(JSON.parse(now), null, 2) + '\n';
  fs.writeFileSync(fileOf(a), relaid);
  d = (await get('/api/criterion?id=' + a)).body;
  assert.equal(d.status.state, 'signed');
  assert.equal(d.status.sameWords, true);
  assert.equal(d.status.applied, true);
  assert.equal((await post('/api/withdraw', { id: a })).status, 409);
  const again = await runApply(fx.env);
  assert.match(again.out, new RegExp(`ALREADY SIGNED\\s+${a}\\s.*laid out again`));
  assert.equal(fs.readFileSync(fileOf(a), 'utf8'), relaid);
});

// ---------- C2. the audit of 19 November ----------

await check('C1 audit records are picked up as soon as the file appears, and a rewrite is seen', async () => {
  const savedAudit = fs.readFileSync(fx.audit, 'utf8');                     // the copy starts with an audit file: take it away for this check
  fs.rmSync(fx.audit);
  try {
  assert.equal((await entryOf('EU7-F04')).audit, null);
  fs.writeFileSync(fx.audit, JSON.stringify({
    'EU7-F04': { final: 'SOUND', note_for_founder: 'No change is needed.', needs_rescore: false, points: [
      { decision: 'IMPROVEMENT', field: 'plain_summary', problem: 'A plainer first line was possible.', change: '', status: 'NO CHANGE' }
    ] },
    'EU7-F01': { final: 'CHANGE', note_for_founder: 'Fix the age limit, then re-score.', needs_rescore: true, points: [
      { decision: 'ERROR', field: 'rule_for_models', problem: 'The age limit drifts from the source.', change: 'From: 15 to 49 | To: over 18', status: 'FOR YOU' },
      { decision: 'AUSTRALIA', field: 'medicine_groups', problem: '', change: 'Add the Australian brands.', status: 'TO BE APPLIED' },
      { decision: 'STRANGE', field: '', problem: 'An unknown decision word stays unclassified.', change: '', status: 'WEIRD' }
    ] },
    'not-a-real-id': { final: 'FOUNDER', note_for_founder: 'x', points: [] }
  }));
  const list = (await get('/api/list')).body.entries;
  const of = id => list.find(e => e.id === id);
  assert.equal(of('EU7-F04').audit.final, 'SOUND');
  assert.equal(of('EU7-F04').audit.auditComplete, false);                   // a record without audit_complete is never ready to sign
  assert.equal(of('EU7-F04').audit.finalTestState, '');
  assert.equal(of('EU7-F01').audit.final, 'CHANGE');
  assert.equal(of('EU7-F01').audit.forYou, true);
  assert.equal(of('EU7-F01').audit.points, 3);
  assert.equal(of('EU7-F03').audit, null);
  const d = (await get('/api/criterion?id=EU7-F01')).body;
  assert.equal(d.audit.final, 'CHANGE');
  assert.equal(d.audit.note, 'Fix the age limit, then re-score.');
  assert.equal(d.audit.needsRescore, true);
  assert.equal(d.audit.forYou, true);
  assert.equal(d.audit.counts['FOR YOU'], 1);
  assert.equal(d.audit.counts['TO BE APPLIED'], 1);
  assert.equal(d.audit.counts['OTHER'], 1);                                 // unknown statuses are kept and counted, not dropped
  assert.deepEqual(d.audit.points.map(p => p.status), ['FOR YOU', 'TO BE APPLIED', '']);
  assert.equal(d.audit.points[2].decision, '');                             // unknown decisions are not invented
  const sound = (await get('/api/criterion?id=EU7-F04')).body;
  assert.equal(sound.audit.final, 'SOUND');
  assert.equal(sound.audit.points[0].status, 'NO CHANGE');
  await new Promise(r => setTimeout(r, 1100));                              // the memo is on the file's mtime: let it change
  fs.writeFileSync(fx.audit, JSON.stringify({ 'EU7-F04': { final: 'FOUNDER', note_for_founder: 'Now it waits for you.', points: [
    { decision: 'FOUNDER', field: 'urgency', problem: 'Same day or not?', change: '', status: 'FOR YOU' }
  ] } }));
  const again = (await get('/api/criterion?id=EU7-F04')).body;
  assert.equal(again.audit.final, 'FOUNDER');
  assert.equal(again.audit.forYou, true);
  assert.equal((await entryOf('EU7-F01')).audit, null);                     // ids that left the file are gone on the next read
  } finally {
    await new Promise(r => setTimeout(r, 1100));
    fs.writeFileSync(fx.audit, savedAudit);                                 // the audit file of the copy is back for the checks that follow
  }
});

let guardId = '';

// ---------- E. founder sign-off bar, filters and guard ----------

await check('E1 the audit file is read again when it changes on disk', async () => {
  const before = (await get('/api/list')).body.signoff.finalTest.passed;
  await new Promise(r => setTimeout(r, 1100));
  const j = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
  j['STOPP-B3'].final_test = { state: 'WAITING', text: 'Final test: waiting again.' };
  j['EXTRA-WAIT'] = { final: 'CHANGE', audit_complete: false, note_for_founder: 'Wait.', points: [], final_test: { state: 'WAITING', text: 'Final test: waiting.' } };
  fs.writeFileSync(fx.audit, JSON.stringify(j));
  const after = (await get('/api/list')).body;
  assert.ok(after.signoff.finalTest.total >= before);
  assert.equal((await entryOf('STOPP-B3')).audit.finalTestState, 'WAITING');
});

await check('E2 the top line counts passed, ready and signed', async () => {
  const j = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
  j['TALLY-PASS'] = { final: 'SOUND', audit_complete: true, note_for_founder: 'Final test: PASSED.', points: [], final_test: { state: 'PASSED', text: 'Final test: PASSED.' } };
  j['TALLY-FAIL'] = { final: 'CHANGE', audit_complete: false, note_for_founder: 'Final test: did not pass.', points: [], final_test: { state: 'DID NOT PASS', text: 'Final test: DID NOT PASS.' } };
  fs.writeFileSync(fx.audit, JSON.stringify(j));
  const list = (await get('/api/list')).body;
  const ft = list.signoff.finalTest;
  assert.ok(ft.total >= 2 && ft.passed >= 1);
  assert.ok(list.signoff.ready >= 1);
  assert.equal(typeof list.signoff.signed, 'number');
  assert.deepEqual(lib.countFinalTest(lib.auditsOf(lib.loadConfig(fx.env))), ft);
});

await check('E3 each sign-off list filter matches the rows', async () => {
  const list = (await get('/api/list')).body.entries;
  const firstReady = list.find(e => e.canSign && e.audit && e.audit.auditComplete);
  assert.ok(firstReady, 'the copy holds a criterion that can be signed');
  guardId = firstReady.id;
  const ready = id => list.find(e => e.id === id);
  assert.ok(ready(guardId).canSign);
  assert.equal(ready(guardId).audit.auditComplete, true);
  const j = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
  j[guardId].audit_complete = false;
  j[guardId].final_test = { state: 'WAITING', text: 'Final test: not yet.' };
  fs.writeFileSync(fx.audit, JSON.stringify(j));
  assert.equal((await entryOf(guardId)).canSign, false);
});

await check('E4 the server refuses a signature when audit_complete is not true', async () => {
  const hash = (await entryOf(guardId)).hash;
  const r = await sign(guardId, hash);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /^Not ready to sign:/);
  const fix = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
  fix[guardId].audit_complete = true;
  fix[guardId].final_test = { state: 'PASSED', text: 'Final test: PASSED.' };
  fs.writeFileSync(fx.audit, JSON.stringify(fix));
  assert.equal((await sign(guardId)).status, 200);
});

await check('E5 a set-aside criterion is only in ALL and cannot be signed', async () => {
  const j = JSON.parse(fs.readFileSync(fx.audit, 'utf8'));
  j['EU7-F04'] = {
    final: 'SET ASIDE', audit_complete: false,
    note_for_founder: 'Set aside.', points: [{ decision: 'SETTLED', field: 'rule', problem: 'x', change: 'y', status: 'SET ASIDE' }],
    final_test: { state: 'SET ASIDE', text: 'Set aside: not in use.' }
  };
  fs.writeFileSync(fx.audit, JSON.stringify(j));
  const e = await entryOf('EU7-F04');
  assert.equal(e.audit.setAside, true);
  assert.equal(e.canSign, false);
  assert.equal((await sign('EU7-F04', e.hash)).status, 403);
});

await check('E6 repo, ledger and audit only: every criterion is read from the repository', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-repo-only-'));
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, 'criteria', 'STOPP-C10', 'cases'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'docs', 'signoff'), { recursive: true });
    fs.mkdirSync(path.join(repo, 'public'), { recursive: true });
    fs.cpSync(path.join(REAL_REPO, 'criteria', 'STOPP-C10'), path.join(repo, 'criteria', 'STOPP-C10'), { recursive: true });
    fs.copyFileSync(path.join(REAL_REPO, 'criteria', 'active.json'), path.join(repo, 'criteria', 'active.json'));
    fs.copyFileSync(path.join(REAL_REPO, 'docs', 'CRITERIA_SHEET.md'), path.join(repo, 'docs', 'CRITERIA_SHEET.md'));
    fs.copyFileSync(path.join(REAL_REPO, 'public', 'mark.svg'), path.join(repo, 'public', 'mark.svg'));
    const ledger = path.join(root, 'ledger.json');
    const audit = path.join(root, 'audit.json');
    fs.writeFileSync(audit, JSON.stringify({
      'STOPP-C10': { final: 'SOUND', audit_complete: true, note_for_founder: 'Final test: PASSED.', points: [], final_test: { state: 'PASSED', text: 'Final test: PASSED.' } }
    }));
    const env = { SIGNOFF_REPO: repo, SIGNOFF_LEDGER: ledger, SIGNOFF_AUDIT: audit };
    const idx = lib.buildIndex(lib.loadConfig(env), true);
    assert.equal(idx.entries.length, 1);
    assert.equal(idx.entries[0].top.place.where, 'repo');
    assert.equal(lib.loadConfig(env).waves, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

await check('E7 a missing audit file blocks signing and reports it in signoff', async () => {
  const port2 = await freePort();
  const env2 = { ...fx.env, SIGNOFF_AUDIT: path.join(fx.root, 'no-audit.json') };
  const srv = await startServer(env2, port2);
  const base2 = srv.base;
  const g = async p => { const r = await fetch(base2 + p); return { status: r.status, body: await r.json() }; };
  const list = await g('/api/list');
  assert.equal(list.body.signoff.auditOk, false);
  assert.match(list.body.signoff.auditError, /audit file/i);
  const p = async (pth, body) => {
    const r = await fetch(base2 + pth, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signoff': '1' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const hash = list.body.entries.find(e => e.id === 'STOPP-B11').hash;
  assert.equal((await p('/api/sign', { id: 'STOPP-B11', file_hash: hash })).status, 503);
  await srv.stop();
});

await check('E8 audit detail holds final_test, extra note and a points summary', async () => {
  const d = (await get('/api/criterion?id=STOPP-C10')).body;
  assert.equal(d.audit.finalTest.state, 'PASSED');
  assert.ok(d.audit.pointsSummary.line.includes('Audit of 19 November'));
  assert.ok(d.audit.finalTest.text);
});

await check('G-LISTS-1 a list is decided once, and the signature, the hash, the state and the ready count stay as they were', async () => {
  const small = makeFixture({ repoIds: ['BRISNIK-HR-A1'], waves: [] });
  const port = await freePort();
  const markers = lib.markersFile(small.repo);
  const listsFile = path.join(path.dirname(small.ledger), 'lists-ledger.json');
  const heart = {
    condition: 'chronic heart failure', question: 'Does this patient have chronic heart failure?',
    fact_names: ['  heart failure  ', 'chronic heart failure'],
    points_to_it: [{ ingredient: 'sacubitril with valsartan', brands: ['Entresto'] }],
    also_used_for_it: [{ ingredient: 'ramipril', brands: ['Tritace'] }],
    no_medicine_points_to_it: 'A diagnosis written on the record still counts.',
    what_the_list_misses: 'A medicine supplied under a name that is not in this list.'
  };
  const srv = await startServer(small.env, port);
  const g = async p => { const r = await fetch(srv.base + p); return { status: r.status, body: await r.json() }; };
  const p = async (pathName, body) => {
    const r = await fetch(srv.base + pathName, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Signoff': '1' }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const ledgerBytes = () => fs.readFileSync(small.ledger);
  try {
    const page = await (await fetch(srv.base + '/')).text();
    assert.match(page, /id="lists-link">Condition lists</);
    assert.match(page, /THIS LIST IS RIGHT/);
    assert.match(page, /NEEDS A CHANGE/);
    assert.match(page, /You marked this list right on /);
    assert.match(page, /You asked for a change to this list: /);
    assert.match(page, /You have not looked at this list yet\./);
    assert.match(page, /You decided this on an earlier version of the list\. It has changed since: look again\./);
    assert.match(page, /showLists\(f\.listMark\.key\)/);
    fs.mkdirSync(path.dirname(markers), { recursive: true });
    fs.writeFileSync(markers, JSON.stringify({ conditions: [heart] }));
    assert.equal((await p('/api/list-right', { key: 'chronic heart failure', fingerprint: 'x' })).body.message, 'Type your name first.');
    assert.equal(fs.existsSync(listsFile), false);
    assert.equal((await p('/api/reviewer', { name: REVIEWER })).status, 200);
    const before = await g('/api/list');
    const beforeDetail = await g('/api/criterion?id=BRISNIK-HR-A1');
    const frozen = ledgerBytes();
    const hash = before.body.entries[0].hash;
    const state = before.body.entries[0].state;
    const ready = before.body.signoff.ready;
    assert.equal(before.body.listDecisions.notLookedAt, 1);
    assert.equal(before.body.listDecisions.right, 0);
    assert.equal(beforeDetail.body.criterion.facts[0].listMark.state, 'not_looked');
    assert.equal(beforeDetail.body.criterion.facts[0].listMark.key, 'chronic heart failure');
    const fp = beforeDetail.body.criterion.facts[0].listMark.fingerprint;
    assert.equal(fp, lib.listFingerprint(heart));
    const listed = before.body.conditionLists.conditions[0];
    assert.equal(listed.question, heart.question);
    assert.equal(listed.none, heart.no_medicine_points_to_it);
    assert.equal(listed.miss, heart.what_the_list_misses);
    assert.equal(listed.pointing[0].name, 'sacubitril with valsartan (Entresto)');
    assert.ok(listed.criteria.some(c => c.id === 'BRISNIK-HR-A1'));
    const marked = await p('/api/list-right', { key: 'Chronic Heart Failure', fingerprint: fp });
    assert.equal(marked.status, 200);
    assert.deepEqual(marked.body.listDecisions, { right: 1, change: 0, notLookedAt: 0, changedSince: 0 });
    assert.equal(marked.body.signoff.ready, ready);
    assert.equal(marked.body.counts.signed, before.body.counts.signed);
    assert.ok(ledgerBytes().equals(frozen));
    const row = JSON.parse(fs.readFileSync(listsFile, 'utf8'));
    assert.equal(row.version, 1);
    assert.equal(row.lists['chronic heart failure'].decision, 'right');
    assert.equal(row.lists['chronic heart failure'].by, REVIEWER);
    assert.equal(row.lists['chronic heart failure'].fingerprint, fp);
    assert.deepEqual(row.lists['chronic heart failure'].medicines, ['sacubitril with valsartan (Entresto)', 'ramipril (Tritace)']);
    const backups = fs.readdirSync(path.join(path.dirname(listsFile), 'backups')).filter(n => n.startsWith('lists-ledger-'));
    assert.equal(backups.length, 1);
    assert.match(backups[0], /^lists-ledger-\d{4}-\d{2}-\d{2}-\d{2}00\.json$/);
    const afterRight = await g('/api/criterion?id=BRISNIK-HR-A1');
    assert.equal(afterRight.body.hash, hash);
    assert.equal(afterRight.body.state, state);
    assert.equal(afterRight.body.criterion.facts[0].listMark.state, 'right');
    const note = 'Add digoxin.\nKeep the line.';
    assert.equal((await p('/api/list-change', { key: 'chronic heart failure', fingerprint: fp, note: '   ' })).status, 400);
    const changed = await p('/api/list-change', { key: 'chronic heart failure', fingerprint: fp, note });
    assert.equal(changed.status, 200);
    assert.deepEqual(changed.body.listDecisions, { right: 0, change: 1, notLookedAt: 0, changedSince: 0 });
    assert.equal(JSON.parse(fs.readFileSync(listsFile, 'utf8')).lists['chronic heart failure'].note, note);
    assert.ok(ledgerBytes().equals(frozen));
    assert.equal((await g('/api/criterion?id=BRISNIK-HR-A1')).body.criterion.facts[0].listMark.note, note);
    assert.equal((await g('/api/criterion?id=BRISNIK-HR-A1')).body.state, state);
    const listsBeforeSign = fs.readFileSync(listsFile);
    const signed = await p('/api/sign', { id: 'BRISNIK-HR-A1', file_hash: hash });
    assert.equal(signed.status, 200, signed.body.message);
    assert.equal(signed.body.entry.state, 'signed');
    assert.equal(signed.body.signoff.ready, ready - 1);
    assert.ok(fs.readFileSync(listsFile).equals(listsBeforeSign));
    assert.equal((await g('/api/list')).body.listDecisions.change, 1);
    assert.equal((await g('/api/criterion?id=BRISNIK-HR-A1')).body.hash, hash);
    const grown = structuredClone(heart);
    grown.points_to_it.push({ ingredient: 'ivabradine', brands: ['Coralan'] });
    fs.writeFileSync(markers, JSON.stringify({ conditions: [grown] }));
    const looked = await g('/api/criterion?id=BRISNIK-HR-A1');
    assert.equal(looked.body.criterion.facts[0].listMark.state, 'changed_since');
    assert.deepEqual(looked.body.criterion.facts[0].listMark.added, ['ivabradine (Coralan)']);
    assert.deepEqual(looked.body.criterion.facts[0].listMark.removed, []);
    assert.equal(looked.body.state, 'signed');
    assert.equal(looked.body.hash, hash);
    const counted = await g('/api/list');
    assert.deepEqual(counted.body.listDecisions, { right: 0, change: 0, notLookedAt: 0, changedSince: 1 });
    assert.equal(counted.body.signoff.ready, ready - 1);
    const stale = await p('/api/list-right', { key: 'chronic heart failure', fingerprint: fp });
    assert.equal(stale.status, 409);
    assert.match(stale.body.message, /This list changed while you were reading it/);
    assert.ok(fs.readFileSync(listsFile).equals(listsBeforeSign));
    const undoSign = await p('/api/undo', { token: signed.body.undo.token });
    assert.equal(undoSign.body.id, 'BRISNIK-HR-A1');
    assert.equal(undoSign.body.entry.state, 'unsigned');
    assert.ok(fs.readFileSync(listsFile).equals(listsBeforeSign));
    assert.ok(ledgerBytes().equals(frozen));
    const undoChange = await p('/api/undo', { token: undoSign.body.undo.token });
    assert.equal(undoChange.body.kind, 'list');
    assert.equal(undoChange.body.note, note);
    assert.equal(JSON.parse(fs.readFileSync(listsFile, 'utf8')).lists['chronic heart failure'].decision, 'right');
    assert.ok(ledgerBytes().equals(frozen));
    const undoRight = await p('/api/undo', { token: undoChange.body.undo.token });
    assert.equal(undoRight.body.kind, 'list');
    assert.deepEqual(JSON.parse(fs.readFileSync(listsFile, 'utf8')).lists, {});
    assert.ok(ledgerBytes().equals(frozen));
    assert.equal((await g('/api/list')).body.listDecisions.notLookedAt, 1);
    fs.writeFileSync(listsFile, '{');
    const stillSigns = await p('/api/sign', { id: 'BRISNIK-HR-A1', file_hash: hash });
    assert.equal(stillSigns.status, 200, stillSigns.body.message);
    assert.equal(stillSigns.body.entry.state, 'signed');
    assert.equal(fs.readFileSync(listsFile, 'utf8'), '{');
    const broken = await g('/api/list');
    assert.equal(broken.status, 500);
    assert.match(broken.body.message, /damaged/);
    assert.equal(fs.readFileSync(listsFile, 'utf8'), '{');
  } finally {
    await srv.stop();
    removeFolder(small.root);
  }
});

// ---------- D. stop ----------

await check('F1 the same ledger and the same criteria give the same list with and without the medicine file, except the new display field', async () => {
  const small = makeFixture({ repoIds: ['BRISNIK-HR-A1'], waves: [] });
  const port = await freePort();
  const markers = lib.markersFile(small.repo);
  const criterionFile = path.join(small.repo, 'criteria', 'BRISNIK-HR-A1', 'criterion.json');
  const parts = lib.contentParts(JSON.parse(fs.readFileSync(criterionFile, 'utf8')));
  const ledgerBytes = () => fs.readFileSync(small.ledger);
  fs.mkdirSync(path.dirname(small.ledger), { recursive: true });
  fs.writeFileSync(small.ledger, JSON.stringify({ reviewer: 'A. Reviewer', entries: {} }) + '\n');
  const heartOnly = {
    what_this_is: 'test', version: '2026-11-20',
    conditions: [{
      condition: 'myasthenia gravis', question: 'Does this patient have myasthenia gravis?',
      fact_names: ['Myasthenia gravis'],
      points_to_it: [{ ingredient: 'pyridostigmine', brands: ['Mestinon'] }],
      also_used_for_it: [], no_medicine_points_to_it: '', what_the_list_misses: ''
    }]
  };
  const withHeart = {
    what_this_is: 'test', version: '2026-11-20',
    conditions: [{
      condition: 'chronic heart failure', question: 'Does this patient have chronic heart failure?',
      fact_names: ['  heart failure  ', 'chronic heart failure'],
      points_to_it: [{ ingredient: 'sacubitril with valsartan', brands: ['Entresto'], forms: [], also_points_to: [] }],
      also_used_for_it: [{ ingredient: 'ramipril', brands: ['Tritace'] }],
      no_medicine_points_to_it: 'A diagnosis written on the record still counts.',
      what_the_list_misses: 'A medicine supplied under a name that is not in this list.'
    }]
  };
  const comparable = body => {
    const copy = structuredClone(body);
    delete copy.serverTime;
    delete copy.conditionLists;
    delete copy.listDecisions;
    return copy;
  };
  const srv = await startServer(small.env, port);
  const g = async p => { const r = await fetch(srv.base + p); return { status: r.status, body: await r.json() }; };
  try {
    const page = await (await fetch(srv.base + '/')).text();
    assert.ok(page.includes('f.markers'));
    assert.ok(page.includes('f.markerMeds'));
    assert.ok(page.includes('conditionNote'));
    assert.ok(!page.includes('\u2014'));
    const beforeLedger = ledgerBytes();
    const beforeFile = fs.readFileSync(criterionFile);
    const absent = await g('/api/list');
    assert.equal(absent.status, 200);
    assert.equal(absent.body.conditionLists, null);
    const bare = await g('/api/criterion?id=BRISNIK-HR-A1');
    assert.equal(bare.body.criterion.conditionNote, '');
    assert.equal(bare.body.criterion.facts[0].markers, null);
    assert.ok(bare.body.criterion.facts[0].rules.some(line => line.startsWith('Answers: ')));
    assert.equal(bare.body.criterion.facts[0].rules.some(line => line.includes('Entresto')), false);
    assert.deepEqual(lib.contentParts(JSON.parse(fs.readFileSync(criterionFile, 'utf8'))), parts);

    fs.mkdirSync(path.dirname(markers), { recursive: true });
    fs.writeFileSync(markers, JSON.stringify(heartOnly));
    const pending = await g('/api/criterion?id=BRISNIK-HR-A1');
    assert.deepEqual(pending.body.criterion.facts[0].markers, [lib.CONDITION_LIST_PENDING]);
    assert.equal(pending.body.criterion.conditionNote, lib.CONDITION_LIST_NOTE);
    assert.equal(pending.body.hash, bare.body.hash);

    fs.writeFileSync(markers, JSON.stringify(withHeart));
    const shown = await g('/api/criterion?id=BRISNIK-HR-A1');
    const shownLines = shown.body.criterion.facts[0].markers;
    assert.equal(shownLines[0], 'Medicines that point to this condition (the application asks about it when one is supplied): sacubitril with valsartan (Entresto) source not recorded');
    assert.equal(shownLines[1], 'Other medicines used for it, which have other uses (never asked alone): ramipril (Tritace)');
    assert.equal(shownLines[2], 'No medicine points to this condition: A diagnosis written on the record still counts.');
    assert.equal(shownLines[3], 'What the list can miss: A medicine supplied under a name that is not in this list.');
    assert.equal(shown.body.hash, bare.body.hash);
    assert.equal(shown.body.state, bare.body.state);
    const listed = await g('/api/list');
    assert.deepEqual(comparable(listed.body), comparable(absent.body));
    assert.equal(listed.body.conditionLists.note, lib.CONDITION_LIST_NOTE);
    assert.equal(listed.body.conditionLists.conditions[0].fact_names[1], 'chronic heart failure');
    assert.equal(listed.body.signoff.ready, absent.body.signoff.ready);
    assert.equal(listed.body.entries[0].hash, absent.body.entries[0].hash);
    assert.ok(ledgerBytes().equals(beforeLedger));
    assert.ok(fs.readFileSync(criterionFile).equals(beforeFile));

    const sourcedDoc = structuredClone(withHeart);
    sourcedDoc.conditions[0].points_to_it[0].source = 'PBS restriction';
    sourcedDoc.conditions[0].points_to_it[0].page = 'https://www.pbs.gov.au/medicine/item/1234';
    sourcedDoc.conditions[0].also_used_for_it[0].source = 'registered indication';
    sourcedDoc.conditions[0].also_used_for_it.push({ ingredient: 'furosemide', brands: ['Lasix'], source: 'PBS restriction', page: 'http://example.com/not-https' });
    fs.writeFileSync(markers, JSON.stringify(sourcedDoc));
    const sourced = await g('/api/criterion?id=BRISNIK-HR-A1');
    const meds = sourced.body.criterion.facts[0].markerMeds;
    assert.equal(meds.pointing[0].name, 'sacubitril with valsartan (Entresto)');
    assert.equal(meds.pointing[0].words, 'PBS restriction');
    assert.equal(meds.pointing[0].href, 'https://www.pbs.gov.au/medicine/item/1234');
    assert.equal(meds.other[0].words, 'registered indication');
    assert.equal(meds.other[0].href, '');
    assert.equal(meds.other[1].name, 'furosemide (Lasix)');
    assert.equal(meds.other[1].words, 'PBS restriction http://example.com/not-https');
    assert.equal(meds.other[1].href, '');
    assert.equal(sourced.body.criterion.facts[0].markers[0].includes('source not recorded'), false);
    assert.equal(sourced.body.hash, bare.body.hash);
    assert.equal(sourced.body.state, bare.body.state);
    const sourcedList = await g('/api/list');
    assert.deepEqual(comparable(sourcedList.body), comparable(absent.body));
    assert.equal(sourcedList.body.signoff.ready, absent.body.signoff.ready);
    assert.equal(sourcedList.body.entries[0].hash, absent.body.entries[0].hash);
    assert.ok(ledgerBytes().equals(beforeLedger));
    assert.ok(fs.readFileSync(criterionFile).equals(beforeFile));

    fs.rmSync(markers);
    fs.mkdirSync(markers); // unreadable as a file
    const blocked = await g('/api/list');
    assert.equal(blocked.status, 200);
    assert.equal(blocked.body.conditionLists, null);
    assert.deepEqual(comparable(blocked.body), comparable(absent.body));
    const blockedDetail = await g('/api/criterion?id=BRISNIK-HR-A1');
    assert.equal(blockedDetail.body.criterion.facts[0].markers, null);
    assert.equal(blockedDetail.body.criterion.conditionNote, '');
    fs.rmSync(markers, { recursive: true });
    const gone = await g('/api/list');
    assert.equal(gone.body.conditionLists, null);
    assert.deepEqual(comparable(gone.body), comparable(absent.body));
    assert.ok(ledgerBytes().equals(beforeLedger));
  } finally {
    await srv.stop();
    removeFolder(small.root);
  }
});

await check('D1 the server stops, and nothing answers on its port afterwards', async () => {
  assert.equal(await server.stop(), true);
});

removeFolder(fx.root);
const failed = results.filter(ok => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed.${failed ? ` ${failed} FAILED.` : ''}`);
process.exitCode = failed ? 1 : 0;
