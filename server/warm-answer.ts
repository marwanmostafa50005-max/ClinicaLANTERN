// What the warm-up does with one answer from Model 1. No model is called here.
// A wrong shape still means the model server answered, so the model is in memory.
// Only a server that did not answer, or a call that took too long, is a failed warm-up.
import { failedBecauseServerIsDown } from '../pipeline/ollama.ts';

export function warmAnswer(answer: { ok: true } | { ok: false; error: string }): { ok: true } | { ok: false; error: string } {
  if (answer.ok) return { ok: true };
  if (failedBecauseServerIsDown(answer.error) || answer.error.includes('took too long')) {
    return { ok: false, error: answer.error };
  }
  return { ok: true };
}
