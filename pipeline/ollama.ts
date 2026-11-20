// The one place that talks to the local Ollama server.
// A call never throws: a model failure comes back as { ok: false, error }.
// Every call is tried once more, 2 seconds after a failure (one model load in five crashed in the proof).
// Only one call runs at a time in this process: there is one GPU.
import type { LanternConfig } from '../shared/types.ts';

export interface JsonSchema {
  type: 'object' | 'array' | 'string' | 'boolean' | 'number' | 'integer';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  maxLength?: number;                 // for text: the most characters the model may write
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];                  // base64, no "data:" prefix
}

export interface ChatRequest {
  model: string;
  think: boolean;
  schema: JsonSchema;                 // sent as "format" and used to check the answer
  messages: ChatMessage[];
  numPredict: number;
  timeoutMs?: number;                 // for one attempt; default 4 minutes
  signal?: AbortSignal;               // stops the call at once (a clean start, or a stopped screening)
}

export interface ChatTimings {
  wallSeconds: number;                // the whole call, with the retry and its wait when there was one
  loadSeconds: number;                // from the last attempt that answered
  promptTokens: number;
  promptSeconds: number;
  outputTokens: number;
  outputSeconds: number;
  attempts: number;                   // 1 or 2
}

export type ChatResult<T> =
  | { ok: true; value: T; timings: ChatTimings }
  | { ok: false; error: string; timings: ChatTimings };

export interface ChatDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  retryDelayMs?: number;
}

/** The shape of chat(): the three jobs take one of these so tests can pass a stand-in. */
export type ChatFn = <T>(cfg: LanternConfig, req: ChatRequest) => Promise<ChatResult<T>>;

export const RETRY_DELAY_MS = 2000;
export const CALL_STOPPED = 'The call was stopped.';
/** The server could not be reached at all. A timeout or an HTTP error is a different failure. */
export const SERVER_DID_NOT_ANSWER = 'The local model server did not answer.';

/**
 * True when the failure is that the model server could not be reached.
 * A timeout, an HTTP error, an empty answer or a bad answer is not this: those still fail after two tries.
 * A second attempt that reached the server is not this either.
 */
export function failedBecauseServerIsDown(error: string): boolean {
  if (!error.includes(SERVER_DID_NOT_ANSWER)) return false;
  if (error.includes('answered with error')) return false;
  if (error.includes('took too long')) return false;
  if (error.includes('could not be read')) return false;
  if (error.includes('empty answer')) return false;
  if (error.includes('not in the form')) return false;
  if (error.includes('did not finish its answer')) return false;
  const second = error.split('Second: ')[1];
  if (second !== undefined && !second.includes(SERVER_DID_NOT_ANSWER)) return false;
  return true;
}
/** One attempt. Screen, check and letter use this. A page image uses a longer limit of its own. */
export const DEFAULT_TIMEOUT_MS = 240_000;

/** A small schema check. Returns null when the value fits, or one sentence saying what is wrong. */
export function checkAgainstSchema(value: unknown, schema: JsonSchema, where = 'answer'): string | null {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string' ? null : `${where} should be text`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `${where} should be true or false`;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : `${where} should be a number`;
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? null : `${where} should be a whole number`;
    case 'array': {
      if (!Array.isArray(value)) return `${where} should be a list`;
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const bad = checkAgainstSchema(value[i], schema.items, `${where}[${i}]`);
          if (bad) return bad;
        }
      }
      return null;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return `${where} should be an object`;
      const obj = value as Record<string, unknown>;
      for (const key of schema.required ?? []) {
        if (!(key in obj)) return `${where} is missing "${key}"`;
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in obj) {
          const bad = checkAgainstSchema(obj[key], sub, `${where}.${key}`);
          if (bad) return bad;
        }
      }
      return null;
    }
    default:
      return `${where} has a type this check does not know`;
  }
}

interface Attempt<T> {
  ok: boolean;
  value?: T;
  error?: string;
  loadSeconds: number;
  promptTokens: number;
  promptSeconds: number;
  outputTokens: number;
  outputSeconds: number;
}

function seconds(nanos: unknown): number {
  return typeof nanos === 'number' && nanos > 0 ? Math.round(nanos / 1e7) / 100 : 0;
}

function count(n: unknown): number {
  return typeof n === 'number' && n > 0 ? n : 0;
}

function short(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > 200 ? one.slice(0, 200) + '...' : one;
}

