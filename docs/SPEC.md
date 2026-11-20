# ClinicaLANTERN: build specification

Version 2, Wednesday 18 November 2026. This file is the single description of what is being built.
If any other file disagrees with it, this file wins. Change it only by a commit that says why.

Version 2 keeps the design of version 1. It writes down what was changed after the review of the
first build, so that this file and the code agree. Every change and its reason is listed in
`docs/REVIEW_FIXES.md`. The changed places below are marked "(v2)".

## 1. What this is

A working prototype for the Future Health Digital Innovation Challenge, Challenge 05
("Closing the Screening-to-Care Loop"). The founder is a practising community pharmacist.
The design below is his. Build it as written. Do not redesign it.

Local AI models, run through Ollama on the pharmacy's own computer, do the work.
The app is the face of those models: one page, three round icons.

The workflow:

1. **Model 1 screens.** The pharmacist imports one dispensing history (CSV or PDF). Model 1 reads it
   against every criterion in use (583 in `criteria/active.json`), one criterion
   at a time. The first ten in `active` are screened before the `further` criteria (section 6a, G06).
   Each suspected finding is passed on. Model 1 stops.
2. **Model 2 double-checks.** It re-reads the history for each suspected finding. If it confirms the
   finding, the finding goes to the pharmacist under the red bell, with the criterion's source text
   as evidence. The pharmacist accepts it or bypasses it. Model 2 stops.
3. **Model 3 writes the letter parts.** For each accepted finding it drafts a letter part to the patient's GP.
   Code assembles the parts for one patient into one combined letter. When that letter is ready the
   yellow letter icon shows a notification. Model 3 stops.
4. **The pharmacist finishes.** He reviews the one combined letter, can edit it, prints it or opens it in his email
   program. Agree, preview, print, email and the reply record each act once on the whole letter.
5. **The loop is closed (added because the challenge scores it).** Each letter keeps a status inside
   the letter icon: sent, reply recorded, closed, or overdue. The pharmacist records the doctor's
   answer. Plain code, no model.

Each model does one job with a fresh context, then goes idle. Only one model is in memory at a time.

## 2. What counts as a pass (the founder's definition)

A criterion PASSES when, on the signed set of fictional test histories:

- no planted finding is missed (it reaches the bell), and
- the finding is shown with its criterion's source text, and
- a proper GP letter is produced for every caught finding.

The founder's ruling 3 of 18 November says what "missed" means. A planted finding has three
possible ends. Confirmed by Model 2: **caught**. Suspected by Model 1 and turned back by Model 2:
**disputed** — it is shown to the pharmacist, who decides; it is not a failure, and it is counted
in a column of its own beside caught in every table. Not suspected by Model 1: **missed** — that is
the failure. A criterion passes when no planted finding is missed.

A false flag is **not** a failure. It is still counted and reported beside the result, because the
judges asked for that number. Never hide it.

The founder signs each criterion in use as clinical reviewer (583 in
`criteria/active.json`). Nothing is called "validated",
"approved" or "never misses". The stage is "Prototype".

## 3. The models (proven on this PC on 18 November, 06:27 to 06:35)

One Ollama server, version 0.40.15, loopback only: `http://127.0.0.1:27435`.
Runtime folder (outside this repository): `%USERPROFILE%\ClinicaLANTERN-Lantern-runtime`.
Start it with `start-ollama.ps1` in that folder (safe to run twice). Stop it with `stop-ollama.ps1`.
Nothing was downloaded: all three models were already on this PC.

| Job | Ollama name | Model | Measured |
|---|---|---|---|
| 1. Screen (and read page images) | `lantern-screen` | Gemma 4 31B, with its vision projector | load 9 to 13 s; one criterion on a 45-line history 5 to 7 s when warm; a 22-row table image transcribed 22 of 22 rows exactly in 39 to 58 s |
| 2. Double-check | `lantern-check` | Qwen 3.8 27B | load 8.5 s; one check 9 s with thinking off, 32 s with thinking on |
| 3. Letter | `lantern-letter` | Gemma 4 26B-A4B | load 10 s; one letter 2 s |

Facts from the proof that the code must respect:

- Call `POST /api/chat` with `stream:false`, `think:false`, `format` set to a JSON schema, and
  `options {temperature:0, seed:42, top_k:1, num_ctx:16384, num_predict:...}`.
- One model load in five crashed with a CUDA error and HTTP 500; the next call worked.
  **Every call retries once after a failure.** A call that fails twice is recorded as
  "could not be screened" (or "second check not completed"), never as "no finding".
- Require `done_reason == "stop"`, non-empty content, and a schema-valid answer.
- The letter model wrote one wrong date in its first test. **Code checks every date, number and
  medicine name in a drafted letter against the finding** (section 7.3).
- The history goes first in the prompt and the criterion last, so the model's cached reading of the
  history is reused across the ten criteria (2.4 s instead of 11.6 s to read the prompt).
- One GPU: one call at a time. The server queues jobs; it never runs two.
- (v2) Measured on 18 November: the first model writes the fields of an answer form in the order the
  form gives them. The second model writes them in alphabetical order, whatever the form says. Both
  answer forms are built so that the explanation is written first and the yes or no last (section 7).
- (v2) Ollama keeps a text field to a "maxLength" given in the form. It cuts the text at that length,
  so code trims a cut text back to its last whole sentence and says that more was written.

## 4. Shape of the program

```
page in the browser (React)  <->  small local server (Node)  <->  Ollama (three local models)
                                        |
                                  data/state.json   (everything that happened; saved after every step)
```

No cloud call. No account. No database. No installer. State lives in the server, not in the page,
so a page reload loses nothing.

### Folders and who owns them

