import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, errorText, isMock, isReplay, isReplayMock } from './api.ts';
import { BellPanel } from './components/BellPanel.tsx';
import { CountsLine } from './components/CountsLine.tsx';
import { Footer } from './components/Footer.tsx';
import { Hero } from './components/Hero.tsx';
import { IconRow } from './components/IconRow.tsx';
import { ImportPanel } from './components/ImportPanel.tsx';
import type { ImportJob } from './components/ImportPanel.tsx';
import { CriteriaPanel } from './components/CriteriaPanel.tsx';
import { LetterPanel } from './components/LetterPanel.tsx';
import { PopUps } from './components/PopUps.tsx';
import { ReplayBar } from './components/ReplayBar.tsx';
import { StatusLine } from './components/StatusLine.tsx';
import type { StatusAlert } from './components/StatusLine.tsx';
import { countNotFullyScreened, countScansToCheck } from './lib/events.ts';
import type { PanelName } from './lib/events.ts';
import { formatDateTime, plural } from './lib/format.ts';
import { latestProblem, modelsWords } from './lib/health.ts';
import { displayNamesOf } from './lib/modelNames.ts';
import { ImportError, prepareImport } from './lib/importFile.ts';
import { bellBadgeCount } from './lib/findings.ts';
import { countDisputedWaiting } from './lib/statusLine.ts';
import { useLantern } from './lib/useLantern.ts';

export const SAMPLE_NOTE = 'Sample data. The models are not connected.';
export const RECORDED_NOTE = "Recorded run from the entrant's computer. The live models are not connected.";

type OpenPanel = PanelName | 'criteria';

/** ?panel= opens a panel when the page loads (used for screenshots). */
function panelFromAddress(): OpenPanel | null {
  const value = new URLSearchParams(window.location.search).get('panel');
  if (value === 'criteria') return 'criteria';
  return value === 'bell' || value === 'letter' || value === 'import' ? value : null;
}

function letterFromAddress(): { letterId: string | null; preview: boolean } {
  const q = new URLSearchParams(window.location.search);
  if (q.get('panel') !== 'letter') return { letterId: null, preview: false };
  return { letterId: q.get('letter'), preview: q.get('preview') === '1' };
}

const draggedFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files');

