# C-REVIEW-3 — One letter for the patient (code review)

Read-only review on branch `cursor`, 20 November 2026. No shell. Focus: G-LETTER-1 (commits 788edee server, a8e6641 page). Sources: `shared/patient-letter.ts`, `pipeline/letter.ts`, `server/engine.ts`, `shared/types.ts`, `src/components/LetterPanel.tsx`, `src/components/LetterPreview.tsx`, `src/lib/draftStore.ts`, `src/lib/letters.ts`, `src/styles/letters.css`, `src/styles/print.css`, and tests named in the task.

---

## Defects

### 1. BLOCKER — Take back after accept still leaves the patient letter (and every point) on stale facts

- **Where:** `server/questions.ts` 677–703 (`takeAnswerBack` does not touch `letters`); `server/engine.ts` 997–1004 (`takeBackQuestion` only calls `takeAnswerBack`); `server/engine.ts` 1382–1396 (`markSent` checks preview hash only, not taken-back lines).
- **What the code does:** Take-back marks the fact line and restores findings. Letters and each `points[].draft` are unchanged. A joined letter still shows every part built from drafts that quoted the taken-back answer.
- **What it should do:** Invalidate or rebuild the open patient letter when a finding or cited fact on that letter is undone; block send if cited pharmacist lines are taken back.
- **How to see it:** Accept several findings, wait for one patient letter `ready`, preview, take back an answer that a point cited, send still allowed if preview hash matches the unchanged body.
- **Mend in G-LETTER-1:** No. Same gap as C-REVIEW-1 defect 1. Joining does not add a check on `findingIds` or `points`.

### 2. BLOCKER — Take back is still allowed while letter jobs for that history are queued or running

- **Where:** `server/engine.ts` 966–973 (`assertQuestionsIdle` only blocks `screen` and `check`); `server/engine.ts` 997–1004 (`takeBackQuestion` uses `assertQuestionsIdle` only).
- **What the code does:** Take-back is allowed while many `letter` jobs run for accepted findings. A point draft can finish after take-back; `placeReadyLetter` (`server/engine.ts` 2257–2268, 1266–1268) still attaches it and calls `rebuildPatientLetter`.
- **What it should do:** Refuse take-back while a letter job is open for a finding on this case, or discard and re-draft affected points after take-back.
- **How to see it:** Accept a finding, immediately take back an answer while status still says letter is writing; race with `runLetter` for point 2 of the same patient letter.
- **Mend in G-LETTER-1:** No. Same gap as C-REVIEW-1 defect 2.

### 3. NOT A BLOCKER — Re-answering a question removes letters only when `letter.findingId` matches, not any point on a joined letter

- **Where:** `server/questions.ts` 660–662 (`gone.has(letters[i].findingId)` only).
- **What the code does:** A patient letter stores the first finding in `findingId` (`shared/types.ts` 277–278). Re-answer removes a letter row only if that id is in `gone`, not if a later point’s finding is removed.
- **What it should do:** Remove or rebuild when any `findingIds` / `points[].findingId` is removed.
- **How to see it:** Uncommon: re-answer after a multi-point letter exists, where the removed finding is not the first point. Tonight’s script does not use this path.

### 4. NOT A BLOCKER — Legacy merge numbers parts by letter id (`T0001`, `T0002`), not accept order

- **Where:** `shared/patient-letter.ts` 321, 408 (`sort` by `a.id.localeCompare(b.id)`).
- **What the code does:** Old one-finding letters join in T-id order, not necessarily the order the pharmacist accepted them.
- **What it should do:** For legacy only, document or sort by draft time or finding id.
- **How to see it:** Load an old state file with several per-finding letters. Live accepts use `findingIds` push order (`server/engine.ts` 1148–1149), not this sort.

### 5. NOT A BLOCKER — Print CSS comment and sizing assume one short letter; a 44-part letter prints over many A4 pages

- **Where:** `src/styles/print.css` 7–8, 31–38; `src/components/LetterPreview.tsx` 145–150, 215–221.
- **What the code does:** Print uses `white-space: pre-wrap` and `overflow-wrap: anywhere`; no character cut. Body text flows to extra pages. Only the closing block avoids an internal break (`print.css` 57–59).
- **What it should do:** Acceptable for tonight; margins were tuned for a short letter.
- **How to see it:** Preview a long joined letter, Print. Many pages, full text.

### 6. NOT A BLOCKER — Email draft limit is 1800 characters, not a page cap on the letter

- **Where:** `server/engine.ts` 1355 (`emailDraftLimit ?? 1800`); `pipeline/letter.ts` 107–114; `src/components/LetterPreview.tsx` 231–237.
- **What the code does:** Long joined letters get a cover note in mailto; preview warns and offers Copy and Print.
- **What it should do:** By design for long cases.
- **How to see it:** Preview 44-part letter, Open in my email program shows warning; clipboard Copy gets full text from preview.