| Folder | What | Owner during the team build |
|---|---|---|
| `shared/` | The contract: types for state, API, criteria, cases | Grok |
| `pipeline/` | The three model jobs, the Ollama client, CSV reading, letter checks | Grok |
| `server/` | The local server: API, job queue, state file | Grok |
| `src/`, `index.html`, `public/` | The one page | Cursor |
| `criteria/` | Every criterion in use as data files (583), plus reserves | Kimi Code |
| `cases/` | Fictional test histories and the expected answers | Kimi Code |
| `eval/` | The scorer and its results | Kimi Code |
| `docs/` | This file and the sign-off sheets | Kimi Code |
| `tools/` | Start and helper scripts | Grok |

One writer per folder. If you need a change in a folder you do not own, write a request; do not edit it.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | server on 8787 and the page on 5173 with live reload |
| `npm run build` | type check and build the page into `dist/` |
| `npm start` | server on 8787 serving the built page and the API (the demo mode) |
| `npm test` | unit tests (no model needed) |
| `npm run eval` | runs the test histories through the real models and writes the results table |
| `npm run typecheck` | type check only |
| `npm run build:replay` | (v2) builds the judges' view, a recorded real run, into `dist-replay/` |

Node runs the TypeScript files directly (Node 24 or newer, per `package.json` `engines`). Use erasable TypeScript only: no `enum`, no
`namespace`, no parameter properties. Relative imports carry the `.ts` extension.
The server uses only Node's built-in modules.

## 5. The contract

The types are in `shared/types.ts`. That file is the contract; this section explains it.

- A **case** is one imported dispensing history: a fictional patient header and numbered lines
  (`L001`, `L002`, ...). The models are shown the numbered lines and must answer with line IDs.
  Code rejects any line ID that does not exist.
- A **finding** is one criterion suspected on one case. It moves through:
  `suspected` -> `confirmed` or `not_confirmed` -> `accepted` or `bypassed`.
  `not_confirmed` findings stay visible in a grey list inside the bell panel; they are never deleted.
  A `not_confirmed` finding on a history with a planted finding is a **disputed finding** in the
  scorer: shown to the pharmacist, never a failure, counted in its own column.
  (18 November, G11) The pharmacist may **dismiss** a finding: `{action:"dismiss"}` with an optional
  reason; no letter is queued and the finding stays `not_confirmed`. **Accept anyway** is
  `{action:"accept", reason:"..."}` on a `not_confirmed` finding, and the reason is required there.
- A **letter** belongs to one patient and holds one or more accepted findings in `findingIds`, with
  one numbered point per finding: `drafting` -> `ready` -> `sent` -> `reply_recorded`
  -> `closed`. A sent letter with no reply after `overdueDays` is shown as **overdue** in red.
  Each finding still has its own Ogee draft; code assembles the patient letter with one head, one
  ending and one signature. Agree, preview, print, email and the reply record act on the whole letter.
  (18 November, G11) A letter carries apart from the editable text: `closingLine`, `signatureName`,
  `signatureTitle`, `signatureRegistration` (the last three lines, not editable), and, after a
  preview, `previewedAt` and `previewHash`. The preview answer also carries `previewToken`, the same
  value as `previewHash`. Mark as sent must send that token back; the token is a hash of the subject
  and text, so a later preview of unchanged text returns the same token and changed text invalidates
  the earlier one. Any edit after the preview clears the preview. The **email draft** is
  `{subject, text, fits, coverNote}` with no address: the app never sends.
- (18 November, G11) **The founder's names for the models** live in `lantern.config.json`:
  `modelNames.screen` (Mantle), `modelNames.check` (Lumen), `modelNames.letter` (Ogee). The truth
  stays visible beside them: `modelsBehind.screen` (Gemma 4 31B), `modelsBehind.check` (Qwen 3.8
  27B), `modelsBehind.letter` (Gemma 4 26B); the health answer carries both as `displayNames` and
  `modelsBehind`. The Ollama ids (`lantern-screen`, `lantern-check`, `lantern-letter`) do not
  change. The pharmacist's name, title and registration also live in the settings under `pharmacy`
  (`pharmacist`, `pharmacistTitle`, `registration`). The email-draft size limit is `emailDraftLimit`
  (about 1,800 characters). The state answer carries `disputedWaiting`: the small grey count beside
  the red bell badge, the disputed findings waiting for the pharmacist (not inside `counts`).
- The **activity log** records every step: time, which model, which criterion, what the pharmacist
  decided and his reason when he bypasses.
- (v2) Added to the contract, all optional: on a criterion run `reason` (what Model 1 wrote when it
  answered clear); on a case `pages` and `scanNotes` (scans only); on the first model's result
  `listedLineIds` (long histories only); on the second check `unclear`; on a letter draft
  `templateReason`.
- (v2) **One rule for the lines of a finding** (`shared/lines.ts`): the lines the second check named
  and the lines the first model named. The bell panel shows them, the letter prints them and the
  scorer judges them. Lines only the first model named are marked as such on the page.
- (v2) A history counts as **screened** only when every criterion has a result. A finding counts as
  **confirmed** only when the second check was completed and its answer was yes.
- (6a) Added to the contract on 18 November, and explained in section 6a: on a criterion `needs_facts`
  (optional); on the first model's result `missingFacts`; on a finding `possible`; on the list of
  criteria in use `further` (optional); on the settings `screenBlockSize` (default 20).
- (G06, 18 November) The engine screens every waiting criterion of the ten and double-checks their
  suspected findings before any further criterion; then it screens further criteria in blocks of
  `screenBlockSize` (default 20) and double-checks each block before the next. With two histories
  waiting, the ten of both come before the further criteria of either. A letter for an accepted
  finding is written before the next further-criterion screen. One model call at a time. The
  status line counts "criterion N of <total>" over the criteria on that history. A further
  criterion whose file is missing or broken is left out and named in the activity log; it never
  stops the ten or the server.

