# C-REVIEW-5 — Answers during a screening (code review)

Branch `cursor`, 20 November 2026. Read-only: `server/engine.ts`, `server/questions.ts`, `server/view.ts`, `pipeline/screen.ts`, `pipeline/config.ts`, `server/engine.test.ts`, `server/questions.test.ts`, `server/mega-flow.test.ts`. No git log.

---

## BLOCKERS

**No blocker found for tonight’s scripted shape** (~78 supply lines at import, answers added during the first screening, total staying near or below `maxLinesPerCall` 150 in `pipeline/config.ts` 13). Screening stays on the per-criterion path (`engine.ts` 2185–2267) that calls `screenCriterion` with `linesForModels(c.lines)` fresh each criterion (`2266`, `pipeline/screen.ts` 575–591).

**Conditional blocker (only if the history is already long at import, `c.parts > 1`):** Answering a question for criterion B while the batched `screenHistory` job is still running can let B be screened on a **line snapshot taken at job start**, then `recordScreen` overwrites B’s run after `writeAnswer` had set it back to `waiting` (`questions.ts` 714–720, `engine.ts` 2111–2154, `pipeline/screen.ts` 617–623). **Scenario:** import ≥150 lines; first screen job uses `screenHistory`; pharmacist answers an ask-when for a criterion not yet marked `running`; answer appends a counter line; later in the same job that criterion completes with the pre-answer lines. **Mend:** at each `answerQuestion`, bump `generation` or abort the running screen job when `again || released`, or recompute `screenParts` inside `runScreening` after every answer (or forbid answers until the long-history job finishes except for the criterion currently `running`).

---

## LESSER POINTS

1. **`recordHoldsFact` is text-only** (`questions.ts` 409–415, 561): any `CONDITION` / `RESULT` / `OBSERVATION` line whose tail contains `fact.what` suppresses the ask-when question—including denials (`questions.test.ts` 1604–1606, `CONDITION | hEaRt fAiLuRe ruled out`) and **dated results that do not meet the criterion’s time rule** (e.g. `START-E4` with CKD on the CSV in `cases/START-E4/pos-fact-spot.csv` while the rule cares about proteinuria timing). Screening proceeds without a counter question; models must treat the existing line as authoritative.

2. **`c.parts` is not updated when answers append lines** (`engine.ts` 799, 871, 1981; not in `writeAnswer` `questions.ts` 672–725). Status text uses `c.parts` (`view.ts` 117–121); overlap splitting for models uses live `screenParts(cfg, lines)` on the short path. UI can under-report “long history” while models already split.

3. **Brief UI regression on answer:** `writeAnswer` removes findings for linked criteria and sets `screening.status` to `waiting` (`questions.ts` 692–722); bell counts and confirmed findings drop until the next screen segment finishes (`view.ts` 38–53).

4. **`server/mega-flow.test.ts` 57–58** still describes refusing answers while screening runs; K-ASK-8 F changed that (`engine.ts` 976–992, `engine.test.ts` 3103–3278). The on-demand mega test paces answers with `whenIdle`; it does not exercise concurrent answers during screening.

5. **`leaveStandingQuestions`** leaves `status: 'open'` with `leftUnanswered` (`questions.ts` 370–376); `waitingOnAnswer` still treats those criteria as blocked (`engine.ts` 2016–2019`). Screening never reaches `done` until those questions are answered or reopened (`engine.ts` 1058–1059)—by design, but a mistaken “leave unanswered” during the video stalls the pass.

6. **`screenAgain` or a second `queueScreen` while a screen job is already queued** can stack two `stage: 'screen'` jobs (`engine.ts` 2072–2076, 941); worker runs them serially, not a wrong result.

---

## WHAT YOU READ AND FOUND RIGHT (eight questions)

1. **Two at once:** `assertAnswerAllowed` blocks only when the question’s own criterion is `running` or its finding’s check is open (`engine.ts` 976–991); otherwise `writeAnswer` resets linked runs to `waiting` and clears their findings (`questions.ts` 714–720); a new screen job is queued only when no screen job is open (`engine.ts` 1018–1021`). Own criterion cannot be answered mid-flight; affected criteria are re-screened on the next segment, not left clear on stale facts if the next job runs—**right** for the short path (`engine.test.ts` 3142–3167, 3227–3277).

