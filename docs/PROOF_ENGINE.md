# ClinicaLANTERN engine: live proof

Wednesday 18 November 2026, 07:26 to 07:51 (Sydney time), on the founder's PC.

This file says what happened when the local server and the three model jobs were run with the
real models. Fictional patients only. No real person is in any of this.

The engine is: `pipeline/` (the three model jobs, the Ollama client, the CSV reader, the letter
checks) and `server/` (the API, the job queue, the state file). The page was not part of this
proof. The proof script played the pharmacist by calling the API.

## 1. The result in one look

| What | Result |
|---|---|
| Final proof run | 07:47:48 to 07:50:21. **28 of 28 checks passed.** |
| Positive history (45 lines, Celebrex with Xarelto) | Model 1 suspected it. Model 2 confirmed it. Both Celebrex lines were cited. |
| Letter | Model 3 wrote it. The first draft passed every check. No template was needed. |
| Pharmacist steps | Edit saved, patient agreement recorded, marked as sent, reply recorded, closed. |
| Near miss (43 lines, Xarelto but no NSAID) | Ended clear. Nothing went to the bell. |
| Scanned page (extra) | Model 1 read 22 of 22 rows exactly. After the rows were confirmed the finding was confirmed. |
| Restart in the middle of screening (extra) | The job became interrupted. Screening picked up by itself and finished. |
| One model in memory at a time | Yes. Ollama was asked four times a second. It never held two. |
| Unit tests | 168 tests in `pipeline/` and `server/`, all passing. No model is needed for them. |
| Type check | Clean. |

The record of the final run is kept in `cases/_demo/recorded-run-2026-11-18.json`.

## 2. What was run

- Ollama 0.40.15 at `http://127.0.0.1:27435`, loopback only. Models: `lantern-screen`,
  `lantern-check`, `lantern-letter`. Thinking off. Temperature 0, seed 42, window 16,384 tokens.
- The server: `node server/index.ts` on port 8787, bound to 127.0.0.1.
  For the proof it was started with `LANTERN_ACTIVE_FILE=cases\_demo\active.json` (the demo
  criterion only) and `LANTERN_DATA_DIR=data\proof-engine` (its own state file).
- The criterion: `criteria/DEMO-NSAID-ANTICOAG`. It is a test stand-in written by the entrant.
  It is not a published criterion and it is not one of the ten.
- The histories: `cases/_demo/positive.csv` (45 supply lines; Celebrex on L036 and L041, Xarelto
  every month) and `cases/_demo/near-miss.csv` (43 lines; the same history without Celebrex).
- The proof script: `tools/proof-engine.mjs` (`npm run proof`).

## 3. The final run, step by step

Times are seconds from the start of the run (07:47:48). Each stage had to change the model in
memory, so these are the slow case. "Model in memory" is what Ollama reported.

| At | What the server said | Model in memory |
|---|---|---|
| 0.1 s | Model 1 is screening: criterion 1 of 1 | lantern-check (left from an earlier test) |
| 0.4 s | | none: the model is being changed |
| 8.8 s | | lantern-screen |
| 14.2 s | Model 2 is double-checking 1 finding | |
| 14.4 s | | none: the model is being changed |
| 21.1 s | | lantern-check |
| 31.1 s | Idle. The finding is confirmed and the bell badge shows 1. | |
| 31.1 s | (the proof script accepts the finding) Model 3 is writing 1 letter | |
| 31.4 s | | none: the model is being changed |
| 42.0 s | | lantern-letter |
| 43.9 s | Idle. The letter is ready and the letter badge shows 1. | |
| 43.9 s | (near miss imported) Model 1 is screening: criterion 1 of 1 | |
| 44.2 s | | none: the model is being changed |
| 54.5 s | | lantern-screen |
| 58.2 s | Idle. The near miss is clear. | |
| 58.2 s | (page image imported) Model 1 is reading a scanned page: page 1 of 1 | lantern-screen |
| 126.9 s | Idle. 22 rows are waiting for the pharmacist to confirm. | |
| 126.9 s | (rows confirmed) Model 1 is screening: criterion 1 of 1 | |
| 134.4 s | Model 2 is double-checking 1 finding | |
| 135.0 s | | none: the model is being changed |
| 145.6 s | | lantern-check |
| 152.7 s | Idle | |

### Timings