### API (all under `/api`, JSON)

| Call | Purpose |
|---|---|
| `GET /state` | the whole state, plus counts and what is running now |
| `GET /criteria` | every criterion in use (label, statement, source, credit), the ten first, then the further criteria |
| `GET /health` | is Ollama up, are the three models present |
| `POST /cases` | import a history; screening is queued at once |
| `POST /cases/:id/confirm-transcription` | pharmacist confirms rows read from a page image |
| `GET /cases/:id/pages/:n` | (v2) one page picture of a scan, until its rows are confirmed |
| `POST /cases/:id/screen-again` | (v2) screens the criteria that have no result; nothing is imported twice |
| `POST /cases/:id/questions/:qid/answer` | (19 November) the pharmacist answers one question: `{option}` or `{value, unit?, date?, source?}`. Not known leaves a possible finding. Any other answer screens again only the criteria that were waiting for that fact |
| `POST /cases/:id/questions/:qid/pathology` | (20 November) reads an uploaded pathology test for one open typed result question. Nothing is written into the record. The pharmacist confirms with `answer` and a `source` |
| `POST /cases/:id/questions/:qid/take-back` | (19 November) takes the answer back. The fact line stays, marked as taken back, and the finding is as it was |
| `POST /cases/:id/questions/:qid/reopen` | (19 November) opens a Not known question again |
| `POST /cases/:id/discard` | (v2) the pharmacist gives up a scan he will not confirm |
| `POST /findings/:id/decision` | `{action:"accept"|"bypass"|"dismiss", reason?}`; accept queues the letter; the reason is required when a `not_confirmed` finding is accepted anyway |
| `POST /findings/:id/seen`, `POST /letters/:id/seen` | clears the notification count |
| `PUT /letters/:id` | save the pharmacist's edits (clears the preview) |
| `POST /letters/:id/preview` | (18 November) the one fixed preview screen: answers `ok`, `letter`, `text` (the letter exactly as it will leave, signature included), `previewedAt`, `emailDraft` and `previewToken` (the same value as `previewHash`) |
| `POST /letters/:id/agree` | records that the patient was told and agrees |
| `POST /letters/:id/sent` | `{by:"print"|"email", previewToken}`; refused with 409 unless the exact text was previewed and `previewToken` matches `previewHash` (an edit clears `previewedAt` and `previewHash`) |
| `POST /letters/:id/reply` | `{outcome, note}` the doctor's answer |
| `POST /letters/:id/close` | closes the case |
| `POST /reset` | start a clean demo; the old state file is kept as a dated backup |

## 6. Import

- **CSV.** One supply per row. Expected columns (any order, extra columns ignored):
  `patient_ref, patient_age, patient_sex, dispense_date, medicine, brand, strength, form, quantity,
  repeats_left, directions, prescriber`. Optional date of birth column: `patient_dob` (also `dob`,
  `date_of_birth`, `birth_date`, and similar header names). When it is present and can be read, age
  is worked out from it at the latest supply date. `medicine` is the active ingredient and may be empty when
  only the brand is known. Each row becomes one line of text:
  `2026-08-21 | Celebrex (celecoxib) 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample`
- **PDF with text inside.** The page reads the text with pdf.js, one line per printed row, and sends
  the rows. No model is needed to read it.
- **PDF or image without text (a scan).** The page renders each page to an image and sends it.
  Model 1 transcribes the rows. The pharmacist sees the rows it read and confirms them before
  screening starts. This route is labelled "read from a scan: please check".
- (v2) **A page is a scan when pictures cover a fifth of it or more**, however much text lies over
  them: a scanned page often carries a fax header, a stamp or a layer of recognised text. A page of
  text with a small logo stays a page of text. On the text route the page asks for a look when a
  page gave only one or two rows.
- (v2) **The check of a scan** shows the rows page by page, with the count for each page and its
  picture. A page that gave no rows is shown as such. Every row needs a date that can be read, as in
  a CSV file; until the pharmacist has corrected such a row the rows cannot be confirmed. The page
  pictures are served by the server until the rows are confirmed. A scan can be discarded.
- Before screening, code checks the import: at least one dated row, dates readable. If not, the
  case shows "Cannot assess: (reason)" and is not screened. An unreadable history is never "no findings".
- Histories longer than `maxLinesPerCall` lines are screened in overlapping parts and the page says so.
- (v2) **A long history is never called clear part by part.** A finding often needs two lines, and
  the two can fall in different parts. So in every part Model 1 also lists each line that holds a
  medicine on the criterion's list. Then Model 1 reads all the listed lines together in one more
  call, and that answer is used. If the listed lines do not fit in one call, or cannot be read, the
  criterion is "could not be screened". The parts are the outer loop and the criteria the inner
  one, so each part is read once and reused.
- (v2) The prototype screens up to 1,000 lines in one history. A longer one is "Cannot assess".
- Fictional patients only. The page and every letter say "Fictional patient. No real person."

## 6a. Records that also carry conditions and results (the founder's ruling of 18 November)

Some criteria need a fact that a dispensing history does not hold: a diagnosis, a test result or a measurement. The founder ruled: the record may carry those facts, as a shared health record would, and where a record lacks the fact the models still report the medicine pattern as a possible finding and the letter asks the doctor to confirm the rest.

