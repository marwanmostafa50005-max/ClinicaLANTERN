// Keeps the page in step with the local server: asks GET /api/state every second,
// loads the criteria, and raises a small pop-up message when something new appears.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { HealthResponse, StateResponse } from '../../shared/types.ts';
import { api, isMock, isReplay } from '../api.ts';
import { byId } from './criteria.ts';
import type { CriterionView } from './criteria.ts';
import { newThings, popUpsFor } from './events.ts';
import type { PanelName, PopUp } from './events.ts';

const POLL_MS = 1000;
const HEALTH_MS = 20000;
/** While the models are not ready the page asks more often, so the warning goes as soon as they are. */
const HEALTH_MS_WHEN_DOWN = 5000;
const POP_UP_MS = 10000;
const POP_UP_MAX = 4;

export interface ShownPopUp extends PopUp {
  id: number;
}

export interface Lantern {
  /** The last answer from the server, or null before the first one. */
  snap: StateResponse | null;
  /** True when the last call to the server failed. */
  serverDown: boolean;
  criteria: Record<string, CriterionView>;
  /** False until the first call for the criteria has ended, well or badly. */
  criteriaLoaded: boolean;
  /** Null in the sample view and until the first answer. */
  health: HealthResponse | null;
  popUps: ShownPopUp[];
  dismissPopUp(id: number): void;
  /** Take away the pop-ups about one panel. Used when the pharmacist opens that panel. */
  dismissPopUpsFor(panel: PanelName): void;
  /** Ask the server for the state now, without waiting for the next second. */
  refresh(): Promise<void>;
  /** Ask now whether the local models are running. Used when a history is imported. */
  refreshHealth(): Promise<void>;
}

/** True when Ollama is up and the three models are there. */
export function modelsReady(health: HealthResponse | null): boolean {
  return health !== null && health.ollama === 'up' && health.models.screen && health.models.check && health.models.letter;
}

/** openPanel: the panel that is open now. A pop-up about it is not raised. */
export function useLantern(openPanel: PanelName | null = null): Lantern {
  const [snap, setSnap] = useState<StateResponse | null>(() => api.peekState?.() ?? null);
  const [serverDown, setServerDown] = useState(false);
  const [criteria, setCriteria] = useState<Record<string, CriterionView>>(() => byId(api.peekCriteria?.() ?? []));
  const [criteriaLoaded, setCriteriaLoaded] = useState(() => api.peekCriteria !== undefined);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [popUps, setPopUps] = useState<ShownPopUp[]>([]);

  const lastSnap = useRef<StateResponse | null>(snap);
  const lastKey = useRef('');
  const nextPopUpId = useRef(1);
  const alive = useRef(true);
  const open = useRef(openPanel);
  open.current = openPanel;

  const dismissPopUp = useCallback((id: number) => {
    setPopUps((list) => list.filter((p) => p.id !== id));
  }, []);

  const dismissPopUpsFor = useCallback((panel: PanelName) => {
    setPopUps((list) => (list.some((p) => p.panel === panel) ? list.filter((p) => p.panel !== panel) : list));
  }, []);

  const apply = useCallback(
    (next: StateResponse) => {
      // Re-draw only when something changed. The clock alone is refreshed twice a minute, for "overdue".
      const key = JSON.stringify([next.state, next.counts, next.now, next.recorded]);
      const before = lastSnap.current;
      const changed = key !== lastKey.current;
      const clockMoved = !before || Date.parse(next.serverTime) - Date.parse(before.serverTime) > 30000;
      if (!changed && !clockMoved) return;
      lastKey.current = key;
      lastSnap.current = next;
      setSnap(next);

      if (before && changed) {
        // One pop-up for each kind. A second event of the same kind adds to the one already showing.
        // Nothing is raised for the panel that is open: the pharmacist is looking at it.
        const fresh = popUpsFor(newThings(before.state, next.state), open.current).map((p) => ({
          ...p,
          id: nextPopUpId.current++,
        }));
        if (fresh.length > 0) {
          setPopUps((list) => {
            const kept = list.filter((old) => !fresh.some((p) => p.kind === old.kind));
            const merged = fresh.map((p) => ({
              ...p,
              count: p.count + (list.find((old) => old.kind === p.kind)?.count ?? 0),
            }));
            return [...kept, ...merged].slice(-POP_UP_MAX);
          });
          for (const p of fresh) window.setTimeout(() => alive.current && dismissPopUp(p.id), POP_UP_MS);
        }
      }
    },
    [dismissPopUp],
  );

  const refresh = useCallback(async () => {
    try {
      const next = await api.getState();
      if (!alive.current) return;
      apply(next);
      setServerDown(false);
    } catch {
      if (alive.current) setServerDown(true);
    }
  }, [apply]);

  // The state, every second. The next call starts only after the last one has ended.
  useEffect(() => {
    alive.current = true;
    let timer = 0;
    const loop = async () => {
      await refresh();
      if (alive.current) timer = window.setTimeout(loop, POLL_MS);
    };
    void loop();
    return () => {
      alive.current = false;
      window.clearTimeout(timer);
    };
  }, [refresh]);

  // The criteria. Asked until they have come once, and again when a finding names a criterion
  // the page does not know yet. Never more often than every five seconds.
  const criteriaAsk = useRef({ at: 0, came: false });
  const unknownCriterion =
    snap !== null && snap.state.findings.some((f) => criteria[f.criterionId] === undefined);
  useEffect(() => {
    if (serverDown) return;
    const ask = criteriaAsk.current;
    const now = Date.now();
    if ((ask.came && !unknownCriterion) || now - ask.at < 5000) return;
    ask.at = now;
    api
      .getCriteria()
      .then((list) => {
        if (!alive.current) return;
        ask.came = true;
        setCriteria(byId(list));
        setCriteriaLoaded(true);
      })
      .catch(() => {
        // Asked again later. Until then a finding says that its criterion text is missing.
        if (alive.current) setCriteriaLoaded(true);
      });
  }, [unknownCriterion, serverDown, snap]);

  // Are the local models there? Not asked in the sample view or in a recorded run, which have no models.
  const noModels = isMock || isReplay;
  const healthStopped = useRef(false);
  const refreshHealth = useCallback(async () => {
    if (noModels) return;
    try {
      const answer = await api.getHealth();
      if (!healthStopped.current) setHealth(answer);
    } catch {
      if (!healthStopped.current) setHealth(null);
    }
  }, [noModels]);

  const ready = modelsReady(health);
  useEffect(() => {
    if (noModels) return;
    healthStopped.current = false;
    let timer = 0;
    const ask = async () => {
      await refreshHealth();
      if (!healthStopped.current) timer = window.setTimeout(ask, ready ? HEALTH_MS : HEALTH_MS_WHEN_DOWN);
    };
    void ask();
    return () => {
      healthStopped.current = true;
      window.clearTimeout(timer);
    };
  }, [noModels, refreshHealth, ready]);

  return { snap, serverDown, criteria, criteriaLoaded, health, popUps, dismissPopUp, dismissPopUpsFor, refresh, refreshHealth };
}
