# ClinicaLANTERN: how the scoring works

Written on Wednesday 18 November 2026. Fictional patients only. No real person is in any test history.
The stage is "Prototype". A scored run is one measured run on one computer. It is not a validation.

The scorer runs the test histories through the three local models and writes a results table.
It works in three stages, so each model is loaded once: Model 1 screens everything, then Model 2
double-checks every suspected finding, then Model 3 writes a letter for every caught finding.
A call that fails never stops the run, and it is never counted as a clean result.

The scorer goes on judging one letter step for each caught finding. The pharmacist's application
shows something different: code assembles the accepted findings for one patient into one combined
letter, with numbered parts, one head, one "Dear Doctor,", one ending and one signature.

Run every command in PowerShell, in the repository folder. Ollama must be up (`docs\RUNNING.md`,
section 1). There is one graphics card: run one scored run at a time, and not while the page is
screening a history.

```
cd %USERPROFILE%\ClinicaLANTERN-Lantern
```

## 1. The three kinds of run

| Run | Command | What is screened |
|---|---|---|
| Full | `npm run eval` | Every criterion on every history of the answer sheet. |
| Quick | `npm run eval -- --quick` | Each history against its own criterion only, and a sample to estimate false flags. |
| Wave | `node eval\run.ts --wave <wave folder> --out <new folder>` | The criteria of a wave folder, in place, each history against its own criterion only. |

**Full run.** The criteria are the ones in `criteria\active.json`: the first ten (`active`), then
the further ones (`further`). The histories and the answers are in `cases\expected.json`. A full
run makes one screen call for each criterion on each history. That was 330 screen calls for the
first ten on 18 November. With hundreds of criteria a full run is too long to be useful: use a
quick run.

**Quick run.** A history is screened against its own criterion only:

- a history with a planted finding: the criteria its answer entry expects;
- a near miss: the criterion its folder is named after;
- a clean history: the first ten.

One history in ten is also screened against up to thirty other criteria. The histories and the
criteria are chosen by a fixed seed (a fixed starting number), so the same test set always gives
the same sample. This gives an estimate of the false flags a full run would show. The table says
that it was a quick run, and it shows the sampled estimate in a section of its own. The sample
costs about three more screen calls for each history. To leave it out:

```
npm run eval -- --quick --no-sample
```

