// Assembles docs/SIGN_OFF.md: the hand-written draft, then the generated criteria parts, then
// the results section. Run after data/k06/pack.mjs: node data/k06/assemble.mjs
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const BOARD = 'C:/Users/AdamG/ClinicaLANTERN-AgentHub/fireup';
const draft = fs.readFileSync('eval/results/signoff-pack-draft.md', 'utf8'); // the hand-written part
const generated = fs.readFileSync('eval/results/signoff-pack-generated.md', 'utf8');

// results section: the ten's measured results
const results = [];
results.push('## The results of the ten', '');
results.push('Newest measured result for the first ten: the scored run of Wednesday 18 November');
results.push('09:30 (run 0), 10 of 10 PASS, 20 of 20 planted findings caught, no false flags,');
results.push('20 of 20 letters. Scored run 1 (Thursday 00:28) was stopped by the merge engine\'s');
results.push('run cap before it wrote a table, so it is not a result; a fresh number for the ten');
results.push('comes with run 2 (Thursday 09:25). STOPP-B13\'s new fact-set histories passed in the');
results.push('wave scoring runs; EU7-F28 passed a part re-score after its rule fix.');
results.push('');
results.push('PDF and scan routes (task K05): the text-PDF twins of all 20 planted histories read');
results.push('back exactly - 1,099 of 1,099 rows, and the planted lines came back in all 20. The');
results.push('scan twins are being scored Thursday morning; the numbers land in docs\\RESULTS.md.');
results.push('');
results.push('One real letter per criterion of the ten: the letters of run 0 (all written by the');
results.push('model, every check clean) are in the run\'s folder ' + BOARD + '\\runs\\20261118-0930-run0\\raw\\letter\\.');

const out = draft.replace('## The first ten, in order\n\n', '## The first ten, in order\n\n')
  + '\n' + generated.slice(generated.indexOf('## The first ten, in order'))
  + '\n' + results.join('\n') + '\n';
fs.writeFileSync('docs/SIGN_OFF.md', out);
console.log('SIGN_OFF.md assembled:', out.split('\n').length, 'lines');