async function attemptOnce<T>(cfg: LanternConfig, req: ChatRequest, fetchImpl: typeof fetch): Promise<Attempt<T>> {
  const empty = { loadSeconds: 0, promptTokens: 0, promptSeconds: 0, outputTokens: 0, outputSeconds: 0 };
  const body = {
    model: req.model,
    stream: false,
    think: req.think,
    format: req.schema,
    options: { temperature: 0, seed: 42, top_k: 1, num_ctx: cfg.numCtx, num_predict: req.numPredict },
    keep_alive: cfg.keepAlive,
    messages: req.messages
  };
  let status = 0;
  let raw = '';
  if (req.signal?.aborted) return { ok: false, error: CALL_STOPPED, ...empty };
  try {
    const timeout = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const res = await fetchImpl(cfg.ollamaBase + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal ? AbortSignal.any([timeout, req.signal]) : timeout
    });
    status = res.status;
    raw = await res.text();
  } catch (e) {
    if (req.signal?.aborted) return { ok: false, error: CALL_STOPPED, ...empty };
    const name = e instanceof Error ? e.name : '';
    const why = name === 'TimeoutError' || name === 'AbortError'
      ? 'The model took too long to answer.'
      : SERVER_DID_NOT_ANSWER;
    return { ok: false, error: why, ...empty };
  }
  if (status !== 200) {
    // Ollama explains an error as { "error": "..." }. Show its words, not the raw JSON.
    let why = short(raw);
    try {
      const told = (JSON.parse(raw) as { error?: unknown }).error;
      if (typeof told === 'string' && told.trim()) why = short(told);
    } catch {
      // Not JSON: keep the text as it came.
    }
    const dot = why && !/[.!?]$/.test(why) ? '.' : '';
    return { ok: false, error: `The local model server answered with error ${status}${why ? ': ' + why + dot : '.'}`, ...empty };
  }
  let reply: Record<string, unknown>;
  try {
    reply = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'The local model server sent an answer that could not be read.', ...empty };
  }
  const timings = {
    loadSeconds: seconds(reply.load_duration),
    promptTokens: count(reply.prompt_eval_count),
    promptSeconds: seconds(reply.prompt_eval_duration),
    outputTokens: count(reply.eval_count),
    outputSeconds: seconds(reply.eval_duration)
  };
  if (reply.done_reason !== 'stop') {
    return { ok: false, error: `The model did not finish its answer (it stopped with "${String(reply.done_reason)}").`, ...timings };
  }
  const message = reply.message as { content?: unknown } | undefined;
  const content = typeof message?.content === 'string' ? message.content.trim() : '';
  if (!content) return { ok: false, error: 'The model sent an empty answer.', ...timings };
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return { ok: false, error: 'The model answer was not in the form that was asked for.', ...timings };
  }
  const bad = checkAgainstSchema(value, req.schema);
  if (bad) return { ok: false, error: `The model answer was not in the form that was asked for: ${bad}.`, ...timings };
  return { ok: true, value: value as T, ...timings };
}

async function chatNow<T>(cfg: LanternConfig, req: ChatRequest, deps: ChatDeps): Promise<ChatResult<T>> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const started = performance.now();
  let last: Attempt<T> | null = null;
  let firstError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt === 2) await sleep(deps.retryDelayMs ?? RETRY_DELAY_MS);
    try {
      last = await attemptOnce<T>(cfg, req, fetchImpl);
    } catch (e) {
      last = {
        ok: false, error: `The call failed: ${e instanceof Error ? e.message : String(e)}`,
        loadSeconds: 0, promptTokens: 0, promptSeconds: 0, outputTokens: 0, outputSeconds: 0
      };
    }
    const timings: ChatTimings = {
      wallSeconds: Math.round((performance.now() - started) / 10) / 100,
      loadSeconds: last.loadSeconds,
      promptTokens: last.promptTokens,
      promptSeconds: last.promptSeconds,
      outputTokens: last.outputTokens,
      outputSeconds: last.outputSeconds,
      attempts: attempt
    };
    if (last.ok) return { ok: true, value: last.value as T, timings };
    // A call that was stopped on purpose is not tried again.
    if (req.signal?.aborted) return { ok: false, error: CALL_STOPPED, timings };
    if (attempt === 1) {
      firstError = last.error ?? 'unknown error';
    } else {
      const second = last.error ?? 'unknown error';
      const error = second === firstError
        ? `Tried twice. ${second}`
        : `Tried twice. First: ${firstError} Second: ${second}`;
      return { ok: false, error, timings };
    }
  }
  // Not reached: the loop always returns on the second attempt.
  return {
    ok: false, error: 'The call did not run.',
    timings: { wallSeconds: 0, loadSeconds: 0, promptTokens: 0, promptSeconds: 0, outputTokens: 0, outputSeconds: 0, attempts: 0 }
  };
}

let line: Promise<unknown> = Promise.resolve();

/** Calls one local model. Waits its turn when another call from this process is running. */
export function chat<T>(cfg: LanternConfig, req: ChatRequest, deps: ChatDeps = {}): Promise<ChatResult<T>> {
  const run = line.then(() => chatNow<T>(cfg, req, deps));
  line = run.catch(() => undefined);
  return run;
}
