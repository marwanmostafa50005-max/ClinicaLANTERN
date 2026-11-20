import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Activity } from '../../shared/types.ts';
import { Footer } from './Footer.tsx';

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const refresh = async (): Promise<void> => undefined;

const at = '2026-11-18T01:00:00.000Z';
const activity: Activity[] = [
  { at, kind: 'import', text: 'Imported fictional-patient-a.csv.' },
  { at, kind: 'screen', text: 'Mantle screened the history.' },
  { at, kind: 'check', text: 'Lumen confirmed a finding.' },
  { at, kind: 'decision', text: 'The pharmacist accepted the finding.' },
  { at, kind: 'letter', text: 'Ogee wrote the letter.' },
];

describe('Footer', () => {
  it('says which open model is behind each of the three names, under the words about the app', () => {
    const line = text(renderToStaticMarkup(<Footer health={null} activity={[]} criteriaCount={null} onOpenCriteria={() => undefined} refresh={refresh} />));
    const about = line.indexOf('Three local models work one after another. The pharmacist decides.');
    const models = line.indexOf(
      'Mantle: Gemma 4 31B. Lumen: Qwen 3.8 27B. Ogee: Gemma 4 26B. All three run on this computer through Ollama.',
    );
    expect(line.indexOf('Fictional patient. No real person.')).toBe(0);
    expect(about).toBeGreaterThan(0);
    expect(models).toBeGreaterThan(about);
  });

  it('names the three models by their names in the activity log, newest entry first', () => {
    const html = renderToStaticMarkup(
      <Footer health={null} activity={activity} criteriaCount={null} onOpenCriteria={() => undefined} refresh={refresh} />,
    );
    const kinds = [...html.matchAll(/<span class="log-kind log-kind--[a-z_]+">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(kinds).toEqual(['Ogee', 'Pharmacist', 'Lumen', 'Mantle', 'Import']);
    expect(text(html)).toContain('Activity log (5)');
    expect(text(html)).not.toMatch(/Model [123]/);
  });

  it('uses the display names and the models behind them from the health response', () => {
    const health = {
      ollama: 'up' as const,
      models: { screen: true, check: true, letter: true },
      names: { screen: 'lantern-screen', check: 'lantern-check', letter: 'lantern-letter' },
      displayNames: { screen: 'Alpha', check: 'Beta', letter: 'Gamma' },
      modelsBehind: { screen: 'Model A', check: 'Model B', letter: 'Model C' },
    };
    const html = renderToStaticMarkup(
      <Footer health={health} activity={activity} criteriaCount={null} onOpenCriteria={() => undefined} refresh={refresh} />,
    );
    const kinds = [...html.matchAll(/<span class="log-kind log-kind--[a-z_]+">([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(kinds).toEqual(['Gamma', 'Pharmacist', 'Beta', 'Alpha', 'Import']);
    expect(text(html)).toContain('Alpha: Model A. Beta: Model B. Gamma: Model C. All three run on this computer through Ollama.');
    expect(text(html)).not.toContain('Gemma 4 31B');
    expect(text(html)).not.toContain('Qwen 3.8 27B');
  });

  it('keeps the activity log and the clean start, and draws no line across the page', () => {
    const html = renderToStaticMarkup(
      <Footer health={null} activity={[]} criteriaCount={null} onOpenCriteria={() => undefined} refresh={refresh} />,
    );
    expect(text(html)).toContain('Activity log (0)');
    expect(text(html)).toContain('Nothing has happened yet.');
    expect(text(html)).toContain('Start a clean demo');
    expect(html).not.toContain('foot-divider');
  });
});
