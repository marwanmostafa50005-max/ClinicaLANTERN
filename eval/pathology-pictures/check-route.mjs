import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const options = { base: 'http://127.0.0.1:8787' };
for (let i = 0; i < args.length; i += 2) {
  const key = args[i];
  if (!['--base', '--case', '--question'].includes(key) || args[i + 1] === undefined) {
    console.error('Usage: node eval/pathology-pictures/check-route.mjs --case C0001 --question Q0001 [--base http://127.0.0.1:8787]');
    process.exit(1);
  }
  options[key.slice(2)] = args[i + 1];
}
if (!options.case || !options.question) {
  console.error('Usage: node eval/pathology-pictures/check-route.mjs --case C0001 --question Q0001 [--base http://127.0.0.1:8787]');
  process.exit(1);
}
const base = new URL(options.base);
if (!['127.0.0.1', 'localhost', '::1'].includes(base.hostname)) {
  console.error('The pathology pictures may be sent only to a server on this computer.');
  process.exit(1);
}

function project(actual, expected) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return actual;
    return expected.length === 0 ? actual : actual.map(item => project(item, expected[0]));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return actual;
    return Object.fromEntries(Object.keys(expected).map(key => [key, project(actual[key], expected[key])]));
  }
  return actual;
}

const truth = JSON.parse(fs.readFileSync(path.join(here, 'truth.json'), 'utf8'));
const route = `${base.origin}/api/cases/${encodeURIComponent(options.case)}/questions/${encodeURIComponent(options.question)}/pathology`;
let failed = 0;
for (const report of truth.reports) {
  const picture = fs.readFileSync(path.join(here, report.file)).toString('base64');
  let actual;
  try {
    const response = await fetch(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fileName: report.file, pageImages: [picture] })
    });
    actual = { httpStatus: response.status, ...(await response.json()) };
  } catch (error) {
    actual = { error: error instanceof Error ? error.message : String(error) };
  }
  const expected = report.expected;
  const core = { collected: expected.collected, readings: expected.readings };
  const actualCore = {
    collected: actual.collected?.date,
    readings: actual.readings
  };
  let matches = JSON.stringify(project(actualCore, core)) === JSON.stringify(core);
  if (expected.abstainedIncludes) {
    matches = matches && Array.isArray(actual.abstained) && actual.abstained.some(line => line.includes(expected.abstainedIncludes));
  }
  if (!matches) failed += 1;
  console.log(`\n=== ${report.file}: ${matches ? 'MATCH' : 'MISMATCH'} ===`);
  console.log('EXPECTED');
  console.log(JSON.stringify(expected, null, 2));
  console.log('ACTUAL');
  console.log(JSON.stringify(actual, null, 2));
}
console.log(`\n${truth.reports.length - failed} of ${truth.reports.length} reports matched the truth.`);
process.exitCode = failed === 0 ? 0 : 1;