export function App() {
  const [panel, setPanelNow] = useState<OpenPanel | null>(panelFromAddress);
  const letterAddress = useMemo(() => letterFromAddress(), []);
  // The panel that is open is told to the poll, so no pop-up is raised over the panel it is about.
  const lantern = useLantern(panel === 'criteria' ? null : panel);
  const { snap, refresh, dismissPopUpsFor, refreshHealth } = lantern;
  const names = displayNamesOf(lantern.health);
  // True only while the panel named in the page address is the one showing.
  const fromAddress = useRef(panel !== null);
  const setPanel = useCallback(
    (next: OpenPanel | null) => {
      fromAddress.current = false;
      setPanelNow(next);
      // A pop-up about a panel has done its job once that panel is open.
      if (next !== null && next !== 'criteria') dismissPopUpsFor(next);
    },
    [dismissPopUpsFor],
  );
  const [job, setJob] = useState<ImportJob>({ step: 'idle' });
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [dragging, setDragging] = useState(false);
  const importing = useRef(false);

  const importFiles = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setPanel('import');
      if (isReplay) {
        setPanel('import');
        setJob({
          step: 'error',
          fileName: files[0]?.name ?? 'File',
          message: 'Import is switched off in a recorded run.',
        });
        return;
      }
      if (importing.current) return;
      importing.current = true;
      const fileName = file.name;
      setJob({ step: 'working', fileName, text: 'Opening the file' });
      // Are the models running? Asked now, so the pharmacist is told at once and not twenty seconds later.
      void refreshHealth();
      try {
        const prepared = await prepareImport(file, (text) => setJob({ step: 'working', fileName, text }));
        setJob({ step: 'working', fileName, text: 'Sending the history to the local server' });
        const { caseId } = await api.importCase(prepared.request);
        if (prepared.previews.length > 0) setPreviews((all) => ({ ...all, [caseId]: prepared.previews }));
        const notes = [...prepared.notes];
        if (files.length > 1) notes.push('One history is imported at a time. Only the first file was imported.');
        setJob({ step: 'done', fileName, caseId, notes, warnings: prepared.warnings });
        await refresh();
      } catch (err) {
        setJob({ step: 'error', fileName, message: err instanceof ImportError ? err.message : errorText(err) });
      } finally {
        importing.current = false;
      }
    },
    [refresh, refreshHealth, setPanel],
  );

  // A file can be dropped anywhere on the page. This also stops the browser from opening the file itself.
  useEffect(() => {
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!draggedFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!draggedFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      if (!draggedFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!draggedFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      void importFiles(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [importFiles]);

  // The page behind an open panel does not scroll. A panel opened by the page address appears at once.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('panel-open', panel !== null);
    html.classList.toggle('panel-instant', panel !== null && fromAddress.current);
    return () => html.classList.remove('panel-open', 'panel-instant');
  }, [panel]);

  const close = useCallback(() => setPanel(null), [setPanel]);
  const counts = snap?.counts ?? null;

  // Say plainly what is on the screen when it is not a live run (docs/SPEC.md section 10).
  // The note is in the top of the first screen and in the head of every panel.
  const pageNote = isReplayMock || isMock ? SAMPLE_NOTE : isReplay || snap?.recorded ? RECORDED_NOTE : undefined;

  // What the pharmacist must not miss on the first screen. Nothing is listed when all is well.
  const models = isMock || isReplay ? null : modelsWords(lantern.health);
  const modelsNote = models && !models.ok ? models.text : null;
  const notFully = snap ? countNotFullyScreened(snap.state) : 0;
  const problem = isMock ? null : latestProblem(snap);
  const alerts: StatusAlert[] = [];
  // The first screen says it in one short sentence. How to start the models is said in the import panel and at the foot.
  if (modelsNote) {
    alerts.push({
      key: 'models',
      text: lantern.health?.ollama === 'up' ? modelsNote : 'The local models are not running. Nothing can be screened until they are.',
    });
  }
  if (notFully > 0) {
    alerts.push({
      key: 'not-fully',
      text: `${plural(notFully, 'history was', 'histories were')} not fully screened. This is not the same as no finding.`,
      action: 'See which',
      onAction: () => setPanel('import'),
    });
  }
  if (problem && !(notFully > 0 && problem.text.includes('could not fully screen'))) {
    alerts.push({ key: 'problem', text: `Problem at ${formatDateTime(problem.at)}: ${problem.text}` });
  }

  return (
    <>
      <div className="page" inert={panel !== null}>
        {!isMock && !isReplay && lantern.serverDown ? (
          <p className="banner banner--down" role="alert">
            The local server is not answering. The page keeps trying every second.
          </p>
        ) : null}

        <Hero note={pageNote}>
          {api.replay ? <ReplayBar replay={api.replay} paused={panel !== null} refresh={refresh} /> : null}
        </Hero>

        <main className="work">
          <IconRow
            scansToCheck={snap ? countScansToCheck(snap.state) : 0}
            notFullyScreened={notFully}
            bellBadge={snap ? bellBadgeCount(snap.state.findings) : 0}
            disputedCount={snap ? countDisputedWaiting(snap.state.findings) : 0}
            letterBadge={counts?.letterBadge ?? 0}
            dragging={dragging}
            replay={isReplay}
            onOpen={setPanel}
          />
          <StatusLine now={snap?.now ?? null} serverDown={lantern.serverDown} alerts={alerts} />
          <CountsLine counts={counts} />
        </main>

        <Footer
          health={lantern.health}
          activity={snap?.state.activity ?? []}
          criteriaCount={lantern.criteriaLoaded ? Object.keys(lantern.criteria).length : null}
          onOpenCriteria={() => setPanel('criteria')}
          refresh={refresh}
        />
      </div>

      {panel === 'import' ? (
        <ImportPanel
          snap={snap}
          criteria={lantern.criteria}
          job={job}
          previews={previews}
          dragging={dragging}
          modelsNote={modelsNote}
          pageNote={pageNote}
          replay={api.replay}
          onFiles={(files) => void importFiles(files)}
          refresh={refresh}
          onClose={close}
          onOpenBell={() => setPanel('bell')}
          names={names}
        />
      ) : null}
      {panel === 'bell' ? (
        <BellPanel
          snap={snap}
          criteria={lantern.criteria}
          criteriaLoaded={lantern.criteriaLoaded}
          pageNote={pageNote}
          refresh={refresh}
          onClose={close}
          onOpenLetters={() => setPanel('letter')}
          onOpenImport={() => setPanel('import')}
          names={names}
        />
      ) : null}
      {panel === 'criteria' ? (
        <CriteriaPanel pageNote={pageNote} onClose={close} />
      ) : null}
      {panel === 'letter' ? (
        <LetterPanel
          snap={snap}
          criteria={lantern.criteria}
          pageNote={pageNote}
          refresh={refresh}
          onClose={close}
          initialLetterId={letterAddress.letterId}
          initialPreview={letterAddress.preview}
          names={names}
        />
      ) : null}

      <PopUps
        popUps={lantern.popUps}
        openPanel={panel === 'criteria' ? null : panel}
        onOpen={setPanel}
        onDismiss={lantern.dismissPopUp}
      />
    </>
  );
}
