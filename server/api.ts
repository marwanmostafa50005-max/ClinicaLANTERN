// The API of docs/SPEC.md section 5. Everything is under /api and speaks JSON.
// Errors come back as { error: "plain words" } with a fitting status code.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { HealthResponse, LanternConfig } from '../shared/types.ts';
import { ApiError, type Engine } from './engine.ts';

export const MAX_BODY_BYTES = 40 * 1024 * 1024;     // page images can be large

export function sendJson(res: ServerResponse, status: number, data: unknown, extraHeaders: Record<string, string> = {}): void {
  const text = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(text);
}

/** Reads a JSON body of at most 40 MB. An empty body reads as {}. */
export function readJsonBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new ApiError(413, 'The file is too large. The limit is 40 MB.'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new ApiError(413, 'The file is too large. The limit is 40 MB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '').trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new ApiError(400, 'The request could not be read. It must be JSON.'));
      }
    });
    req.on('error', () => reject(new ApiError(400, 'The request was cut off.')));
  });
}

function hostName(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.startsWith('[')) return v.slice(1, v.indexOf(']'));
  return v.split(':')[0];
}

function isLocalName(name: string): boolean {
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

/** True when the Host header names this computer. Stops other websites from reaching the server by a made-up name. */
export function isLocalHostHeader(host: string | undefined): boolean {
  return typeof host === 'string' && host !== '' && isLocalName(hostName(host));
}

/** True when the Origin header (sent by browsers) is a page served from this computer. */
export function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:') && isLocalName(u.hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

let lastHealth: { at: number; value: HealthResponse } | null = null;

/** Is Ollama up, and are the three models there? */
export async function getHealth(cfg: LanternConfig, fetchImpl: typeof fetch = fetch): Promise<HealthResponse> {
  const names = { screen: cfg.models.screen, check: cfg.models.check, letter: cfg.models.letter };
  const displayNames = { ...cfg.modelNames };
  const modelsBehind = { ...cfg.modelsBehind };
  const down: HealthResponse = {
    ollama: 'down', models: { screen: false, check: false, letter: false }, names, displayNames, modelsBehind
  };
  try {
    const v = await fetchImpl(cfg.ollamaBase + '/api/version', { signal: AbortSignal.timeout(2500) });
    if (!v.ok) return down;
    const version = ((await v.json()) as { version?: unknown }).version;
    const t = await fetchImpl(cfg.ollamaBase + '/api/tags', { signal: AbortSignal.timeout(2500) });
    const listed = t.ok ? ((await t.json()) as { models?: { name?: unknown; model?: unknown }[] }).models ?? [] : [];
    const present = new Set<string>();
    for (const m of listed) {
      if (typeof m.name === 'string') present.add(m.name.toLowerCase());
      if (typeof m.model === 'string') present.add(m.model.toLowerCase());
    }
    const has = (name: string): boolean => {
      const n = name.toLowerCase();
      return present.has(n) || (!n.includes(':') && present.has(n + ':latest'));
    };
    const up: HealthResponse = {
      ollama: 'up',
      models: { screen: has(names.screen), check: has(names.check), letter: has(names.letter) },
      names,
      displayNames,
      modelsBehind
    };
    if (typeof version === 'string') up.version = version;
    return up;
  } catch {
    return down;
  }
}

async function cachedHealth(cfg: LanternConfig): Promise<HealthResponse> {
  const now = Date.now();
  if (lastHealth && now - lastHealth.at < 2000) return lastHealth.value;
  const value = await getHealth(cfg);
  lastHealth = { at: Date.now(), value };
  return value;
}

function segment(text: string | undefined): string {
  if (text === undefined) return '';
  try {
    return decodeURIComponent(text);
  } catch {
    return '';
  }
}

/** Answers one /api request. Never throws: every failure becomes a JSON error. */
export async function handleApi(engine: Engine, req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const method = (req.method ?? 'GET').toUpperCase();
  try {
    if (!isLocalHostHeader(req.headers.host)) throw new ApiError(403, 'This server only answers on this computer.');
    const origin = req.headers.origin;
    if (typeof origin === 'string' && origin !== '' && !isLocalOrigin(origin)) {
      throw new ApiError(403, 'This server only answers pages opened from this computer.');
    }

    const parts = pathname.split('/').filter(Boolean).map(segment);   // ["api", "letters", "T0001", "sent"]
    const [, area, id, action] = parts;
    const route = `${method} ${area ?? ''}${id ? '/:id' : ''}${action ? '/' + action : ''}`;

    // One page picture of a scan: GET /api/cases/C0004/pages/2. The pictures are kept until the rows
    // are confirmed, so the pharmacist can check the rows after a page reload or in another window.
    if (parts.length === 5 && area === 'cases' && action === 'pages') {
      if (method !== 'GET' && method !== 'HEAD') throw new ApiError(405, 'This call does not take that method.');
      const png = /^\d{1,3}$/.test(parts[4]) ? engine.pageImage(id, Number(parts[4])) : null;
      if (!png) throw new ApiError(404, 'This page picture is not on this computer any more.');
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': png.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff'
      });
      res.end(method === 'HEAD' ? undefined : png);
      return;
    }
    const questionRoute = parts.length === 6 && area === 'cases' && parts[3] === 'questions';
    const leaveRoute = parts.length === 5 && area === 'cases' && parts[3] === 'questions' && parts[4] === 'leave';
    if (parts.length > 4 && !questionRoute && !leaveRoute) throw new ApiError(404, 'There is no such call.');

    // ----- reading -----
    if (route === 'GET state' || route === 'HEAD state') {
      sendJson(res, 200, engine.stateResponse());
      return;
    }
    if (route === 'GET criteria') {
      await engine.refreshCriteria();
      if (engine.criteriaError) throw new ApiError(503, `The criteria could not be loaded. ${engine.criteriaError}`);
      sendJson(res, 200, engine.criteria);
      return;
    }
    if (route === 'GET health') {
      const health = { ...await cachedHealth(engine.cfg) };
      if (engine.modelsNote) health.modelsNote = engine.modelsNote;
      else delete health.modelsNote;
      sendJson(res, 200, health);
      return;
    }

    // ----- changing -----
    if (method !== 'POST' && method !== 'PUT') {
      const known = ['state', 'criteria', 'health', 'cases', 'findings', 'letters', 'reset', 'demo-clock'].includes(area ?? '');
      throw new ApiError(known ? 405 : 404, known ? 'This call does not take that method.' : 'There is no such call.');
    }
    const body = await readJsonBody(req);

    if (questionRoute) {
      if (method !== 'POST') throw new ApiError(405, 'This call does not take that method.');
      const questionId = parts[4];
      const act = parts[5];
      if (act === 'answer') {
        sendJson(res, 200, { ok: true, question: engine.answerQuestion(id, questionId, body) });
        return;
      }
      if (act === 'pathology') {
        // What was read from an uploaded pathology test. Nothing is written until the pharmacist confirms with "answer".
        sendJson(res, 200, await engine.readPathologyTest(id, questionId, body));
        return;
      }
      if (act === 'take-back') {
        sendJson(res, 200, { ok: true, question: engine.takeBackQuestion(id, questionId) });
        return;
      }
      if (act === 'reopen') {
        sendJson(res, 200, { ok: true, question: engine.reopenQuestion(id, questionId) });
        return;
      }
      throw new ApiError(404, 'There is no such call.');
    }

    if (leaveRoute) {
      if (method !== 'POST') throw new ApiError(405, 'This call does not take that method.');
      sendJson(res, 200, { ok: true, questions: engine.leaveStandingQuestions(id, body) });
      return;
    }

    switch (route) {
      case 'POST cases':
        sendJson(res, 200, await engine.importCase(body));
        return;
      case 'POST cases/:id/confirm-transcription':
        sendJson(res, 200, { ok: true, case: engine.confirmTranscription(id, body) });
        return;
      case 'POST cases/:id/screen-again':
        sendJson(res, 200, { ok: true, case: engine.screenAgain(id) });
        return;
      case 'POST cases/:id/discard':
        sendJson(res, 200, { ok: true, case: engine.discardScan(id) });
        return;
      case 'POST findings/:id/decision':
        sendJson(res, 200, { ok: true, finding: engine.decide(id, body) });
        return;
      case 'POST findings/:id/seen':
        sendJson(res, 200, { ok: true, finding: engine.markFindingSeen(id) });
        return;
      case 'POST letters/:id/seen':
        sendJson(res, 200, { ok: true, letter: engine.markLetterSeen(id) });
        return;
      case 'PUT letters/:id':
        sendJson(res, 200, { ok: true, letter: engine.editLetter(id, body) });
        return;
      case 'POST letters/:id/preview':
        sendJson(res, 200, { ok: true, ...engine.previewLetter(id) });
        return;
      case 'POST letters/:id/agree':
        sendJson(res, 200, { ok: true, letter: engine.agree(id, body) });
        return;
      case 'POST letters/:id/sent':
        sendJson(res, 200, { ok: true, letter: engine.markSent(id, body) });
        return;
      case 'POST letters/:id/reply':
        sendJson(res, 200, { ok: true, letter: engine.recordReply(id, body) });
        return;
      case 'POST letters/:id/close':
        sendJson(res, 200, { ok: true, letter: engine.closeLetter(id) });
        return;
      case 'POST reset':
        sendJson(res, 200, { ok: true, ...(await engine.reset()) });
        return;
      case 'POST demo-clock':
        sendJson(res, 200, { ok: true, ...engine.setDemoClock(body) });
        return;
      default:
        throw new ApiError(404, 'There is no such call.');
    }
  } catch (e) {
    if (res.headersSent) {
      res.end();
      return;
    }
    if (e instanceof ApiError) {
      sendJson(res, e.status, { error: e.message }, e.status === 413 ? { connection: 'close' } : {});
      return;
    }
    console.error('The server could not do a step:', e);
    sendJson(res, 500, { error: 'The server could not do this step. Please try again.' });
  }
}
