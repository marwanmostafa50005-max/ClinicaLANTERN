// Serves the sign-off page from a throwaway COPY of some criteria, for trying the page by hand.
// Run:  node tools\signoff\test\serve-copy.mjs [minutes]
// It prints the address, then waits. It stops when the file STOP appears in its temp folder,
// or after the given number of minutes (20 when none is given). The copy is then removed.
import fs from 'node:fs';
import path from 'node:path';
import { makeFixture, startServer, freePort, removeFolder, sleep, REAL_REPO } from './fixture.mjs';

const minutes = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 20;
const proposed = JSON.parse(fs.readFileSync(path.join(REAL_REPO, 'criteria', 'active.proposed.json'), 'utf8'));
const fx = makeFixture({ repoIds: [...proposed.active, ...proposed.reserves], waves: ['W101', 'W108', 'W114', 'W116', 'W133', 'W151'] });
const server = await startServer(fx.env, await freePort());
const info = { address: server.base, folder: fx.root, stopFile: path.join(fx.root, 'STOP'), ledger: fx.ledger };
console.log(JSON.stringify(info));
if (process.env.SIGNOFF_INFO_FILE) fs.writeFileSync(process.env.SIGNOFF_INFO_FILE, JSON.stringify(info));

const until = Date.now() + minutes * 60000;
while (Date.now() < until && !fs.existsSync(info.stopFile) && server.child.exitCode === null) await sleep(500);
const stopped = await server.stop();
removeFolder(fx.root);
console.log(stopped ? 'Stopped. The copy is removed.' : 'WARNING: the server still answers.');