---

## Section notes (coordinator checklist)

### 1. Tonight’s case: 1st, 2nd, and 44th accept

| Step | What happens (code) |
|------|---------------------|
| **1st accept** | `decide` → `letterForAcceptance` creates one letter (`engine.ts` 1159–1174), `findingIds: [f.id]`, `points: [{ findingId }]`, status `drafting`, queues `letter` job (`1083–1085`). |
| **2nd accept (same patient, letter not sent)** | `letterForAcceptance` finds open `drafting` or `ready` (`1145–1146`), appends `f.id` to `findingIds` and `points` (`1147–1150`), sets `drafting`, deletes `previewedAt`, `previewHash`, `patientAgreed` (`1151–1154`), calls `rebuildPatientLetter` (`1155`). Pharmacist sees status **Being written** / note on page (`LetterPanel.tsx` 449) and body with point 1 plus **2. Being written** when second draft not done (`shared/patient-letter.ts` 101–103, `engine.ts` 1201–1203). |
| **44th accept** | Same append and rebuild. Up to 44 queued `letter` jobs (`engine.ts` 1084). Each finished job calls `placeReadyLetter` → `rebuildPatientLetter` when `findingIds.length > 1` (`1267–1268`). |

**Between accepts while drafts lag:** One letter row in the list (`LetterPanel.tsx` 1006–1023). Body rebuilt synchronously on each accept and each completed draft. No parallel `rebuildPatientLetter` in one thread; jobs run one at a time through the engine worker.

**Late draft:** `placeReadyLetter` sets `point.draft` then rebuilds (`1266–1268`). A draft that finishes after an earlier rebuild is joined on the next rebuild. No code drops a `findingId` from the list.

**Two rebuilds “into each other”:** Only sequential job completion; each rebuild reads all `points` and `findingIds`. No mutex issue in single-threaded Node.

**Order of numbered parts:** Order of `findingIds` array (`engine.ts` 1149, 1264). Stable for accepts on one open letter. Not completion order of models (`engine.test.ts` 2646–2655).

**Lost or duplicate parts:** Duplicates prevented by `letterFindingIds(open).includes(f.id)` (`1147`). Pending slot until draft exists (`1199–1203`).

### 2. Pharmacist’s edit vs rebuild

| Question | Answer (file:line) |
|----------|-------------------|
| When is an edit dropped? | `rebuildPatientLetter` sets `letter.body` from drafts and `editedByPharmacist = false` (`engine.ts` 1226–1229`). Triggered on new finding on open letter (`1155`) and when a multi-point draft completes (`1268`). |
| Told beforehand? | New accept clears preview and patient agreement (`1152–1154`); page shows drafting and “still being written” (`LetterPanel.tsx` 449). No extra warning before rebuild. Adding a finding while `ready` forces `drafting` so `editLetter` returns 409 (`1324`). |
| After agree or preview? | New accept after preview clears `previewHash` and `patientAgreed` (`1152–1154`). While all points still drafting, agree/preview/send blocked (`1324`, `1348`, `1386`; tests `engine.test.ts` 2761–2763). After full preview with no further accepts, no rebuild runs until another accept. |
| Preview hash covers | `letterTextHash` on `leavingText(letter)` (`engine.ts` 1350–1354, 1303–1306`): full outbound text including fictional line, writing line, signature via `letterAsItLeaves` (`pipeline/letter.ts` 85–99). |

### 3. Forty-four parts on page and paper

| Topic | Finding |
|-------|---------|
| **30000 character cap** | **not settled on this branch as a letter limit.** Editor and server use **200000** (`draftStore.ts` 19–20; `engine.ts` 1327; `LetterPanel.tsx` 524). No 30000 in letter path. |
| **Text box height** | `fitHeightKeepingScroll` grows textarea (`LetterPanel.tsx` 111–120); `letters.css` 245–254 `min-height: 260px`, `overflow: hidden`; outer `letter-scroll` scrolls (`letters.css` 199–206). |
| **Print** | Full `editableBody` in `.print-letter` plus closing (`LetterPreview.tsx` 215–221). Multi-page, not truncated. |
| **What pharmacist can export** | **Print** (browser print to paper or PDF); **Copy** (clipboard, full preview text); **Open in my email program** (mailto, whole letter if ≤1800 chars else cover note); **Mark as sent** after preview. No separate “download .txt” file button; Copy is the text export. |

### 4. Checks on joined letter

