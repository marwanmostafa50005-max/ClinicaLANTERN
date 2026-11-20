// Writes the activity log of a running server to a CSV file. It adds no call to the API.
//   node tools/export-activity.ts --server http://127.0.0.1:8788 --out data\activity.csv
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Activity, StateResponse } from '../shared/types.ts';

export function csvCell(value: string | undefined): string {
  const text = value ?? '';
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function activityToCsv(activity: Activity[]): string {
  const lines = activity.map(row =>
    [row.at, row.kind, row.text, row.model, row.caseId, row.findingId, row.letterId, row.criterionId]
      .map(csvCell)
      .join(','));
  return 'time,kind,text,model,case,finding,letter,criterion\n' + lines.join('\n') + (lines.length > 0 ? '\n' : '');
}

export async function writeActivity(server: string, outFile: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const base = server.replace(/\/+$/, '');
  const res = await fetchImpl(base + '/api/state', { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`GET /api/state answered ${res.status}`);
  const body = await res.json() as StateResponse;
  if (!body || !body.state || !Array.isArray(body.state.activity)) throw new Error('The state has no activity log.');
  const csv = activityToCsv(body.state.activity);
  const file = path.resolve(outFile);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, csv);
  return csv;
}

function option(args: string[], name: string): string {
  const at = args.indexOf(name);
  const value = at >= 0 ? args[at + 1] : '';
  return value && !value.startsWith('--') ? value : '';
}

const calledDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (calledDirectly) {
  const args = process.argv.slice(2);
  const server = option(args, '--server');
  const outFile = option(args, '--out');
  if (!server || !outFile) {
    console.error('Usage: node tools/export-activity.ts --server http://127.0.0.1:8788 --out <file>');
    process.exit(1);
  }
  writeActivity(server, outFile)
    .then(csv => {
      const rows = csv.split('\n').filter(line => line !== '').length - 1;
      console.log(`Written: ${path.resolve(outFile)}`);
      console.log(`${rows} ${rows === 1 ? 'line' : 'lines'}.`);
    })
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