**Wave run.** It scores a wave folder before its criteria are in the repository. It reads
`<wave>\criteria\<ID>\criterion.json`, the histories in `<wave>\cases\<ID>\` and the answers in
`<wave>\cases\<ID>\expected.part.json`. Nothing in the repository is changed.

```
node eval\run.ts --wave %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\waves-claude\W101 --out %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\wave-runs\W101
```

- Give `--wave` again, or use commas, to score several wave folders in one run. The three stages
  then run once for all of them. A folder that holds wave folders stands for all of them.
- Score a few wave folders in one run, not all 51. A run that is stopped keeps what it finished,
  but a criterion whose letters were not written does not pass.
- A folder with `NOT_DRAFTED.md` and no `criterion.json` is listed as **not drafted** and skipped.
- A criterion file, an answer part or a history that will not load is reported for that criterion
  as **files not usable: (reason)**. The other criteria still run.
- `--only EU7-F03` scores one criterion of the wave folders again. `--quick` adds the false-flag sample.
- `--out` must be a new folder. Earlier results are never written over.

The 51 wave folders hold 387 drafted criteria, 7 that were not drafted, and 1,132 histories with
745 planted findings. So wave runs over all of them make 1,132 screen calls in all, then one
double-check for each suspected finding and one letter for each caught finding.

**To look before a run, without a model.** Add `--check` to any of the three. It reads the files,
says how many screen calls the run would make and lists what needs a look. It writes nothing.

```
npm run eval -- --quick --check
node eval\run.ts --wave %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\waves-claude\W101 --check
```

The default answer sheet is `cases\expected.json` (not signed by the clinical reviewer). When
`cases\expected.further.json` is present, the scorer reads both. To score only the three demo
histories: `npm run eval -- --sheet cases\_demo\expected.demo.json`.
`npm run eval -- --help` lists every option.

## 2. What PASS means

The founder's rule (`docs\SPEC.md`, section 2). A criterion **passes** when, on its test histories:

1. no planted finding is missed: each one reaches the bell with its planted lines;
2. the finding is shown with the criterion's own text and credit line;
3. a GP letter is produced for it, and the letter shows the planted lines.

A **false flag** is a confirmed finding where nothing was planted. It is counted and listed. It is
never a failure. A near miss that is confirmed is a false flag. PASS means the same in a full run,
a quick run and a wave run. A quick run and a wave run look for false flags only where they screen.

The founder's ruling 3 of 18 November says what "missed" means. A planted finding has three
possible ends. Confirmed by Model 2: **caught**. Suspected by Model 1 and turned back by Model 2:
**disputed** — shown to the pharmacist, who decides; it is not a failure, and it is counted in a
column of its own beside caught in every table. Not suspected by Model 1: **missed** — the failure.
A criterion passes when no planted finding is missed.

| Result | Meaning |
|---|---|
| PASS | All three parts of the rule hold for every planted finding. |
| PASS (part run) | Nothing failed, but the run left something out, for example the letters. Not a pass. |
| FAIL | A planted finding was lost, or the criterion text or a letter is missing, or a call could not be completed on a planted history. |
| NOT TESTED | No planted finding for the criterion was in the run. |
| NOT DRAFTED | The wave folder holds a note in place of the criterion. Not scored. |
| FILES NOT USABLE | A file of the criterion could not be loaded. Not scored. |

For a FAIL the table gives the history and the step, in these words: **not suspected by Model 1**,
**call could not be completed** (with the model), **letter missing**.
Two more can appear: the finding reached the bell but a planted line was not cited, and the letter
does not show the planted lines. A planted finding that Model 1 suspected and Model 2 turned back
is **disputed**: it is not a FAIL and it is never a reason in this list. The table also gives each
criterion its **class**: "supplies only", or "needs a fact" when the criterion needs a condition, a
result or a measurement.

## 3. How a possible finding is scored

Some criteria need a fact that a dispensing history does not hold (`docs\SPEC.md`, section 6a).
When the medicines match and the record holds no line about the fact, the app reports a
**possible finding**: it reaches the bell marked as possible, and the letter asks the doctor to
confirm the fact. Such a criterion has up to three test histories:

| History | What it holds | How it is scored |
|---|---|---|
| `pos-fact.csv` | The medicines and the fact. | A planted finding. It must be confirmed, and the fact line must be cited with the supply lines. |
| `pos-nofact.csv` | The medicines, and no line about the fact. | A planted finding. It is caught when it is confirmed, whether it was reported as possible or not. The table records how many were reported as possible. |
| `near-miss.csv` | The fact is there and does not meet the criterion. | It must not be confirmed. If it is, that is a false flag: counted, never a failure. |

A possible finding that Model 1 suspected and Model 2 turned back is **disputed**, not a miss: it
is shown to the pharmacist and fails no criterion, like any other disputed planted finding.

## 4. What a run writes

In `eval\results\<date and time>\`, or in the folder given with `--out`:

- `table.md`: the result for each criterion, then every miss, every false flag and every letter.
- `results.json`: everything, and two lists made for scripts (below).
- `raw\`: every model answer, one file for each call.

The two lists in `results.json`:

```
"passing": ["EU7-F01", "EU7-F02"],
"not_passing": [
  { "id": "EU7-F03", "result": "FAIL", "reason": "pos-brand.csv: not suspected by Model 1.",
    "reasons": ["pos-brand.csv: not suspected by Model 1."], "class": "supplies_only", "wave": "W101" }
]
```

`passing` holds the IDs whose result is PASS, and nothing else. Every other criterion is under
`not_passing` with its reason. `result` is one of `FAIL`, `PASS_PART`, `NOT_TESTED`, `NOT_DRAFTED`,
`FILES_NOT_USABLE`. For the last two the reason reads "not drafted" or "files not usable: (reason)".
A wave run also keeps a fingerprint (SHA-256) of every file it scored, under `waves`.

The score inside `results.json` also carries the founder's ruling 3 of 18 November: each criterion
row has `disputed` (how many planted findings Model 1 suspected and Model 2 turned back) and
`disputes` (those findings, each with its history and the lines each model cited), and the totals
have `disputed`. The table shows a **Disputed** column beside Caught / planted for every criterion
and for every wave folder, and a section "Disputed findings" that lists each one. A disputed
finding is shown to the pharmacist; it is not a failure and it is not a miss.

A wave run can score several wave folders at once. So the table has a section "Each wave folder",
with one row for each: criteria scored, PASS, not passing, not drafted, files not usable, planted
findings caught, false flags, and the seconds spent in the model calls for its criteria. The last
lines of the run say the same, one line for each wave folder. This line is from the run of
18 November at 13:50:

```
  W105: PASS 8 of 8 scored, not passing 0. Planted findings caught: 16 of 16. Time in model calls: 5 min 58 s.
