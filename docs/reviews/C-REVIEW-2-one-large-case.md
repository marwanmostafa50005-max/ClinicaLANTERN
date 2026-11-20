# C-REVIEW-2 — One large fictional case (code review)

Read-only review on branch `cursor`, 20 November 2026. No shell. One fictional patient, ~78 supply lines, ~44 findings, ~33 pharmacist questions, 582 criteria, ~600 model steps. Today’s engine path was tested with stand-ins; this pass asks what the **page and existing UI** do at that scale.

---

## Defects

### 1. NOT A BLOCKER — Activity log and jobs grow without cap in the saved state and in every poll

- **Where:** `server/engine.ts` 429–431 (`note` pushes to `state.activity`); `server/engine.ts` 703–718 (`stateResponse` returns full `this.state`); `src/lib/useLantern.ts` 106–108 (`api.getState`); `src/components/Footer.tsx` 26–27 (only **displays** last 60).
- **What the code does:** Every model step, decision, and letter event appends an `activity` row. Nothing trims `activity` in the store. `GET /api/state` sends the whole `AppState` every time, including the full log, all cases (78 lines each), 582 criterion runs, findings, letters, and jobs. The footer summary count is `activity.length`; the open list is sliced to 60.
- **What it should do (for scale):** Either cap or paginate activity in the file, or omit bulk history from the poll payload. Not required for correctness if the machine copes.
- **How to see it:** Run the large case to the end. Open **Activity log (N)** in the footer; N is hundreds. In devtools, watch `/api/state` response size grow through the run.

### 2. NOT A BLOCKER — Poll payload and client change-detection work on the full state every second

- **Where:** `src/lib/useLantern.ts` 11, 71–81, 117–124; `server/engine.ts` 711–717.
- **What the code does:** Poll interval is 1000 ms. Each answer is `JSON.stringify([next.state, next.counts, next.now, next.recorded])` for equality. Any job, finding, letter, or activity change re-renders the tree. During ~600 steps the state changes often, so the bell panel and main page redraw repeatedly while work runs.
- **What it should do:** Incremental or shallow updates for large states. Correctness does not depend on this.
- **How to see it:** Import the large history with the bell closed. Watch CPU and network on `/api/state` while Mantle is still screening.

### 3. NOT A BLOCKER — Pop-ups are not one per finding; counts merge and only four show

- **Where:** `src/lib/events.ts` 54–70, 90–98; `src/lib/useLantern.ts` 15–16, 83–99; `src/components/PopUps.tsx` 22–23.
- **What the code does:** `newThings` counts **batches** of new confirmed findings, unchecked findings, letters, etc. `popUpsFor` emits at most one pop-up per **kind**. Merging adds counts; the list keeps the last four (`POP_UP_MAX`). There is no per-finding toast stack.
- **What it should do:** For tonight’s video, the pharmacist may see “12 findings were confirmed” once, not twelve separate messages. That is by design, not loss of data.
- **How to see it:** Leave the main page open while many findings confirm. One or two bell-related pop-ups with large counts, not 44 rows.

### 4. NOT A BLOCKER — Pop-ups sit fixed at the top and stay in the panel tab order

- **Where:** `src/styles/base.css` 352–370, 103–111 in `src/components/Panel.tsx`; `src/components/PopUps.tsx` 31–46.
- **What the code does:** Pop-ups are `position: fixed`, `z-index: 80`, centred under the top of the viewport (or `top: 72px` when a panel is open on wide screens). Tab cycles include pop-up buttons with the open panel (`Panel.tsx` 110–111). They do not cover the three orbs on the main page, but on a wide screen they can sit over the **panel head** while the bell is open.
- **What it should do:** N/A unless clicks are stolen; buttons are reachable and dismissible.
- **How to see it:** Open the bell while findings still confirm. Pop-ups appear above the panel title area; close or use “Open the bell”.

### 5. NOT A BLOCKER — Accept turns a tall card into a short receipt; the next control can move under the pointer

- **Where:** `src/components/BellPanel.tsx` 273–275, 932–942, 971–995, 1084–1085.
- **What the code does:** On Accept, `decideFinding` then `refresh`. The card is replaced by a **Receipt** in the same list position. Focus moves to the next `[data-finding-focus]` with `preventScroll: true`. The comment at 971–973 says the receipt is short so the next card “moved up into view”; there is **no** scroll-position restore on poll refresh. Collapsing a finding grid (criterion, 78-line history, model text) to a one-line receipt **shortens** the document above anything below the pointer.
- **What it should do:** Keep scroll stable or anchor the clicked row if mis-clicks matter. Accept still saves the finding.
- **How to see it:** Scroll deep in the bell, accept a finding whose card is tall; watch the Accept button on the **next** card jump up.

