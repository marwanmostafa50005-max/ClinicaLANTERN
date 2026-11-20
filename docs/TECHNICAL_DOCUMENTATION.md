# ClinicaLANTERN: technical documentation

ClinicaLANTERN is a working prototype that helps a community pharmacist screen a dispensing history, draft a letter to the patient's general practitioner, and track the case until the doctor's answer is recorded (`docs\SPEC.md`). The pharmacist imports CSV or PDF history; three local models, run through Ollama on the pharmacy computer, screen against criteria, double-check suspected findings, and draft letters. Every question, every finding and every letter is the pharmacist's decision (`README.md`, `Engine.decide` in `server\engine.ts`). A criterion the first model clears without suspecting never reaches the pharmacist (`server\engine.ts` `recordScreen`). The program is one browser page talking to a local Node server; state is kept in a JSON file on disk. This repository holds the application code, criteria as data, fictional test histories, scoring tools, and working papers under `docs\`.

State of this document: 21 November 2026, 04:10 Sydney time

## System architecture

### Parts and how they connect

| Part | Location | Role |
|------|----------|------|
| Page | `src\`, `index.html`, `public\` | React UI: import, bell (findings), letter, criteria list, activity footer |
| Local server | `server\index.ts`, `server\api.ts` | HTTP on loopback only; API under `/api`; serves built page from `dist\` |
| Engine and queue | `server\engine.ts` | One job at a time; screens, checks, letters; writes state after each step |
| State | `server\store.ts` | `data\state.json` (path overridable); atomic whole-file writes |
| View helpers | `server\view.ts` | Counts, status text for the page, disputed-waiting count |
| Questions | `server\questions.ts` | Pharmacist facts not in the history; sync, answer, take-back |
| Pipeline: screen | `pipeline\screen.ts`, `pipeline\transcribe.ts` | Model 1: criterion screening and scan transcription |
| Pipeline: check | `pipeline\check.ts` | Model 2: double-check of each suspected finding |
| Pipeline: letter | `pipeline\letter.ts`, `shared\patient-letter.ts` | Model 3: per-finding draft; code assembles one patient letter |
| Pipeline: config and Ollama | `pipeline\config.ts`, `pipeline\ollama.ts` | `lantern.config.json`; sole network client to the model server |
| Pipeline: import | `pipeline\csv.ts`, `pipeline\pdf.ts`, `pipeline\history.ts` | CSV/PDF to numbered lines |
| Pipeline: medicines | `pipeline\medicine-names.ts`, `pipeline\count-supplies.ts` | Letter fact check word list; supply counting for prompts |
| Pipeline: criteria load | `pipeline\criteria.ts` | Reads `criteria\<id>\criterion.json` and `criteria\active.json` |
| Shared contract | `shared\types.ts`, `shared\lines.ts`, `shared\facts.ts` | Types for cases, findings, letters, criteria, API |
| Criteria data | `criteria\`, `criteria\active.json` | One folder per criterion; active list defines order (first ten, then further) |
| Test histories | `cases\` | Fictional CSV/PDF per criterion |
| Scoring | `eval\` | Runs histories through real models; PASS/FAIL tables |
| Tools | `tools\` | Smoke test, record run, sign-off server, adoption helpers |

```
+------------------+     GET/POST /api      +------------------+     POST /api/chat     +------------------+
|  Browser page    | <--------------------> |  Node server     | <------------------> |  Ollama :27435   |
|  (src, dist)     |   poll /api/state 1s   |  server/*.ts     |   one call at a time |  3 model names   |
+------------------+                        |  engine + store  |                      +------------------+
                                            |        |         |
                                            |        v         |
                                            |  data/state.json |
                                            +------------------+
```

### Local models

Three models share one graphics card. The page shows founder names from `lantern.config.json` (`modelNames`: Mantle, Lumen, Ogee) and lists the models behind them in health responses (`modelsBehind` in `shared\types.ts`, defaults in `pipeline\config.ts`).

| Job | Status line name | Ollama id | Model (config) |
|-----|------------------|-----------|----------------|
| Screen (and scan images) | Mantle | `lantern-screen` | Gemma 4 31B (with vision for scans per `docs\SPEC.md` section 3) |
| Double-check | Lumen | `lantern-check` | Qwen 3.8 27B |
| Letter | Ogee | `lantern-letter` | Gemma 4 26B |

`docs\RUNNING.md` and `docs\SPEC.md` section 3 state that Ollama runs loopback-only at `http://127.0.0.1:27435`, version 0.40.15 in the measured proof, with model files and start scripts in a runtime folder outside this repository (`%USERPROFILE%\ClinicaLANTERN-Lantern-runtime` per `docs\RUNNING.md`). This clone does not contain quantisation tags for the weights; serving is through Ollama on that address.

The test computer on which the coordinator read these numbers on 20 November 2026 at 23:05 is in `leader-points\test-computer.md`, word for word: a laptop; processor Intel Core Ultra 9 290HX Plus, 24 cores; memory 96 GB (95.4 GiB visible to Windows); Windows 11 Pro; graphics card NVIDIA GeForce RTX 5090 Laptop GPU, 24 GB of memory (24,463 MiB as the card reports it); model server version 0.40.15, answering on this computer only (127.0.0.1:27435); the three models as the server lists them: `lantern-screen` (Model 1; shown to the pharmacist as "Mantle"): family gemma4, 30.7 billion parameters, quantisation Q4_0, 17.6 GB on disk (it also reads pictures); `lantern-check` (Model 2, "Lumen"): family qwen35 as the model file names it, 27.3 billion parameters, quantisation Q4_K_M, 16.4 GB on disk; `lantern-letter` (Model 3, "Ogee"): family gemma4, 25.2 billion parameters, quantisation Q4_0, 14.6 GB on disk; one model is on the card at a time (at 23:05 the check model: 16.7 GB, all of it on the card); the server changes the model on the card when a job needs another one; the application runs one model job at a time; what this means for a pharmacy: the three models need a graphics card with about 24 GB of memory, or a computer that runs them more slowly on the processor; no pharmacy computer was tested. the time of the recorded one-patient test is shown in the demonstration film

`pipeline\ollama.ts` states that only one call runs at a time in the process (one GPU). `server\engine.ts` queues jobs and `pickNextJob` prefers keeping the same stage loaded when possible. The server binds to `127.0.0.1` (`server\index.ts`). Model traffic uses `cfg.ollamaBase` (default `http://127.0.0.1:27435` in `pipeline\config.ts`); non-loopback bases are rejected at config load.

### When the model server stops, times out or answers in a wrong form

If the local model server cannot be reached, the running job goes back to **queued**, the activity log says the models are not running, and the job runs again when the server answers (`server\engine.ts` `pauseForServer`, `failedBecauseServerIsDown` in `pipeline\ollama.ts`). Screening of a scan waits the same way until the server is back (`server\engine.ts` `runTranscription`).

Each model call is tried twice with a two-second wait between tries (`pipeline\ollama.ts` `chatNow`, `RETRY_DELAY_MS`). A timeout, HTTP error, empty answer or JSON that does not match the asked schema returns `{ ok: false, error }` and does not throw. A failed screen marks that criterion **failed** with the error text, not clear (`server\engine.ts` `recordScreen`). After an unexpected error the job is marked **failed**, logged, and the same step is queued again at most twice (`MAX_RETRIES_AFTER_ERROR` in `server\engine.ts` `afterJobError`). A screen that stops half way leaves the history **interrupted** and a "Screen again" control on the page; a check that still fails after retries reaches the bell as "second check not completed"; a letter step can get a note to write by hand (`server\engine.ts` `afterJobError`).

The pharmacist sees failed criteria, interrupted screening, job detail text on the footer, and error lines in the activity log (`server\view.ts`, `Engine.note`). State is written after each step (`server\store.ts`). Cases not covered in code: behaviour if Ollama crashes in a way that corrupts its process without a clean HTTP refusal; recovery of a job that was **running** when the Node server itself stops (on restart, queued jobs are picked up from `data\state.json`; a job left **running** is not resumed automatically).

### Path of one dispense history

1. **Import.** You bring in one file (spreadsheet text, PDF with selectable text, or pictures of pages). If the file cannot be read into lines, the page says the history cannot be assessed and nothing is screened. (`Engine.importCase` in `server\engine.ts`): POST body may be CSV text, PDF text rows, or page images. CSV is parsed in `pipeline\csv.ts`: header row maps columns (aliases in `COLUMN_NAMES`); each data row becomes a numbered line `L001`, … Supplies need `dispense_date` and `medicine` and/or `brand`. Optional `record_type` / `detail` / `value` rows are facts (`docs\SPEC.md` section 6a). Problems return `cannotAssess` on the case. Over `MAX_HISTORY_LINES` (1000, `server\engine.ts`) is refused. A new `CaseRecord` gets one screening row per criterion in `engine.criteria` from `criteria\active.json`.
2. **Screening order.** The LANTERN works through every criterion in use, but not all at once on day one: the list in `criteria\active.json` names a **first ten** (the `active` array); those ten are screened before the **further** criteria, which run in blocks (`further` array, `screenBlockSize` default 20 in `pipeline\config.ts`). Within each priority rank, criteria that need a listed medicine on a supply line go first, then those that needed an ask-when answer, then the rest (`screenRank` in `server\engine.ts`). A criterion that is waiting on an open standing question is **not** screened until you answer or choose "Not known"; those rows stay **waiting** on the criteria list while other criteria in the same rank may still run (`waitingOnAnswer` in `server\engine.ts`; `not_known` releases screening). (`bestOpen`, `screenRank`, `segmentIndexes` in `server\engine.ts`).
3. **What the first model reads** (`pipeline\screen.ts`): Patient header, numbered history lines, criterion statement, medicine groups, optional `needs_facts`, `datesNote` (calendar cut dates from the latest supply date on the record), `supplyCountNote` when `count_supplies` is set, and task/schema for JSON answer (suspected or clear, line ids, medicines, reason).
4. **Suspected finding**: A screen result with suspected lines creates a `Finding` in state `suspected`; `queueChecks` adds check jobs.
5. **Model 2** (`pipeline\check.ts`): Re-reads cited lines; `confirmed: true` moves to `confirmed` (or `not_confirmed` if disputed). Incomplete or failed checks stay visible; `not_confirmed` with planted findings count as disputed in scoring (`docs\SCORING.md`).
6. **Possible finding**: When medicines match but required facts are missing from the record, screen may set `possible` and `missingFacts` (`shared\facts.ts`, `server\engine.ts` `recordScreen`).
7. **Questions.** You may be asked for facts the history does not hold. You can answer while most jobs run; the page blocks an answer only when that question's own criterion is on the model or its finding's check is open. If you answer while other criteria were waiting on the fact, those criteria are screened again on the next screen job. (`server\questions.ts`, `syncCaseQuestions`): Facts the dispense record cannot hold (conditions, results, observations) may come from CSV or from pharmacist answers. Code opens standing and ask-when questions from `needs_facts` (`syncCaseQuestions`). A possible finding can open further questions after Model 1 names missing facts (`recordScreen` in `server\engine.ts`). `needs_facts.ask_when` opens questions before screening when the record does not already hold the fact (`recordHoldsFact` skips the question). Answers write a fact line on the history. "Not known" on an ask-when question releases its criteria to screening (`waitingOnAnswer` and `released` in `answerQuestion`). `assertAnswerAllowed` in `server\engine.ts` and `writeAnswer` in `server\questions.ts` implement the rules above. Take-back still uses `assertQuestionsIdle` in `server\engine.ts`.
8. **Pharmacist decision** (`Engine.decide`): On a finished check, actions are `accept`, `bypass`, or `dismiss` (dismiss only for `not_confirmed`). Accept queues a letter job; bypass and dismiss record reasons in the activity log.
9. **Letter** (`pipeline\letter.ts`, `server\engine.ts`, `shared\patient-letter.ts`): Each accept queues a letter job for that finding only. Model 3 drafts one finding at a time. The open letter for the patient is reused (`letterForAcceptance`): accepted findings share one letter record with one `findingIds` list and one point per finding. `rebuildPatientLetter` turns each point's draft into a `PatientLetterPart` and `assemblePatientLetter` joins them with one pharmacy head, one "Dear Doctor,", one closing, and the pharmacist's signature block from config. The subject is `"N points for this patient"`. `renderPatientLetter` adds a numbered contents list at the head when there are more than three points (`shared\patient-letter.ts` lines 159-169). Each point keeps its own paragraphs, cited lines, and criterion source block. Preview and send require the pharmacist to read that combined text first (`previewLetter`, `markSent` in `server\engine.ts`).

### Reading a pathology test at the question (path-O-finder inside the LANTERN)

When the LANTERN asks for a **result** that stands on a pathology report, the question offers two ways: the pharmacist types the value, or uploads the pathology test (`pipeline\pathology.ts`, `server\questions.ts`). The upload part shows the path-O-finder mark (`src\assets\path-o-finder\pathofinder_lantern.svg`: the name and the glass of path-O-finder's own mark, without the line that mark carries, which says "clinician"). The panel carries this line, ordered by the founder: "Every result finds its path, and every path is one a pharmacist chose." Everything else on the page keeps the LANTERN's approved look.

**Two tiers.** A page that already has text is read **by rule**, with no model (`pipeline\pathology.ts`); that reader copies what is printed and does not change digits or units. A page that is only a picture is written out line by line by the local reading model (the same model as screening), **twice** (`pipeline\transcribe-pathology.ts`), because one pass can misread a character; only lines both passes agree on are kept, and the same rule reads those lines. You see the line before anything is written and should check it against the report. The fixed instruction to the reading model is:

`You read one page of a printed pathology report from an image and write its text out line by line. You only read. Write every line exactly as printed, left to right, top to bottom. Keep a test name, its value, its unit, its reference range and any flag letter together on one line, separated by single spaces. Keep every digit, decimal point, sign (< or >) and unit exactly as printed. Do not correct, round, convert, interpret or comment. If a character cannot be read, write ? in its place. Do not add any line that is not on the page. Answer with JSON only, in this form: {"lines": ["first line", "second line"]}`

**Route and queue.** POST `/api/cases/<case>/questions/<question>/pathology` (`server\api.ts`, `Engine.readPathologyTest` in `server\engine.ts`). At most ten pages. A picture is transcribed only when no other model job is queued or running: one model job at a time, as everywhere in the LANTERN.

**Confirm before write.** The route returns what was read; nothing is written into the dispense history until the pharmacist confirms on the page (`USE THIS RESULT` in `src\components\PathologyUpload.tsx`). A confirmed result can be taken back like any other answer. The fact line then says where the value came from, in the form used by `answerLineText` in `server\questions.ts`: `Read from the uploaded pathology test "<file name>" (page <n>; the line of the report: "<the line>") and confirmed by the pharmacist at the counter on <date>.`

### How the upload was reviewed

Automated tests cover the reader (`pipeline\pathology.test.ts`, 36 `it(` tests in this clone) and the route with a stand-in model (`server\pathology-upload.test.ts`, 32 `it(` tests in this clone). At the end of the night the two files hold 36 and 32 `it(` tests.

An independent review by a second member of the team (K-PATH-REVIEW, 20 November, 20:52 to 21:08) was told to try to break the reader. It found six wrong readings in the first version, each returned as sure: on a row with two or three result numbers the last number was taken ("Sodium 128 139 mmol/L" read as 139); a comma inside a number split it ("Potassium 4,4" read as 4; "Creatinine 1,234" read as 234); and a requested date standing after the word "Collected" was taken as the collection date. All were mended by making the reader abstain, with tests written first (commits 75e7c80 and 62555c0 on branch kimi).

A second order to the same reviewer (K-PATH-2, 21:32 to 21:49) made three further mends, each with its test first. A line of a text page that is longer than 300 characters is not read and not cut: the other lines are read, and the skipped line is named to the pharmacist (commit 95c7554); before that, one long footer line refused the whole report. A scanned page keeps its original page number when a blank page stands before it (commit a4c3176). And a point of the final audit on three criteria (CKD-N06A, CKD-N06D, CKD-N07B) was mended in the application's code: when the pharmacist answers "Not known" to a question that asks for a result, the line written into the record now names the result ("eGFR: not known. Entered by the pharmacist at the counter on 20 November 2026."); before, it read "Not known." and a reader of the record could not tell which result was meant (commit 60d5520).

The upload page built that night (G-PATH-1, three commits, in main from 21:35 on 20 November) is implemented in `src\components\PathologyUpload.tsx` and covered by `src\components\PathologyReadings.test.tsx` (buttons "USE THIS RESULT" and "TYPE IT MYSELF", refusals with the typed form still available). It shows the two ways on the question card, what was read with the line and the page of the report, and every refusal in the server's own words with the typed form still open.

The figures of the reading model's test on fictional report pictures are not stated in this document.

### What code decides vs what a model decides

The table below is for implementers: it names which steps are fixed in TypeScript and which steps call a local model.

| Step | Decided by code | Decided by model |
|------|-----------------|------------------|
| Order of screening ranks, the first ten, and further blocks | `screenRank`, `segmentIndexes`, `pickNextJob` (`criteria\active.json` `active` vs `further`) | — |
| Matching supply text to criterion medicine lists (pre-screen priority) | `listedMedicineSupplied`, `groupIsSupplied` in `server\questions.ts` | Model reads lines for clinical match |
| Supply counts in prompts | `count-supplies.ts`, `supplyCountNote` | Whether criterion is met |
| Calendar **month** windows in prompts (from latest supply date on the history) | `monthsCountedBack`, `datesNote` in `pipeline\screen.ts` | Whether criterion is met |
| Calendar **day** and **week** windows in prompts | — (rule text only) | Model counts the window in the prompt |
| Opening/closing standing and ask-when questions; writing fact lines after you answer | `syncCaseQuestions`, `writeAnswer` in `server\questions.ts` | Possible finding opens extra questions via `missingFacts` (`recordScreen` in `server\engine.ts`) |
| Letter factual checks (dates, amounts, names, tone) | `checkLetterFacts`, `checkLetterTone` in `pipeline\facts.ts` | Wording of paragraphs (JSON fields) |
| Letter assembly, prescriber choice, signature block | `assemblePatientLetter`, `letterAsItLeaves`, `choosePrescriber` | — |
| Finding line set shown to pharmacist | `shared\lines.ts` merges screen and check line ids | Initial line picks in screen/check JSON |
| Criterion met or not | — | Screen yes/no and check confirmation |

### State

All cases, findings, letters, jobs, and activity entries live in one JSON file (`server\store.ts`). No database and no user accounts appear in the server code. `writeFileAtomic` replaces the whole file after changes. The activity log (`state.activity`) appends timestamped entries for imports, model steps, pharmacist decisions, and letter status (`Engine.note`). Finished jobs are capped at 300 retained (`KEPT_FINISHED_JOBS` in `server\engine.ts`); the activity array is not trimmed in code (`docs\reviews\C-REVIEW-2-one-large-case.md`).

### Privacy and network use

On 20 November 2026 the coordinator searched for `fetch`, `http://`, `https://`, and `WebSocket` in application `.ts` files under `server\` (not tests), `pipeline\`, and `src\`. That search was manual source reading, not a network capture. The model server's own traffic outside this process was not inspected. Third-party packages were not exhaustively audited.

In normal operation the running application contacts loopback only:

- Page to app server: `src\api.ts` uses `BASE` pointing at the local server (and `vite.config.ts` proxies `/api` to `127.0.0.1` in dev).
- App server to Ollama: `pipeline\ollama.ts` `POST` to `cfg.ollamaBase + '/api/chat'`; `server\engine.ts` probes `base + '/api/version'`.
- Replay build: `src\lib\replayBackend.ts` fetches local `recorded/index.json` only in judges' view.

No application code in `pipeline\` or `server\` (excluding tests) calls a non-loopback URL for screening, checks or letters. The page's only API client is `src\api.ts` (local server). Criterion JSON files may contain DOI URLs as metadata; those are not fetched by the screening pipeline. From this search alone, the application's own code sends model prompts and dispensing data only to the local model server on this computer during a normal run. That does not prove Ollama sends nothing elsewhere.

### Sign-off of criteria

Each `criterion.json` may hold `signed_by_clinical_reviewer: { name, date }` or `null` (`pipeline\criteria.ts`, `shared\types.ts`). Until signed, `draft` defaults true (`raw.draft !== false`). The criteria API exposes sign-off to the page; `src\components\CriteriaPanel.tsx` and `BellPanel.tsx` show "Draft criterion. Not yet signed by the clinical reviewer" when `signedBy` is absent. `docs\SIGN_OFF.md` and `docs\SIGNOFF_TOOL.md` describe the clinical reviewer signing in a local tool on port 8790. At the time of submission the sign-off record holds 583 signed criteria of 583 in use.

### A switched-off component: questions prompted by a supplied medicine

The code holds a component that could open a condition's question when a supplied medicine points to that condition (`syncCaseQuestions` and `conditionMarkerReason` in `server\questions.ts`; its behaviour is tested on a small test file in `server\condition-markers.test.ts`). It reads its lists only when the switch `conditionMarkers` in `lantern.config.json` is on. The switch is off, no list of medicines is shipped in this release, and the clinical reviewer has not reviewed such lists. The recorded one-patient test did not use it.

### How it is tested

The repository includes 113 `*.test.ts` files (Vitest, counted in this clone). They cover CSV import, questions, engine queue, letter assembly, API, page helpers, and pathology upload without calling live models when tests use stand-ins. Whether they all pass at submission is recorded separately (`docs\RESULTS.md`, continuous integration); this document does not state a pass count for tonight's run.

Pinned prompt tests:

- `pipeline\unchanged.test.ts`: SHA-256 hashes of screen, check, and letter messages/schemas for the baseline first-ten criterion without facts (guards against silent prompt drift).
- `pipeline\first-ten-pin.test.ts`: Full text pin for STOPP-C10 on `cases\STOPP-C10\pos-brand.csv` screen and check messages.
- `shared\judges-wording.test.ts`: Scans tracked text files for banned wording (e.g. marketing phrases) per `docs\SPEC.md` section 10.

Scoring (`docs\SCORING.md`, `eval\`): On fictional test histories, a criterion **PASS** means all three parts in `docs\SCORING.md` section 2: no planted finding is missed (reaches the bell with planted lines and criterion text); a GP letter is produced showing planted lines; false flags are counted but are not failures; a near miss wrongly confirmed is a false flag, not a failure; a planted finding that Model 1 suspected and Model 2 disputed is shown to the pharmacist, is not a failure, and is not a miss.

The criteria were drafted from the published sources, each with fictional test histories, by GPT-6.2 Astra, and read a second time by Gemini 4 Neon. A text was changed only where both readers agreed, or where the leader of the audit (Claude Fable 5.2) ruled against the published statement, the dated lines of the source and the Australian medicines list. Every changed text was run again on the three local models until it passed its planted-finding test, and a proof compared the hash of each scored text with the text in the main branch. The clinical reviewer then read and signed each criterion himself. The research paper gives the method and its limits.

### How to run it

```
powershell -NoProfile -File <runtime>\start-ollama.ps1
cd <repository>
npm run build && npm start
```

Open `http://127.0.0.1:8787/`. Hardware: one graphics card on the test computer (`docs\RUNNING.md`, `README.md`). Full steps: `docs\RUNNING.md` section 1.

## Dataset assumptions

### The input

A **dispense history** is one patient's numbered supply lines (and optional fact lines) in one imported file. Formats: CSV (primary), PDF with extractable text, or PDF/image scan read by Model 1. The CSV layout is the application's own: a header row with canonical or alias column names (`COLUMN_NAMES` in `pipeline\csv.ts`). No export from a real Australian dispensing system was imported or scored in this repository. Real dispensing data is often messier than the fictional test histories (abbreviated directions, part supplies, brand changes); that messiness is not covered by the scorer.

| Column (canonical name) | Required | Use |
|-------------------------|----------|-----|
| `dispense_date` (or aliases) | Yes for supplies | Parsed to ISO date on each supply line |
| `medicine` and/or `brand` | Yes | Product name on line (`pipeline\csv.ts`) |
| `strength`, `form`, `quantity`, `repeats_left`, `directions`, `prescriber` | No | Concatenated into line text |
| `patient_ref`, `patient_age`, `patient_dob`, `patient_sex` | No | Patient header; age resolved in `pipeline\age.ts` |
| `record_type`, `detail`, `value` | No | Condition, result, or observation lines |

Dates accept several day-month-year forms via `parseDateField` (`pipeline\dates.ts`); bad dates are listed in import problems. Multiple `patient_ref` values in one file are reported. Lines over `MAX_LINE_CHARS` (1000) block assess. Empty or missing required columns yield problems and `cannotAssess` without screening.

### What a dispense history does not hold

Diagnoses, laboratory results, and observations are not inferred from supplies alone. Criteria with `needs_facts` declare what must be known (`criterion.json`); the record may include fact rows or the pharmacist answers via questions (`server\questions.ts`: kinds `condition`, `result`, `observation`, optional `ask_when` before screen, and questions after a possible finding). Answers become lines marked as entered by the pharmacist at the counter.

### Conditions are rarely written in a dispensing history

A dispensing history rarely names a diagnosis. 298 of the 583 criteria need a condition (a needed fact of the kind condition): 348 such facts, counted from `needs_facts` of kind `condition` over the ids in `criteria\active.json`. Where the record does not hold the condition, the application asks the pharmacist, who answers or marks it not known. A fact that stays unknown leaves a finding possible; it does not confirm it.

### Time

For criteria whose rules mention counting back from the **end of the record**, the program uses the **latest dispensing date on the history** (not today's date). For rules phrased in **months**, code reads the month counts from the criterion text and adds a **DATES** block (`monthsCountedBack`, `datesNote` in `pipeline\screen.ts`; tests in `pipeline\dates-note.test.ts`). `latestDate(lines)` is the latest `yyyy-mm-dd` at the start of a supply line, ignoring pharmacist-entered counter lines. Rules phrased in **days** or **weeks** are not turned into a DATES block; the models work the window from the rule text (see Limitations).

### The criteria

Sources and licences are documented in `docs\SOURCES_AND_LICENCES.md` (STOPP/START, PINCER, PROMPT, Brisnik, EU(7)-PIM, OPTIMISE, Bansal opioid indicators, Khawagi S3 rows, etc.). Criteria tied to non-commercial-only bases or clinical grounds are set aside (`docs\SET_ASIDE.md`, seven ids). Sources not confirmed by the founder keep `licence_status: "proposed"`. 583 criteria are in use.

Example **STOPP-B13** (`criteria\STOPP-B13\criterion.json`): published STOPP statement and CC BY credit; `medicine_groups` for aldosterone antagonists and potassium-conserving drugs with Australian ingredient and brand lists; `needs_facts` for serum potassium; `rule_for_models` and test histories under `cases\STOPP-B13\`; `signed_by_clinical_reviewer` null in file.

### Medicine names

Lists in each criterion hold ingredient strings and brand names as plain words. `listedMedicineSupplied` lowercases line text and tests substring presence of listed names (minimum length 3). `pipeline\medicine-names.ts` holds a broad Australian-oriented word list used only for letter fact checking (not for screening). Screening match is model-led on the lines plus criterion lists in the prompt.

### Test data

Every patient, prescriber, and prescriber practice name in test files is fictional (`README.md`, `docs\SCORING.md`). Histories are built with planted findings and near misses per criterion (`docs\SCORING.md`, `docs\PROOF_WAVES.md`). Scored runs are measured on one computer and are not called clinical validation (`docs\RESULTS.md`). At the end of the night the repository holds 1,822 fictional test histories with 71,541 lines in all.

### Pathology reports used in tests

The pathology reader's tests (`pipeline\pathology.test.ts`) use **fictional** report lines only. No live model is called in those tests. Upload-route tests use fictional file names and stand-in transcriptions (`server\pathology-upload.test.ts`).

### Tests the pathology reader knows

When a criterion asks for a result the reader can read from a report, it matches against the table `ANALYTES` in `pipeline\pathology.ts`. In plain names, the reader knows: Sodium, Potassium, Urea, Creatinine, eGFR, Haemoglobin, Platelets, White cell count, Neutrophils, Ferritin, Transferrin saturation, TSH, Free T4, HbA1c, Glucose, Corrected calcium, Calcium, Magnesium, Phosphate, ALT, AST, Vitamin D (25-hydroxy), INR, Lithium, Carbamazepine, Vitamin B12, Red cell folate, Folate, Prolactin, and Urine albumin to creatinine ratio. Any other result is typed by the pharmacist.

### Other input assumptions

One import creates one case (duplicate files create two cases; `docs\reviews\C-REVIEW-1-questions-and-answers.md`). Letter prompts ask for plain Australian English (`pipeline\letter.ts`). Brand lists target medicines dispensed in Australia. PDF scans require pharmacist confirmation of transcribed rows before screening (`awaitsTranscription` in `server\view.ts`; screening is refused until confirmation in `server\engine.ts`; `POST /api/cases/:id/confirm-transcription` in `server\api.ts` and `src\api.ts`).

## Clinical boundaries

### The pharmacist decides

Every finding is accepted, bypassed or dismissed only by the pharmacist (`Engine.decide` in `server\engine.ts`). A letter cannot be marked sent until the pharmacist has previewed the exact leaving text (`previewLetter` and `markSent`). The signature name, title and registration on the letter come from pharmacy config and are stamped back into the body (`letterAsItLeaves`, `stampClosing`). The software sends nothing by itself: `emailDraftFor` in `pipeline\letter.ts` builds a local draft with no recipient; print and email are recorded actions only.

### The reader reads; it does not interpret

The pathology upload follows path-O-finder rules in `pipeline\pathology.ts`. For **text** pages, the rule-based reader **reports** what is printed: the value (as written, including `<` or `>`), the unit, the laboratory's own reference range and flag letter when they are on the line, the collection date when the document states one collection date, the page number, and the report line word for word. It does not interpret whether a result is normal or abnormal for the patient; it does not correct, round or convert values. For **picture** pages, a model writes the lines first; it can still misread or round a character despite the instruction and the two-pass agreement step (`pipeline\transcribe-pathology.ts`), which is why the pharmacist confirms against the report before write.

When it is not sure, it **abstains** and says why. The pharmacist then types the result. It abstains on a line when: a character could not be read (`?` on the line); more than one result number sits on the row (a cumulative report); a comma sits between digits; the value lies outside the test's hard bounds; the unit is not one of the test's allowed units; the reference range on the line could not be read; the document holds more than one collection date; the same test appears more than once with different values; a wanted line appears in only one of two picture transcriptions; or coherence checks leave doubt (unit missing where one is expected, a limit not a measured number, or the laboratory flag disagreeing with its own range on the line). Abstentions and low-confidence readings are shown on the page; **nothing is written into the record** until the pharmacist confirms. A confirmed upload can be taken back like any other answer (`takeBackQuestion` in `server\engine.ts`).

### Published criteria and how they are shown

Each criterion in use comes from a published source named in its JSON file (`docs\SOURCES_AND_LICENCES.md`). The `statement` field is shown to the pharmacist as published wording, including historical doses and spelling (`CriterionDetail` in `src\components\CriteriaPanel.tsx`). The `plain_summary` field in each criterion file carries the plain-language summary, often with Australian product information or guidance where the entrant added it. The field `statement_origin` in `criterion.json` is `published` when the statement is taken from the source, or `entrant` when the entrant restated it (`pipeline\criteria.ts`). Credit and modification lines sit with the statement when the file defines them.

### Draft criteria and sign-off

Each `criterion.json` may hold `signed_by_clinical_reviewer` or null (`shared\types.ts`, `pipeline\criteria.ts`). Until signed, `draft` defaults true and the criteria panel shows a draft notice. Each criterion and its medicine list is a draft until a clinical reviewer signs it in the separate local tool (`docs\SIGNOFF_TOOL.md`); the screening models do not sign. The clinical reviewer is one practising Australian community pharmacist, who is also the entrant: not an independent panel. Repository scoring and AI readers are not a clinical review of the criteria. 583 of 583 criteria in use are signed at the time of submission.

### What one dispensing history can and cannot show

A dispensing history is one pharmacy's record for one patient. It has no stop date on a medicine unless the import line says so, no supply from another pharmacy, no hospital-only treatment unless it appears as a line, and no medicine bought without a prescription unless the pharmacist records it. Many criterion files state this under `cannot_be_seen`. Whether a medicine is still current is estimated in screening prompts from quantity, directions and dates; the pharmacist judges borderline cases.

### Australian tailoring of medicine lists

Medicine groups list ingredients and brands marketed in Australia for the use the criterion describes. Named departures from a published list are written in group notes with a reason on record. Finerenone is excluded from the mineralocorticoid antagonist check at eGFR below 30 in `criteria\STOPP-E7\criterion.json` (note on the Finerenone group in that file). Loop diuretics and spironolactone are excluded from the antihypertensive group in severe symptomatic aortic stenosis (`criteria\STOPP-B20\criterion.json`). In the opioid laxative indicator `criteria\NHSBSA-PAIN02\criterion.json`, bulk-forming fibre does not count as prescribed cover and the rule asks about non-prescription laxative use; `criteria\BANSAL-S13\criterion.json` and `criteria\BANSAL-S14\criterion.json` still list bulk-forming products in Group B (documented in `docs\TECHNICAL_DOCUMENTATION.notes.md` section 2).

### Known gaps in coverage

The Australian boxed warning for strontium ranelate names risks at any age that are not all screened as their own criterion. `criteria\EU7-F46\criterion.json` screens strontium ranelate from age 65 with specific immobility, clot-risk and renal routes; its `plain_summary` quotes the Protos boxed warning text but the rule does not implement every boxed-warning situation at every age. Some published criteria name ingredients with no Australian brand on the list (for example edoxaban with an empty brands array in `criteria\BRISNIK-HR-F1\criterion.json`); matching relies on ingredient text on the supply line. No criterion in `criteria\active.json` rests on the AGS Beers Criteria (`criteria\KHAWAGI-G048` is set aside for that reason in `docs\SET_ASIDE.md`).

### Evidence, not outcomes

A finding is a flag with cited lines, not a diagnosis or instruction (`docs\SPEC.md` section 5). No patient outcome has been measured with this software. It has not been used on a real patient's record in production and is not registered or approved by a regulator (`README.md`). Nothing in the repository is medical advice.

**Alert burden.** In the one-patient recorded test, the number of questions and findings is shown in the demonstration film and not restated here. How many flags and questions a full patient list would trigger across 583 criteria is not measured.

**Silent clearance.** When Model 1 marks a criterion clear, nothing is shown to the pharmacist. The scored runs guard against missing **planted** findings only (`docs\SCORING.md`); they do not measure silent false negatives on real records.

**Regulation.** The LANTERN has not been assessed against the Australian rules for software as a medical device or their exemption for clinical decision support software. It has not been used on a real patient's record. That assessment is needed before any real use. This document does not state which rule applies.

## Limitations

### Fictional patients and clinical use

Fictional patients only. Never import a real dispensing export, even to test. The prototype is not validated for clinical use. Nothing here is medical advice.

### The pharmacist decides

The pharmacist decides. The software flags and drafts.

### Missed findings and false flags

A missed finding is the failure the build guards against; a false flag is counted and reported, never hidden (`docs\SCORING.md`; **Scoring and deployment** below).

### One history at a time; pathology only at the question

The LANTERN imports one dispense history at a time. A second import for the same patient is a separate history; answers from the first are not copied into the second. A pathology test is not imported as a second history. Since the night of 20 November 2026, when a question asks for a result that can stand on a pathology report, the pharmacist may upload that test at the question or type the value; the upload is read, shown, and written only after confirmation (see **Reading a pathology test at the question**).

For about forty minutes the missing upload was recorded as a limitation. At about 19:40 the clinical reviewer accepted it, word for word: "fair enough, we will build the imported pathology tests engine in the future, and record it now as a limitation". At 20:22 he ordered it built the same night: "whenever a pathology result is needed, the pharmacist could be given the choice to enter the number manually or to upload the pathology test that has the required result".

**What the upload does not do:** it reads only the tests in its table; any other result is typed. It does not import a pathology report as history and does not search for results the LANTERN did not ask for. Handwriting is not read. A report with cumulative columns is not read: the reader abstains. A picture can be misread, which is why it is transcribed twice, the line is shown, and the pharmacist confirms before write. Whether the upload appears in the recorded test can be seen in the demonstration film.

### Day and week windows worked out by the model (ruling R23)

When a rule counts back in **days** or **weeks**, code does not build a DATES block for that window (`monthsCountedBack` returns `[]` for day-only rules; see `pipeline\dates-note.test.ts`). The models work the exact window from the rule text in the prompt (`leader-points\limits-to-record.md`, ruling R23). Fictional test histories were built with at least seven days clear of each cut-off (`leader-points\limits-to-record.md`); the scorer does not enforce that margin in code. Examples named in the ruling: DREISCHULTE-73 and DREISCHULTE-75 (84 days), and KHAWAGI-G084 (the 14 days after the last dose of an MAOI; its histories were moved from day 14 and day 15 to day 7 and day 21 by the repair recorded in `leader-points\limits-to-record.md` as wave W1918). At the end of the night two further limits stood recorded under R23, for STOPP-B13 (which of several dated supplies the models cite) and KHAWAGI-G162 (a comparison of two dates that the model writes out).

### One answer for a named question for the whole history (rulings R24 and R25)

The application keeps one answer to a named question for the whole history, with no date on the choice itself. An answer cannot be tied to one course, one supply or one calendar date on the choice, except that you may type a **result date** on a result question (`resultDate` in `ChosenAnswer`, `server\questions.ts`) and a confirmed pathology upload carries the collection date from the report in the fact line (`answerLineText` in `server\questions.ts`). A question is not asked when the record already settles the matter (`recordHoldsFact`). Where the record leaves the matter open, the finding stays possible and the pharmacist reads it. The leader of the audit recorded this as a limit on At the end of the night the leader's record holds 77 LIMIT decisions under R24 and 39 under R25. points of the final audit (rulings R24 and R25 in `leader-points\limits-to-record.md`). Examples: CKD-N03A (dialysis), QLDCOAG-6-1 (pregnancy at the supply), STOPP-B5 (which course overlapped), USMEC-D1-POSTPARTUM-A (the date of the birth), START-F1 (a course that ended before the condition began), BRISNIK-OP-DEPR8 (which SSRI and which regimen exceeded its daily reference amount).

### A condition is often not written in a dispensing history

298 of the 583 criteria need a condition fact, and a dispensing history rarely holds one. The application then asks the pharmacist. A question left unanswered leaves its criterion waiting or its finding possible. In the recorded run of 21 November 2026, 52 questions were still open when the screening ended.

### Speed and hardware

On the test computer, one graphics card runs one model call at a time. In the recorded run of 21 November 2026, with every criterion in use (583 in `criteria\active.json`) and one fictional history built to meet many criteria, the first finding was confirmed 2 minutes 36 seconds after the import and the first GP letter was ready at 4 minutes 54 seconds. Thirty minutes after the import, 143 of the 583 criteria had been screened. The pass finished about 64 minutes after the import: 512 criteria clear and 71 suspected, 67 findings confirmed by the second model and 4 not confirmed, and 52 questions left unanswered. Every suspected finding is double-checked by the second model, and the models take turns on the one graphics card. An earlier note of about 22 minutes for one history is not confirmed for the full set of criteria. `pipeline\ollama.ts` allows only one model call at a time in the process, so a pathology picture upload waits while any other model job is queued or running (`server\engine.ts` `readPathologyTest`). `server\engine.ts` queues jobs one after another. The Ollama model ids and the display names Mantle, Lumen and Ogee come from `pipeline\config.ts` (`lantern-screen`, `lantern-check`, `lantern-letter`; models behind: Gemma 4 31B, Qwen 3.8 27B, Gemma 4 26B). One graphics card is assumed.

### Questions and answers

You see one open question per fact name (for example one "chronic heart failure" question shared by every criterion that needs it). Answers are Yes, No or Not known (or option words defined in the criterion file); result questions can ask for a typed value and date. The page will not ask again when a fact line already answers it, including a denial. Questions tied to a medicine group can open when that group is supplied, not only when the record is silent. (`factKey`, `syncCaseQuestions`, `recordHoldsFact`, `needsAValue` in `server\questions.ts`; tests in `server\questions.test.ts`). Where the rule needs a narrower question, Model 1 may report a possible finding and name missing facts instead (`recordScreen` in `server\engine.ts`).

### Urgency

Each criterion carries `urgency` of `routine` or `same_day` in its JSON file. Every finding of that criterion inherits the same urgency. Letter text adds "Urgency: same day" when `same_day` is set (`shared\patient-letter.ts`, criterion panel in `CriteriaPanel.tsx`).

### Dates and windows

For criteria whose rules count back in calendar months from the end of the record, `monthsCountedBack` and `datesNote` in `pipeline\screen.ts` add a DATES block from the latest supply date on the history (`pipeline\dates-note.test.ts`). Rules that count days or weeks are left to the models in the prompt. Fictional test histories in `cases\` are built with planted dates; the seven-day margin in test design is recorded in `leader-points\limits-to-record.md`, not enforced by the scorer (`docs\TECHNICAL_DOCUMENTATION.notes.md` section 2).

### Supply counting

When a criterion has `count_supplies`, the program counts matching supply lines in code (`pipeline\count-supplies.ts`). Quantities in puffs, doses, actuations or mL are not converted to whole devices; those lines are flagged `UNREAD_UNIT` and the count may be wrong for inhalers or liquids (`pipeline\count-supplies.ts`, `pipeline\count-supplies.test.ts`).

### Long histories

Long histories are read to the model in parts (150 lines per part by default in `pipeline\config.ts`). If the history already had more than 150 lines at import, answering a question during the first batched screen job can leave a criterion screened on a line snapshot from job start; the pharmacist may need to screen again. (`docs\reviews\C-REVIEW-5-answers-during-a-screening.md`; `writeAnswer` in `server\questions.ts`). Not confirmed as mended at the time of submission.

### Scoring and deployment

The test set is fictional histories with planted findings and near misses per criterion (`docs\SCORING.md`). **PASS** matches `docs\SCORING.md` section 2: no planted finding missed; letters show planted lines; false flags counted but not failures; disputed planted findings not failures. PASS does not measure false flags on real dispensing data or silent clearance on real records. Repeated model runs can differ; the benchmark is one run per test history. Letter wording is checked in code for some facts (`checkLetterFacts` in `pipeline\facts.ts`); other wording errors are not fully guarded.

The running app is one browser page, one local server, no login, loopback only. State is one JSON file rewritten whole after each step (`server\store.ts`); it is not encrypted. There is no user login and no record of which staff member acted. Old histories are not deleted automatically. The activity log grows without an automatic trim (`server\engine.ts` `note`; finished jobs capped at 300). The page polls every second (`src\lib\useLantern.ts`). Seven criteria are set aside (`docs\SET_ASIDE.md`). CSV import expects the column names and aliases documented above (`pipeline\csv.ts`, `pipeline\csv.test.ts`). Criteria remain drafts on the page until clinically signed.