# C-REVIEW-1 — Pharmacist question paths (code review)

Reviewer read-only pass on branch `cursor`. No shell. Sources: `server/engine.ts`, `server/questions.ts`, `src/components/BellPanel.tsx`, `src/components/ImportPanel.tsx`, `src/api.ts`.

---

## Path answers

### 1. Ask-when (`supply` / `patient`) answered **Not known**

**Confirm the coordinator.** `waitingOnAnswer` treats `not_known` like an unanswered ask-when: the criterion is skipped by screening (`server/engine.ts` 1723–1727). `writeAnswer` sets `q.status = 'not_known'`, does **not** reset criterion runs, and returns `false` so no screen job is queued (`server/questions.ts` 645–647, 968–985).

The criterion stays `waiting`. No finding is created for it unless one already existed from an earlier partial run. The doctor is not asked via a new finding for that criterion.

**Page — bell:** `BellPanel.tsx` 867–874 shows “Not known. The question stays closed until you open it again” and **Open this question again** (`reopenQuestion`).

**Page — history card:** `ImportPanel.tsx` 132–140 only treats **`open`** ask-when questions as holding screening. **`not_known` is omitted.** If every unscreened criterion is held only by `not_known`, `openAnswersHolding` returns null and the card may show “Waiting in line for [screen model]” (`ImportPanel.tsx` 220–224) even though those criteria will never enter `segmentIndexes` (`engine.ts` 1747–1748, 1892).

**Counter / patient:** Correct to withhold a finding when the fact is unknown; the missing import warning for `not_known` is confusing, not clinically wrong.

---

### 2. Same question answered **does not meet** (e.g. **No**)

`chosenFrom` picks the option’s `effect` (`server/questions.ts` 718–738). `writeAnswer` writes a fact line (`factLineDetail` / `answerLineText`, 595–633) and returns `true`, which resets every `q.criterionIds` run to `waiting` and queues screening (`636–673`, `engine.ts` 976–985).

Criteria **are** screened. Models read `linesForModels(c.lines)` (`engine.ts` 1906, 1961) — taken-back lines excluded (`questions.ts` 331–334). The new line is visible, e.g. `No heart failure: the patient does not have it` (`questions.ts` 600–603). Test: `questions.test.ts` 260–268 (**No** clears possible findings and marks criterion clear after idle).

**Counter / patient:** Intended path; models see the negated fact.

---

### 3. Typed value (result): does not meet, wrong unit, empty, future date, date before history

Handled in `chosenFrom` (`questions.ts` 718–738):

| Input | Code behaviour |
|--------|----------------|
| Value with text | Always `effect: 'meets'`; words are `[what, value, unit].filter(...).join(' ')` — **no unit whitelist** |
| Empty / whitespace value | Error: `Enter the value, or choose Not known.` (730) — API 400 (`questions.test.ts` 1489) |
| **Not known** button on typed question | `effect: 'unknown'` like other questions (723–724) |
| Date present but not `YYYY-MM-DD` | Error with year-month-day hint (731–732) |
| Date omitted | Allowed; line says “The date of the result is not recorded.” (`answerLineText` 626–627) |
| Future date or before history start | **No validation** — any valid calendar day is stored as `resultDate` and as the line head (640–641) |

“Does not meet” for a typed result only appears if the criterion defines custom `options` with `does_not_meet` (`questions.test.ts` 352–373); default typed path is always **meets**.

**Counter / patient:** Empty and malformed dates are blocked. Wrong unit and arbitrary dates can reach the models and letters — weak for patient safety.

---

### 4. **Take answer back** after screen, accepted finding, letter written

`takeBackQuestion` → `takeAnswerBack` (`engine.ts` 989–997, `questions.ts` 677–703):

- Marks the live fact line with `TAKEN_BACK_MARK`; `linesForModels` drops it (331–334).
- Restores `q.heldFindings` and `q.heldRuns`; removes **other** findings on the same criterion ids (683–686).
- Sets `q.status = 'open'`. **Does not** touch `letters`, **does not** reverse `decide` / accepted state on letters, **does not** call `queueScreen` (`engine.ts` 989–997 vs `answerQuestion` 983–985).

Activity note says “The finding is as it was” (`995`) — finding snapshot only, not the letter workflow.

