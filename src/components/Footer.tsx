import { useState } from 'react';
import type { Activity, HealthResponse } from '../../shared/types.ts';
import { api, errorText, isMock, isReplay } from '../api.ts';
import { formatDateTime } from '../lib/format.ts';
import { modelsWords } from '../lib/health.ts';
import { displayNamesOf, kindWords, modelsFooterLine } from '../lib/modelNames.ts';
import { FICTIONAL_LINE } from '../lib/letters.ts';

interface FooterProps {
  health: HealthResponse | null;
  activity: Activity[];
  /** Null until the criteria list has been read once. */
  criteriaCount: number | null;
  onOpenCriteria(): void;
  refresh(): Promise<void>;
}

/** The quiet part under the three icons: what the app is, the activity log, and a clean start for a demo. */
export function Footer({ health, activity, criteriaCount, onOpenCriteria, refresh }: FooterProps) {
  const badges = kindWords(displayNamesOf(health));
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The sample view and a recorded run have no models behind them. The top of the page says so.
  const models = isMock || isReplay ? null : modelsWords(health);
  // Newest first, and not more than the pharmacist can read.
  const recent = activity.slice(-60).reverse();

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resetDemo();
      await refresh();
      setAsking(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <footer className="foot">
      <p className="foot-fictional">{FICTIONAL_LINE}</p>
      <p>
        ClinicaLANTERN runs open models on the pharmacy's own computer through Ollama, an open-source model runner.
        Three local models work one after another. The pharmacist decides.
      </p>
      {/* Which open model is behind each of the three names, so the truth stays visible. */}
      <p>{modelsFooterLine(health)}</p>
      {models ? <p className={models.ok ? 'foot-ok' : 'foot-warn'}>{models.text}</p> : null}

      {criteriaCount !== null && criteriaCount > 0 ? (
        <p>
          <button type="button" className="link-btn" onClick={onOpenCriteria}>
            All criteria in use ({criteriaCount})
          </button>
        </p>
      ) : null}

      <details className="foot-log">
        <summary>Activity log ({activity.length})</summary>
        {recent.length === 0 ? (
          <p>Nothing has happened yet.</p>
        ) : (
          <ol>
            {recent.map((entry, i) => (
              <li key={`${entry.at}-${i}`}>
                <span className="log-when">{formatDateTime(entry.at)}</span>
                <span className={`log-kind log-kind--${entry.kind}`}>{badges[entry.kind] ?? entry.kind}</span>
                <span className="log-text">{entry.text}</span>
              </li>
            ))}
          </ol>
        )}
      </details>

      {/* A recorded run cannot be changed, so it has no clean start. */}
      <div className="foot-reset" hidden={isReplay}>
        {asking ? (
          <div className="inline-form" role="group" aria-label="Start a clean demo?">
            <p className="inline-form-title">Start a clean demo?</p>
            <p>
              Every history, finding and letter is taken off the page.
              {isMock ? ' The sample data comes back when the page is loaded again.' : ' The server keeps the old state as a dated backup file.'}
            </p>
            {error ? (
              <p className="note note--error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="btn-row">
              <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void reset()}>
                {busy ? 'Starting' : 'Yes, start clean'}
              </button>
              <button type="button" className="btn btn-quiet btn-small" disabled={busy} onClick={() => setAsking(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="link-btn" onClick={() => setAsking(true)}>
            Start a clean demo
          </button>
        )}
      </div>
    </footer>
  );
}