| Step | Model | Seconds | Of which changing the model |
|---|---|---|---|
| Screen the positive history (45 lines, 1 criterion) | lantern-screen | 14.0 | about 8.4 |
| Double-check the finding | lantern-check | 16.8 | about 6.7 |
| Write the letter | lantern-letter | 12.8 | about 10.6 |
| Screen the near miss (43 lines) | lantern-screen | 14.2 | about 10.3 |
| Read one scanned page (22 rows) | lantern-screen | 68.7 | 0 |
| Screen the 22 rows read from the scan | lantern-screen | 7.2 | 0 |
| Double-check that finding | lantern-check | 18.3 | about 10.6 |

When the right model was already in memory the same screening call took 5.9 s (run at 07:26) and
6.5 s (run at 07:43). Import to "confirmed" took 31.0 s in the final run and 24.7 s at 07:43.

## 4. The positive history

**Model 1 (screen), 14.0 s.** Suspected: yes. Lines L030, L035, L036, L040, L041, L045.
Medicines: rivaroxaban, celecoxib. Its reason:

> The patient was supplied celecoxib (an NSAID) while also being supplied rivaroxaban (an oral
> anticoagulant) within 60 days.

Celebrex is on L036 and L041. Both were cited. Every line ID it gave exists in the history.

**Model 2 (double-check), 16.8 s.** Confirmed: yes. Same six lines. What it said matches:

> The patient was supplied rivaroxaban (Xarelto) on 2026-07-08 (L030), 2026-08-08 (L035),
> 2026-09-08 (L040), and 2026-10-08 (L045), which overlaps with supplies of celecoxib (Celebrex)
> on 2026-08-21 (L036) and 2026-09-20 (L041).

What it said cannot be seen:

> A dispensing history does not show whether the patient actually took the medications, the
> specific timing of doses relative to each other, or any clinical contraindications or protective
> measures (such as PPI co-prescription) that might mitigate the bleeding risk.

**Model 3 (letter), 12.8 s.** Origin: model. Check notes: none. This is the letter as drafted.
The three paragraphs after "Dear Doctor," are the model's. Code built everything else.

```
Example Community Pharmacy (fictional)
1 Example Street, Exampletown
Phone: (00) 0000 0000
Pharmacist: The pharmacist on duty

18 November 2026

To: Dr F. Example (fictional)
Example Family Practice

Patient: Fictional patient F-001, female, 72 years
Fictional patient. No real person.

Re: Clinical query regarding Celebrex and Xarelto for Fictional patient F-001

Dear Doctor,

I am writing to note that this 72 year old female patient is being supplied a non-steroidal anti-inflammatory drug (NSAID) alongside an oral anticoagulant. This combination may increase the risk of major bleeding.

The patient has been supplied Xarelto 20 mg tablet on 8 July 2026, 8 August 2026, 8 September 2026, and 8 October 2026. Additionally, Celebrex 200 mg capsule was supplied on 21 August 2026 and 20 September 2026.

Could you please review whether the NSAID is still needed while the anticoagulant continues, and assess the patient's risk of bleeding? Please let us know if you require any further information.

The criterion this is based on
Demo criterion (NSAID with an anticoagulant): A non-steroidal anti-inflammatory drug (NSAID) supplied to a person who is also being supplied an oral anticoagulant (risk of major bleeding).
Source: Test wording written by the entrant for this prototype. It is not a published criterion.

Dispensing lines from our records
2026-07-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example
2026-08-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example
2026-08-21 | Celebrex 200 mg capsule | qty 30 | repeats 2 | Take ONE capsule daily with food | Dr G. Sample
2026-09-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example
2026-09-20 | Celebrex 200 mg capsule | qty 30 | repeats 1 | Take ONE capsule daily with food | Dr G. Sample
2026-10-08 | Xarelto 20 mg tablet | qty 28 | repeats 5 | Take ONE tablet daily with food | Dr F. Example

What a dispensing history cannot show
Why the anticoagulant was started, kidney function, any history of bleeding, and any pain or stomach medicines bought without a prescription.

Yours sincerely,

The pharmacist on duty
Example Community Pharmacy (fictional)

Drafted by a local AI model, reviewed and edited by the pharmacist.
```

All six dates in the model's paragraph are in the cited lines. In the model proof earlier this
morning the same letter model wrote one wrong date. Two things were changed after that: the model
is now given each date already written out ("21 August 2026") and told to copy it, and code checks
every date, amount and medicine name afterwards. In four live runs today the first draft passed
each time. The second-draft and template paths were proven in the unit tests, not live.

## 5. The pharmacist's steps

The proof script made these calls. Each one answered as it should.

