import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconRow } from './IconRow.tsx';

const noop = (): void => undefined;

describe('IconRow', () => {
  const base = {
    scansToCheck: 0,
    notFullyScreened: 0,
    bellBadge: 0,
    disputedCount: 0,
    letterBadge: 0,
    dragging: false,
    onOpen: noop,
  };

  it('has three buttons in import, bell, letter order with aria-labels', () => {
    const html = renderToStaticMarkup(<IconRow {...base} />);
    expect(html.match(/type="button"/g)?.length).toBe(3);
    expect(html.indexOf('Import a history')).toBeLessThan(html.indexOf('Findings. Confirmed'));
    expect(html.indexOf('Findings. Confirmed')).toBeLessThan(html.indexOf('Letters. Letters'));
    expect(html).toContain('aria-label="Import a history. Import a dispensing history, CSV or PDF, by click or by drop."');
    expect(html).toContain('aria-label="Findings. Confirmed findings waiting for the pharmacist."');
    expect(html).toContain('aria-label="Letters. Letters to the doctor and their status."');
  });

  it('shows no badges at zero', () => {
    const html = renderToStaticMarkup(<IconRow {...base} />);
    expect(html).not.toMatch(/class="orb-badge"/);
    expect(html).not.toMatch(/class="orb-disputed"/);
  });

  it('shows 99+ above 99', () => {
    const html = renderToStaticMarkup(<IconRow {...base} bellBadge={120} letterBadge={100} />);
    expect(html).toContain('99+');
  });

  it('shows the grey disputed count when one waits', () => {
    const html = renderToStaticMarkup(<IconRow {...base} disputedCount={1} />);
    expect(html).toContain('orb-disputed');
    expect(html).toContain('aria-label="1 finding on which the two models disagree"');
  });

  it('hides the grey count when none wait', () => {
    const html = renderToStaticMarkup(<IconRow {...base} disputedCount={0} />);
    expect(html).not.toContain('orb-disputed');
  });

  it('puts the grey count before the red badge on the bell, and names both for a screen reader', () => {
    const html = renderToStaticMarkup(<IconRow {...base} bellBadge={4} disputedCount={1} />);
    expect(html.indexOf('id="orb-disputed-bell"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="orb-disputed-bell"')).toBeLessThan(html.indexOf('id="orb-badge-bell"'));
    expect(html).toContain('aria-describedby="orb-badge-bell orb-disputed-bell"');
    expect(html).toContain('aria-label="Findings: 4 waiting for your decision"');
  });

  it('shows the words of the approved first screen under the three icons', () => {
    const html = renderToStaticMarkup(<IconRow {...base} />);
    expect(html).toContain('<span class="orb-caption">Import a history</span>');
    expect(html).toContain('<span class="orb-caption">Findings</span>');
    expect(html).toContain('<span class="orb-caption">Letters</span>');
  });

  it('puts a red number on the magnifying glass when a scan waits for its rows to be checked', () => {
    const html = renderToStaticMarkup(<IconRow {...base} scansToCheck={1} />);
    expect(html).toContain('id="orb-badge-import"');
    expect(html).toContain('aria-label="1 scan waiting for you to check the rows"');
    expect(html).toContain('aria-describedby="orb-badge-import"');
    expect(html).toContain('<span class="orb-caption">Import a history</span>');
  });

  it('adds the histories that were not fully screened to the number on the magnifying glass', () => {
    const html = renderToStaticMarkup(<IconRow {...base} scansToCheck={1} notFullyScreened={2} />);
    expect(html).toMatch(/id="orb-badge-import"[^>]*>3</);
    expect(html).toContain('aria-label="1 scan waiting for you to check the rows, 2 histories not fully screened"');
  });

  it('asks for the file while one is dragged over the page', () => {
    const html = renderToStaticMarkup(<IconRow {...base} dragging />);
    expect(html).toContain('orbs--dragging');
    expect(html).toContain('<span class="orb-caption">Drop the file here</span>');
  });

  it('puts the model bar under the three icons outside the buttons', () => {
    const html = renderToStaticMarkup(<IconRow {...base} />);
    expect(html).toContain('class="model-bar"');
    expect(html).toContain('/models/mantle.svg');
    expect(html).toContain('/models/lumen.svg');
    expect(html).toContain('/models/ogee.svg');
    expect(html.indexOf('class="model-bar"')).toBeGreaterThan(html.lastIndexOf('orb-wrap--letter'));
  });

  it('opens the list of recorded cases in a recorded run', () => {
    const html = renderToStaticMarkup(<IconRow {...base} replay />);
    expect(html).toContain('<span class="orb-caption">Pick a recorded case</span>');
    expect(html).toContain('aria-label="Pick a recorded case. Choose a recorded run to play step by step."');
    expect(html).not.toContain('Import a history');
    const dropped = renderToStaticMarkup(<IconRow {...base} replay dragging />);
    expect(dropped).toContain('<span class="orb-caption">Pick a recorded case</span>');
  });
});