import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PopUps } from './PopUps.tsx';

describe('PopUps', () => {
  it('labels the message region for screen readers', () => {
    const html = renderToStaticMarkup(
      <PopUps
        popUps={[{ id: 1, kind: 'finding', panel: 'bell', count: 1 }]}
        openPanel={null}
        onOpen={() => undefined}
        onDismiss={() => undefined}
      />,
    );
    expect(html).toContain('class="popups" role="region" aria-live="polite" aria-label="Messages"');
  });
});