**Letter risk:** After accept, `decide` creates a letter and queues drafting (`engine.ts` 1074–1088). Draft uses `linesForModels` at draft time (`2112`). If the pharmacist later takes the answer back, the letter record and `body` stay; `markSent` only checks preview hash and status (`1258–1283`), not whether the cited pharmacist line was taken back.

**Yes — a ready letter can still be previewed and sent** resting on an answer that was taken back (models would no longer see that line; letter text can still quote it). Not covered by `questions.test.ts` take-back tests (292–303 stop at restoring possible findings).

**Run:** Criterion runs revert to held snapshot; no automatic re-screen on take-back alone.

---

### 5. One question, many `criterionIds`

`syncCaseQuestions` merges on `factKey` and appends criterion ids (`questions.ts` 484–521). `writeAnswer` uses `const ids = new Set(q.criterionIds)` for held findings, removal, and run reset (649–668). `engine.answerQuestion` queues one screen job for the case (983–985).

Test `questions.test.ts` 228–239: one **Heart failure** answer re-screens **HF** and **HF2**. Same for supply/possible-shared keys (`775–778`).

Criteria that were already **possible** before answer: held in `q.heldFindings`, stripped from global list, then re-screened after meets/no (650–659). Confirmed.

---

### 6. **Possible** question: Yes / No / Not known

| Answer | `writeAnswer` `again` | Finding |
|--------|----------------------|---------|
| **Not known** | `false` | Stays possible; question `not_known` (`questions.test.ts` 271–282; comment `engine.ts` 968) |
| **No** | `true` | Re-screen; findings cleared, criterion **clear** (260–268) |
| **Yes** | `true` | Old findings for those ids held then removed; new screen outcomes (`228–247`) |

`recordScreen` does not keep two active findings for one criterion: answer first removes findings on those ids (`657–659`). Re-screen creates at most one new finding per criterion (`1837–1850`). Old id reserved via `heldFindings` / `takeId` reserved list (1837–1840) — not two bell items unless take-back restores held without clearing new work.

---

### 7. Server stopped and started

**`Engine.start`** (`671–691`): `recoverAfterRestart` (`188–238`).

| Situation | On restart |
|-----------|------------|
| Job was **running** | Marked **failed**, detail “Interrupted…”; screen → case `interrupted` + note; check/letter → note “starts again” |
| Criterion run **running** | → **waiting** (221–222) |
| Screen **waiting/interrupted**, no queued screen job | New screen job added (228–231) |
| Screen **done** | `queueChecks` again (232) — may re-queue checks |
| Letter **drafting**, no letter job | Letter job re-queued (234–237) |

**In-flight model call:** `generation` increments only on **`reset()`** (`1369–1372`), not on ordinary stop/start. Stop mid-call → job failed + re-queue; work may **run twice** (check, letter draft). After **`reset()`**, stale async results are dropped (`generation !== this.generation` guards, e.g. 1965).

**Open question / answer idle:** Persisted in state file; `commit` on pharmacist actions (`483–491`). Answers survive restart (`questions.test.ts` 305–324).

**Letter mid-write:** Re-queued; draft step runs again (`215`–216).

**What is lost:** Only uncommitted pharmacist actions if state write failed (503). Running job’s partial in-memory progress is not a finished result — recovery re-queues.

---

### 8. Same history imported twice

`importCase` always `takeId` for a new case (`782–802`), `push`es new `CaseRecord`, `syncQuestions`, new screen job. **Two cases, two question sets.** No deduplication (`engine.ts` 911–913 “Nothing is imported twice” refers to **screen again**, not duplicate files).

---

### 9. Question never answered

**Ask-when / supply (`open` or `not_known`):** `waitingOnAnswer` blocks screening forever for those criteria (`1723–1727`). Other criteria can finish. `screening.status` stays **`waiting`** while any criterion is `waiting`/`running` (`1978–1988`); it does **not** become **`done`** until every run is terminal (`1990–1991`). History is **not** shown as fully screened.

**Standing `patient` left via “Leave these unanswered”:** Still `status: 'open'` with `leftUnanswered: true` (`questions.ts` 345–352). **`waitingOnAnswer` does not ignore `leftUnanswered`** — those criteria still block (`checksNotRun` in `questions.test.ts` 946–947). Engine note: “The checks still wait” (`engine.ts` 1021). UI tucks standing rows (`BellPanel.tsx` 725–727).