- **CSV.** Three optional columns: record_type, detail, value. A file without them is read exactly as before. record_type is empty or "dispensed" for a supply, and "condition", "result" or "observation" for a fact. For a fact row, dispense_date holds the date the fact was recorded, detail holds its name (Heart failure, eGFR, Blood pressure) and value holds the number with its unit when there is one (28 mL/min/1.73 m2, 168/94 mmHg). The medicine columns are empty on a fact row.
- **Line text for a fact row:** "2026-08-03 | RESULT | eGFR 28 mL/min/1.73 m2", "2026-07-10 | CONDITION | Heart failure", "2026-08-03 | OBSERVATION | Blood pressure 168/94 mmHg". Line IDs run over all rows in file order, supplies and facts alike.
- **Whether the record already holds a fact.** A needed fact of the kind result is also held by an observation line that names it, and the other way round. A condition is only held by a condition line. A line marked taken back by the pharmacist does not count. Standing questions that use `ask_when` are not put when the record already holds the fact.
- **Criterion file.** An optional field needs_facts: a list of {kind: "condition" | "result" | "observation", what, meets}. The criterion block shown to the models lists them under "FACTS THIS CRITERION NEEDS".
- **Screen (Model 1).** Medicines match, the record holds the fact and it meets the criterion: a finding, and the fact line is cited with the supply lines. Medicines match and the record holds NO line about the fact: a **possible finding**; the answer names the missing fact in missing_facts. The record holds the fact and it does not meet the criterion: no finding. For an omission criterion (a medicine that should be there is not supplied) the same three cases apply, with the rule in the criterion file saying which lines to cite.
- **Double-check (Model 2).** It confirms a possible finding as possible when the medicine pattern is there and the record truly holds no line about the fact; it turns a finding back when the record holds the fact and it does not meet the criterion.
- **The bell** shows a possible finding with the line "Possible finding. The record does not show: (fact). The letter asks the doctor to confirm." **The letter** for a possible finding asks the doctor to confirm that fact and review if it applies.
- **Test histories for such a criterion:** pos-fact.csv (fact present: the finding must be confirmed and cite the fact line), pos-nofact.csv (no line about the fact: it must reach the bell as a possible finding), near-miss.csv (fact present and not meeting: it must not be confirmed). Some criteria have only two of the three; the answer part says which.
- **Further criteria.** criteria/active.json may hold a third list, further: criteria in use after the first ten. The first ten (active) are always screened first, then the further ones in order.
- **Contract:** Criterion.needs_facts (optional), ScreenResult.missingFacts (string list, empty when nothing is missing), Finding.possible (boolean), ActiveCriteria.further (optional string list).

## 6b. Questions for the pharmacist (19 November)

The pharmacist at the counter is asked. The patient is not asked, and the doctor is not asked. The letter stays the only thing that goes to the doctor, and only when the pharmacist sends it.

- Each fact the record does not show becomes one plain question. Two criteria that name the same fact (the same kind, and the same words after the spaces are trimmed and the letters are made lower case) share one question.
- A condition or an observation is answered by choosing. The default buttons are Yes, No and Not known. A result, the age, and a daily dose are typed: a value, a unit and a date, or Not known. A typed result that the reader knows may also be read from an uploaded pathology test (section 6d).
- **needs_facts.options** (optional). A list of `{words, effect}`. `effect` is `meets`, `does_not_meet` or `unknown`. The fact line names the fact, not the button's word on its own. A default Yes stores the fact as a plain statement that it is there ("Peptic ulcer disease"). A default No stores the fact with a plain statement that the patient does not have it ("No peptic ulcer disease: the patient does not have it"). Not known stores the fact and "not known" ("Peptic ulcer disease: not known"). A button from the criterion's own list stores the fact, then the button's words ("Reason for the loop diuretic: high blood pressure alone"). A typed result, age or daily dose stores what was measured, the value and the unit. The line begins with the date of the result, and the sentence names the day the pharmacist entered it: "2026-11-01 | RESULT | latest lithium level 0.8 mmol/L. Entered by the pharmacist at the counter on 20 November 2026." When no date is given, the line begins "no date" and says "The date of the result is not recorded." The day of entry is not the date of the result. The words the page shows the pharmacist stay the button's word. When `options` is absent, the default buttons are used. Do not write option lists into a criterion until the founder asks for that criterion.
- **needs_facts.ask_when** (optional). Absent: the question is asked only when a possible finding is waiting for that fact. `"always"`: the question stands for this patient, and the pharmacist may answer it or leave it. `{ "group": "<key>" }`: ask when a medicine of that group is supplied and the age limit written in the criterion holds, even when there is no possible finding.
- **needs_facts.close_when** (optional). `{ "group": "<key>", "months": 12 }`. `months` may be left out, and then it is 6. `{ "group": "A" }` stays valid. When `ask_when` is `"always"`, the standing question is not put if a medicine of that group of the same criterion was supplied in that many calendar months ending on the newest supply date of the record. An older supply does not close it. A fact line, and a line marked taken back by the pharmacist, do not count as a supply. When `ask_when` is not `"always"`, the field is ignored. The group is the key named on the criterion. It is never guessed.
- **only_sex** (optional), on the criterion. `"female"` or `"male"`. A standing question is withheld for the other sex only when this field is set. Without it the question is asked, even when the statement or the rule names one sex. A missing sex is still asked. Any other value is refused. The field is not in the words the models read.
- The answer is a fact line of the kind the record already knows. A chosen answer begins "no date", so the day of the answer is not read as the day the fact began. A typed result begins with the date of the result, or "no date" when none was given, and the sentence names the day of entry. The line says it was entered by the pharmacist at the counter, or that the value was read from an uploaded pathology test and confirmed there. It has a line ID. A finding can cite it. The letter can show it. Taking it back leaves the line in the history, marked "Taken back by the pharmacist at the counter." Leaving standing questions unanswered does not hide a question that a possible finding is waiting on.
- (20 November) **A result from an uploaded pathology test.** On a typed result question the reader may know one or more tests. Then `PharmacistQuestion.pathology` holds `{tests: [{key, name}]}`. The list comes from `pathologyOf` in `server/questions.ts`. It is absent when the fact is not a result, when the question uses custom buttons, or when `analytesForFact` in `pipeline/pathology.ts` knows no test for the name. The pharmacist may still type the value. To confirm a reading, `answer` sends `value`, `unit`, optional `date`, and `source`. `source` is an `AnswerSource`: `{kind:"pathology", fileName, page, line, readBy}` with `readBy` either `text` or `model`. Only the file name and the one report line are kept. `sourceFrom` reads and tidies the source the page sends. A broken source is refused with 400 and the words `The source of the result could not be read.` When a source is present, the value and unit must not hold a line break, a field mark or a quote mark. On the fact line, after the kind and the value words, a confirmed pathology answer ends with this sentence from `answerLineText`, with the file name, page number, report line and the day of entry filled in (`longDate(chosen.date)`): `Read from the uploaded pathology test "${chosen.source.fileName}" (page ${chosen.source.page}; the line of the report: "${chosen.source.line}") and confirmed by the pharmacist at the counter on ${longDate(chosen.date)}.`
- Yes, or an option whose effect is `meets`, screens again only the criteria that were waiting for that fact. A possible finding becomes a finding that cites the new line, or it goes away when the fact does not meet. Not known leaves it a possible finding and closes the question until it is opened again. Accept, bypass and sending a letter stay the pharmacist's own acts.
- Where an `ask_when` question is still unanswered, one line says how many checks could not run until those questions are answered, and the criteria are listed on request. That silence is not "nothing found".
- Nothing in the models' prompts changes. The criterion block does not list the buttons, `ask_when`, `close_when` or `only_sex`.
- (21 November) **A switched-off component.** The code holds a component for questions prompted by a supplied medicine, behind the switch `conditionMarkers`. The switch is off and no list of medicines is shipped in this release.

