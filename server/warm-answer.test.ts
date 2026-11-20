// The warm-up's reading of one answer. No model is called.
import { describe, expect, it } from 'vitest';
import { SERVER_DID_NOT_ANSWER } from '../pipeline/ollama.ts';
import { warmAnswer } from './warm-answer.ts';

describe('warm-up answer', () => {
  it('counts a bad shape as warm, and a silent or slow server as not warm', () => {
    expect(warmAnswer({ ok: true })).toEqual({ ok: true });
    expect(warmAnswer({ ok: false, error: SERVER_DID_NOT_ANSWER })).toEqual({
      ok: false, error: SERVER_DID_NOT_ANSWER
    });
    expect(warmAnswer({ ok: false, error: 'Tried twice. The model took too long to answer.' })).toEqual({
      ok: false, error: 'Tried twice. The model took too long to answer.'
    });
    expect(warmAnswer({ ok: false, error: 'The model answer was not in the form that was asked for.' })).toEqual({
      ok: true
    });
    expect(warmAnswer({ ok: false, error: 'The model sent an empty answer.' })).toEqual({ ok: true });
    expect(warmAnswer({
      ok: false, error: 'The local model server answered with error 500: busy.'
    })).toEqual({ ok: true });
  });
});