**Counter:** Pharmacist gets bell warnings for **open** ask-when (`669–703`, `761–770`) and import “checks could not run…” when **open** holds all waiting criteria (`132–140`). **`not_known`** gaps per path 1.

---

### 10. Other paths (loss / wrong / silent wait)

- **One answer at a time while screening:** `assertQuestionsIdle` (`958–965`) — 409 while screen or check job open; UI `BellPanel` disables via `off` / error (`752–754`). Matches mega-flow observation.
- **Take back during letter job:** `assertQuestionsIdle` does **not** consider `letter` jobs — take-back allowed while letter is queued/running.
- **Wrong import “waiting in line”** when only `not_known` blocks (path 1).
- **No typed-date plausibility** (path 3).
- **Leave standing** does not free screening (by design per tests; comment at `engine.ts` 1012 “Screening is not held up” means no `assertQuestionsIdle`, not that criteria run).

---

## Defects

| # | Severity | Path | Where | What it does | Should do | Test |
|---|----------|------|-------|--------------|-----------|------|
| 1 | **BLOCKER** | Take back after accept + letter ready/sent | `questions.ts` 677–703; `engine.ts` 989–997, 1258–1283 | Take-back restores findings and marks the fact line taken back but **never** removes or invalidates letters; send only checks preview hash | Invalidate or remove GP letters whose finding depends on a taken-back answer; block `markSent` if `TAKEN_BACK_MARK` on cited lines | **`takeBack-invalidates-letter`**: import → answer → idle → accept → idle until letter `ready` → `takeBackQuestion` → assert letter closed or send returns 409; `linesForModels` must not include answer line |
| 2 | **BLOCKER** | Take back while letter job running | `engine.ts` 958–965, 989–997 | `assertQuestionsIdle` ignores letter stage; take-back can race letter drafting | Refuse take-back while a letter job exists for a finding on this case, or abort/regenerate letter after take-back | **`takeBack-blocked-while-letter-queued`**: accept → immediately `takeBackQuestion` with letter job `queued`/`running` → expect 409 or letter discarded |
| 3 | **NOT A BLOCKER** | `not_known` holds screening but import card silent | `ImportPanel.tsx` 132–140; `BellPanel.tsx` 669–673 | Only `q.status === 'open'` counts as holding checks; `not_known` still blocks in engine | Same copy as open: “answer or reopen” for criteria blocked by `not_known` | **`not-known-shows-on-import-card`**: answer Not known on sole ask-when → import status must not say only “Waiting in line” |
| 4 | **NOT A BLOCKER** | Typed result wrong unit | `questions.ts` 726–735 | Any unit string is concatenated into the fact and sent to models | Validate unit against criterion fact definition (if product has rules) or warn pharmacist | **`typed-wrong-unit-rejected`**: answer lithium with unit `mg` when criterion expects `mmol/L` → 400 or warning |
| 5 | **NOT A BLOCKER** | Typed result future / pre-history date | `questions.ts` 731–735, 640–641 | Accepts any `YYYY-MM-DD` | Reject dates after “today” or before first supply line date | **`typed-result-date-bounds`**: import dated history → answer with `2099-01-01` → 400 |

---

## Paths checked and found right

| Path | Where |
|------|--------|
| `not_known` on ask-when skips screening (coordinator claim) | `engine.ts` 1723–1727; `questions.ts` 645–647 |
| `does_not_meet` writes fact and re-screens | `questions.ts` 636–673; `engine.ts` 976–985 |
| Shared question hits all `criterionIds` | `questions.ts` 649–668; `questions.test.ts` 228–239 |
| Possible + Not known keeps possible finding | `engine.ts` 968–981; `questions.test.ts` 271–282 |
| Possible + No clears after re-screen | `questions.test.ts` 260–268 |
| One answer at a time during screen/check | `engine.ts` 958–965 |
| Taken-back lines excluded from models | `questions.ts` 331–334 |
| Duplicate import → two cases | `engine.ts` 782–802 |
| Restart recovery re-queues screen/check/letter | `engine.ts` 188–238, 671–691 |
| `reopenQuestion` on `not_known` marks old line taken back | `questions.ts` 706–711 |

---

## Not settled

- **Exact letter body after take-back** if pharmacist never re-previews: depends on Model 3 draft at accept time; code does not re-run draft on take-back. Reason: no `takeBack` + letter integration test or letter-regen hook in engine.