**Contract:** NeededFact.options (optional), NeededFact.ask_when (optional), NeededFact.close_when (optional), Criterion.only_sex (optional), CaseRecord.questions (optional), PharmacistQuestion (optional `pathology`, optional `conditionMarker`), FactAnswer, QuestionAnswerRequest. Calls: `POST /api/cases/:id/questions/:qid/answer`, `POST /api/cases/:id/questions/:qid/pathology`, `POST /api/cases/:id/questions/:qid/take-back`, `POST /api/cases/:id/questions/:qid/reopen`.

## 6c. A counted supply total (optional)

A criterion may carry `count_supplies`: `{ "group": "<key>", "months": 12, "window": "any" or "last", "form_has": ["inhaler"] }`. `form_has` may be left out. When the field is absent, the criterion and every prompt read exactly as before. When it is present, the application counts the matching supply lines and adds one plain block, "COUNTED BY THE APPLICATION", after the criterion words in the screen and the check, and at the start of the letter prompt. A fact line and a line taken back by the pharmacist are not counted. The whole number at the start of the quantity is the amount. A quantity that does not start with a whole number, or that names puffs, doses, actuations, capsules or mL, is listed as "quantity not read" and left out of the total. The criterion block itself does not change.

`packs` may be left out. It is a list of `{ "form_has": "capsule", "per": 30 }`. `form_has` is one word. `per` is a whole number of 1 or more. A pack rule without a word, or with a `per` that is not such a number, is refused. For a counted line whose product holds that word, matched the same way as `form_has`, the amount is the quantity's whole number divided by `per`, rounded up. The first rule that matches is used. The block shows the conversion, for example `L033 1 (30 capsules, one pack of 30)`. The totals use that amount. A line that matches no pack rule is counted as before. When `packs` is absent, the block is unchanged.

**Contract:** Criterion.count_supplies (optional).

## 6d. Reading a pathology test (20 November)

The clinical reviewer asked for this on 20 November: when a typed result is needed, the pharmacist chooses to type the number or to upload the pathology test that holds it. The upload call reads the document and returns possible values. Nothing is written into the record until the pharmacist confirms with `answer` and a `source`. The file itself is not kept.

### The route

`POST /api/cases/:id/questions/:qid/pathology`

The body may send `pages`, `pageImages` and optional `pageNumbers`.

- **`pages`:** an array of text pages. Each page is an array of strings, one string per line, from the text layer of the file.
- **`pageImages`:** an array of base64 PNG pictures, one picture per page without a text layer.
- **`pageNumbers`:** optional. When it is sent, it must be an array with one whole number of at least 1 for each page in `pages` plus `pageImages`, in strictly rising order. When it is absent, the pages count from 1 in the order sent (text pages first, then pictures).

Limits and what happens at each:

- At most **10** pages in total (`pages` plus `pageImages`). Above that: refused **400** with `The pathology test has more than 10 pages. Upload only the pages that hold the result.`
- Each text page: at most **400** lines. Above that: refused **400** with `A text page has more than 400 lines. Upload only the page that holds the result.`
- Each line of a text page: at most **300** characters. A longer line is **skipped**, named in `abstained` (`One line on page …` or `… lines on page …`), and is not a refusal.
- The whole JSON body: at most **40 MB**. Above that: refused **413** with `The file is too large. The limit is 40 MB.`

The answer is a `PathologyResponse`:

- **`fact`:** the name of the fact the question asks for (`q.what`).
- **`tests`:** the tests asked for: `{key, name}` for each analyte key.
- **`readings`:** each value the reader kept. Each item is a `PathologyReading` plus **`readBy`**: `text` when the line came from `pages`, `model` when it came from a picture read by the screen model. A reading holds: `analyte`, `name`, `value`, `valueWords` (as printed, including `<` or `>`), `unit`, optional `refLow`, `refHigh` and `flag` (`H` or `L`), optional `date` (collection date when one was found), optional `multipleOfUpper`, `line` (the report line word for word), `page`, `sure` (false when the pharmacist must check the report first), and optional `why` when `sure` is false.
- **`abstained`:** one sentence for each line that looked like a wanted result and was not used, and for server-side skips (long lines, two model readings that disagree on a wanted line).
- **`collected`:** optional `{date, line}` when the document states one collection date.
- **`dateNote`:** optional, when no single collection date is taken from the document (see the reader below).
- **`note`:** optional. When no reading is returned, or when a scan could not be read by the model, a plain sentence for the pharmacist (see below).

