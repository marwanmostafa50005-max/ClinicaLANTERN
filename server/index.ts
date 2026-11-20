// The local server. It answers on this computer only (127.0.0.1).
// It serves the API under /api and, when the built page exists, that page.
// Only Node's built-in modules are used.
//
// Settings from the environment (all optional):
//   PORT                 the port to listen on (default: "port" in lantern.config.json, 8787)
//   LANTERN_DATA_DIR     where state.json is kept (default: data/ in the repository)
//   LANTERN_ACTIVE_FILE  another list of active criteria (default: criteria/active.json)
//   LANTERN_NO_WARMUP    set to 1 to skip the warm-up. A warm-up uses the graphics card.
//   LANTERN_DIST_DIR     the built page to serve (default: dist/ in the repository)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../pipeline/config.ts';
import { loadCriteriaReport } from '../pipeline/criteria.ts';
import { screenCriterion, screenHistory } from '../pipeline/screen.ts';
import { checkFinding } from '../pipeline/check.ts';
import { draftLetter } from '../pipeline/letter.ts';
import { chat } from '../pipeline/ollama.ts';
import { transcribePageImage } from '../pipeline/transcribe.ts';
import { transcribePathologyPage } from '../pipeline/transcribe-pathology.ts';
import { handleApi, sendJson } from './api.ts';
import { Engine } from './engine.ts';
import { warmAnswer } from './warm-answer.ts';
import { PageImages } from './images.ts';
import { serveStatic } from './static.ts';
import { holdDataDirectory } from './data-lock.ts';
import { StateStore } from './store.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fromEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

async function main(): Promise<void> {
  const cfg = loadConfig(repoRoot);
  const portText = fromEnv('PORT');
  const port = portText && /^\d{1,5}$/.test(portText) && Number(portText) >= 1 && Number(portText) <= 65535
    ? Number(portText)
    : cfg.port;
  const dataDir = path.resolve(repoRoot, fromEnv('LANTERN_DATA_DIR') ?? 'data');
  const activeFile = fromEnv('LANTERN_ACTIVE_FILE');
  const activePath = activeFile ? path.resolve(repoRoot, activeFile) : undefined;
  const distDir = path.resolve(repoRoot, fromEnv('LANTERN_DIST_DIR') ?? 'dist');

  // Nothing is read or written here yet. The state file is touched only after the port is ours
  // (see below), and only after this process holds the data folder. A second server, even on
  // another port, cannot write the same folder or start a model call beside the first.
  const store = new StateStore(dataDir);
  const engine = new Engine({
    cfg,
    store,
    images: new PageImages(path.join(dataDir, 'images')),
    conditionMarkersFile: path.join(repoRoot, 'criteria', '_markers', 'condition-markers.json'),
    // The first ten (active) first, then the further ones. A criterion file that does not load is
    // named and the others still load. When none loads, nothing can be screened and the reason is said.
    loadCriteria: async () => {
      const load = await loadCriteriaReport(repoRoot, activePath);
      const active = new Set(load.activeIds);
      const tenProblem = load.problems.find(problem => active.has(problem.id));
      // A missing file among the ten stops screening. A further file is left out and named in the log.
      if (tenProblem) throw new Error(tenProblem.error);
      if (load.criteria.length === 0 && load.problems.length > 0) throw new Error(load.problems[0].error);
      return load;
    },
    pipeline: {
      screenCriterion: (c, patient, lines, criterion, signal) => screenCriterion(c, patient, lines, criterion, { signal }),
      screenHistory: (c, patient, lines, criteria, hooks, signal) => screenHistory(c, patient, lines, criteria, { signal }, hooks),
      checkFinding: (c, patient, lines, criterion, screen, signal) => checkFinding(c, patient, lines, criterion, screen, { signal }),
      draftLetter: (c, patient, lines, criterion, finding, signal) => draftLetter(c, patient, lines, criterion, finding, { signal }),
      transcribePageImage: (c, image, signal) => transcribePageImage(c, image, { signal }),
      transcribePathologyPage: (c, image, signal) => transcribePathologyPage(c, image, { signal }),
      // One tiny answer from Model 1. A wrong shape still means the model server answered, so the model is in memory.
      warmModel: async (c, signal) => {
        const answer = await chat<{ ok: boolean }>(c, {
          model: c.models.screen,
          think: false,
          schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
          messages: [{ role: 'user', content: 'Answer with ok true. This only wakes the model.' }],
          numPredict: 24,
          timeoutMs: 180_000,
          signal
        });
        return warmAnswer(answer);
      }
    },
    warmup: fromEnv('LANTERN_NO_WARMUP') !== '1',
    log: line => console.log(`[${new Date().toLocaleTimeString('en-AU', { hour12: false })}] ${line}`)
  });
  let ready = false;

  const server = http.createServer((req, res) => {
    let pathname = '/';
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    } catch {
      sendJson(res, 400, { error: 'The address could not be read.' });
      return;
    }
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (!ready) {
        sendJson(res, 503, { error: 'The server is starting. Please try again in a moment.' });
        return;
      }
      void handleApi(engine, req, res, pathname);
      return;
    }
    try {
      serveStatic(distDir, req, res, pathname);
    } catch (e) {
      console.error('A file could not be served:', e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The file could not be served.');
    }
  });

  server.on('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Is the server already running? Stop it, or set PORT to another number.`);
    } else {
      console.error('The server could not start:', e.message);
    }
    process.exit(1);
  });

  // The port first. Only when it is ours: read the state, pick up interrupted work and start the queue.
  server.listen(port, '127.0.0.1', () => {
    void (async () => {
      try {
        holdDataDirectory(dataDir);
        store.load();
        await engine.start();
        ready = true;
      } catch (e) {
        console.error('The server could not start:', e instanceof Error ? e.message : e);
        process.exit(1);
      }
      console.log(`ClinicaLANTERN server: http://127.0.0.1:${port}`);
      console.log(`State file: ${store.file}`);
      const inUse = engine.criteria.map(c => c.id);
      const ten = engine.firstTenIds;
      console.log(engine.criteriaError
        ? `Criteria: NOT LOADED. ${engine.criteriaError}`
        : inUse.length <= 20
          ? `Criteria in use: ${inUse.join(', ')}`
          : `Criteria in use: ${inUse.length}. The first ten (${ten.length}): ${ten.join(', ')}. Further: ${inUse.length - ten.length}.`);
      for (const problem of engine.criteriaProblems) console.log(`Criterion NOT LOADED: ${problem.id}. ${problem.error}`);
      console.log(`Models through Ollama at ${cfg.ollamaBase}: ${cfg.models.screen}, ${cfg.models.check}, ${cfg.models.letter}`);
      console.log('Fictional patients only. Press Ctrl+C to stop.');
    })();
  });

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping. The state is saved after every step, so nothing is lost.');
    server.close(() => process.exit(0));
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);
}

process.on('unhandledRejection', reason => {
  console.error('A step failed in the background:', reason);
});

main().catch(e => {
  console.error('The server could not start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
