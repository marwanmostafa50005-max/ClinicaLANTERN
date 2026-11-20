import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StatusLine, statusDisplayText } from './StatusLine.tsx';

const text = (markup: string): string =>
  markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('StatusLine', () => {
  it('shows the server text unchanged', () => {
    const line = text(
      renderToStaticMarkup(
        <StatusLine now={{ stage: 'screen', text: 'Mantle is screening: criterion 214 of 413' }} serverDown={false} />,
      ),
    );
    expect(line).toContain('Now: Mantle is screening: criterion 214 of 413');
  });

  it('says when the server is down', () => {
    expect(statusDisplayText(null, true)).toBe('Waiting for the local server');
    const line = text(renderToStaticMarkup(<StatusLine now={null} serverDown />));
    expect(line).toContain('Waiting for the local server');
  });

  it('says starting before the first answer', () => {
    expect(statusDisplayText(null, false)).toBe('Starting');
    const line = text(renderToStaticMarkup(<StatusLine now={null} serverDown={false} />));
    expect(line).toContain('Now: Starting');
  });

  it('shows the pill of a stopped server while the server does not answer, also in the middle of a step', () => {
    const html = renderToStaticMarkup(
      <StatusLine now={{ stage: 'screen', text: 'Mantle is screening: criterion 214 of 413' }} serverDown />,
    );
    expect(html).toContain('class="status-line status-line--down"');
    expect(html).not.toContain('status-line--screen');
    expect(text(html)).toContain('Now: The local server is not answering. Trying again.');
    const waiting = renderToStaticMarkup(<StatusLine now={null} serverDown />);
    expect(waiting).toContain('class="status-line status-line--down"');
  });

  it('puts alerts in a live region with a plain list inside', () => {
    const html = renderToStaticMarkup(
      <StatusLine
        now={{ stage: null, text: 'Idle' }}
        serverDown={false}
        alerts={[{ key: 'models', text: 'The local models are not running.' }]}
      />,
    );
    expect(html).toContain('class="status-alerts-live" role="alert"');
    expect(html).toContain('<ul class="status-alerts">');
    expect(html).toContain('<li class="status-alert">');
    expect(html).not.toMatch(/<ul class="status-alerts" role="alert"/);
  });

  it('shows the dot of the step that is running, and the idle dot when nothing runs', () => {
    const stage = (now: Parameters<typeof StatusLine>[0]['now']): string =>
      renderToStaticMarkup(<StatusLine now={now} serverDown={false} />);
    expect(stage({ stage: 'screen', text: 'Mantle is screening: criterion 4 of 12' })).toContain('status-line--screen');
    expect(stage({ stage: 'check', text: 'Lumen is double-checking 2 findings' })).toContain('status-line--check');
    expect(stage({ stage: 'letter', text: 'Ogee is writing the letter' })).toContain('status-line--letter');
    expect(stage({ stage: null, text: 'Idle' })).toContain('status-line--idle');
    expect(stage(null)).toContain('status-line--idle');
  });
});