Refusals (exact words from the server):

| Status | When | Message |
|---|---|---|
| 404 | case not found | `This history was not found.` |
| 404 | question not found | `This question was not found.` |
| 409 | question not open | `This question already has an answer. Take it back before reading a pathology test for it.` |
| 400 | not a pathology result question | `This question is not answered from a pathology test. Type the answer.` |
| 400 | `pages` present but not an array | `The text pages must be an array of pages.` |
| 400 | `pageImages` present but not an array | `The page pictures must be an array of base64 images.` |
| 400 | a picture not valid base64 | `A page picture is not valid base64 image data. Upload the page again, or type the result yourself.` |
| 400 | no pages sent | `The pathology test is empty.` |
| 400 | more than 10 pages | `The pathology test has more than 10 pages. Upload only the pages that hold the result.` |
| 400 | bad `pageNumbers` | `The page numbers must give one whole number of at least 1 for each supplied page, in strictly rising order.` |
| 400 | a text page not an array | `Each text page must be an array of lines.` |
| 400 | more than 400 lines on a text page | `A text page has more than 400 lines. Upload only the page that holds the result.` |
| 400 | a line not a string | `Every line of a text page must be a string.` |
| 400 | body not JSON | `The request could not be read. It must be JSON.` |

When `readings` is empty and no model note applies, `note` is `No (test names) result was found in this document. Type the result from the report.` with the names from `tests`. When pictures were sent but the screen model is unavailable, `note` is `This page has no text that can be read by program, and the reading model is not available now. Type the result from the report.` When pictures were sent but another model job is running, `note` is `This page has no text that can be read by program, and the reading model is busy with a history now. Upload the pathology test again when that has finished, or type the result from the report.` While picture pages are read, no new screening job starts; queued screening runs when the read finishes.

### The reader (`pipeline/pathology.ts`)

`readPathology(pages, wanted, pageNumbers?)` returns a `PathologyReadResult`: `readings`, `abstained`, optional `collected`, optional `dateNote`. It is pure code: no model and no file I/O.

For each line it calls `readLine`. A line with no wanted test name at the start, fewer than 3 characters, more than 200 characters, no digit after the name, or only a heading, is left out with no sentence. When a line matches a wanted test but must not be used, `readLine` returns a sentence (with the line quoted) and it goes into `abstained`, prefixed with `Page (n): ` when original page numbers were sent. The reasons are, word for word apart from the quoted line, the value and the test name:

- `"…": a character on this line could not be read. Read the value from the report yourself.` (a `?` in the value part).
- `"…": a comma between digits could be a decimal point or a thousands separator. Read the value from the report yourself.`
- `"…": the reference range on the line could not be read.`
- `"…": more than one number stands on this line (a report with results of several dates?). Read the value from the report yourself.`
- `"…": the unit (unit) does not fit (name) (expected …). Read the value from the report yourself.`
- `"…": (value) lies outside what (name) can be ((min) to (max) (unit)): a misread is suspected. Read the value from the report yourself.`

A line that passes may still have `sure: false` and a `why` starting `Check the report:` when the unit is missing and the test expects one, when the report gives a limit not a measured number, when a star flag does not say high or low, when the laboratory flag and range disagree, or when the same test appears more than once with different values (`it holds more than one (name) value. Choose the one that belongs to the date you enter.`).

Collection date: only a line whose label is one of the collection phrases counts. A printed or reported date is not the sample date. One date in the document is copied onto every reading, then removed from readings marked unsure because the same test has conflicting values; none or more than one yields `dateNote`: `The document does not say when the sample was collected. Enter the date from the report.` or `The document gives more than one collection date ((dates)). Enter the date of the result you use.`

### A page without a text layer (`pipeline/transcribe-pathology.ts`)

The screen model reads each picture **twice**. A line is used only when both readings hold it (`agreedLines`). If any wanted line appears in only one reading, no model-read result from that page is used, and that page adds to `abstained`: `Page (n): the two readings of this line did not agree. Read the value from the report yourself.`

The fixed instruction to the model is, word for word:

`You read one page of a printed pathology report from an image and write its text out line by line. You only read. Write every line exactly as printed, left to right, top to bottom. Keep a test name, its value, its unit, its reference range and any flag letter together on one line, separated by single spaces. Keep every digit, decimal point, sign (< or >) and unit exactly as printed. Do not correct, round, convert, interpret or comment. If a character cannot be read, write ? in its place. Do not add any line that is not on the page. Answer with JSON only, in this form: {"lines": ["first line", "second line"]}`

The user task is: `Write out the text of this page, line by line.`

## 7. The three jobs

### 7.1 Screen (Model 1), once per criterion per case

Prompt order: system role, then the numbered history, then the criterion (label, statement, the
medicines that count by group with brands, the rule in one sentence), then the task.
Answer schema (v2: the explanation first, the yes or no last):
`{reason: string, medicines: string[], line_ids: string[], suspected: boolean}`.
In a part of a long history the form starts with `listed_line_ids` (section 6).
Instruction to the model: brand names count as their ingredient; if in doubt, report it; use only
lines that exist.

After the call, code drops line IDs that do not exist. If `suspected` is true the finding goes on to
the check even when no valid line is left (marked "lines not verified"): a missed finding is the
failure we are guarding against.

