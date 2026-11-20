import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SAMPLE_NOTE } from '../App.tsx';
import { Hero } from './Hero.tsx';

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('Hero', () => {
  it('shows the fixed purpose line, slogan and fictional line', () => {
    const html = text(renderToStaticMarkup(<Hero note={SAMPLE_NOTE} />));
    expect(html).toContain('A Pharmacist-in-the-loop Clinical Decision Support System');
    expect(html).toContain('See what routine dispensing can miss.');
    expect(html).toContain('Fictional patient. No real person.');
    expect(html).toContain('Prototype');
    expect(html).toContain('Sample data. The models are not connected.');
  });

  it('announces the name once as ClinicaLANTERN', () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toContain('aria-label="ClinicaLANTERN"');
    expect(html.match(/aria-label="ClinicaLANTERN"/g)?.length).toBe(1);
  });

  // The approved first screen: the stage tag and the note about the data at the top left, the
  // fictional line at the top right, the mark to the left of the name.
  it('keeps the stage tag and the note on the left and the fictional line on the right', () => {
    const html = renderToStaticMarkup(<Hero note={SAMPLE_NOTE} />);
    expect(html).toContain(
      '<div class="hero-strip-left"><span class="stage-tag">Prototype</span>' +
        '<span class="stage-note" role="note">Sample data. The models are not connected.</span></div>' +
        '<span class="fictional-tag">Fictional patient. No real person.</span>',
    );
    expect(html.indexOf('class="hero-mark"')).toBeGreaterThan(-1);
    expect(html.indexOf('class="hero-mark"')).toBeLessThan(html.indexOf('class="hero-words"'));
  });

  it('shows no note when the page shows a live run', () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).not.toContain('stage-note');
    expect(html).toContain('<span class="stage-tag">Prototype</span>');
  });

  it('writes the name as the brand sheet does: Clinica, a golden L, ANTERN', () => {
    const html = renderToStaticMarkup(<Hero />);
    expect(html).toContain(
      '<span aria-hidden="true" class="wm-clinica">Clinica</span>' +
        '<span aria-hidden="true" class="wm-l">L</span>' +
        '<span aria-hidden="true" class="wm-antern">ANTERN</span>',
    );
  });

  it('puts what it is given at the foot of the band, under the slogan', () => {
    const html = renderToStaticMarkup(
      <Hero>
        <p>the steps of a recorded run</p>
      </Hero>,
    );
    expect(html.indexOf('See what routine dispensing can miss.')).toBeLessThan(html.indexOf('the steps of a recorded run'));
    expect(html).toMatch(/<p>the steps of a recorded run<\/p><\/header>$/);
  });
});