```

Each model is loaded once for the whole run. That time falls on the first call of each stage, so
it is counted in the wave folder whose history is first.

The run ends with code 0 when nothing failed, 1 when a criterion failed or its files could not be
used, 2 when it could not run or was stopped early. Ctrl+C stops after the current call and writes
the results.

## 5. How to adopt a wave

A criterion is adopted into the repository when it is in the `passing` list of a wave run **and**
the case check calls it ok. Do the steps in this order.

1. **Check the files.** No model is needed. It prints one line for each criterion, "ok" or what is
   wrong, and ends with code 0 only when all are ok. "not drafted" is not counted as wrong.

   ```
   node tools\check-cases.mjs --wave %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\waves-claude\W101
   ```

2. **Score the wave** (section 1, wave run). Keep the folder given with `--out`.

3. **See what would be adopted.** Nothing is written.

   ```
   node tools\adopt-wave.mjs --wave %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\waves-claude\W101 --results %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\wave-runs\W101\results.json --dry-run
   ```

4. **Adopt.** The same line without `--dry-run`.

   ```
   node tools\adopt-wave.mjs --wave %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\waves-claude\W101 --results %USERPROFILE%\ClinicaLANTERN-Lantern-runtime\wave-runs\W101\results.json
   ```

5. **Check the repository again**, then start a clean demo before the page is used, because the
   list of criteria changed.

   ```
   node tools\check-cases.mjs
   npm test
   ```

What the helper does for each criterion it adopts: it copies `criteria\<ID>\` and `cases\<ID>\`
into the repository, adds the ID to the `further` list of `criteria\active.json`, and adds the
histories to `cases\expected.json`. What it never does:

- It never touches the first ten (`active`) or the reserves, and never adds an ID twice.
- It never writes over a criterion folder or a cases folder that is already there. It reports it
  and skips. If the same files are already there from a run that was stopped, it only completes
  the list and the answer sheet.
- It never adopts a file that changed after it was scored. Score the wave folder again.
- It never adds to a signed answer sheet. Add `--signed-sheet-ok` when the clinical reviewer has
  given his word.

When `cases\expected.json` is missing, the helper makes it and says so. A sheet made this way is not
signed and holds the adopted histories only. The histories of the first ten are not in it until
someone puts them there. `--sheet <file>` names another sheet.

It prints one line for each criterion: ADOPTED, COMPLETED or SKIPPED with the reason. `--repo <folder>`
adopts into another copy of the repository. `--wave` can be given several times, as for a wave run.
One adoption runs at a time: a second one that is started meanwhile stops and says so.
After adoption, score the whole set with a quick run: `npm run eval -- --quick`.

Two things to know before the first real adoption (seen on 18 November, `docs\PROOF_WAVES.md`):

- The helper adds to the `further` list only. Before the first real adoption on 18 November,
  `criteria\active.json` listed the demo criterion alone, and the ten proposed criteria were in
  `criteria\active.proposed.json`. The first ten had to be put in `active` before a wave folder was
  adopted, so that the further criteria would not follow the demo criterion.
- When the answer sheet was first made from adoptions, it held the adopted histories only. A quick run
  then had no history for the first ten and no clean history. The repository now has
  `cases\expected.json` and `cases\expected.further.json`.

## 6. How long a run takes

Measured on this PC on 18 November 2026, with the real models, thinking off. One run each.

| Run | What was scored | Model calls | Time |
|---|---|---|---|
| Full run, 09:30 | The ten proposed criteria, 33 histories. | 330 to screen, 22 to double-check, 20 letters | 21 min 30 s |
| Quick run, 13:38 | The same criteria and histories. | 87 to screen, 21 to double-check, 20 letters | 11 min 45 s |
| Wave run, 13:50 | W105, W114 and W146 in one run: 24 criteria, 67 histories. | 67 to screen, 43 to double-check, 43 letters | 15 min 58 s |

The quick run and the wave run were each made once more that afternoon, with the same calls and
the same results: 12 min 14 s and 15 min 56 s.

- In a full run a screen call took 3.2 s on average, because the model's reading of a history is
  reused for the next criterion. In a quick run and a wave run most histories are read for one
  criterion only, so there is little to reuse: a screen call took 5.3 to 5.6 s on average in the
  quick runs and 7.1 s in the wave runs.
- A double-check took 8.7 to 9.2 s on average. A letter took 2.4 to 2.8 s on average: about 1.7 s
  when the first draft passed its checks, and about 3.5 s when a second draft was needed.
- A wave folder of eight criteria took 4 to 6 minutes of model calls: about 14 seconds for each
  history.
- Going by that, wave runs over all 51 wave folders (1,132 histories) would take about four and a
  half hours of model calls. This is an estimate from three wave folders. It is not a measurement.
- In a quick run with many criteria in use, most of the screen calls are the false-flag sample:
  one history in ten against up to thirty other criteria. With the ten and the eight criteria of
  one wave folder in use (57 histories), `--quick --check` plans 186 screen calls: 54 for a history
  against its own criterion, 30 for the clean histories and 102 for the sample. Run `--quick --check`
  first to see the number. Use `--no-sample` when time matters, and say that no sample was taken.
