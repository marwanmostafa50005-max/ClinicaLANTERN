# C-REVIEW-4 — The take-back mends (code review)

Read-only review on branch `cursor`, 20 November 2026. No shell. Focus: G-LETTER-2 (commits 79c1914 and eba58c4 on main). Sources: `server/questions.ts`, `server/engine.ts`, `shared/patient-letter.ts`, `shared/types.ts`, `src/components/LetterPanel.tsx`, `src/components/LetterPreview.tsx`, `server/engine.test.ts`.

---

## Judgment on the old blockers and further point

| Item | Verdict |
|------|---------|
| C-REVIEW-1 / C-REVIEW-3 blocker 1 (stale open letter still previewable and sendable after take-back) | **Closed** in code |
| C-REVIEW-1 / C-REVIEW-3 blocker 2 (late letter draft joins after take-back while jobs run) | **Closed** in code (discard path, not refuse-take-back) |
| C-REVIEW-3 further point (re-answer only checked `letter.findingId`) | **Closed** in code |

---

## Defects (new)

No new **BLOCKER** found in this read.

### 1. NOT A BLOCKER — A sent letter still shows the old text that quoted the taken-back answer

- **Where:** `server/engine.ts` 1304–1308 (`dropPartsNoLongerAccepted` skips body when `alreadyOut`).
- **What the code does:** After take-back, a letter already marked sent keeps its prior `body`. Only `withdrawnNote` is set and a `letter_status` note is written.
- **What it should do:** By Grok’s stated design: sent mail is not rewritten; the pharmacist is told the answer was taken back.
- **How to see it:** Accept, preview, mark sent, take back the answer that one point rested on. The sent letter text is unchanged; the warn note appears in the panel (`src/components/LetterPanel.tsx` 441–444).

### 2. NOT A BLOCKER — Another point’s draft is not rebuilt when a sibling point leaves for take-back

- **Where:** `server/engine.ts` 1310–1318 (`keep` filters ids and `rebuildPatientLetter` only assembles remaining `points[].draft`).
- **What the code does:** Remaining points keep the model draft written before take-back. That draft’s “lines from our records” block can still quote a pharmacist line that was later taken back, if that line appeared in the cited block for a different criterion.
- **What it should do:** Ideal would re-draft or strip cites when any cited line gains `TAKEN_BACK_MARK` (`server/questions.ts` 695). The mend targets points whose **finding** is no longer accepted, not every cite in every part.
- **How to see it:** Two accepted points on one letter; both drafts cite the same counter answer; take back only the question that removes one finding. The other point’s numbering and text are unchanged except the join step drops the removed part.

### 3. NOT A BLOCKER — Take-back during a running letter job is still allowed; only the join is refused

- **Where:** `server/engine.ts` 966–973, 1004–1009 (`assertQuestionsIdle` unchanged); 1332–1335 (queued letter jobs dropped); 2371–2375 (`placeReadyLetter` fails, `finish` with `not joined: the answer was taken back`).
- **What the code does:** The pharmacist can take back while `letter` is `running`. The model may still finish; the draft is not placed. Activity gets a `letter` note with “arrived after the answer was taken back” (`2372–2373`).
- **What it should do:** C-REVIEW-1 allowed either refuse take-back or discard late drafts. Grok chose discard. That closes the safety issue; it does not stop wasted model work.
- **How to see it:** Same as `engine.test.ts` 2970–2999; also try take-back while the job is only `queued` (queued jobs are removed at `1332–1335`; not covered by that test).

### 4. NOT A BLOCKER — `withdrawnNote` can stay on screen after the letter again matches the findings

- **Where:** `server/engine.ts` 1281–1284 (`assertCanReview` blocks only when `withdrawnNote` and `!letterMatchesAccepted`); 1319 (`withdrawnNote` set on partial take-back); 1163 (`delete open.withdrawnNote` only when a new finding is accepted onto the open letter).
- **What the code does:** After a partial take-back, agree and preview work again on the rebuilt body, but the yellow warn line can remain until a new accept clears it or the pharmacist ignores it.
- **What it should do:** Cosmetic; send is still gated on a new preview (`1476–1481`).
- **How to see it:** Three-point letter, take back the middle answer, re-preview and agree. Warn text still shows (`LetterPanel.tsx` 441–444) though send is safe after preview.

