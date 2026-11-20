import type { Activity, HealthResponse } from '../../shared/types.ts';

/** Display names for the three model jobs until the contract carries them on every response. */
export const JOB_NAMES = {
  screen: 'Mantle',
  check: 'Lumen',
  letter: 'Ogee',
} as const;

/** Default open models proven on this computer (docs/SPEC.md section 3). */
export const DEFAULT_MODELS = {
  screen: 'Gemma 4 31B',
  check: 'Qwen 3.8 27B',
  letter: 'Gemma 4 26B',
} as const;

/** The three names the page shows. The settings on the health response win; otherwise Mantle, Lumen, Ogee. */
export interface DisplayNames {
  screen: string;
  check: string;
  letter: string;
}

function shown(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export function displayNamesOf(health: HealthResponse | null | undefined): DisplayNames {
  const names = health?.displayNames;
  return {
    screen: shown(names?.screen, JOB_NAMES.screen),
    check: shown(names?.check, JOB_NAMES.check),
    letter: shown(names?.letter, JOB_NAMES.letter),
  };
}

/** The word on an activity-log badge. Import, Pharmacist and the rest stay as they are. */
export function kindWords(names: DisplayNames = JOB_NAMES): Record<Activity['kind'], string> {
  return {
    import: 'Import',
    screen: names.screen,
    check: names.check,
    decision: 'Pharmacist',
    letter: names.letter,
    letter_status: 'Letter',
    error: 'Problem',
    reset: 'Reset',
  };
}

/** One plain footer line: which open model sits behind each job name. */
export function modelsFooterLine(health: HealthResponse | null): string {
  const names = displayNamesOf(health);
  const behind = health?.modelsBehind;
  const screen = shown(behind?.screen, DEFAULT_MODELS.screen);
  const check = shown(behind?.check, DEFAULT_MODELS.check);
  const letter = shown(behind?.letter, DEFAULT_MODELS.letter);
  return `${names.screen}: ${screen}. ${names.check}: ${check}. ${names.letter}: ${letter}. All three run on this computer through Ollama.`;
}