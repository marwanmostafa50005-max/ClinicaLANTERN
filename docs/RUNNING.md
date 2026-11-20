# ClinicaLANTERN: how to run it

Written on Wednesday 18 November 2026, after the parts were joined and run together with the real
models on the founder's PC. Updated the same day after the review of the first build: what was
changed and why is in `docs\REVIEW_FIXES.md`, and what was run afterwards is in section 10.
Updated once more that afternoon, after the founder's ruling that a record may also carry
conditions and results (`docs\SPEC.md`, section 6a): sections 2c and 11 are new, and the scorer
has a file of its own, `docs\SCORING.md`.
Fictional patients only. No real person is in any of this.

The stage is "Prototype". Everything runs on this computer. Nothing is sent anywhere.

```
page in the browser  <->  local server (Node, port 8787)  <->  Ollama (port 27435, three local models)
                                 |
                           data\state.json
```

## 1. Start everything from a cold PC

Open Windows PowerShell and do these steps in order.

**Before step 1: what this computer must have.** The repository does not hold the model server or the
model files. They are large and each has its own publisher and licence.

- **Node 24 or newer** (`package.json`, `engines`).
- **The model server, Ollama.** Version 0.40.15 was used. `tools\start-ollama.ps1` starts it for this
  application: on this computer only (`127.0.0.1:27435`, the address in `lantern.config.json`), one
  model loaded at a time, one request at a time, a context of 16,384 tokens. The script looks for the
  program at `ollama-v0.40.15\ollama.exe` under the folder you name with `-Root`, and keeps the models
  in `ollama-store` beside it.
- **Three open-weight models**, each under the local name that `lantern.config.json` uses. The three
  small files in `tools\models\` say how each name is made:

  | Local name | Shown as | Model files |
  |---|---|---|
  | `lantern-screen` | Mantle | `gemma-4-31B_q4_0-it.gguf` with `gemma-4-31B-it-mmproj.gguf` (it also reads pictures) |
  | `lantern-check` | Lumen | `Qwen3.8-27B-UD-Q4_K_XL.gguf` |
  | `lantern-letter` | Ogee | `gemma-4-26B_q4_0-it.gguf` with `gemma-4-26B-it-mmproj.gguf` |

  Put each model file beside its `.Modelfile`. With the server up, in a PowerShell window in
  `tools\models`, set `$env:OLLAMA_HOST = '127.0.0.1:27435'` and run
  `ollama create lantern-screen -f lantern-screen.Modelfile`, then the same for `lantern-check` and
  `lantern-letter`. Each is set to temperature 0, seed 42, top_k 1 and a context of 16,384 tokens.
  These three files are the entrant's own model definitions with the paths made relative. The
  `ollama create` commands were not run again from the repository's copies.
- **A graphics card with about 24 GB of memory.** The largest model is 17.6 GB on disk and one model
  is on the card at a time. The test computer has an NVIDIA GeForce RTX 5090 Laptop GPU with 24 GB
  and 96 GB of main memory. No smaller computer was tested.

1. **Start the model server (Ollama).** It is safe to run this twice. On the entrant's computer:

   ```
   powershell -NoProfile -File C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\start-ollama.ps1
   ```

   On another computer, from the repository, with the folder that holds `ollama-v0.40.15`:

   ```
   powershell -NoProfile -File tools\start-ollama.ps1 -Root <that folder>
   ```

   It answers `STARTED ... version=0.40.15 at http://127.0.0.1:27435`, or `ALREADY UP` when it was
   running. Leave it running.

2. **Go to the repository.**

   ```
   cd C:\Users\AdamG\ClinicaLANTERN-Lantern
   ```