| Call | Answer |
|---|---|
| `POST /api/findings/F0001/seen` | The bell badge went from 1 to 0. |
| `POST /api/findings/F0001/decision` with bypass and no reason | Refused (400): "Please give a short reason for bypassing this finding." |
| `POST /api/findings/F0001/decision` with accept | The finding became accepted. A letter was queued. |
| `POST /api/letters/T0001/seen` | The letter badge went from 1 to 0. |
| `PUT /api/letters/T0001` | The edit was saved. The letter is marked as edited. The first draft is kept beside it. |
| `POST /api/letters/T0001/agree` | Recorded: discussed with the patient, the patient agrees. |
| `POST /api/letters/T0001/sent` with print | Status sent. A reply is due in 7 days. |
| `PUT /api/letters/T0001` again | Refused (409): "This letter was already sent. It can no longer be changed." |
| `POST /api/letters/T0001/reply` | Status reply recorded. |
| `POST /api/letters/T0001/close` | Status closed. |

The counts at the end: histories screened 3, findings confirmed 2, accepted 1, bypassed 0, letters
sent 1, replies recorded 1, closed 1, overdue 0. The bell badge was 1 (the finding from the scan,
not yet seen). Every step is in the activity log, with its time and its model.

## 6. The near miss

The same history without Celebrex. Xarelto is still there, and so is Panadol Osteo.
Model 1 answered: not suspected. The criterion ended **clear** in 14.2 s (about 10.3 s of that was
changing the model). No finding was made, so Model 2 was not called and nothing went to the bell.

## 7. A scanned page (extra)

The page image from this morning's model proof was used: a printed table with 22 rows of the same
fictional history. It was read from the runtime folder and not copied into the repository.

- Import as `pdf-image`. Nothing was screened yet. Model 1 read the page in 68.7 s.
- **22 of 22 rows** came back, each one the same, letter for letter, as the matching CSV line:
  date, medicine, strength, form, quantity, repeats, directions and prescriber.
- The case waited with "read from a scan: please check". After
  `POST /api/cases/C0003/confirm-transcription` it was screened (7.2 s) and double-checked
  (18.3 s). The finding was confirmed with lines L013, L017 and L018 (Celebrex, Xarelto, Celebrex).
- The page image is kept in a file beside the state until the rows are confirmed. Then it is removed.

This was one clean page made on a computer. A real scan or a photo is harder. That was not tested.

## 8. A restart in the middle of screening (extra)

07:50:36 to 07:51:10, after the final run, same code.

1. The positive history was imported. Three seconds later the server said
   "Model 1 is screening: criterion 1 of 1".
2. The server process was killed at 07:50:41. On disk: job J0001 running, screening running, no
   finding yet.
3. The server was started again. It marked J0001 as "Interrupted. The server stopped while this
   was running.", queued a new screening job and started it by itself. The activity log says:
   "The server stopped while Model 1 was screening positive.csv. Screening picks up at criterion
   1 of 1."
4. 28.6 s after the restart the server was idle. The finding was confirmed with the same six lines.

With one criterion there is only one place to pick up from. Picking up at the right criterion out
of several (and keeping the results of the ones already done) is proven in the unit tests.

## 9. Other things measured with the real models

**The history is read once, then reused.** Three screening calls on the same 45-line history with
only the criterion block changed. Each prompt was 2,788 tokens. Reading it took 2.44 s the first
time, then 1.00 s and 0.78 s. Each answer took 3.2 s. A whole call took 4.2 s and 4.0 s once the
model was in memory. So ten criteria on a history of this size should take about 40 s after the
model is loaded. That was worked out, not run: there is one criterion on disk today.

**Size.** 150 demo lines are 8,214 tokens for the screen model and 8,397 for the check model.
That is half of the 16,384 token window.

**A history that is too long for one call. This one matters.** As a test, 389 lines were sent to
Model 1 in a single call, going around the part splitter. Ollama gave no error. It read only
8,195 tokens and dropped the start of the history. Celebrex was in the part that was dropped, and
the model answered "no finding". That is a silent miss. The engine now guards against it twice:

1. A part is limited by its size as well as by its line count, so a prompt cannot outgrow the window.
2. After every screen and check call, code compares what was sent with what Ollama says it read.
   If the prompt was cut, the call counts as "could not be screened". It is never "clear".

The same 389 lines through the real path (three overlapping parts) took 28.2 s and came back
suspected, citing L036 (Celebrex) and L040 (Xarelto).

**Long histories, forced.** With the limit lowered to 20 lines the 45-line history was screened in
three overlapping parts (13.3 s) and came back suspected with the same six lines. The double-check
then read only the part that holds those lines (16.9 s) and confirmed.

**Failures.** With the server address pointed at nothing, a screen call came back after 2.0 s as
"Tried twice. The local model server did not answer." That is "could not be screened", not "clear".
With a model name that does not exist, the double-check came back after 2.0 s with
`completed: false`, and the finding stays on show marked "second check not completed".
More than 20 model changes were made today. None crashed, so the retry was not seen recovering
from a real CUDA crash. It is covered by the unit tests.