### 5. NOT A BLOCKER — List row label for a single-point letter uses `letter.findingId`, not `findingIds[0]` when both exist

- **Where:** `src/components/LetterPanel.tsx` 1009–1028 (`findingById.get(letter.findingId)`; multi-point rows use `pointCount`).
- **What the code does:** After any mend that sets `findingId` to `keep[0]` (`server/engine.ts` 1317, `server/questions.ts` 673), the row label tracks the first remaining point. Legacy letters with only `findingId` still work via `letterFindingIds` on the server.
- **What it should do:** Acceptable; server keeps `findingId` in sync with `keep[0]`.
- **How to see it:** Take back the finding that was listed second in `findingIds`; row still shows “N points” when `findingIds.length > 1`.

---

## Blocker 1 walkthrough — take-back on an open patient letter

### Hook

- `takeBackQuestion` (`server/engine.ts` 1004–1012) calls `takeAnswerBack` (`server/questions.ts` 693–718) then `dropPartsNoLongerAccepted` (`1296–1335`).

### While the letter is being written (`status` `drafting`)

- **State:** Non-accepted findings drop out of `findingIds` and `points` (`1314–1315`). If any accepted points remain, `rebuildPatientLetter` (`1318`) rebuilds `body` from remaining drafts (`1205–1236`). If none remain, `body` becomes the withdrawn message, `points` is `[]`, status stays `drafting` (`1322–1328`).
- **Pharmacist:** `letterView` is still “Being written” (`src/lib/letters.ts` 18–20). `withdrawnNote` shows when set (`LetterPanel.tsx` 441–444). List detail “A point was withdrawn” when drafting with note (`letters.ts` 59–60).
- **Can a letter leave with the taken-back fact?** No on this row. `markSent` calls `assertCanReview` (`1471`) and needs a fresh preview hash (`1476–1481`). Preview/agree are cleared on take-back (`1311–1313`).

### While the letter is ready (not yet previewed or agreed)

- **State:** Same drop and rebuild path; `status` becomes `ready` again when every remaining id has a draft (`1237–1244`).
- **Pharmacist:** Chip “Ready to review” (`VIEW_WORDS` in `letters.ts` 35–42). Warn note describes cleared preview (`1319`).
- **Send?** No until preview and hash match.

### After preview and patient agreement

- **State:** `previewedAt`, `previewHash`, and `patientAgreed` deleted (`1311–1313`). Test confirms (`engine.test.ts` 2904–2906, 2908).
- **Pharmacist:** Agreement line disappears from the trail until ticked again (`LetterPanel.tsx` 479). `markSent` without new preview returns 409 (`2908`).
- **Send?** No until `previewLetter` runs again (`2909–2911`).

### After mark sent

- **State:** `body`, `status`, and send fields are untouched (`1304–1308`). `withdrawnNote` records that the answer was taken back and the letter was not changed (`1306`).
- **Pharmacist:** Sent view; warn note on the sent letter (`LetterPanel.tsx` 441–444). Text may still quote the old fact (defect 1 above).
- **Can a new send carry the taken-back fact?** This letter is already out. A new patient letter would be a separate row (`1152–1183`, `afterSent`).

**Conclusion:** Blocker 1 is closed for any letter that has not yet been sent.

---

## Blocker 2 walkthrough — take-back while letter jobs are queued or running

### Queued jobs

- `dropPartsNoLongerAccepted` removes queued `letter` jobs whose `findingId` is no longer in the accepted set for that case (`1332–1335`).

### Running jobs

- Take-back is **not** blocked (`966–973`, `1006`).
- When the draft returns, `letterWaitingFor` still finds the letter if the finding id is no longer on `findingIds` (`1187–1193`); `placeReadyLetter` returns `false` when the finding is not accepted or not listed (`1339–1341`).
- `runLetter` writes activity and finishes the job (`2371–2375`). Detail string: `not joined: the answer was taken back`.

### Letter job row and status line