(v2) A "no" that names lines of the history is not taken as a plain no. It goes on to the second
check and says so. What Model 1 wrote for a clear criterion is kept in the state.

**The screening is done by the model.** Do not add a medicine-name match in code to the screening
path. If tests show misses that prompt work cannot fix, report the numbers; the founder decides.

### 7.2 Double-check (Model 2), once per suspected finding

It gets the full numbered history again, the same criterion block, and the suspected finding.
(v2) For a long history it gets the same listed lines the first model read together, in one call.
Answer schema (v2: the names are numbered, because the second model writes its fields in
alphabetical order; so the explanation is written first and the yes or no last):
`{step1_what_matches: string, step2_line_ids: string[], step3_what_cannot_be_seen: string, step4_confirmed: boolean}`.
`step1_what_matches` is kept to 700 characters.
The check is lopsided on purpose: it may reject only when the cited lines clearly do not contain the
listed medicines or the rule is clearly not met. When unsure it confirms and says what a dispensing
history cannot show. If the check call fails twice the finding still goes to the bell, marked
"second check not completed".

(v2) A "no" that names lines as proof is not a plain no either. The finding goes to the bell, marked
"second check unclear". A finding in the grey list can still be accepted by the pharmacist.

A finding that Model 1 suspected and Model 2 turned back is a **disputed finding** (the founder's
ruling 3 of 18 November). It is never hidden, it is not a failure, and the pharmacist decides: the
bell panel shows the two views side by side — what Model 1 suspected (`screen.reason` with its
`screen.lineIds`) and why Model 2 turned it back (`check.whatMatches` with its `check.lineIds`) —
with **Accept anyway** (a short reason is required, as for a bypass) and **Dismiss** (an optional
reason; the finding stays `not_confirmed` and leaves the grey count). In the scorer it is counted
in its own column beside caught, so anyone can see how often Model 2 turns back a true finding.

### 7.3 Letter (Model 3), one draft per accepted finding and one letter per patient

For each accepted finding, the model returns `{subject, finding_paragraph, evidence_paragraph, request_paragraph}`.
Code builds that finding's draft around them: pharmacy and pharmacist block, date, the doctor, patient label,
"Re:" line, the three paragraphs, the criterion's source text and credit line, the dispensing lines
cited, what a dispensing history cannot show, the line about the local AI model, and the signature.
Code then assembles every accepted finding for the patient into one combined letter with numbered
parts, one head, one "Dear Doctor,", one ending and one signature. The model call remains one call
per finding with the same input; the combination is plain code.
(18 November, the founder's rulings 1 and 2) The letter goes to the prescriber named most often on
the cited dispensing lines; a tie goes to the later cited line; when no cited line names one, the
settings doctor and practice are used. The line about the local AI model is, word for word,
"Drafted by a local AI model. Read by the pharmacist before sending." — moved above the signature
and true of every model letter. By the founder's decision of 18 November (19:10) a letter built
from the template has no last line about the template or the AI draft at all: it ends with the
signature. The signature
is the last three lines and cannot be edited away: the pharmacist's name (in a bold handwriting
font on the page and in print; Caveat, bundled through npm, openly licensed), then his title, then
his registration number — all three from the settings. No letter leaves without the preview: print,
"Open in my email program" and "Mark as sent" are reached only from the fixed preview screen. The
preview answer carries `previewToken`, the same value as `previewHash` on the letter. Mark as sent
sends `{by, previewToken}`. The server refuses unless that exact text was previewed and the token
matches. An edit clears `previewedAt` and `previewHash`. Refused with **409** and one of:
`This letter has not been previewed. Open the preview, read the letter, then mark it as sent.`;
`The letter changed after the preview. Open the preview again, then mark it as sent.`;
`This is not the copy that was previewed. Open the preview again, then mark it as sent.`
The email stays a draft in the pharmacist's
own mail program: it carries the letter text when it fits `emailDraftLimit` (about 1,800
characters), else a short cover note.

Code then checks the model's paragraphs: every date, every number with a unit and every medicine
name must appear in the finding's cited lines or the criterion. On a mismatch the letter is drafted
once more with the mismatch named. If it fails again the letter is built from the template alone
(`origin: "template"`), and says so. The letter asks the doctor for a review; it never tells the
doctor what to do.

(v2) The wording check: a sentence of the model's paragraphs is a problem when it starts with an
action word (stop, cease, start, switch, change, reduce, increase, prescribe, withhold, arrange,
do not) or holds must, should, needs to, is to be, requires, recommend, advise or suggest, unless
it is a question. A template letter says why it is one: "The AI draft did not pass its checks."
or, when no draft came back at all, "The AI model did not answer."

(18 November, when the parts for section 6a were joined) When the first draft failed the wording
check, the request for the second draft also names the words the check looks for inside a sentence
(must, should, needs to, is to be and the others), and says that a question ends with a question
mark. Told only the one word that was found, the model wrote another of the same kind, and the
template was used. The check itself is unchanged, and so is the first request. See
`docs/PROOF_WAVES.md`.

## 8. The page

One page. No routes, no menu.

The look of the page is specified by the approved look (the founder's ruling of 18 November,
18:25): the reference pictures in `docs/approved-look/` are the specification of the look. A part
of the page that differs from an approved part of the reference pictures is a defect.

- **Top half or more of the first screen:** the ClinicaLANTERN mark (golden L in the navy square
  with the data lines), the name with the golden L, the purpose line
  "A Pharmacist-in-the-loop Clinical Decision Support System", and the slogan
  "See what routine dispensing can miss."
- **Below it: three large round icons, in a row, each at least 160 px across.**
  1. **Magnifying glass** (cyan): import a dispensing history, CSV or PDF, by click or by drop.
  2. **Red bell:** findings waiting for a decision. The red number counts the findings that wait
     for a decision and stays until each is accepted or bypassed - it does not go after one look.
     Beside the red badge a small **grey count** (`disputedWaiting`) is the disputed findings
     waiting for the pharmacist.
  3. **Yellow letter:** letters. A badge appears when Model 3 has a letter ready.
