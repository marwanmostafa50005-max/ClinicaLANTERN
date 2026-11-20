// Makes the reviewer's signatures final.
//   node tools\signoff\apply.mjs            writes the signatures and the list of changes
//   node tools\signoff\apply.mjs --dry-run  only says what it would do. It writes nothing.
//
// For every ledger entry "signed" whose file is still the file the reviewer was shown (same sha256),
// it sets "draft" to false and "signed_by_clinical_reviewer" to { name, date } in that criterion.json.
// The name and the date are the ones recorded on that decision. A name typed later is not used.
// Every other byte of the file stays as it was. A file whose words have changed since it was signed
// is never signed, and the script says so. A file that was only laid out again (line ends, spacing,
// the order of the fields) says the same thing: it is signed, and the script says that too.
// For every entry "change" it writes one section into changes.md.
import fs from 'node:fs';
import path from 'node:path';
import {
  loadConfig, buildIndex, readLedger, writeLedger, readFresh, signedBytes, sha256, writeWhole, statusOf, localIso,
  contentParts, sameWordsAs, WHERE_WORDS, LedgerError
} from './lib.mjs';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const notKnown = args.filter(a => a !== '--dry-run');
if (notKnown.length) {
  console.error(`Not understood: ${notKnown.join(' ')}`);
  console.error('Use:  node tools\\signoff\\apply.mjs            or   node tools\\signoff\\apply.mjs --dry-run');
  process.exit(1);
}

const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
const short = hash => String(hash ?? '').slice(0, 12) || 'none';

function whenWords(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'a time that was not recorded';
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) + ' at ' +
    d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

function whereWords(entry) {
  const p = entry.top.place;
  return p.wave ? `${WHERE_WORDS[p.where]}, ${p.wave}` : WHERE_WORDS[p.where];
}