3. **Build the page.** This is needed the first time, and again after any change in `src\`.
   It takes about 2 seconds.

   ```
   npm run build
   ```

4. **Start the app server.** Keep this window open. It prints one line for each step it takes.

   ```
   npm start
   ```

   It prints the address, the state file and the criteria in use. With the final database it begins
   `Criteria in use: 583.` and then names the first ten and gives the further-criteria count.

5. **Open the page** in Microsoft Edge: <http://127.0.0.1:8787/>

6. **Look at the bottom of the page.** It must say "The three local models are ready."
   If the models are not running, the first screen says so in a red note beside the status line,
   and the import panel says it again. Do step 1 again. The page notices by itself within a few
   seconds.

To stop: press Ctrl+C in the window of step 4. Nothing is lost, because the state is saved after
every step. Ollama can stay up. To stop Ollama too:

```
powershell -NoProfile -File C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\stop-ollama.ps1
```

The dependencies are already installed on this PC. On another copy of the repository run
`npm install` once before step 3. npm 11 on this PC skips install scripts. If `vite` or `vitest`
then fails because of `esbuild`, run `npm install-scripts approve esbuild` and `npm rebuild esbuild`.
That was not needed on 18 November.

## 2. A demo in two minutes

The sample files are in `cases\_demo\`. The first five are the same fictional patient. The long
history is another fictional patient.

| File | What it is |
|---|---|
| `positive.csv` | 45 supplies. Celebrex (an NSAID) on 21 August and 20 September 2026, with Xarelto (an anticoagulant) every month. |
| `near-miss.csv` | The same history without Celebrex. It must end clear. |
| `positive.pdf` | The positive history as a PDF with text inside, two A4 pages. The page reads the rows itself. No model is needed to read it. |
| `positive-scan.png` | A picture of the same table. Model 1 reads the rows from it and you check them. This takes about two and a half minutes. |
| `positive-scan.pdf` | The same history as a PDF of two pages that are pictures with no text, as a scanner makes them. Model 1 reads both pages and you check the rows. This takes about two and a quarter minutes. |
| `long-split.csv` | A long history of 310 lines, printed medicine by medicine. Xarelto is on lines L001 to L034 and Celebrex on lines L309 and L310. Model 1 reads it in three overlapping parts, and no part holds both medicines. The finding is seen only when the listed lines are read together (section 2a). A little over one minute. |

The two scan files are drawn by a computer. They are clean. They are not real scans of paper.

The times below were measured with one criterion in use (the demo criterion `DEMO-NSAID-ANTICOAG`). Start
the server for that demo before step 1, as in section 4 Settings (`cases\_demo\active.json` and
`data\demo`). If the server already runs with the full list of 583 criteria, stop it and start again
with those settings.

1. Click the magnifying glass. Choose `positive.csv`, or drop it anywhere on the page.
2. Watch the line under the icons: "Mantle is screening: criterion 1 of 1" (it may add
   "This pass is not finished." while the pass goes on), then "Lumen is double-checking 1 finding".
3. After about 30 seconds a red **1** shows on the bell and a pop-up says
   "A finding was confirmed. It is waiting under the bell."
4. Open the bell. Read the criterion text, the lines the models pointed to and what Model 2 wrote.
   Click **Accept**. Accept and Bypass stay in view at the bottom of the panel.
5. After about 10 seconds a red **1** shows on the letter. Open it. Edit the letter if you wish.
6. Tick "Discussed with the patient; the patient agrees to this letter". Then Print, or
   Open in my email program.
7. Click **Mark as sent**, then **Record the doctor's reply**, then **Close the case**.
8. Import `near-miss.csv`. Nothing reaches the bell.

### 2a. What the page does in the less common cases

- **A long history** (more than 150 lines, or too large for one call). Model 1 reads it in
  overlapping parts. In every part it also lists each line that holds a medicine on the
  criterion's list. Then it reads all the listed lines together in one more call, and that answer
  is used. A long history is never called clear part by part. Model 2 checks the same listed lines
  together. The status line says "(long history, part 2 of 3)" and then "(long history, reading
  the listed lines together)". If the listed lines do not fit in one call, the criterion is
  "could not be screened".
- **More than 1,000 lines.** The prototype does not screen it. The history shows "Cannot assess"
  with the reason in plain words.
- **A criterion that could not be screened**, or a screening that was interrupted. The history is
  not counted as screened. The card says how many criteria have no result, the first screen shows
  a note beside the status line, and the magnifying glass gets a red number. Click
  **Screen again what has no result** on the card. Nothing is imported twice.
- **A scan.** A PDF page counts as a scan when pictures cover a fifth of it or more, however much
  text lies over them. The check shows the rows page by page, with the count for each page and
  its picture. A page that gave no rows is shown as such. A row with no date that can be read is
  named, and the rows cannot be confirmed until it is corrected. The pictures are kept by the
  server until the rows are confirmed, so they are still there after a reload. A scan you do not
  want to confirm can be given up with **Discard this scan**. It stays in the list, marked as not
  screened, and no longer counts in the red number.
- **A second check that is not a plain yes.** A finding whose second check failed twice is marked
  "Second check not completed". A "no" from Model 2 that names lines as proof is marked "Second
  check unclear". Both wait under the bell. A finding Model 2 did not confirm stays in the grey
  list, and can be accepted there with **Accept anyway**.
- **A clean start while a model is working.** The running call is stopped at once.

### 2b. The judges' view: a recorded real run

The judges cannot run the local models. `npm run build:replay` builds a second copy of the page
into `dist-replay\`. It never talks to a server. It plays `cases\_demo\recorded-state.json`, the
saved state of a real run on this PC, step by step. It says "Recorded run from the entrant's
computer. The live models are not connected." at the top of the first screen and in the head of
every panel. An import or any change is refused in one plain sentence.

To look at it on this PC:

```
npm run build:replay
npx vite preview --outDir dist-replay --port 4178 --strictPort --host 127.0.0.1
```

Then open <http://127.0.0.1:4178/>. Ctrl+C stops it. To record a new run: `npm run smoke`, then
`npm run record` while the server still runs, then `npm run build:replay`.

### 2c. A record that also carries conditions and results

Some criteria need a fact that a dispensing history does not hold: a diagnosis, a test result or
a measurement. The founder ruled on 18 November that the record may carry those facts, as a shared
health record would (`docs\SPEC.md`, section 6a).

- **The file.** A CSV file may have three more columns: `record_type`, `detail` and `value`. A row
  whose `record_type` is "condition", "result" or "observation" is a fact, not a supply. Its date
  is the date the fact was recorded. A file without these columns is read exactly as before.
- **On the page.** A fact is a line of its own among the supplies, with a small mark: CONDITION,
  RESULT or OBSERVATION. The import panel says "The file may also list the patient's known conditions
  and recent test results."
- **A finding with its fact.** The medicines match and the record holds the fact: the finding is
  shown as before, and the fact line is among the lines the models pointed to.
- **A possible finding.** The medicines match and the record holds no line about the fact. The
  bell shows it with the line "Possible finding. The record does not show: (fact). The letter asks
  the doctor to confirm." Its letter carries the line "The record we hold does not show: (fact)."
  and asks the doctor to confirm that fact.
- **No finding.** The record holds the fact and it does not meet the criterion: nothing reaches
  the bell.
- **Which criteria.** Only a criterion whose current file lists `needs_facts` works this way.
  Among the first ten, STOPP-B13 needs a serum potassium result; its current file and histories
  carry that requirement.
- **A PDF or a scan** has no fact lines. A finding on it for a criterion that needs a fact is always
  shown as a possible finding.

The current `criteria\active.json` includes criteria that need a fact. Section 11 records the early
proof in which one wave folder was brought into a private copy of the repository and tried on the
page with the real models.

## 3. Start a clean demo (reset)

- **On the page:** scroll to the bottom, click **Start a clean demo**, then **Yes, start clean**.
- **Or by command**, while the server runs:

  ```
  Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8787/api/reset -ContentType 'application/json' -Body '{}'
  ```

Every history, finding and letter is taken off the page. Nothing is thrown away: the old state is
kept as a dated file such as `data\backups\state-2026-11-18T08-20-38.json`.

To go back to an old state: stop the server, copy the backup file over `data\state.json`, and start
the server again.

Start a clean demo after you change the list of criteria in use. An old finding for a criterion
that is no longer in the list is shown without its criterion text.

## 4. The commands

Run them in the repository folder.

| Command | What it does | Needs |
|---|---|---|
| `npm start` | The server on port 8787. It serves the built page and the API. This is the demo mode. | Ollama, and `npm run build` once |
| `npm run build` | Checks the types and builds the page into `dist\`. | nothing |
| `npm run dev` | For working on the page: the server on 8787 and the page on 5173 with live reload. Ctrl+C stops both. | Ollama |
| `npm test` | The unit tests. No model is called. No built page or prior `npm run build` is needed. | nothing |
| `npm run typecheck` | The type check only. | nothing |
| `npm run eval` | The scorer. It runs the test histories through the real models and writes `eval\results\<time>\table.md`. | Ollama. Stop other model work first. |
| `npm run eval -- --quick` | A quick scored run: each history against its own criterion only, and a sample to estimate false flags (`docs\SCORING.md`). | Ollama. Stop other model work first. |
| `node eval\run.ts --wave <wave folder> --out <new folder>` | Scores the drafted criteria of a wave folder in place, before they are in the repository. Give `--wave` again to score several wave folders in one run. | Ollama. Stop other model work first. |
| `node tools\check-cases.mjs --wave <wave folder>` | Checks the files of a wave folder. It prints one line for each criterion: "ok", or what is wrong. Without `--wave` it checks the criteria and histories of the repository. | nothing |
| `node tools\adopt-wave.mjs --wave <wave folder> --results <results.json> --dry-run` | Says which criteria of a scored wave folder would be brought into the repository. Without `--dry-run` it brings them in. | the results of a wave run |
| `node tools\prove-records.mjs` | The live proof for records that carry conditions and results (`docs\PROOF_RECORDS.md`). | Ollama. Stop other model work first. |
| `npm run build:replay` | Builds the judges' view, a recorded real run, into `dist-replay\` (section 2b). | nothing |
| `npm run record` | Writes `cases\_demo\recorded-state.json` from the state of the running server, for the judges' view. Run it after `npm run smoke`, while the server still runs. | `npm start`, after a real run |
| `npm run smoke` | The join test. It drives the running server through the whole loop with the real models and checks every answer. Its last round is the long history `long-split.csv`. Add `-- --shots docs\screens` for pictures of the page, and `-- --no-long` to leave out the long history (about one minute less). | Ollama and `npm start` |
| `npm run walk` | Walks through the real page in headless Edge with real clicks: CSV, bell, letter, near miss, PDF, bypass, a picture, a scanned PDF, phone width. It takes pictures. About 7 minutes. Add `-- --no-scan` to leave out the two scans (then about 2 minutes). | Ollama and `npm start` |
| `node tools\run-case.mjs <history.csv>` | Sends one CSV history to the running server and prints what each criterion gave, with seconds, and what the two models cited. It decides nothing. | Ollama and `npm start` |
| `npm run proof` | The engine proof from the first build (`docs\PROOF_ENGINE.md`). | Ollama and `npm start` |
| `node tools\demo-files.mjs make` | Makes `positive.pdf`, `positive-scan.png` and `positive-scan.pdf` again from `positive.csv`. | Microsoft Edge |
| `node tools\demo-files.mjs check-pdf` | Reads `positive.pdf` with the page's own row code and compares the rows with the CSV. | nothing |
| `node tools\demo-files.mjs check-scan` | Has Model 1 read `positive-scan.png` and compares the rows with the CSV. | Ollama, and an idle server |
| `node tools\demo-files.mjs check-scan-pdf` | Checks that every page of `positive-scan.pdf` is a picture with no text. | nothing |
| `node tools\make-demo-cases.mjs` | Writes the three demo CSV files again: `positive.csv`, `near-miss.csv` and `long-split.csv`. | nothing |

`npm run smoke` and `npm run walk` start a clean demo first. The old state is kept as a backup.
They never click Print, Copy or the email link, so the printer, the clipboard and the email program
of this computer are left alone. They need the demo criterion to be in use (see Settings below).

The tools that take pictures start Microsoft Edge without a window, with a throwaway profile in
`data\tmp\` and with browser extensions and sync switched off. In the first walk on 18 November a
small "Gmail" button that is not part of the app showed in the corner of the pictures. It most
likely came from a browser extension on this PC. With extensions off it no longer appears, and the
walk now checks that nothing from outside the app is drawn into the page.

There is one GPU. Run one model job at a time: do not run `npm run eval` while the page is
screening a history.

### The scorer

The answer sheet `cases\expected.json` is in the repository. It is not signed by the clinical reviewer
(`signed_by_clinical_reviewer` is null). A full run uses it by default. It also reads
`cases\expected.further.json` when that file is present. For the three demo histories only:

```
npm run eval -- --sheet cases\_demo\expected.demo.json
```

`npm run eval -- --help` lists the options. `--check` reads the sheet and the histories and calls
no model.

There are three kinds of scored run: a full run, a quick run (`--quick`) and a wave run
(`--wave <folder>`). `docs\SCORING.md` explains them, what PASS means, how a possible finding is
scored, and how a wave folder is brought into the repository. `docs\PROOF_WAVES.md` holds the
first wave runs with the real models.

The demo sheet holds three histories: the positive one, the near miss and the long one. Since the
review the scorer judges the planted lines against the lines the app shows and prints: those of
Model 2 and those of Model 1. A letter that shows none of the planted lines is a FAIL. A letter
that had to be built from the template because Model 3 did not answer is listed as a call that
could not be completed, and the criterion does not pass.

These are the scorer's per-finding letter steps. In the pharmacist's application, code joins all
accepted findings for one patient into one combined letter; the list, preview, print, email and
reply actions act once on that whole letter.

### Settings

| Where | What |
|---|---|
| `lantern.config.json` | The Ollama address, the port, the three model names, the window size, how long a model stays in memory (20 minutes), the reply time for a letter (7 days), and the fictional pharmacy and doctor printed on a letter. |
| `criteria\active.json` | The 583 criteria in use, in order. The list `active` holds the first ten and `further` holds the other 573: the first ten are always screened first, then the further ones in order. The adoption helper adds to `further` only. |
| `$env:PORT` | Another port for the server. |
| `$env:LANTERN_DATA_DIR` | Another folder for the state file. |
| `$env:LANTERN_ACTIVE_FILE` | Another list of criteria. `cases\_demo\active.json` always holds the demo criterion, so the demo and the join tests can still be run after the ten criteria are put in `criteria\active.json`. |

For example, to run the demo criterion with its own state:

```
$env:LANTERN_ACTIVE_FILE = 'cases\_demo\active.json'
$env:LANTERN_DATA_DIR = 'data\demo'
npm start
```

## 5. The ports

All three answer on this computer only (127.0.0.1).

| Port | What |
|---|---|
| 8787 | The app server: the page and everything under `/api`. |
| 5173 | The page with live reload. Only while `npm run dev` runs. |
| 27435 | Ollama, the model runner. |

## 6. What each folder is

| Folder | What is in it |
|---|---|
| `shared\` | `types.ts`: the contract between the page, the server, the model jobs and the scorer. `lines.ts`: the one rule for the lines of a finding, used by the page, the letter and the scorer. `facts.ts`: the one rule for a record that carries conditions and results: which line is a fact, and which finding is a possible finding. |
| `pipeline\` | The three model jobs (screen, double-check, letter), reading a page image, the Ollama client, the CSV reader and the letter checks. |
| `server\` | The local server: the API, the job queue (one job at a time), the state file. |
| `src\`, `index.html`, `public\` | The one page. `src\README.md` says where things are. |
| `dist\` | The built page. Made by `npm run build`. Not kept in git. |
| `dist-replay\` | The judges' view. Made by `npm run build:replay`. Not kept in git. |
| `criteria\` | One folder for each criterion with its `criterion.json`. `active.json` lists the ones in use. `active.proposed.json` is a proposal and is not used by the program. |
| `cases\` | Fictional test histories, one folder for each criterion, and `_clean\`. `expected.proposed.json` is a proposed answer sheet. It is not signed and the scorer does not use it by itself. |
| `cases\_demo\` | The demo files of section 2, the demo answer sheet `expected.demo.json`, the demo list `active.json`, the records of the real runs of 18 November, and `recorded-state.json`, the recording that the judges' view plays. |
| `eval\` | The scorer: full, quick and wave runs, and the rules of the adoption helper. `eval\results\<time>\` holds each run: `table.md`, `results.json` and the raw answers. |
| `tools\` | Start and helper scripts. `dev.mjs` (working mode), `smoke.mjs` (join test), `page-walk.mjs` (walk through the page), `record-run.mjs` (the recording for the judges' view), `run-case.mjs` (one history), `demo-files.mjs` and `make-demo-cases.mjs` (sample files), `proof-engine.mjs` (engine proof), `prove-records.mjs` (proof for records with conditions and results), `edge.mjs` (starts Edge without a window), `extract-criteria.mjs` and `check-cases.mjs` (for the criteria and the test histories), `adopt-wave.mjs` (brings a scored wave folder into the repository). |
| `docs\` | `SPEC.md` (what is being built, now version 2 with section 6a), `REVIEW_FIXES.md` (what the review found and what was done), this file, `SCORING.md` (how the scoring works), `PROOF_ENGINE.md`, `PROOF_RECORDS.md` and `PROOF_WAVES.md` (what was run with the real models), the criteria sheets, and `screens\` with the pictures of the page. `FOUNDER_DESIGN.md`, the founder's own words, is on this PC but is held out of git by `.gitignore` until the founder decides (see `REVIEW_FIXES.md`, finding 14). |
| `data\` | Made by the server. `state.json` is everything that happened. `backups\` holds the dated backups. `images\` holds page images of a scan until its rows are confirmed. `tmp\` and `logs\` are scratch space of the tools. Not kept in git. |
| `node_modules\` | The installed packages. Not kept in git. |

Outside the repository: `C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime` holds Ollama, the three
models and the start and stop scripts.

## 7. Timings measured on 18 November 2026

All times are in seconds, on this PC, with the real models, thinking off. The demo history has
45 lines and one criterion was in use (the demo criterion), unless a row says otherwise.
Each stage has to change the model in memory first. Seen from outside, that change took about
6 to 11 seconds every time.

**The loop through the server** (`npm run smoke`, three runs: 08:20, 08:22 and 09:22)

| Step | Seconds | Of which |
|---|---|---|
| Import to "screened": Model 1, one criterion | 13.0 to 14.2 | loading Model 1: about 8 to 11 |
| Double-check: Model 2 | 16.3 to 18.4 | loading Model 2: about 6 to 10 |
| Import to "confirmed", when the bell badge shows | 29.6 to 31.3 | both of the above |
| Accept to "letter ready": Model 3 | 10.0 to 12.2 | loading Model 3: about 8 to 10 |
| Near miss: import to clear | 13.5 to 14.7 | loading Model 1: about 10 |
| One Model 1 call when Model 1 is already in memory | 4.5 to 6.5 | nothing to load |
| The whole run: 3 histories, 1 letter, every pharmacist step | 78 | 90 to 95 when it also takes 12 pictures |

**The other ways in** (`npm run walk`, six runs between 08:34 and 09:22, one of them the scanned PDF
alone, and one run of `node tools\demo-files.mjs check-scan` at 08:28)

| Step | Seconds | Result |
|---|---|---|
| PDF with text, 2 pages: the page reads the rows | under 1 | 50 rows, 45 of them supplies, no model needed |
| PDF with text: import to "confirmed" | 21.8 to 23.1 | the same finding |
| Picture of 45 rows (1754 by 1240): Model 1 reads the rows | 145 to 149 | 45 of 45 rows exact, in 5 runs out of 5 |
| Scanned PDF, 2 pages, 23 and 22 rows: Model 1 reads the rows | 132 to 135 | 45 of 45 exact in 2 runs after a fix. 44 of 45 in the one run before it (section 9). |
| After the rows are confirmed: screening and double-check | 23.1 to 24.4 | the same finding |
| The whole walk, 42 checks, 30 pictures | 432 to 441 | The two scans take about 330 of these. |

**More than one criterion** (a trial at 09:09 with the ten proposed criteria, which are not signed and
not in use; one 37-line history, `cases\STOPP-C10\pos-brand.csv`)

| Step | Seconds |
|---|---|
| Model 1, ten criteria, one after another | 37.0 in all: 13.2 for the first (with loading), then 2.0 to 3.7 each |
| Model 2, one suspected finding | 34.9 in that run. It wrote far more than it was asked for (section 9). The same call took 4.4 to 5.0 when it was repeated, and about 13 with loading. |
| Import to "every suspected finding checked" | 71.9 |

**The scorer** (`npm run eval -- --sheet cases\_demo\expected.demo.json`, 08:30): 39 in all.
Two screen calls, 6.5 and 4.5. One double-check, 17.7. One letter, 10.6.

**Without a model**

| Step | Seconds |
|---|---|
| `npm run typecheck` | 1 |
| `npm test` on 20 November 2026 at 10:31: 1692 tests in 112 files | 57.79 |
| Dated history, 18 November 2026: `npm test`, 808 tests in 44 files after section 6a was joined (536 tests in 28 files after the review, 347 tests in 21 files before it) | 5 |
| `npm run build` | 2 |
| `npm run build:replay` | 2 |
| `npm start` until the page answers | under 1 |
| A restart in the middle of a screening: from the restart to the confirmed finding | about 26 |

Starting Ollama itself was not timed today. It was already running, and it was left running.

**After the review** (the join test at 11:12, 11:47 and 12:00; the walk at 11:18, 11:27, 11:38 and
11:53). The answer forms now ask for the explanation before the yes or no, and the join test has
one more round, the long history.

| Step | Seconds | Result |
|---|---|---|
| Import to "confirmed", when the bell badge shows | 27.2 to 33.4 | |
| Accept to "letter ready": Model 3 | 10.6 to 12.5 | |
| Near miss: import to clear | 14.3 to 16.3 | |
| Long history, 310 lines in 3 parts, one criterion: Model 1 | 49.7 to 54.1 | three calls for the parts and one call for the 36 listed lines |
| Long history: import to "second check done" | 63.2 to 70.8 | the finding is confirmed with L032 and L309 |
| The whole join test: 4 histories, 1 letter, 47 checks, 12 pictures | 149 to 169 | |
| PDF with text: import to "confirmed" | 26.8 to 27.7 | the same finding |
| Picture of 45 rows: Model 1 reads the rows | 145 to 149 | 45 of 45 rows exact in every run |
| Scanned PDF, 2 pages: Model 1 reads the rows | 133 to 139 | 45 of 45 rows exact in every run |
| After the rows are confirmed: screening and double-check | 20.6 to 24.7 | the same finding |
| The whole walk, 42 checks | 436 to 446 | |
| The scorer on the demo sheet, three histories (11:16) | 93 | PASS, caught 2 of 2 |

**The scorer on many criteria** (13:38 to 14:50, after the parts for section 6a were joined).
The criteria were not signed and not in use: the ten proposed ones in a private copy, and three
drafted wave folders scored where they are. More in `docs\SCORING.md`, section 6.

| Run | Model calls | Seconds |
|---|---|---|
| Quick run, the ten proposed criteria, 33 histories | 87 to screen, 21 to double-check, 20 letters | 705 (11 min 45 s), and 734 when it was run again at 14:38 |
| Wave run, three wave folders in one run, 24 criteria, 67 histories | 67 to screen, 43 to double-check, 43 letters | 959 (15 min 58 s), and 957 when it was run again at 14:10 |
| One wave folder of eight criteria, inside that run | 19 to 24 to screen, 11 to 16 to double-check, 11 to 16 letters | 250 to 359 |
| One screen call in a quick or wave run | | 5.3 to 7.1 on average |
| One double-check | | 8.7 to 9.2 on average |
| One letter | | 2.4 to 2.8 on average |

## 8. If something goes wrong

| What you see | What to do |
|---|---|
| The page says "The local server is not answering." | The server window was closed or stopped. Run `npm start` again. The page finds it by itself. |
| The bottom of the page says "The local models are not running." | Run `start-ollama.ps1` (step 1). |
| `npm start` says "Port 8787 is already in use." | The server is already running in another window. Use that one, or stop it first. |
| `npm start` says "Criteria: NOT LOADED." | A file named in `criteria\active.json` is missing or broken. The message names it. |
| The page shows the words "The page has not been built yet." | Run `npm run build`, then reload the page. |
| A second `npm start` by mistake | It ends with the same message and changes nothing. The first server and its state file are left alone. |
| A history shows "Cannot assess: (reason)" | The file could not be read safely, so it was not screened. The reason says what is wrong, for example a row with no date, or more than 1,000 lines. |
| A criterion shows "could not be screened", or the first screen says "1 history was not fully screened" | A model call failed twice, or the screening was interrupted. This is not a clear result. Open the import panel and click **Screen again what has no result** on that history. |
| The rows of a scan cannot be confirmed | A row has no date that can be read. The message names the line. Click **Correct a row**, fix the row, and confirm again. Or click **Discard this scan** and import a clearer one. |
| A finding is marked "Second check not completed" | Model 2 failed twice. The finding is shown so that it is not missed. Decide on it as usual. |
| A finding is marked "Second check unclear" | Model 2 answered no, but named lines as proof. The finding is shown so that it is not missed. Read the lines and decide. |
| The first screen shows "Problem at (time): ..." | A step reported a problem in the last quarter of an hour. The full text is in the activity log at the foot of the page. |
| The log says "The state file could not be written." | The server keeps working and tries again every second. Nothing is lost while the server runs. Check that `data\state.json` is not open in another program and that the disk is not full. The log says when it can be written again. |
| The server says a saved state could not be read | The file is kept as `data\state-unreadable-<time>.json` and the server starts clean. Nothing is deleted. |
| A job was running when the server stopped | Start the server again. It marks the job as interrupted and picks the work up by itself. |
| A step stops with an error nobody expected | The server starts it again by itself, up to two more times. After that a second check goes to the bell as "not completed", a letter says it could not be drafted, and a screening stays "interrupted" with the "Screen again" button. |

## 9. What was run when the parts were joined

The server with the model jobs, the page and the scorer were written separately against
`docs\SPEC.md` and `shared\types.ts`. On 18 November they were run together with the real models.

| What | Result | Where to look |
|---|---|---|
| `npm run typecheck`, `npm test`, `npm run build` | Clean. 21 test files, 347 tests pass. | run them |
| The whole loop through the API: `npm run smoke` | 42 of 42 checks at 09:22 | `cases\_demo\join-run-2026-11-18.json`, `docs\screens\live-01` to `live-12` |
| The whole loop through the real page, with real clicks: `npm run walk` | 42 of 42 checks at 09:14. No error on the page. | `cases\_demo\page-walk-2026-11-18.json`, `docs\screens\live-walk-*` |
| A PDF with text | The page's own code read 45 of 45 supply rows exactly. | `node tools\demo-files.mjs check-pdf` |
| A picture and a scanned PDF | Model 1 read 45 of 45 rows exactly from each. | the walk record |
| The printed letter | One A4 page, only the letter. | `docs\screens\live-walk-print-letter-a4.pdf` |
| The scorer on the two demo histories | PASS, 1 criterion of 1: caught 1 of 1, 0 false flags, the letter written by the model | `eval\results\20261118-083049\table.md` |
| The server stopped in the middle of a screening (09:08), then started again | The job was marked as interrupted, screening started again by itself, and the finding was confirmed. | on this PC only: `data\backups\state-2026-11-18T09-14-44.json` |
| `npm run dev` | Works, after the fix below. | |
| Ten proposed criteria on one history (a trial, with its own server and state) | Ten criteria screened in one job. STOPP C10 was suspected and confirmed. Nine were clear. | `cases\_demo\trial-ten-proposed-criteria-2026-11-18.json`, `docs\screens\trial-ten-proposed\` |

Every call the page makes matched the server: no route, field name or state had to be changed.

**Fixed while joining**

- `npm run dev` stopped with an EBUSY error, because the live page watched the `data\` folder while
  it was in use. It no longer watches it (`vite.config.ts`).
- A scanned PDF page that lies on its side was drawn at about 106 dots per inch, not 150. Model 1
  then read one date wrongly in 45 rows: 7 July for 6 July. The page is now drawn at 150 dots per
  inch, and the two runs since then read 45 of 45 (`src\lib\pdf.ts`).
- A pop-up about a finding stayed on top of the bell panel after the bell was opened by its icon.
  A pop-up now goes away when its panel opens.
- The picture of a scan beside the rows was too small to read. It can now be shown at full size.
- In the list of letters a patient label was broken in the middle of "F-001". The status now moves
  under the label.
- A real letter from Model 3 ran one line onto a second A4 page when printed. It now fits one page.

**Limits seen on 18 November, still open**

The review of the first build found more, and most of it is fixed: see `docs\REVIEW_FIXES.md`.
Its last part lists what is still open, with the reason. The limits below are the ones seen when
the parts were joined. Each says where it stands now.

- On 18 November only the demo criterion was in use and only the demo answer sheet was scored. The
  repository now lists 583 criteria in `criteria\active.json`, and `cases\expected.json` exists but
  is not signed by the clinical reviewer.
- In the trial with the ten proposed criteria, Model 2 once wrote its working-out, about 2,600
  characters, into "What the second check says matches", and took 35 seconds. Since the review the
  answer form limits this text to 700 characters, and the model writes its explanation before its
  yes or no.
- In the same trial both models pointed at an Eliquis supply in January and a Mobic supply in June,
  160 days apart, as the matching lines. Nearer pairs are in the history. The finding is right, but
  the lines shown are not the best evidence. The bell panel now heads the list "Lines the models
  pointed to" and asks the pharmacist to check them. Whether code may check the dates is the
  founder's decision.
- A history from a PDF has no patient reference, age or sex: the page shows "Fictional patient".
  The title and the heading rows of the PDF become numbered lines of the history.
- A table cell that wraps onto a second printed line in a PDF becomes a row of its own. The sample
  PDF has no wrapped cell.
- Only clean pictures drawn by a computer were read. A real scan of paper, or a photo, was not
  tested. The one wrong date above shows why the pharmacist's check of the rows matters.
- Not seen with the real models: a second letter draft, a letter built from the template, a retry
  after a model crash, an overdue letter, a criterion that could not be screened, and a second
  check marked "unclear" or "not completed". These paths are covered by the unit tests with
  stand-in models.
- The walk does not click Print, Copy or the email link. It uses the file chooser, not drag and drop.
- The page was tested in Microsoft Edge without a window. After the review some things were also
  checked by hand in a second browser of the same family, in the sample view and the recorded
  view: the keyboard, typing in a letter, the phone widths and the place of the pop-ups. The page
  was not tried in Firefox or Safari.
- A letter can be marked as sent without the tick for the patient's agreement. The page warns and
  the log records it. Whether to allow this is the founder's decision.

At the end of the join the app server was stopped and Ollama was left running. What `data\state.json`
holds now is said at the end of section 10.

## 10. What was run after the review

Three reviewers read the first build and reported 36 findings. `docs\REVIEW_FIXES.md` lists each
one, what was done, the test that covers it, and what is left open. After the fixes this was run,
on the final code:

| What | Result | Where to look |
|---|---|---|
| `npm run typecheck`, `npm test`, `npm run build`, `npm run build:replay` | Clean. 28 test files, 536 tests pass. Both builds are made. | run them |
| The whole loop through the API: `npm run smoke` | 47 of 47 checks at 12:00, in 169 seconds. The last 5 checks are the long history. | `cases\_demo\review-fix-run-2026-11-18.json`, `docs\screens\live-01` to `live-12` |
| The whole loop through the real page, with real clicks: `npm run walk` | 42 of 42 checks at 11:53, in 436 seconds. No error on the page. Model 1 read 45 of 45 rows exactly from the picture and from the scanned PDF. | `cases\_demo\review-fix-walk-2026-11-18.json`, `docs\screens\live-walk-*` |
| The scorer on the three demo histories (11:16) | PASS, 1 criterion of 1: caught 2 of 2, 0 false flags, 0 failed calls, both letters written by the model | `eval\results\20261118-111622\table.md` |
| A sample of six proposed criteria on 18 histories with the new answer forms (10:42). They are not signed and not in use. | 12 of 12 planted findings caught with the planted lines shown, 6 of 6 near misses clear, 0 false flags | `cases\_demo\review-fix-sample-2026-11-18.json` |
| The judges' view | Built from the recording of the join test above. Looked at in a browser: it plays by itself to step 26 of 26 and calls no server. | `dist-replay\`, `cases\_demo\recorded-state.json` |
| The sample view | Its ten pictures were taken again, and one was added: an open letter at phone width. | `docs\screens\mock-*` |

The join test and the walk also passed on every earlier run after the fixes: the join test at 11:12
and 11:47, the walk at 11:18, 11:27 and 11:38.

At the end the app server was stopped and Ollama was left running. `data\state.json` holds the end
of the last join test: four histories, one closed letter, one bypass, and the finding of the long
history waiting under the bell. "Start a clean demo" clears it and keeps a backup.

## 11. What was run when the parts for section 6a were joined

On the afternoon of 18 November three pieces were built side by side for section 6a of
`docs\SPEC.md`: the engine, the scorer and the page. Then they were joined and run with the real
models. `docs\PROOF_WAVES.md` has the whole account. Every result is kept under
`C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\`.

| What | Result | Where to look |
|---|---|---|
| `npm run typecheck`, `npm test`, `npm run build`, `npm run build:replay` | Clean. 44 test files, 808 tests pass. Both builds are made. | run them |
| Regression on the ten proposed criteria: a quick scored run in a private copy, at 13:38 and again on the final code at 14:38 | 10 of 10 PASS both times. 20 of 20 planted findings caught, 0 false flags, 0 failed calls. | `regression-first-ten\table.md`, `regression-first-ten-run2\table.md` |
| Three drafted wave folders (W105, W114, W146) in one wave run, at 13:50 and again on the final code at 14:10 | 24 of 24 PASS both times. 43 of 43 planted findings caught: 16 with the fact line cited, 11 as possible findings, 16 from the supplies alone. 24 of 24 near misses kept from the bell. | `waves-W105-W114-W146-run1\table.md`, `waves-W105-W114-W146-run2\table.md` |
| The adoption helper, dry run on W105 in the repository | 8 criteria would be adopted. Nothing was written. | `docs\PROOF_WAVES.md`, section 8 |
| The adoption helper for real, W114 into a private copy of the repository | 8 adopted. A second run changed nothing. The case check of the copy called all 27 criteria ok. | the same |
| The page and the server of that copy, with 18 criteria in use (port 8797, its own state folder) | A record with results gave a finding, with its result lines marked RESULT under the bell. A record with no line about the fact gave a possible finding under the bell, and a letter written by the model that asks the doctor to confirm. | `app-join\`, `docs\screens\records-live-bell-fact-lines-and-possible-1366x2300.png` |
| The join test and the walk through the page, against a second server of the copy with the demo criterion (port 8798) | `tools\smoke.mjs`: 44 of 44 checks in 155 seconds. `tools\page-walk.mjs --no-scan`: 32 of 32 checks in 111 seconds, no error on the page. | `app-join\smoke-demo-criterion.json`, `app-join\page-walk-demo-criterion.json` |

Without `--shots` the join test makes 44 checks. The 47 of section 10 include three checks that
are made only when it takes pictures.

One thing was changed in the engine while joining. When the first draft of a letter fails the
wording check, the request for the second draft now names the words the check looks for inside a
sentence, and says that a question ends with a question mark. Before
that, 7 of 63 letters in these runs were built from the template, each because of the word
"should" or "is to be" taken from the criterion's own text. After it, none was.

The repository's own `criteria\active.json` and `data\state.json` were not touched: every run with
other criteria was made in a private copy or on a wave folder in place. At the end the two test
servers were stopped and Ollama was left running.