- The job ends `done` with that detail; it does not attach a draft.
- Activity: kind `letter`, text includes “arrived after the answer was taken back” (`2372–2373`). Test expects activity with “not joined” (`engine.test.ts` 2999).

**Conclusion:** Blocker 2 is closed. Late drafts do not join. The pharmacist may still see a finished job and a status note that the draft was wasted.

---

## Further point — every use of `letter.findingId` in `server/` and `src/`

| Location | Uses whole letter? | Comment |
|----------|-------------------|---------|
| `server/questions.ts` 663–674 | **Yes** | `held = letterFindingIds(letter)`; filter `points` by `keep`. Re-answer mend. |
| `server/engine.ts` 1127–1128 | No | `letterNote` metadata only; criterion label for activity. |
| `server/engine.ts` 1157–1158 | **Yes** | Join uses `letterFindingIds(open)` before append. |
| `server/engine.ts` 1189–1192 | **Yes** | `letterWaitingFor` uses `letterFindingIds(letter).includes(findingId)`; `letter.findingId === findingId` is legacy fallback when `points` has no row. |
| `server/engine.ts` 1206–1237 | **Yes** | `rebuildPatientLetter` maps `letterFindingIds(letter)`. |
| `server/engine.ts` 1302–1317 | **Yes** | `dropPartsNoLongerAccepted` uses `letterFindingIds`; sets `findingId = keep[0]`. |
| `server/engine.ts` 1339–1348 | **Yes** | `placeReadyLetter` checks `letter.findingIds.includes(findingId)`. |
| `server/engine.ts` 1527–1533 | **Yes** | `replyPointOverrides` uses `letterFindingIds(letter)`. |
| `server/engine.ts` 239–242 | **Yes** | Resume queues jobs per `letterFindingIds(letter)`. |
| `src/components/LetterPanel.tsx` 258, 326 | **Yes** | Multi-point reply UI uses `letter.findingIds`. |
| `src/components/LetterPanel.tsx` 1009–1011 | Partial | Row label uses `letter.findingId` for single-point display; count uses `findingIds.length`. Server keeps `findingId` as `keep[0]`. |
| `src/components/LetterPanel.tsx` 993 | No | `selected.findingId` for detail header when one finding drives the prop; multi-point uses `pointIds` (258). |
| `src/mock/server.ts` | **Yes** (mock) | Mock mirrors `findingIds` with fallback to `[letter.findingId]`. Not production server. |
| `src/replay/replay.ts` 128, 137 | No | Replay seed uses first id for display; out of scope for live send. |

**Conclusion:** The further point is closed in `server/questions.ts` and `server/engine.ts`. Production paths that decide which findings belong on a letter use `letterFindingIds` or `findingIds` / `points`.

---

## What the mends may have broken (regression notes)

### Finding comes back after the pharmacist answers again

- **Remove from letter:** `writeAnswer` in `server/questions.ts` 661–678 filters by `letterFindingIds` and `points`, clears preview fields.
- **Engine rebuild:** `answerQuestion` 983–989 compares `letterFindingIds` before and after and calls `rebuildPatientLetter` when the set changes.
- **Return to letter:** If the finding is accepted again, `letterForAcceptance` 1152–1164 appends the id, deletes `withdrawnNote`, and rebuilds. The point slot has no draft until `runLetter` places one (`1339–1350`). The old `points[].draft` for that finding was removed on re-answer; it is not reused.

### Numbering of parts after a point leaves

- `rebuildPatientLetter` 1206–1214 walks remaining ids in order; `shared/patient-letter.ts` 105–108 numbers `index + 1` on each rebuild. Order is the remaining `findingIds` order, not re-sorted by id.

### Pharmacist edits on remaining text

- `rebuildPatientLetter` sets `editedByPharmacist = false` (`1238–1239`). Preview and agreement are cleared on take-back (`1311–1313`). The warn note says preview was cleared (`1319`). There is no separate “your edits were dropped” line. Local dirty text in the browser may linger until poll or save path (`LetterPanel.tsx` 804–818, 834–839).

### Doctor reply after a point left

