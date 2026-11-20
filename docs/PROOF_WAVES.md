# ClinicaLANTERN: the three pieces joined, and the first wave runs. Live proof

Wednesday 18 November 2026, 13:37 to 14:51 (Sydney time), on the founder's PC.

Three pieces were built side by side for section 6a of `docs\SPEC.md` (the founder's ruling of
18 November: a record may also carry conditions and results). They are the engine (`shared\`,
`pipeline\`, `server\`), the scorer (`eval\`, the case check and the adoption helper) and the page
(`src\`). This file says what happened when they were joined and run with the real models.

Fictional patients only. No real person is in any of this. Nothing here is "validated" or
"approved". The stage is "Prototype". Every number below is one measured run on one computer.

## 1. The result in one look

| What | Result |
|---|---|
| Type check, unit tests, build | Clean. 44 test files, 808 tests, all passing. |
| Regression on the first ten (the ten proposed criteria, quick run) | **10 of 10 PASS**, 20 of 20 planted findings caught, 0 false flags, 0 failed calls. Run twice: on the code as the builders left it, and on the final code. |
| Three drafted wave folders in one wave run: W105, W114, W146 | **24 of 24 PASS**, 43 of 43 planted findings caught, 24 of 24 near misses kept from the bell, 0 false flags, 0 failed calls. Run twice, with the same result. |
| Criteria that need a fact (16 of the 24) | 16 of 16 findings confirmed with the fact line cited. 11 of 11 histories with no line about the fact reached the bell as a possible finding. |
| Time for each wave folder | 358 s, 350 s and 250 s of model calls: about 14 s for each history. |
| Criteria that failed because of their files | None. |
| Fixed | Letters that fell back to the template because of one word: 7 of 63 before, 0 of 63 after (section 6). Nothing in the screening or the double-check was changed. |
| The adoption helper | Dry run on W105 in the repository: 8 would be adopted, nothing written. Real adoption of W114 in a private copy: 8 adopted, and a second run changed nothing. |
| Through the app, in the private copy (section 9) | The first ten were screened first, then the eight adopted criteria. A record with results gave a finding with its result lines marked on the page. A record with no line about the fact gave "Possible finding. The record does not show: Asthma. The letter asks the doctor to confirm." under the bell, and a letter written by the model that asks the doctor to confirm. |
| The app's own join tests on the final code | 44 of 44 checks through the API, 32 of 32 checks through the real page with real clicks. |

## 2. Without a model: type check, unit tests, build

Run in the repository at 13:37, on the code as the three builders left it. Nothing had to be fixed.

| Command | Result |
|---|---|
| `npm run typecheck` | Clean. |
| `npm test` on 18 November 2026 at 13:37 (dated record) | 44 test files, 804 tests, all passing. |
| `npm run build` | The page is built into `dist\`. |
| `npm run build:replay` | The judges' view is built into `dist-replay\`. |
| `node tools\check-cases.mjs` | Every criterion of the repository is ok. |

At the end of the join the count was 44 test files and 808 tests, all passing. The four more tests
cover what was added while joining (section 7): two for the rows for each wave folder in the
scorer, and two for the wording hint in the letter job. No existing test was changed.

## 3. Regression on the first ten

The ten proposed criteria passed their first scored run at 09:30 this morning (a full run, kept in
`C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\run0\results\`). They had to pass again on today's
code. This was run the same way as in the morning, but as a quick run:

- A private copy of the repository was made under the Windows temp folder, without
  `node_modules`, `.git`, `data` and `dist`. In the copy `criteria\active.proposed.json` was put
  in place of `criteria\active.json`, and `cases\expected.json` was made from
  `cases\expected.proposed.json` with the histories of the ten and the clean ones: 33 histories.
- `node eval/run.ts --quick --out <results folder>`, 13:38 to 13:50.
- The results are in `C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\regression-first-ten\`
  (`table.md`, `results.json`, `raw\`), and the log is beside that folder.

| | Full run this morning, 09:30 | Quick run on today's code, 13:38 |
|---|---|---|
| Criteria that PASS | 10 of 10 | **10 of 10** |
| Planted findings caught | 20 of 20 | **20 of 20** |
| False flags | 0 | 0, and 0 in the 27 sampled screenings |
| Suspected by Model 1 and turned back by Model 2, where nothing was planted | 2 | 1 |
| Calls that could not be completed | 0 | 0 |
| Letters | 20 of 20, all written by the model | 20 of 20: 18 written by the model, 2 built from the template |
| Model calls | 330 to screen, 22 to double-check, 20 letters | 87 to screen, 21 to double-check, 20 letters |
| Time | 21 min 30 s | 11 min 45 s |

**One difference, and its cause.** The two letters for PINCER 9 were built from the template this
afternoon. Both drafts of each failed the wording check: the first held "should" and the second
held "is to be". These are the criterion's own words: its text says the medicine "should be taken
weekly", and its request to the doctor says "the day of the week it is to be taken". The wording
check was added in the review of the first build, after the morning run and before the baseline
commit. This morning's letter for the same history holds the same sentence ("... do not specify
that the medication should be taken weekly"), and today's wording check, run on that text, gives
the same note. So the cause is the wording check of the review, not the work for section 6a. A
letter built from the template counts as a letter, and PINCER 9 passes. Section 6 says what was
done about it.

**Again, on the final code.** After the change of section 6 the same regression was run once more,
in a fresh private copy made from the final code, 14:38 to 14:50 (12 min 14 s). The results are in
`C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\regression-first-ten-run2\`.
Again 10 of 10 PASS, 20 of 20 planted findings caught, 0 false flags (0 in the 27 sampled
screenings), 0 failed calls, and 1 suspected finding turned back by Model 2 where nothing was
planted. The same calls were made: 87 to screen, 21 to double-check, 20 letters. All 20 letters
were written by the model: 18 at the first draft, and the two for PINCER 9 at the second draft.

## 4. Three drafted wave folders, scored in place in one wave run

The three wave folders, under `C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\`:

| Wave folder | What it holds | Class |
|---|---|---|
| W105 | EU(7)-PIM F32 to F39: medicines for older people to avoid | 8 decided from the supplies alone |
| W114 | PINCER 2, 3, 4, 5a, 5b, 6, 7 and 8: a diagnosis with a medicine, or a monitoring test that is overdue | 8 that need a fact |
| W146 | START D3 to D7 and E1 to E3: a medicine that should be there and is not supplied | 8 that need a fact |

**First the files, without a model.** `node tools\check-cases.mjs --wave <folder>` on each: W105,
W114 and W146 each gave 8 criteria, 8 ok, 0 not ok, 0 not drafted, and ended with code 0.
`node eval\run.ts --wave ... --check` planned 67 screen calls and found nothing that needs a look.

**Then the run.** One run for the three folders, so each model was loaded once:

```
node eval\run.ts --wave <waves>\W105 --wave <waves>\W114 --wave <waves>\W146 --out C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\waves-W105-W114-W146-run1
```

13:50 to 14:06, 15 min 58 s. The results are in that folder (`table.md`, `results.json`, `raw\`).

| | W105 | W114 | W146 | All three |
|---|---|---|---|---|
| Criteria scored | 8 | 8 | 8 | 24 |
| **PASS** | **8** | **8** | **8** | **24 of 24** |
| Not passing | 0 | 0 | 0 | 0 |
| Histories | 24 | 24 | 19 | 67 |
| Planted findings caught | 16 of 16 | 16 of 16 | 11 of 11 | 43 of 43 |
| of these, histories that hold the fact (`pos-fact`), with the fact line cited | none in this folder | 8 of 8 | 8 of 8 | 16 of 16 |
| of these, histories with no line about the fact (`pos-nofact`), reported as a possible finding | none in this folder | 8 of 8 | 3 of 3 | 11 of 11 |
| Near misses kept from the bell | 8 of 8 | 8 of 8 | 8 of 8 | 24 of 24 |
| False flags | 0 | 0 | 0 | 0 |
| Calls that could not be completed | 0 | 0 | 0 | 0 |
| Letters | 16 of 16 | 16 of 16 | 11 of 11 | 43 of 43 |
| **Seconds in model calls** | **358.2** | **350.3** | **250.0** | **958.6** |

- Model 1 suspected the 43 planted findings and nothing else: all 24 near misses ended clear at
  the first step, so Model 2 was never asked about one.
- Model 2 confirmed all 43, with the planted lines.
- Calls: 67 to screen (7.1 s each on average), 43 to double-check (8.7 s), 43 letters (2.4 s).

Every criterion, in short. "Possible" means the history with no line about the fact reached the
bell as a possible finding.

| Criterion | Class | Result | Caught / planted | Possible | Near miss | Seconds |
|---|---|---|---|---|---|---|
| EU7-F32 vasodilators with no proven benefit | supplies only | PASS | 2 / 2 | | clear | 72.8 |
| EU7-F33 venotonic vein medicines | supplies only | PASS | 2 / 2 | | clear | 39.8 |
| EU7-F34 non-selective beta-blockers | supplies only | PASS | 2 / 2 | | clear | 41.5 |
| EU7-F35 nicardipine and nifedipine | supplies only | PASS | 2 / 2 | | clear | 43.1 |
| EU7-F36 verapamil and diltiazem | supplies only | PASS | 2 / 2 | | clear | 40.6 |
| EU7-F37 niacin | supplies only | PASS | 2 / 2 | | clear | 36.4 |
| EU7-F38 oral oestrogen | supplies only | PASS | 2 / 2 | | clear | 44.3 |
| EU7-F39 bladder antimuscarinics | supplies only | PASS | 2 / 2 | | clear | 39.7 |
| PINCER-2 beta-blocker with asthma | needs a fact | PASS | 2 / 2 | yes: asthma | clear | 44.4 |
| PINCER-3 ACE inhibitor or loop diuretic, no kidney and salt check | needs a fact | PASS | 2 / 2 | yes: the kidney and salt results | clear | 51.2 |
| PINCER-4 combined pill after a blood clot | needs a fact | PASS | 2 / 2 | yes: thrombosis | clear | 42.8 |
| PINCER-5A methotrexate, no recent full blood count | needs a fact | PASS | 2 / 2 | yes: the full blood count | clear | 41.8 |
| PINCER-5B methotrexate, no recent liver test | needs a fact | PASS | 2 / 2 | yes: the liver function test | clear | 41.7 |
| PINCER-6 warfarin, no recent INR | needs a fact | PASS | 2 / 2 | yes: the INR | clear | 42.3 |
| PINCER-7 lithium, no recent level | needs a fact | PASS | 2 / 2 | yes: the lithium level | clear | 43.5 |
| PINCER-8 amiodarone, no recent thyroid test | needs a fact | PASS | 2 / 2 | yes: the thyroid test | clear | 42.6 |
| START-D3 no cholinesterase inhibitor in Alzheimer's dementia | needs a fact | PASS | 2 / 2 | yes: the dementia diagnosis | clear | 40.6 |
| START-D4 no rivastigmine in Lewy body dementia | needs a fact | PASS | 1 / 1 | no such history | clear | 20.4 |
| START-D5 no SSRI in severe anxiety | needs a fact | PASS | 1 / 1 | no such history | clear | 21.6 |
| START-D6 no dopamine agonist in restless legs | needs a fact | PASS | 1 / 1 | no such history | clear | 23.2 |
| START-D7 no propranolol in essential tremor | needs a fact | PASS | 1 / 1 | no such history | clear | 19.3 |
| START-E1 no active vitamin D in severe kidney disease | needs a fact | PASS | 2 / 2 | yes: eGFR, calcium, hyperparathyroidism | clear | 46.6 |
| START-E2 no phosphate binder in severe kidney disease | needs a fact | PASS | 2 / 2 | yes: eGFR, phosphate, the renal diet | clear | 54.1 |
| START-E3 no erythropoietin analogue in kidney anaemia | needs a fact | PASS | 1 / 1 | no such history | clear | 24.2 |

The first criterion of the run carries the loading of each model, about 30 seconds in all.

The same three wave folders were scored once more at 14:10, on the final code, after the change
of section 6. The result was the same: 24 of 24 PASS, 43 of 43 caught, in 15 min 56 s.

## 5. Criteria that failed because of their files

None. All 24 criteria passed, so no drafted file had to be judged. No drafted file was changed.

## 6. What the letters showed, and what was done

No criterion failed, so nothing in the screening or the double-check was changed. One thing was
seen in the letters of both runs, and it was fixed with prompt work.

**What was seen.** A letter built from the template still counts as a letter. But in the two runs
above 7 letters of 63 were built from the template, and 7 more needed a second draft:

| Run | Letters | First draft passed | Second draft passed | Built from the template |
|---|---|---|---|---|
| Regression on the first ten | 20 | 18 | 0 | 2 (both PINCER 9) |
| W105 | 16 | 10 | 5 | 1 |
| W114 | 16 | 15 | 1 | 0 |
| W146 | 11 | 6 | 1 | 4 |

Every one of the 7 template letters, and 5 of the 7 second drafts, came from one check: the wording
check found "should", "need to" or "is to be" in a sentence that is not a question. The 2 other
second drafts were for possible findings whose first draft did not ask the doctor to confirm the
fact. The raw drafts of START D6 showed why the wording check was met so often:

- The word came from the criterion's own text. The request the criterion file gives for START D6
  is "Whether treatment of the restless legs should be reviewed, once iron stores and kidney
  function have been checked." The EU(7)-PIM statements say "Older people should avoid ...".
- Model 3 wrote "Could you please review whether treatment of the restless legs should be reviewed,
  once iron stores and kidney function have been checked." It ended the request with a full stop.
  The check lets "should" pass only in a question, and a question ends with a question mark.
- The request for a second draft named only the word that was found. The second draft kept the
  word, or wrote another of the same kind ("should", then "is to be" for PINCER 9). So both drafts
  failed and the template was used.

**What was done.** The request for the second draft now also says, only when the first draft
failed the wording check: which words must not stand in a sentence that is not a question (must,
should, ought to, need to, needs to, is to be, are to be, requires, recommend, advise, suggest),
to leave them out also where the facts use them, and that a sentence that asks the doctor
something ends with a question mark (`pipeline\letter.ts`, `WORDING_HINT`).

What was left alone:

- The wording check itself. It is as strict as before, and a second draft that still tells the
  doctor what to do still ends in the template. A unit test holds this.
- The first request for a letter. The pinned requests of the first ten (`pipeline\unchanged.test.ts`)
  are unchanged, so no criterion is asked anything new at the first draft.
- The request for a second draft about a date, an amount or a medicine name. It reads as it always
  did, to the letter. A unit test holds this too.

**The same letters, after the change.** The three wave folders and the regression were run again
on the final code, as section 4 and section 3 were run. No letter was built from the template.

| Run on the final code | Letters | First draft passed | Second draft passed | Built from the template |
|---|---|---|---|---|
| Regression on the first ten, 14:38 | 20 | 18 | 2 (both PINCER 9) | 0 |
| W105, 14:10 | 16 | 10 | 6 | 0 |
| W114, 14:10 | 16 | 15 | 1 | 0 |
| W146, 14:10 | 11 | 6 | 5 | 0 |

The second wave run is in
`C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\waves-W105-W114-W146-run2\`. Its
screening and double-check gave what the first run gave: 24 of 24 PASS, 43 of 43 planted findings
caught, 11 possible findings, 0 false flags, 0 failed calls, in 15 min 56 s (W105 358.7 s,
W114 346.5 s, W146 251.0 s). The first drafts still met the wording check 10 times in 43 letters.
Each of those now passed at the second draft.

## 7. What was added while joining

Nothing between the three pieces had to be repaired: every call, field name and file fitted. These
small things were added.

| Where | What |
|---|---|
| `eval\report.ts`, `eval\run.ts` | A wave run now says what each wave folder came to: a section "Each wave folder" in `table.md` and one line for each at the end of the run, with the criteria scored, PASS, not passing, the planted findings caught and the seconds in model calls. Several wave folders share one run, and the time for each was asked for. Two unit tests (`eval\wave.test.ts`, `eval\report.test.ts`). |
| `pipeline\letter.ts`, `pipeline\facts.ts` | The wording hint in the request for a second draft (section 6). Two unit tests (`pipeline\letter.test.ts`). |
| `tools\run-case.mjs` | It now prints "Possible finding. The record does not show: (fact)." for such a finding. |
| `docs\SPEC.md` | One paragraph in section 7.3 about the wording hint. |
| `docs\RUNNING.md`, `docs\SCORING.md` | Brought up to date: the new commands, section 2c, the timings, how long a run takes. |

## 8. The adoption helper

**Dry run on a passing wave folder, in the repository itself.** Nothing was written: afterwards
`criteria\active.json` was unchanged, and there was no `cases\expected.json`, no `criteria\EU7-F32`
and no lock file.

```
> node tools\adopt-wave.mjs --wave C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\W105 --results C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\waves-W105-W114-W146-run1\results.json --dry-run

ClinicaLANTERN adoption helper. DRY RUN: nothing is written. Fictional patients only.
Repository: C:\Users\AdamG\ClinicaLANTERN-Lantern
Results: C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\waves-W105-W114-W146-run1\results.json. Passing: 24. Not passing: 0.
Answer sheet: cases/expected.json was not found. A real run would make it, not signed. It would hold the adopted histories only: the histories of the first ten are not in it.

Wave folder W105: 8 criterion folders.
WOULD ADOPT  EU7-F32  would copy criteria/EU7-F32 and cases/EU7-F32; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F33  would copy criteria/EU7-F33 and cases/EU7-F33; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F34  would copy criteria/EU7-F34 and cases/EU7-F34; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F35  would copy criteria/EU7-F35 and cases/EU7-F35; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F36  would copy criteria/EU7-F36 and cases/EU7-F36; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F37  would copy criteria/EU7-F37 and cases/EU7-F37; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F38  would copy criteria/EU7-F38 and cases/EU7-F38; would add the ID to the further list; would add 3 histories to the answer sheet.
WOULD ADOPT  EU7-F39  would copy criteria/EU7-F39 and cases/EU7-F39; would add the ID to the further list; would add 3 histories to the answer sheet.

DRY RUN. Nothing was written. This is what would be done:
  Adopted: 8. Completed: 0. Skipped: 0. Failed: 0.
  IDs added to the further list of criteria/active.json: 8. The first ten and the reserves were not touched.
  Histories added to cases/expected.json: 24. The sheet did not exist. It would be made, not signed.
```

It ended with code 0. A dry run of all three wave folders against the results of the second wave
run (`waves-W105-W114-W146-run2\results.json`, the final code) said the same for all of them:
24 would be adopted, 67 histories would be added, nothing skipped. Use that results file for the
real adoption.

**A real adoption, in a private copy.** The repository itself was not to be changed, so the helper
was run for real in a second private copy under the Windows temp folder. There the ten proposed
criteria were in use and the answer sheet held their 33 histories. Wave folder W114 was adopted:

- First run: 8 ADOPTED. The two folders of each criterion were copied, the 8 IDs were added to a
  new `further` list after the first ten and the reserves, and 24 histories were added to the
  sheet. The first ten and the reserves were the same as before.
- Second run: 8 SKIPPED, "already in the repository, in the list and in the answer sheet". Nothing
  was written.
- The answer sheet was put back without the adopted histories, and the helper was run again:
  8 COMPLETED, "the folders were already in the repository, the same files; the ID was already in
  the list; added 3 histories to the answer sheet".
- `node tools\check-cases.mjs` in the copy, with the whole proposed sheet: 27 criteria, every one ok
  (the ten, the nine reserves and the eight adopted ones), code 0.
- `node eval\run.ts --quick --check` in the copy: 57 histories, 18 criteria, 186 screen calls
  planned (54 own criterion, 30 clean histories against the first ten, 102 false-flag sample),
  nothing that needs a look.

## 9. Through the app: the server and the page, in the private copy

The scored runs join the engine and the scorer. This part joins the page as well. It used the
private copy of section 8: the ten proposed criteria in use, then the eight adopted criteria of
W114. The copy's own server ran on port 8797 with its own state folder, and served the built
page. The repository's own state file and list of criteria were not touched.

| Step | What happened |
|---|---|
| Server start | "Criteria in use: STOPP-C10, STOPP-B3, STOPP-B13, STOPP-C14, STOPP-D18, STOPP-L2, STOPP-D8, STOPP-A3, STOPP-B11, PINCER-9, PINCER-2, PINCER-3, PINCER-4, PINCER-5A, PINCER-5B, PINCER-6, PINCER-7, PINCER-8". The first ten first, then the further ones in order. `GET /api/criteria` gave the 18, and the eight carry `needs_facts`. |
| A record with results: `PINCER-3\pos-fact.csv`, 57 lines | Screened against all 18 criteria in 88.9 s, the first ten first. PINCER 3 was suspected and confirmed. Both models cited the four result lines (eGFR, creatinine, potassium, sodium, L002 to L005) and two ramipril supplies. The other 17 criteria ended clear. `possible` is false and `missingFacts` is empty. |
| A record with no line about the fact: `PINCER-2\pos-nofact.csv`, 27 lines | Screened against all 18 in 75.9 s. PINCER 2 was suspected as a possible finding and confirmed by Model 2. The state holds `possible: true` and `missingFacts: ["Asthma"]`. The other 17 ended clear. |
| The bell, on the real page | Two findings wait. PINCER 3 shows its four result lines with the mark RESULT among the lines the models pointed to. PINCER 2 shows the line "Possible finding. The record does not show: Asthma. The letter asks the doctor to confirm." Both show the criterion text and its credit line. |
| Accept of the possible finding | The letter was ready after 12.8 s, written by the model, first draft, no check note. The letter badge showed 1. |
| The import panel | It says "A CSV file may also list known conditions and test results." |

The letter, as Model 3 wrote it. The frame is built by code. The line under "Re:" is the one
section 6a asks for.

```
Re: Possible finding: Timoptol 0.5% eye drops
The record we hold does not show: Asthma.

Dear Doctor,

Our records indicate this patient has been prescribed Timoptol 0.5% eye drops. However, our records do not show a diagnosis of asthma.

The following supplies were dispensed: 1 June 2026, Timoptol 0.5% eye drops, qty 1; 27 July 2026, Timoptol 0.5% eye drops, qty 1; and 21 September 2026, Timoptol 0.5% eye drops, qty 1.

Could you please confirm if the patient has asthma and review whether a beta-blocker is the right choice for them? Please let us know if we can assist further.
```

One thing to know. In its own words under the bell, Model 2 wrote the third supply date as
2026-09-24. The line says 2026-09-21, and the letter, whose dates are checked by code, says
21 September. The page marks Model 2's text "These are the model's own words, not a checked fact."

**The app's own join tests, on the final code.** They were run against a second server of the
same copy (port 8798, its own state folder, the demo criterion in use), so that the repository's
state was left alone.

| Test | Result |
|---|---|
| `tools\smoke.mjs`: the whole loop through the API, with the long history | ALL 44 CHECKS PASSED, 154.6 s |
| `tools\page-walk.mjs --no-scan`: the real page with real clicks in headless Edge, without the two scans | ALL 32 CHECKS PASSED, 111.1 s. No error on the page. At phone width (390 by 844) nothing scrolls sideways. |

Where to look: `C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\wave-proof\app-join\` holds the two
records of `run-case`, the accept and the letter, the state file, the server logs, the records
of the two join tests, and the pictures. One picture is kept with the page pictures:
`docs\screens\records-live-bell-fact-lines-and-possible-1366x2300.png`.

With 18 criteria in use one history took 76 to 89 seconds to screen: about 3 to 5 seconds for
each criterion once Model 1 is loaded. Screening time grows with the number of criteria in use.

Both test servers were stopped at the end. Ollama was left running.

## 10. Still open

- **Only three of the 51 wave folders were scored**: 24 of the 387 drafted criteria. The rest is
  not scored yet. Seven criteria are not drafted: OPTIMISE-T2-14, T2-16, T2-18, T2-26, T2-47,
  T2-48 and T3-08. Without a model, `node eval\run.ts --wave <the folder of all waves> --check`
  reads all 51 folders on the final code: 387 criteria, 1,132 histories, 1,132 screen calls
  planned, nothing that needs a look. Nothing here is signed by the clinical reviewer.
- **Time.** A wave folder of eight criteria took 4 to 6 minutes. All 51 would take about four and
  a half hours of model calls (an estimate from three folders, `docs\SCORING.md` section 6). Score
  a few wave folders in one run: a run that is stopped before its letters are written passes
  nothing.
- **Screening one history takes longer with every criterion in use.** With 18 criteria in use a
  history took 76 to 89 seconds on the page (section 9), about 3 to 5 seconds for each criterion.
  By proportion, 400 criteria in use would take roughly 20 to 30 minutes for one history on this
  PC. That is an estimate by proportion, not a measurement. It is a question for the founder
  before all the criteria are put in use on the page.
- **Before the first real adoption.** `criteria\active.json` in the repository lists the demo
  criterion only, and `cases\expected.json` does not exist. The helper adds to `further` only, and
  the sheet it makes holds the adopted histories only. So the first ten have to be put in `active`,
  and their histories in the sheet, before a wave folder is adopted. Both are the founder's to sign.
- **False flags across criteria were not measured for the wave folders.** A wave run screens a
  history against its own criterion only, and no sample was taken. None of the 24 near misses was
  suspected. `--wave ... --quick` adds the sample.
- **A quick run over many criteria is mostly the false-flag sample.** See `docs\SCORING.md`,
  section 6. Run `--quick --check` first to see how many calls it would make.
- **The criterion's own words and the wording check.** After the fix of section 6 a first draft
  can still fail the wording check when the criterion's own text holds "should" or "is to be": the
  model copies the words. The second draft then passes, at the cost of about two seconds. To stop
  it at the source, the drafted `ask_the_gp` texts could be worded without those words, or the
  hint could be given in the first request. The second changes what the first ten are asked, so
  it needs the pinned requests renewed and a new scored run. Neither was done.
- **Not seen with the real models in these runs:** a possible finding turned back by Model 2, a
  near miss of a criterion that needs a fact suspected by Model 1, a letter for a possible finding
  built from the template, and a record with fact lines long enough to be read in parts.
- **What the engine proof left open is still open** (`docs\PROOF_RECORDS.md`, section 9): the
  second model does not change the mark "possible"; a criterion file that does not load is left
  out of the screening and named in the log; a PDF or a scan has no fact lines.
- **The words of `docs\SPEC.md` about ten criteria.** Sections 1, 2 and 9 speak of ten criteria,
  and section 11 lists "No 413-criterion machinery" under what is not built. The `further` list,
  the wave runs and the adoption helper now exist. Section 6a covers them, but the older sentences
  were left as they are: they are the founder's design, and his to reword.
- **Three private copies are still under the Windows temp folder**: `lantern-regress-20261118-133824`,
  `lantern-regress-20261118-141949` and `lantern-join-20261118-141112`. They are throwaway. Every
  result that matters was saved under `wave-proof\`, so they can be deleted.

## 11. How to run it again

Start Ollama first (`start-ollama.ps1`, `docs\RUNNING.md` section 1). There is one graphics card:
run one of these at a time, and not while the page is screening a history.

```
cd C:\Users\AdamG\ClinicaLANTERN-Lantern
npm run typecheck
npm test
npm run build

node tools\check-cases.mjs --wave C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\W105
node eval\run.ts --wave C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\W105 --check
node eval\run.ts --wave C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\W105 --wave C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\W114 --out <a new folder>
node tools\adopt-wave.mjs --wave C:\Users\AdamG\ClinicaLANTERN-Lantern-runtime\waves-claude\W105 --results <that folder>\results.json --dry-run
```

The regression on the first ten needs the ten in use and their answer sheet. Until the founder has
signed them, make a private copy as section 3 says, and run `node eval/run.ts --quick --out <a new
folder>` in the copy. `docs\SCORING.md` explains every kind of run and the adoption.
