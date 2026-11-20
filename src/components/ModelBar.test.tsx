import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IconRow } from './IconRow.tsx';
import { ModelBar } from './ModelBar.tsx';

const noop = (): void => undefined;

describe('ModelBar', () => {
  it('holds the three models in Mantle, Lumen, Ogee order with names and picture files', () => {
    const html = renderToStaticMarkup(<ModelBar />);
    expect(html).toContain('class="model-bar"');
    const mantle = html.indexOf('/models/mantle.svg');
    const lumen = html.indexOf('/models/lumen.svg');
    const ogee = html.indexOf('/models/ogee.svg');
    expect(mantle).toBeGreaterThan(-1);
    expect(lumen).toBeGreaterThan(mantle);
    expect(ogee).toBeGreaterThan(lumen);
    expect(html).toContain('>MANTLE<');
    expect(html).toContain('>LUMEN<');
    expect(html).toContain('>OGEE<');
  });

  it('has no click handler, no tab stop, and carries its group label and the three place labels', () => {
    const html = renderToStaticMarkup(<ModelBar />);
    expect(html).not.toContain('type="button"');
    expect(html).not.toContain('tabindex');
    expect(html).toContain('aria-label="The three models"');
    expect(html).toContain('aria-label="Mantle, the model that reads the record and finds"');
    expect(html).toContain('aria-label="Lumen, the model that checks each finding"');
    expect(html).toContain('aria-label="Ogee, the model that writes the letter"');
  });

  it('shows two arrows, from Mantle to Lumen and from Lumen to Ogee, hidden from screen readers', () => {
    const html = renderToStaticMarkup(<ModelBar />);
    const arrows = html.match(/<[^>]+ class="model-bar-arrow [^"]*"[^>]*>/g) ?? [];
    expect(arrows).toHaveLength(2);
    for (const arrow of arrows) {
      expect(arrow).toContain('aria-hidden="true"');
    }

    const first = html.indexOf('model-bar-arrow--first');
    const second = html.indexOf('model-bar-arrow--second');
    expect(first).toBeGreaterThan(html.indexOf('>MANTLE<'));
    expect(first).toBeLessThan(html.indexOf('src="/models/lumen.svg"'));
    expect(second).toBeGreaterThan(html.indexOf('>LUMEN<'));
    expect(second).toBeLessThan(html.indexOf('src="/models/ogee.svg"'));
    expect(html.slice(html.indexOf('>OGEE<'))).not.toContain('model-bar-arrow');
    expect(html).not.toContain('tabindex');
    expect(html).not.toContain('type="button"');
  });
});

describe('IconRow with ModelBar', () => {
  it('keeps the model bar outside the three icon buttons', () => {
    const html = renderToStaticMarkup(
      <IconRow
        scansToCheck={0}
        notFullyScreened={0}
        bellBadge={0}
        disputedCount={0}
        letterBadge={0}
        dragging={false}
        onOpen={noop}
      />,
    );
    expect(html.match(/type="button"/g)?.length).toBe(3);
    expect(html).toContain('class="model-bar"');
    expect(html.indexOf('class="model-bar"')).toBeGreaterThan(html.lastIndexOf('type="button"'));
  });
});