- A status line under the icons says in plain words what is happening now, naming the models by the
  founder's names from the settings: "Mantle is screening: criterion 14 of 413",
  "Lumen is double-checking 2 findings", "Idle". The footer of the page says which open model is
  behind each name: "Mantle: Gemma 4 31B. Lumen: Qwen 3.8 27B. Ogee: Gemma 4 26B. All three run on
  this computer through Ollama."
- (v2) Beside the status line the first screen says what must not be missed, and nothing when all
  is well: the local models are not running; a history was not fully screened; a step reported a
  problem. A history that was not fully screened also counts in the number on the magnifying glass.
- A line of counts: histories screened, findings confirmed, accepted, bypassed, letters sent,
  replies recorded, closed, overdue.
- Clicking an icon opens its panel over the page so the working part fills the screen:
  - **Bell panel:** each finding shows the criterion label, the criterion's source text with its
    credit line, the dispensing lines that match (highlighted), what Model 2 said matches, what
    cannot be seen in a dispensing history, and two buttons: **Accept** and **Bypass** (bypass asks
    for a short reason). Under them, an open grey section "The two models disagree (n)" holds the
    disputed findings: what Mantle suspected beside what Lumen turned back, each with its lines,
    and two buttons: **Accept anyway** (asks for a short reason) and **Dismiss**.
  - **Letter panel:** a list of letters with their status; overdue in red. Opening a letter shows
    an editor, a tick box "Discussed with the patient; the patient agrees to this letter", then
    **Record the doctor's reply** and **Close**. The four actions **Print**, **Open in my email
    program**, **Copy** and **Mark as sent** stand in the one fixed preview screen only, which shows
    the whole letter exactly as it will leave, the AI line and the signature included. Print shows
    only the letter, on A4.
- Notifications are in-page badges and a small pop-up message, driven by asking `/api/state` every
  second. No operating-system notifications.
- "Open in my email program" uses a `mailto:` link with the subject and a short cover note; the app
  itself sends nothing and stores no password or address book. (v2) The edits are saved first and
  then the email program is opened, so the browser never asks "leave this page?" in between.
- Colours and type: navy `#071d49`, gold `#edbf67`, cyan `#27c2d0`, dark cyan `#0e7490`, dark gold
  `#9a6200`, red `#b42318`, page `#f7f9fc`, text `#14233b`, Segoe UI. Visible focus ring. Works with
  the keyboard. Readable at 1366 x 768 and at phone width.

## 9. Criteria and test histories

- `criteria/<ID>/criterion.json` holds one criterion: label, statement shown to the pharmacist,
  source and credit, the medicines that count (ingredients and Australian brands, by group), the
  one-sentence rule for the models, what cannot be seen, what the letter asks the GP to review,
  urgency, and the sign-off field. See `Criterion` in `shared/types.ts`.
- `criteria/active.json` lists 583 in order: `active` (the first ten, screened
  first), then `further` (the rest in use), then `reserves` when present.
- `cases/<ID>/*.csv` are fictional histories: for each criterion two with the finding planted
  (one by brand name only, one buried in the middle of a long history) and one near-miss that must
  not be a finding. `cases/_clean/*.csv` are histories with no finding.
- `cases/expected.json` is the answer sheet of the ten and the clean histories: for every case,
  which criteria must fire and which lines prove it. The founder signs it. After that it is
  changed only with his word. It is never rewritten for further criteria.
- `cases/expected.further.json` is the sheet of the further criteria, in the same form. A missing
  further sheet is not an error.
- `npm run eval` with no option runs the cases through the real models in two phases and writes
  `eval/results/<time>/table.md` and `results.json`. Phase one scores the ten in full and writes
  both files at once. Phase two scores the further criteria in quick mode and writes both files
  again after every 20 further criteria, and once at the end. Histories of further criteria are
  not run against the ten. The table carries a part for the first ten and a part for the further
  criteria, each with its count in the words of rule 8: how many pass the planted-finding test,
  how many are signed by the clinical reviewer. Failures are published too.
- **Swap rule.** Replace a criterion with a reserve, rather than keep tuning it, when it still misses
  a planted finding after two prompt revisions, or when fixing it breaks another criterion.

## 10. Say only what is true

- "Three local models" is true: three different models run, one after another.
- Say "ClinicaLANTERN runs open models on the pharmacy's own computer through Ollama, an open-source
  model runner." Never say the app hides Ollama.
- Do not claim the models screen better than fixed rules. Say what was measured.
- Every screen and letter in the prototype says the patient is fictional.
- The judges cannot run local models. Their link shows recorded real runs, labelled
  "Recorded run from the entrant's computer. The live models are not connected."
  (v2) `npm run build:replay` builds that view into `dist-replay/`. It plays the recording
  `cases/_demo/recorded-state.json` (the state of a real run, written by `tools/record-run.mjs`)
  step by step, never talks to a server, and refuses an import or any change in one plain sentence.
  The label is in the top of the first screen and in the head of every panel.
- (v2) The sample view (`?mock=1`) says "Sample data. The models are not connected." in the same
  places, and its letters say that they were written by hand for the mock-up.

## 11. What is not built

No accounts or sign-in. No cloud model. No database. No installer. No 413-criterion machinery.
No gates, pins or sealed sets from the earlier build. Nothing from the earlier build is imported.

One combined letter for the patient is built, superseding the 18 November next step by the founder's
order of 20 November 2026 at 13:00. Each accepted finding keeps its own model draft; code joins the
patient's findings into one letter. A single letter spanning several patients is not built.