| Check | Where |
|-------|--------|
| Per-finding draft | `draftLetter` → `checkDraft` on each model pass (`pipeline/letter.ts` 356–371, 637–655). Same request as before (`patient-letter.test.ts` 93–106). |
| On joined body | No `checkDraft` on assembled patient letter. `letterAsItLeaves` restores fictional line and signature (`pipeline/letter.ts` 85–99; `engine.ts` 1226`). `writingLine` for mixed model/template (`shared/patient-letter.ts` 63–69, `engine.ts` 1219–1220). |

### 5. C-REVIEW-1 take-back blockers in G-RELETTER-1

**Not mended.** Still `assertQuestionsIdle` without `letter` (`engine.ts` 966–973); take-back still does not touch joined letters (`997–1004`). Stale text can sit in any **numbered part** still inside one body. Pharmacist still sees a normal `ready` letter until they notice the mismatch.

### 6. Old state

- **Load:** `mergeLegacyPatientLetters` on `Engine.start` (`engine.ts` 679`). Groups per `caseId`, splits **sent** vs **open** (`shared/patient-letter.ts` 396–401). Only merges groups with 2+ letters without `findingIds` (`397–398`, 407–408).
- **Sent letter changed by join?** Two **sent** one-finding letters for one patient merge into one **sent** combined letter (`combineStoredLetters`, `mergedStatus` 292–299). That can change stored body of already-sent pieces on load only. **Open + sent** on same patient are **not** merged together (different bags). Live path after send: new letter with `afterSent` (`engine.ts` 1159–1171; test `2771–2795`).
- **Re-send old sent via join:** Merged sent letter keeps `sentAt`; `editLetter` and `markSent` refuse wrong status (`1325`, 1387–1389).

### 7. Reply

- One `reply.outcome` for the letter (`engine.ts` 1410–1425).
- `replyPointOverrides` stores a point only when outcome differs from letter outcome (`1438–1458`; test `2712–2722`).
- UI: multi-point selectors (`LetterPanel.tsx` 623–645). Stored on letter only; individual finding records are not updated in `engine.recordReply`.

### 8. Other risks for tonight’s script

No additional **blocker** found for accept-only flow without take-back. Unsaved local edits when status flips from `ready` to `drafting` are dropped on save path (`LetterPanel.tsx` 831–834). Poll keeps dirty local text until save (`805–814`), which could confuse during rapid accepts; saving overwrites server rebuild until next server rebuild completes.

---

## Checked and found right (Grok claims and core behaviour)

| Claim or behaviour | Where |
|--------------------|--------|
| One patient has one open letter | `engine.ts` 1144–1156 |
| Each finding drafted on its own, same model request | `runLetter` 2263; `letterMessages` unchanged (`patient-letter.test.ts` 93–106) |
| Code joins drafts | `rebuildPatientLetter` 1196–1254; `assemblePatientLetter` 530–556 |
| One head, Dear Doctor, numbered parts, one ending | `renderPatientLetter` 126–166 |
| Pending part shows “Being written” | `patient-letter.ts` 101–103; test 128–138 |
| Agree, preview, send wait while drafting | `stillWriting` 1187–1193; `engine.test.ts` 2743–2768 |
| Edit clears preview | `editLetter` 1335–1336 |
| Writing line and signature protected | `letterAsItLeaves` 85–99; `LetterPanel.tsx` 531–536 |
| One reply outcome; points only if different | `replyPointOverrides` 1438–1458 |
| Accept after sent starts next letter | `engine.ts` 1159–1171, 1158; `afterSent` UI 438–439 |
| Old multi-letter state loads as one (open) | `mergeLegacyPatientLetters`; `engine.ts` 679; test 2798–2854 |
| Counts count letters not points | `view.ts` 46–47; `engine.test.ts` 2679 |
| Later finding rebuilds from drafts; combined edits dropped on rebuild | `rebuildPatientLetter` 1226–1229 |
| Single-finding letter unchanged text | `renderPatientLetter` 129; `assemblePatientLetter` 536–537 |
| `letterFindingIds` helper | `shared/patient-letter.ts` 58–59 |
| List shows one row with “N points” | `LetterPanel.tsx` 1006–1023 |
| Preview hash gates send | `markSent` 1391–1396 |
| Recovery re-queues missing point drafts | `recoverAfterRestart` 237–243 |
| MOCK/sample path mirrors join | `src/mock/server.ts` 139–198, 652–669 |

---

## Not settled

1. **Whether 30000 ever existed on this branch for letters** — no letter-path reference found; cap is 200000. Reason: grep across repo; may have been removed before merge.
2. **Browser performance with one very tall textarea and 1 Hz full-state poll** — same as C-REVIEW-2; not provable from letter files alone.
3. **Exact byte length of 44-part letter at export** — depends on criteria text and cited lines; only limits are 200000 edit cap and email 1800 mailto behaviour.

---

## Blockers (count: 2)

1. Take back after accept still leaves the combined letter (all points) valid for preview and send on stale facts (`questions.ts` 677–703; `engine.ts` 997–1004, 1382–1396).
2. Take back during letter drafting is still allowed and can race point drafts into the joined letter (`engine.ts` 966–973, 997–1004, 2242–2283).

---

*File written: `docs/reviews/C-REVIEW-3-one-letter-for-the-patient.md`.*