- `recordReply` still works on sent letters. Per-point overrides must use ids still on the letter (`1527–1533`). Removed findings cannot be named in `points`.

### Old state file

- **Not settled.** `mergeLegacyPatientLetters` (`shared/patient-letter.ts` 398–417) still joins pre-`findingIds` letters on load. There is no call to `dropPartsNoLongerAccepted` at load time. An old file with an open letter and a taken-back line in history but no `withdrawnNote` may need a live load test.

### Counts

- **Not settled** from this read alone. `writeAnswer` splices the whole letter row when every point is gone (`668–669`). Take-back leaves one row with empty `findingIds` (`1314` with `keep.length === 0`). Issued id counters are not adjusted in these paths in the snippets reviewed.

---

## Tests (`server/engine.test.ts`)

| Test | Proves what the name says? | Notes |
|------|---------------------------|-------|
| 2884 `takes the point out of the letter when the answer it rested on is taken back` | **Yes** | Removes middle finding, rebuilds body, clears preview/agree, blocks `markSent`, allows new preview without Beta text. Also checks activity. Does not exercise `drafting` before first `ready`. |
| 2917 `says the point is withdrawn when the only finding goes back to a possible finding` | **Yes** | Body is withdrawn copy; agree/preview/send 409. Uses synthetic `heldFindings`, not full re-screen. |
| 2947 `does not change a letter already marked as sent` | **Yes** | Body bitwise equal; `withdrawnNote` only. |
| 2970 `does not join a draft that arrives after the answer was taken back` | **Yes** | Running job, `release` after take-back, `points` and body exclude TWO. Does not assert queued-job removal at `1332–1335`. |
| 3023 `takes a later point out of the letter when its question is answered again` | **Yes** | Re-answer on TWO; ids `[0,2]`. Relies on engine `answerQuestion` rebuild, not only `writeAnswer`. |
| 3042 `keeps the other points when the first finding is the one whose question is answered again` | **Yes** | Re-answer on ONE; ids `[1,2]`. Closes the old `findingId`-only bug. |

### Gaps (no test in this set)

- Take-back with letter job only **queued** (not running).
- Pharmacist **edit** then take-back (edit dropped, warn only).
- Finding **re-accepted** onto the same letter shell after full withdrawal (`letterForAcceptance` on empty `findingIds`).
- **Sent** letter: UI shows `withdrawnNote` but body unchanged.
- Cited line from a taken-back answer still visible in **another point’s** draft (defect 2).
- **Load** of an old state file after upgrade.
- `assertQuestionsIdle` still allows take-back during **running** letter (behaviour is intentional; safety is in `placeReadyLetter`).

---

## What was checked and found right

| Behaviour | Where |
|-----------|--------|
| `letterFindingIds` helper for one vs many points | `shared/patient-letter.ts` 62–64 |
| Take-back marks line and restores held findings | `server/questions.ts` 693–718 |
| Open letter invalidated on take-back | `server/engine.ts` 1008–1009, 1296–1330 |
| Agree, preview, edit blocked while withdrawn and no accepted points | `server/engine.ts` 1281–1288, 1409 |
| Send requires preview hash after take-back | `server/engine.ts` 1476–1481 |
| Late draft rejected at placement | `server/engine.ts` 1339–1341, 2371–2375 |
| Re-answer removes any listed finding on the letter | `server/questions.ts` 661–678 |
| Re-answer rebuild when id set changes | `server/engine.ts` 983–989 |
| Page shows `withdrawnNote` | `src/components/LetterPanel.tsx` 441–444 |
| Preview send path surfaces server 409 | `src/components/LetterPreview.tsx` 188–200 |
| `takenBackAt` on answer type | `shared/types.ts` 69–70, 289 (`withdrawnNote`) |

---

## Not settled

1. **Old state file on disk** after upgrade: whether an open letter can still be sent with stale text without a new take-back event (no `dropParts` on load).
2. **Issued letter id counts** when `writeAnswer` splices a letter row vs take-back leaving an empty shell.
3. **Whether a remaining point’s draft** quoting a taken-back pharmacist line is acceptable clinically for tonight (code keeps those drafts).

---

*End of C-REVIEW-4.*