### 6. NOT A BLOCKER — Orb bell badge counts all waiting findings, not “unseen” only (differs from `counts.bellBadge`)

- **Where:** `src/App.tsx` 202; `src/lib/findings.ts` 30–36; `server/view.ts` 51; `shared/types.ts` 326.
- **What the code does:** The red orb uses `bellBadgeCount` (all `state === 'confirmed'`). Server `counts.bellBadge` is confirmed **and not** `seenByPharmacist`. Opening the bell calls `markFindingSeen` (`BellPanel.tsx` 952–968), which lowers `counts.bellBadge` but **not** the orb number until findings are accepted or bypassed.
- **What it should do:** Align badge semantics if the video script assumes the orb clears on open. Work is not lost.
- **How to see it:** Open the bell with 44 waiting; `counts` line may drop “unseen” behaviour in tools that read `counts.bellBadge`, but the orb stays at 44 until decisions.

### 7. NOT A BLOCKER — Early accepts queue many letter jobs; the worker favours the current stage and can run letters in a batch

- **Where:** `server/engine.ts` 158–168, 1074–1088, 1099; `server/engine.ts` 1419–1453 (`lastStage`); `server/engine.ts` 1791–1804 (`maybeContinueScreen` holds screen while checks are open).
- **What the code does:** Each accept adds a letter job and calls `kick`. `pickNextJob` prefers queued jobs that are not “further” screen bands, then keeps the **same stage** as the last finished job. Accepting many findings while screening is still running queues many letter jobs. The worker may draft several letters before returning to screen, but screen segments still run when no check blocks `maybeContinueScreen`. Screening is delayed, not skipped.
- **What it should do:** Fairer interleaving if letters must not defer screening on a deadline. All criteria can still finish.
- **How to see it:** Accept ten findings quickly while status still says screening; status line alternates between letter and screen stages; findings still arrive later.

### 8. NOT A BLOCKER — Letter panel today is one letter per finding; print and preview assume a single letter body

- **Where:** `src/components/LetterPanel.tsx` 686–688, 946–970; `src/components/LetterPreview.tsx` 215–221, 125–126; `src/styles/print.css` 7–8, 31–38; `server/engine.ts` 1222–1230 (`previewHash` per letter).
- **What the code does:** `sortLetters` lists every `Letter` row. Preview and `markSent` use **per-letter** `previewHash` / `previewedAt`. Print CSS is tuned for **one** short letter on A4 (`print.css` 7–8). `letter-body` textarea uses `fitHeightKeepingScroll` for **one** body (`LetterPanel.tsx` 111–120, `letters.css` 245–254).
- **What it should do for a single 44-part letter (Grok):** Replace list semantics, one hash, one print flow, and height model. Today’s code does not do that.
- **How to see it:** Accept many findings; letter panel shows dozens of rows; each needs its own preview before send.

### 9. NOT A BLOCKER — State file written whole after essentially every queue step

- **Where:** `server/store.ts` 1–3, 218–219, 17–39; `server/engine.ts` 440–457, 1511–1517, 1450–1452.
- **What the code does:** `save()` writes the entire JSON atomically (temp file, fsync, rename with Windows retries). `finish` and starting a job both call `save()`. Expect on the order of **one write per model step** for a long run.
- **What it should do:** Batched or append-only persistence if disk or AV contention appears. Atomic whole-file write is intentional.
- **How to see it:** Watch `data/state.json` size and timestamp during the run; activity in the file matches the log.

### 10. NOT A BLOCKER — Mid-write server stop should not corrupt the state file

- **Where:** `server/store.ts` 16–39, 218–219.
- **What the code does:** Readers see old or new file, not a mix. If rename fails after six attempts, temp is unlinked and error propagates; engine `save()` catches failure and retries (`engine.ts` 440–515).
- **What it should do:** Already matches spec comment at `store.ts` 1–3.
- **How to see it:** Not safely reproducible in read-only review; behaviour is in unit tests around `writeFileAtomic`.

---

## Not settled

1. **Whether the browser stays usable** with ~44 full finding cards (each able to show 78 scrolling history lines) plus ~1 Hz full-state polls — depends on machine RAM/CPU; no code path caps DOM size.
2. **Exact `/api/state` byte size** at end of run — not computed here; scales with activity length, letter bodies, and 582 criterion run records embedded in the case.

---

## Checked and found right