function main() {
  const cfg = loadConfig();
  console.log(`ClinicaLANTERN sign-off: apply${dry ? ' (dry run: nothing is written)' : ''}`);
  console.log(`Ledger: ${cfg.ledger}`);
  if (!fs.existsSync(cfg.ledger)) {
    console.log('There is no ledger yet. Nothing has been signed on the sign-off page, so there is nothing to do.');
    return 0;
  }
  const ledger = readLedger(cfg);
  const reviewer = typeof ledger.reviewer === 'string' ? ledger.reviewer.trim() : '';
  console.log(`Reviewer: ${reviewer || '(no name in the ledger)'}`);
  console.log('');

  const index = buildIndex(cfg, true);
  const order = id => index.byId.get(id)?.position ?? 100000;
  const ids = Object.keys(ledger.entries).sort((a, b) => order(a) - order(b) || a.localeCompare(b));

  const planned = [];            // signatures to write
  const lines = [];
  let already = 0;
  let notSigned = 0;
  let failed = 0;
  const changes = [];
  const say = (word, id, text) => lines.push(`${word.padEnd(15)} ${id.padEnd(22)} ${text}`);

  for (const id of ids) {
    const e = ledger.entries[id];
    if (!isObj(e)) continue;
    const entry = index.byId.get(id);
    if (e.decision === 'change') {
      changes.push({ id, e, entry });
      continue;
    }
    if (e.decision !== 'signed') {
      say('LEFT ALONE', id, `The ledger holds a decision this script does not know ("${e.decision}").`);
      continue;
    }
    if (!entry) {
      notSigned++;
      say('NOT SIGNED', id, 'No file was found for this criterion in any folder.');
      continue;
    }
    if (entry.kind !== 'criterion') {
      notSigned++;
      say('NOT SIGNED', id, `The newest copy is now a "not drafted" note, not the file that was signed (${whereWords(entry)}).`);
      continue;
    }
    const file = entry.top.file;
    const now = readFresh(file);
    if (!now) {
      notSigned++;
      say('NOT SIGNED', id, `The file could not be read: ${file}`);
      continue;
    }
    if (e.applied_hash && now.hash === e.applied_hash) {
      already++;
      say('ALREADY SIGNED', id, `${file} (${whereWords(entry)})`);
      continue;
    }
    const signer = typeof e.reviewer === 'string' ? e.reviewer.trim() : '';
    const date = /^\d{4}-\d{2}-\d{2}/.test(String(e.at)) ? String(e.at).slice(0, 10) : '';
    if (!signer) {
      failed++;
      say('NOT SIGNED', id, 'This decision records no reviewer name. It is not signed under a name typed later.');
      continue;
    }
    if (!date) {
      failed++;
      say('NOT SIGNED', id, 'This decision records no date. It is not signed under a later date.');
      continue;
    }
    let laidOutAgain = false;
    if (now.hash !== e.file_hash) {
      // These are not the bytes he was shown. Does the file still say the same thing, word for word?
      let nowJson = null;
      try { nowJson = JSON.parse(now.buf.toString('utf8').replace(/^﻿/, '')); } catch { nowJson = null; }
      if (!sameWordsAs(e, contentParts(nowJson))) {
        notSigned++;
        say('NOT SIGNED', id, `The file changed after it was signed (signed version ${short(e.file_hash)}, file now ${short(now.hash)}). ` +
          `It is not signed. Open the sign-off page and read it again. ${file}`);
        continue;
      }
      const inFile = isObj(nowJson) ? nowJson.signed_by_clinical_reviewer : null;
      const inName = isObj(inFile) && typeof inFile.name === 'string' ? inFile.name.trim() : '';
      const inDate = isObj(inFile) && typeof inFile.date === 'string' ? inFile.date.trim() : '';
      if (isObj(nowJson) && nowJson.draft === false && inName) {
        if (inName === signer && inDate === date) {
          already++;
          say('ALREADY SIGNED', id, `${file} (${whereWords(entry)}). The file was laid out again after it was signed. Its words are the same.`);
          continue;
        }
        notSigned++;
        say('NOT SIGNED', id, `The file is already signed by ${inName}${inDate ? ' on ' + inDate : ''}. That is not this decision (${signer} on ${date}). The file was left as it is. ${file}`);
        continue;
      }
      laidOutAgain = true;
    }
    let bytes;
    try {
      bytes = signedBytes(now.buf, signer, date);
    } catch (err) {
      failed++;
      say('NOT SIGNED', id, `${err instanceof Error ? err.message : String(err)} ${file}`);
      continue;
    }
    planned.push({ id, e, entry, file, bytes, newHash: sha256(bytes), date, signer, baseHash: now.hash, laidOutAgain });
  }

  // The ledger is told first, the files are written second. If the script is stopped halfway,
  // a file that was not reached is still the file that was signed, and the next run signs it.
  if (!dry && planned.length) {
    const live = readLedger(cfg);
    const at = localIso();
    for (const p of planned) {
      const cur = live.entries[p.id];
      if (isObj(cur) && cur.decision === 'signed' && cur.file_hash === p.e.file_hash && cur.at === p.e.at) {
        cur.applied_at = at;
        cur.applied_hash = p.newHash;
      } else {
        p.skip = 'The ledger entry changed while this script was running. Run it again.';
      }
    }
    writeLedger(cfg, live);
  }

  let signedNow = 0;
  for (const p of planned) {
    const where = `${p.file} (${whereWords(p.entry)})`;
    const layout = p.laidOutAgain ? ' The file was laid out again since he signed. Its words are the same.' : '';
    if (dry) {
      signedNow++;
      say('WOULD SIGN', p.id, `${where}, as ${p.signer}, ${p.date}.${layout}`);
      continue;
    }
    if (p.skip) {
      failed++;
      say('NOT SIGNED', p.id, p.skip);
      continue;
    }
    try {
      const again = readFresh(p.file);
      if (!again || again.hash !== p.baseHash) throw new Error('The file changed while this script was running. It was left as it is.');
      const liveNow = readLedger(cfg);
      const still = liveNow.entries[p.id];
      if (!isObj(still) || still.decision !== 'signed' || still.file_hash !== p.e.file_hash || still.at !== p.e.at) {
        failed++;
        say('NOT SIGNED', p.id, 'The decision was withdrawn or changed before the file was written. The file was left as it is.');
        continue;
      }
      writeWhole(p.file, p.bytes);
      const check = readFresh(p.file);
      if (!check || check.hash !== p.newHash) throw new Error('The file did not read back as written.');
      signedNow++;
      say('SIGNED', p.id, `${where}, as ${p.signer}, ${p.date}.${layout}`);
    } catch (err) {
      failed++;
      say('NOT SIGNED', p.id, `${err instanceof Error ? err.message : String(err)} ${p.file}`);
    }
  }

  // The list of changes, one section for each criterion, in the reviewer's own words.
  const changesFile = path.join(path.dirname(cfg.ledger), 'changes.md');
  const agreed = isObj(ledger.not_drafted_agreed) ? Object.keys(ledger.not_drafted_agreed).sort((a, b) => order(a) - order(b)) : [];
  const md = [];
  md.push('# Changes asked for by the clinical reviewer', '');
  md.push(`Reviewer: ${reviewer || 'no name in the ledger'}. Written by apply.mjs on ${whenWords(localIso())}.`);
  md.push(`${changes.length} ${changes.length === 1 ? 'criterion needs' : 'criteria need'} a change. The words under each heading are the reviewer's own.`, '');
  for (const { id, e, entry } of changes) {
    const label = entry ? entry.label : id;
    const title = entry && entry.title ? `: ${entry.title}` : '';
    md.push(`## ${label} (${id})${title}`, '');
    md.push(`- Asked on ${whenWords(e.at)}.`);
    if (!entry) {
      md.push('- No file was found for this criterion in any folder.');
    } else {
      const status = statusOf(entry, ledger);
      md.push(`- File: ${entry.top.file} (${whereWords(entry)}).${entry.kind === 'not_drafted' ? ' This criterion was not drafted.' : ''}`);
      if (status.state === 'look_again' || (status.state === 'nd_open' && status.was)) {
        md.push('- The file has changed since the reviewer wrote this. He is asked to look at it again on the sign-off page.');
      }
      if (entry.kind === 'criterion' && entry.json && isObj(entry.json.signed_by_clinical_reviewer)) {
        md.push('- This file carries a signature. Clear it when the change is made, so that it is read and signed again.');
      }
    }
    md.push('');
    for (const line of String(e.note ?? '').split(/\r?\n/)) md.push(line.trim() ? `> ${line}` : '>');
    md.push('');
  }
  if (agreed.length) {
    md.push('## Not drafted: the reviewer agrees to leave these out', '');
    for (const id of agreed) {
      const entry = index.byId.get(id);
      const stale = entry && statusOf(entry, ledger).state !== 'nd_agreed';
      md.push(`- ${entry ? entry.label : id} (${id})${entry && entry.title ? `: ${entry.title}` : ''}. Agreed on ${whenWords(ledger.not_drafted_agreed[id].at)}.${stale ? ' The note has changed since then.' : ''}`);
    }
    md.push('');
  }
  const hadFile = fs.existsSync(changesFile);
  const worthWriting = changes.length > 0 || agreed.length > 0 || hadFile;
  if (!dry && worthWriting) writeWhole(changesFile, md.join('\n'));

  for (const line of lines) console.log(line);
  if (lines.length) console.log('');
  if (changes.length) {
    console.log(`Changes asked for: ${changes.length} (${changes.map(c => c.id).join(', ')}).`);
    console.log(dry ? `They would be written to ${changesFile}` : `They are written to ${changesFile}`);
  } else {
    console.log('No change is asked for.' + (!dry && hadFile ? ` ${changesFile} now says so.` : ''));
  }
  if (agreed.length) console.log(`Not drafted, agreed to leave out: ${agreed.length} (${agreed.join(', ')}). Nothing is written into those.`);
  console.log('');
  console.log(`Summary: ${signedNow} ${dry ? 'would be signed' : 'signed now'}, ${already} already signed, ${notSigned + failed} not signed, ${changes.length} to change.`);
  if (dry) console.log('This was a dry run. Nothing was written. Run it without --dry-run to write the signatures.');
  if (notSigned + failed > 0) {
    console.log('Some signatures were not written. The lines marked NOT SIGNED say why.');
    return 2;
  }
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  if (err instanceof LedgerError) console.error(err.message);
  else console.error(err);
  process.exitCode = 1;
}