2. **Many answers quickly:** Extra passes coalesce: only one new screen job per idle gap (`1018–1021`); further bands wait behind the first ten and their checks (`157–171`, `2072–2076`, `2083–2096`); three answers → one extra screen job in test (`engine.test.ts` 3170–3196`). Queue does not grow without bound; first screening is not abandoned—**right**.

3. **Record grows:** Counter answers append to `c.lines` (`questions.ts` 678–679); models read them via `linesForModels` (`questions.ts` 356–358, `engine.ts` 2198, 2253). With `c.parts === 1` at import, each criterion re-splits via `screenParts` on the current line list (`pipeline/screen.ts` 581–591). Crossing 150 mid-run does not switch to the batched long reader while `c.parts` stays 1—**right for correctness**, UI parts label may lag (see lesser point 2).

4. **Not known (change E):** Ask-when: `released` queues screen even when `writeAnswer` returns false (`engine.ts` 1003–1019, `questions.ts` 681–683); `waitingOnAnswer` ignores `not_known` (`engine.ts` 2016–2019). Possible-finding question: `released` is false (`1003`); finding stays possible—**right** (`engine.test.ts` 3282–3347).

5. **Question no longer asked (change A):** `syncCaseQuestions` skips when `recordHoldsFact` (`561`); false-skip shape is **`needs_facts` with `ask_when: "always"` or `{ group }`** when the record already has a **fact line of the matching kind** whose text contains `what`, including negatives (`questions.test.ts` 1604–1606)—not wrong kind (`1598–1600`) or taken-back lines (`1601–1603`).

6. **Take-back during screening:** `takeBackQuestion` still uses `assertQuestionsIdle` (`engine.ts` 1026–1028, 966–972)—409 “still being screened”; answer uses the narrower guard. Restore via `heldFindings` / `heldRuns` (`questions.ts` 728–753, `engine.test.ts` 3227–3277)—**right**.

7. **Server stop/start:** `recoverAfterRestart` fails running jobs, resets `running` criteria to `waiting`, re-queues screen (`engine.ts` 191–235); finished criteria keep results (`187–188`). No perpetual `running` job—**right** (`engine.test.ts` 305–340).

8. **What the page shows:** `/api/state` returns saved state each poll (`engine.ts` 710–721); answers can remove findings and set `screening.status` to `waiting` before the next segment (`questions.ts` 714–722); counts recomputed (`view.ts` 38–53). Transient “fewer findings / not fully screened” until re-screen completes—**expected**, not a stuck wrong final state.

---

## COULD NOT JUDGE FROM READING ALONE

| Doubt | Test that would settle it |
|--------|---------------------------|
| Wrong final finding when ≥150 lines at import and answers land mid–first `screenHistory` job | Rig with `maxLinesPerCall: 10`, import 24+ lines, defer `screenHistory` between criteria, answer before criterion 2, assert criterion 2’s screen call received the new counter line |
| Tonight’s CSV actually triggers a false skip on a still-needed question | Run `syncCaseQuestions` on M01 import plus fixture criteria; list criteria whose ask-when was suppressed by `recordHoldsFact` but whose rule needs fresher or negated facts |
| 30 rapid answers during screening never 409 and all criteria finish | Scripted UI or API test: answer open import questions without `whenIdle` while `computeNow` shows `stage: 'screen'`, then `screening.status === 'done'` |
| Counter lines always fall in overlap parts when length crosses 150 mid-pass | Import 145 lines, start screen, add 20 answers during job, assert last pharmacist lines appear in model prompts for re-queued criteria |