**The server's guards.** A request for `/..%2f..%2fpackage.json` got 403. A `POST /api/reset`
that said it came from another website got 403. A request that used another host name got 403.
A body of 41 MB got 413.

## 10. Tests without a model

`npm test` runs them. For the engine: 11 test files, 168 tests, all passing at 07:53.
`npm run typecheck` is clean.

| Area | What the tests pin down |
|---|---|
| CSV reader | Quoted fields, commas and line breaks inside quotes, CRLF, a BOM, header in any order, extra columns, day-first dates, blank rows, every "cannot assess" reason, the two demo files. |
| Line-ID guard | IDs that do not exist are dropped. A suspected finding is never dropped: with no valid line it goes on, marked "lines not verified". |
| Long histories | Overlapping parts cover every line. Merging: suspected in any part means suspected. A part that failed is never "clear". A cut prompt is never trusted. |
| Double-check | The lopsided wording. A call that fails twice gives `completed: false` and keeps the lines. It never throws. |
| Letter fact check | Catches the wrong date from the model proof (20/10/2026). Catches an invented medicine, a wrong strength, a wrong quantity, a made-up length of time. Passes a correct letter with dates written four different ways. |
| Letter | Every part of the letter is there and in order. One redraft that names the mismatch. Then the template, which says so. It never throws. |
| Ollama client | The options from the model proof. One retry after 2 seconds, never a third try. Cut-off, empty, non-JSON and wrong-shape answers are refused. One call at a time. |
| State store | Round trip. Whole-file writes with no temporary file left behind. An unreadable state file is kept and a clean state started. Reset keeps a dated backup. |
| Resume | A job left running becomes interrupted. Screening picks up at the first criterion not finished and keeps the earlier results. Checks and letters start again. |
| Queue | Every waiting history is screened with Model 1 before Model 2 checks anything. |
| API over HTTP | A whole case through real HTTP calls with stand-in models. Error codes and plain messages. The 40 MB limit. Path traversal. Other websites and other host names are refused. |

## 11. What this proof does not show

- **How well the models screen.** One test criterion, two short histories and one page image show
  that the engine works from end to end. They do not measure misses or false flags. That is the
  scorer's job (`npm run eval`) with the ten real criteria and the signed answer sheet.
- **Ten criteria in one job, live.** The order of calls was proven with stand-in models. The live
  runs had one criterion.
- **The second letter draft and the template, live.** The first draft passed in all four live runs.
- **A real scan or photo.** Only a clean computer-made page image was read.
- **PDFs with text.** The page reads those. The server side (rows in, numbered lines out) is
  covered by unit tests only.
- **The medicine-name check in letters is a net, not a guarantee.** It uses a list of common names,
  word endings that mark a medicine name, any word written just before a strength, and the names in
  the patient's own history. A made-up name that fits none of these would pass.
- **Long histories are slower than they need to be.** A history in several parts is screened
  criterion by criterion, so the model re-reads a part on every call: about 9 s a part instead of
  about 4 s. The results are the same. It can be made faster later.

## 12. How to repeat it

```
powershell -NoProfile -File %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\start-ollama.ps1

$env:LANTERN_ACTIVE_FILE = 'cases\_demo\active.json'
$env:LANTERN_DATA_DIR = 'data\proof-engine'
npm start

# in a second window
npm run proof -- --out data\proof-engine\run.json
```

Add `--scan <a page image.png>` to include the scanned page. The proof resets the server's state
first. The server keeps the old state as a dated backup in the `backups` folder beside it.

## 13. Earlier runs today

| Time | What | Result |
|---|---|---|
| 07:07 | Pipeline only: screen the two demo histories | Positive suspected (12.1 s with the model load). Near miss clear (4.4 s). |
| 07:26 | First proof run through the server | Screen, check and letter worked. The run stopped there because of a mistake in the proof script, not in the server. The script was fixed. |
| 07:27 | Proof run | 28 of 28. |
| 07:33 | Restart test | Passed. |
| 07:43 | Proof run | 28 of 28. |
| 07:47 | Final proof run, final code | 28 of 28. This is the run written up above. |
| 07:50 | Restart test, final code | Passed. |

The engine code changed between these runs: plainer error wording, the two guards for histories
that are too long, and a guard so that scanned rows cannot be confirmed while they are still being
read. The 07:47 and 07:50 runs used the code as it now stands.

My server was stopped at the end. The Ollama server was left running.