| Topic | Where | Notes |
|--------|--------|--------|
| All waiting findings listed; no “first N” cut | `BellPanel.tsx` 918–944, 1084–1097 | `waitingFindings` + groups; orphan `noHistory` still rendered |
| Card order | `findings.ts` 88–123; `BellPanel.tsx` 937–942 | By case order, then signed criteria first within group |
| Search only narrows view, does not drop | `findings.ts` 154–158; `BellPanel.tsx` 925–930, 1073–1079 | Filter hides cards; lede still shows total waiting |
| Failed criteria list complete | `findings.ts` 63–79; `BellPanel.tsx` 1102–1112 | All failed runs listed; details collapsed only when &gt;5 |
| Disputed section always shown when present | `BellPanel.tsx` 1115–1150 | No cap on `inDisputed` |
| Questions block lists all open questions | `BellPanel.tsx` 709–892 | `rows.flatMap`; no slice |
| Poll interval and refresh on actions | `useLantern.ts` 11, 117–124; `BellPanel.tsx` 273–275 | 1 s poll; Accept/Bypass also `refresh()` |
| Skip redraw when state unchanged | `useLantern.ts` 73–78 | Reduces work when idle |
| Scroll container for bell | `panels.css` 80–85 | `panel-body` `overflow: auto` |
| Focus after decision without scrolling page | `BellPanel.tsx` 990 | `preventScroll: true` |
| Pop-up kind aggregation | `events.ts` 54–98 | Designed batching, not per finding |
| Counts line order | `CountsLine.tsx` 17–27 | Matches SPEC section 8 ordering |
| Status line text from server | `StatusLine.tsx` 26–30; `view.ts` 89–135 | `computeNow` for screen/check/letter |
| Footer log display cap | `Footer.tsx` 26–27, 62–76 | 60 entries shown; full length in summary |
| Full state on GET | `engine.ts` 703–717; `src/api.ts` 34–35 | Documented contract |
| Atomic state write | `store.ts` 17–39, 218–219 | Whole-file replace |
| Screen rank and segments | `engine.ts` 1736–1777 | Listed medicine, ask-when, tens, then further blocks of `blockSize()` (default 20) |
| Checks hold next screen segment | `engine.ts` 1798–1803 | Open check jobs block `maybeContinueScreen` for that case |
| Letter list sort | `letters.ts` 267–281 | Ready/overdue before closed |
| Letter list scroll | `letters.css` 21–27 | `letter-list` `overflow: auto` for many rows |
| Preview hash gate on send | `engine.ts` 1267–1272; `LetterPreview.tsx` 188–200 | Wrong-letter send blocked if preview stale |

---

## Section notes (coordinator checklist)

**1. Bell panel with 44 findings and 17+ questions** — All confirmed findings render as cards or receipts. Order: pharmacist questions first (`1023`), then waiting groups (`1085–1097`), failed criteria (`1102–1112`), disputed (`1116–1150`), decided in `<details>` (`1153–1188`). Poll every 1 s; each accept triggers an extra refresh. Scroll lives in `panel-body`; no scroll restore on poll. Receipt swap can move buttons below (`Defect 5`).

**2. Badges and pop-ups** — Not one pop-up per finding (`Defect 3`). Up to four stacked pop-ups centred at top (`Defect 4`). Icon badges use numeric text to 99+ (`IconRow.tsx` via `badgeText`).

**3. Status line and activity** — `computeNow` reflects running job (`view.ts` 89–135). Activity unbounded in state (`Defect 1`). Every poll sends full state (`engine.ts` 711–717).

**4. State file** — Whole-file write after steps (`Defect 9`); crash mid-write should leave previous file (`Defect 10`).

**5. Engine order** — `pickNextJob`, `screenRank`, `bestOpen`, `segmentIndexes`, `maybeContinueScreen` as read above; early accepts queue letters without cancelling screening (`Defect 7`).

**6. Letter panel and print** — Per-letter model today (`Defect 8`); Grok’s single combined letter will replace list, per-letter textarea height, per-letter `previewHash`, and single-page print assumption.

**7. Other** — Opening bell marks visible waiting findings seen for pop-up accounting (`BellPanel.tsx` 952–968), batched `Promise.all` + `refresh`. Thirty-three question articles stack above findings. `lines-box--scroll` max-height 290px per card (`panels.css` 286–287) for full history view.

---

## Blockers (this review)

**Count: 0.**

No code path at this scale truncates findings, drops letters, or forces the wrong letter for the selected row. The two take-back / letter-staleness blockers from C-REVIEW-1 remain with code owners and are out of scope for “size of case” unless the video uses take-back after accept.

---

*File written: `docs/reviews/C-REVIEW-2-one-large-case.md`.*