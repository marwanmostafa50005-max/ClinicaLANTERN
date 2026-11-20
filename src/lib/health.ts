// The words the page uses for the local models: ready, not running, or one missing.
// Pure code: no browser, no server.
import type { Activity, HealthResponse, StateResponse } from '../../shared/types.ts';

export interface ModelsWords {
  text: string;
  ok: boolean;
}

/** What to say about the local models. Null until the first answer has come. */
export function modelsWords(health: HealthResponse | null): ModelsWords | null {
  if (!health) return null;
  if (health.ollama !== 'up') {
    return {
      text:
        'The local models are not running. A history cannot be screened until they are. ' +
        'Start them with start-ollama.ps1 (step 1 of docs\\RUNNING.md).',
      ok: false,
    };
  }
  const missing = (['screen', 'check', 'letter'] as const).filter((job) => !health.models[job]);
  if (missing.length > 0) {
    return {
      text: `The model server is running, but ${missing.length === 1 ? 'a model is' : 'some models are'} missing: ${missing
        .map((job) => health.names[job])
        .join(', ')}.`,
      ok: false,
    };
  }
  return { text: 'The three local models are ready.', ok: true };
}

/** How long a problem from the activity log stays on the first screen. */
export const PROBLEM_SHOWN_MS = 15 * 60 * 1000;

/**
 * The newest "Problem" entry of the activity log, while it is fresh. It is shown on the first
 * screen, so a pharmacist who waits for the bell is not left with a quiet page when something
 * went wrong. Null when there is none, or when it is older than a quarter of an hour.
 */
export function latestProblem(snap: StateResponse | null): Activity | null {
  if (!snap) return null;
  const now = Date.parse(snap.serverTime);
  for (let i = snap.state.activity.length - 1; i >= 0; i--) {
    const entry = snap.state.activity[i];
    if (entry.kind !== 'error') continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || !Number.isFinite(now) || now - at > PROBLEM_SHOWN_MS) return null;
    // The entry that says a problem is over is not a problem to show.
    if (entry.text.startsWith('The state file can be written again')) return null;
    return entry;
  }
  return null;
}
