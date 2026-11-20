import { useEffect, useRef, useState } from 'react';
import type { NowRunning } from '../../shared/types.ts';
import { shouldAnnounceStatusChange, statusAnnouncementBucket } from '../lib/statusLine.ts';
import { AlertIcon } from './glyphs.tsx';

export interface StatusAlert {
  /** A short key, so the list can be drawn. */
  key: string;
  text: string;
  /** The words of a button that takes the pharmacist to the place to act, when there is one. */
  action?: string;
  onAction?(): void;
}

interface StatusLineProps {
  now: NowRunning | null;
  serverDown: boolean;
  /**
   * Things the pharmacist must not miss while he waits for the bell: the models are not running,
   * a history was not fully screened, a step reported a problem. Nothing is shown when all is well.
   */
  alerts?: StatusAlert[];
}

/** Wording shown after "Now:" from server state. */
export function statusDisplayText(now: NowRunning | null, serverDown: boolean): string {
  if (serverDown && !now) return 'Waiting for the local server';
  if (serverDown) return 'The local server is not answering. Trying again.';
  if (now) return now.text || 'Idle';
  return 'Starting';
}

/** One line in plain words about what is happening now, as the server tells it. */
export function StatusLine({ now, serverDown, alerts = [] }: StatusLineProps) {
  const stage = now?.stage ?? null;
  const text = statusDisplayText(now, serverDown);
  const bucket = statusAnnouncementBucket(text, serverDown, stage);

  const lastBucket = useRef<string | null>(null);
  const [announced, setAnnounced] = useState<string | null>(null);

  useEffect(() => {
    if (shouldAnnounceStatusChange(lastBucket.current, bucket)) {
      lastBucket.current = bucket;
      setAnnounced(`Now: ${text}`);
    }
  }, [bucket, text]);

  // The alerts sit beside the status line, in the same row when there is room, so the first
  // screen still shows the counts at 1366 by 768.
  return (
    <div className="status-row">
      <p className={`status-line status-line--${serverDown ? 'down' : now?.stage ?? 'idle'}`}>
        <span className="status-dot" aria-hidden="true" />
        <span className="status-label">Now:</span> <span className="status-text">{text}</span>
      </p>
      {announced ? (
        <p className="sr-only" role="status" aria-live="polite">
          {announced}
        </p>
      ) : null}
      {alerts.length > 0 ? (
        <div className="status-alerts-live" role="alert">
          <ul className="status-alerts">
            {alerts.map((alert) => (
              <li key={alert.key} className="status-alert">
                <AlertIcon />
                <span>
                  {alert.text}{' '}
                  {alert.action && alert.onAction ? (
                    <button type="button" className="link-btn" onClick={alert.onAction}>
                      {alert.action}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}