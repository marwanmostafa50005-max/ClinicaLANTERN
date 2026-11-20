// Builds docs/SIGN_OFF.md, the founder's sign-off pack (task K06), from the files of the
// repository, the wave summary and Gemini's opinions. Run: node data/k06/pack.mjs
// The first ten come first. Nothing here says "validated", "approved" or "never misses".
import fs from 'node:fs';
import path from 'node:path';

const BOARD = (process.env.USERPROFILE || process.env.HOME || '').replace(/\\/g, '/') + '/ClinicaLANTERN-AgentHub/fireup';
const active = JSON.parse(fs.readFileSync('criteria/active.json', 'utf8'));
const sheet = JSON.parse(fs.readFileSync('cases/expected.json', 'utf8'));
const results = fs.readFileSync('docs/RESULTS.md', 'utf8');
const summary = JSON.parse(fs.readFileSync(path.join(BOARD, 'runs/waves/summary.json'), 'utf8'));
const rows = summary.criteria ?? [];

function criterionBlock(id, short) {
  const c = JSON.parse(fs.readFileSync(`criteria/${id}/criterion.json`, 'utf8'));
  const groups = c.medicine_groups.map((g) => {
    const brands = Object.entries(g.brands ?? {}).map(([ing, bs]) => `${ing}: ${bs.join(', ')}`).join('; ');
    return `- ${g.name}: ${g.ingredients.join(', ')}${brands ? `. Brands - ${brands}` : ''}${g.note ? `. Note: ${g.note}` : ''}`;
  }).join('\n');
  const facts = (c.needs_facts ?? []).map((f) => `- ${f.what} (${f.kind}): meets when ${f.meets}`).join('\n');
  return `### ${c.label}${short ? '' : ` - ${c.title}`}
${short ? '' : `
Statement (${c.statement_origin === 'published' ? 'the published wording, word for word' : "the entrant's summary"}):
> ${c.statement}

Source: ${c.source.citation}. Licence: ${c.source.licence} (status "${c.source.licence_status}" - the founder confirms the rights). Credit line: ${c.source.credit}${c.source.modification_notice ? ` Notice: ${c.source.modification_notice}` : ''}

Plain summary: ${c.plain_summary}

Rule given to the models: ${c.rule_for_models}

Medicines that count:
${groups}
${facts ? `\nFacts it needs:\n${facts}\n` : ''}
What a dispensing history cannot show: ${c.cannot_be_seen}

The letter asks the GP: ${c.ask_the_gp}. Urgency: ${c.urgency}. ${c.signed_by_clinical_reviewer ? `Signed: ${c.signed_by_clinical_reviewer.name}, ${c.signed_by_clinical_reviewer.date}.` : 'Not yet signed.'}`}
`;
}

const out = [];
out.push('# THE FOUNDER\'S SIGN-OFF PACK (docs\\SIGN_OFF.md, built by data\\k06\\pack.mjs)');
out.push('');
out.push('This pack is rebuilt from the files as they stand. The living draft sections (the count, the');
out.push('changes, the founder questions) are written by Kimi Code directly below; this generated part');
out.push('lists the criteria. Fictional patients only. Nothing here says "validated" or "approved".');
out.push('');
out.push('## The first ten, in order');
out.push('');
for (const id of active.active) out.push(criterionBlock(id, false));
out.push('## The answer sheet of the ten');
out.push('');
for (const c of sheet.cases) {
  const planted = c.findings.length > 0 ? c.findings.map((f) => `${f.criterion} proven by lines ${f.must_cite.map((g) => `(${g.join(' or ')})`).join(' and ')}`).join('; ') : 'nothing planted';
  out.push(`- ${c.file} (${c.kind}): ${c.about} ${planted}`);
}
out.push('');
out.push(`## The further criteria in use (${active.further.length})`);
out.push('');
out.push('Each line: label - statement (first 140 characters) - wave - scored result - signed or not.');
out.push('Full details are in the criterion files, the sign-off tool and the wave summary.');
const byId = new Map(rows.map((r) => [r.id, r]));
for (const id of active.further) {
  let c;
  try { c = JSON.parse(fs.readFileSync(`criteria/${id}/criterion.json`, 'utf8')); } catch { continue; }
  const row = byId.get(id);
  const st = (c.statement ?? '').slice(0, 140);
  out.push(`- ${c.label}: ${st}${st.length >= 140 ? '...' : ''} | ${row ? `wave ${row.wave}: ${row.result}` : 'scored by Kimi Code'} | ${c.signed_by_clinical_reviewer ? `signed ${c.signed_by_clinical_reviewer.name}` : 'not signed'}`);
}
fs.writeFileSync('eval/results/signoff-pack-generated.md', out.join('\n') + '\n');
console.log('generated eval/results/signoff-pack-generated.md:', active.active.length, 'ten +', active.further.length, 'further');
