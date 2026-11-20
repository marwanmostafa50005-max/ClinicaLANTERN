# ClinicaLANTERN: records that also carry conditions and results. Live proof

Wednesday 18 November 2026, 12:15 to 13:40 (Sydney time), on the founder's PC.

This file says what was built for section 6a of `docs\SPEC.md` (the founder's ruling of 18 November),
and what happened when it was run with the real models. Fictional patients only. No real person is
in any of this. Nothing here is "validated" or "approved". The stage is "Prototype".

## 1. The result in one look

| What | Result |
|---|---|
| Unit tests in `shared\`, `pipeline\` and `server\` (no model needed) | 22 test files, 396 tests, all passing. At the baseline commit: 14 files, 284 tests. The whole repository at 13:32: 44 files, 804 tests, all passing. |
| Type check (`npm run typecheck`) | Clean for the whole repository. |
| Three drafted criteria and the two demo histories, real models (13:27 to 13:31) | **11 of 11 histories gave what the answer part expects**: 3 findings with their fact line cited, 3 possible findings confirmed as possible, 3 near misses kept from the bell, and the demo positive and near miss as before. |
| Letters for the 7 findings of that run (Model 3) | 7 of 7 written by the model and past every letter check: 6 on the first draft, 1 on the second. The 3 for possible findings carry the line "The record we hold does not show" and ask the doctor to confirm. |
| One "no fact" history through the server's own engine | The state file holds `possible: true` and the missing fact. The bell badge showed 1. After the accept the letter was written by the model. |
| Fourteen more drafted criteria, real models (13:17 to 13:27) | **38 of 38 histories**: 13 findings with their fact line, 11 possible findings, 14 near misses kept from the bell. |
| In all, with the real models | 17 of the drafted criteria that need facts, 47 histories: 16 findings with the fact, 14 possible findings, 17 near misses. All gave what their answer part expects. |
| The demo positive through the real server over HTTP | Confirmed with the same six lines as this morning. `GET /api/state` gave `possible: false` and an empty `missingFacts`. The server was started on port 8799 with its own state folder, and stopped afterwards. |
| A criterion without facts | It is sent byte for byte what it was sent before (section 7). |
| The drafted files | 387 criteria load, 256 of them need facts. 1,132 histories are read with no problem. Every planted line exists. No model was needed for this check. |

One planted finding was missed in the first wider run, and prompt work fixed it. Section 8 says how.

## 2. What was built

Everything is in the folders of the engine: `shared\`, `pipeline\`, `server\`, and one new tool.

| Where | What changed |
|---|---|
| `shared\types.ts` | The contract of section 6a: `Criterion.needs_facts` (optional), `ScreenResult.missingFacts`, `Finding.possible`, `ActiveCriteria.further` (optional). |
| `shared\facts.ts` (new) | One rule for the engine, and for the page and the scorer if they wish: which line is a fact line, which facts a finding says the record does not show, whether a finding is a possible finding. It reads the shape of a line. It never reads a medicine name. |
| `pipeline\csv.ts` | The three optional columns `record_type`, `detail`, `value`. A fact row becomes a fact line. Line IDs run over all rows in file order. A fact row with no date is kept and shows "no date". A file without the columns is read exactly as before. |
| `pipeline\criteria.ts` | `needs_facts` is read strictly. The criterion block lists the facts under "FACTS THIS CRITERION NEEDS". `loadCriteria` gives the first ten, then the further ones, each once. A criterion file that does not load is named and the others still load. `loadCriteriaFrom(folder, ids)` loads from any folder, such as a wave folder. |
| `pipeline\screen.ts` | A criterion with `needs_facts` gets its own answer form (with `missing_facts`, always asked for, may be empty) and a task that explains the three cases. A finding with a missing fact is a possible finding. Every older guard is kept. A criterion with facts that counts months back from the end of the record also gets the note "DATES" (section 8). |
| `pipeline\check.ts` | For such a criterion the second model is told what the first model says is missing, and the three cases, and gets the same note "DATES". Its answer form is the same four fields as before. |
| `pipeline\letter.ts`, `pipeline\facts.ts` | A letter for a possible finding carries the line "The record we hold does not show: (fact)." and its request paragraph must ask the doctor to confirm. The fact check accepts a fact line cited from the record, and now also checks blood pressures and common result units. |
| `pipeline\history.ts`, `pipeline\dates.ts` | The heading of a record that holds fact lines says so. Months can be counted back from a date. |
| `server\` | A finding carries `possible` and `screen.missingFacts` through the state file and the API. A state saved before today still loads. A criterion file that does not load is named in the activity log. |
| `tools\prove-records.mjs` (new) | The live proof below. |
| `docs\SPEC.md` | Section 6a, word for word, and one line in section 5. |

### The three cases, as the models are told them

The first model is told, only for a criterion with `needs_facts`:

1. **A finding.** The medicines meet the rule, and a fact line of the record meets the criterion. It answers yes, gives the supply lines and the fact line, and leaves `missing_facts` empty.
2. **A possible finding.** The medicines meet the rule, but the record holds no line about a fact that the finding needs. It answers yes, gives the lines the rule names, and names each such fact in `missing_facts`.
3. **No finding.** The medicines do not meet the rule, or a fact line shows that the fact does not meet the criterion. It answers no.

The second model is told the same three cases as: confirm with the fact line; confirm a possible finding and do not turn it back because the fact is not on the record; do not confirm when the fact line does not meet the criterion.

### Guards that were added

- **A fact is never taken as recorded without its line.** When the first model reports a finding, names no missing fact and cites no fact line, the finding is shown as a possible finding and says so.
- **A missing fact is never dropped.** A name that fits exactly one fact of the criterion is written the way the criterion writes it. A name that fits none is kept as the model wrote it.
- **A long history.** A part cannot tell that a fact is missing, because its line may be in another part. So each part lists the fact lines with the medicine lines, and the three cases are decided when the listed lines are read together. A criterion with facts is never called clear only because no line was listed.
- **The letter frame.** The line "The record we hold does not show" never prints a date, an amount or a medicine name that code has not checked against the cited lines and the criterion.

## 3. What was run

- Ollama 0.40.15 at `http://127.0.0.1:27435`, loopback only. Models: `lantern-screen`,
  `lantern-check`, `lantern-letter`. Thinking off. Temperature 0, seed 42, window 16,384 tokens.
  The Ollama server was already running. It was left running.
- The proof tool: `node tools\prove-records.mjs`. It does not use the app server. It loads a drafted
  criterion from its wave folder with `loadCriteriaFrom`, reads the histories named in the
  criterion's answer part with the app's own CSV reader, and runs each one through
  `screenCriterion` (Model 1) and `checkFinding` (Model 2). With `--letters` it also has Model 3
  write the letter for every finding at the bell. With `--server` it takes one history through the
  server's own engine, in the same process, with the state file in a throwaway folder.
- The drafted criteria and histories were read where they are, under
  `%USERPROFILE%\ClinicaLANTERN-Lantern-runtime\waves-claude`. Nothing was copied into the
  repository and no drafted file was changed.
- The three criteria of the main run were chosen to be one of each kind the task names:
  **STOPP E1** needs a result (the eGFR), **STOPP B2** needs a condition (heart failure with its
  NYHA class), and **START B3** is about a medicine that should be there and is not supplied (an
  ACE inhibitor in coronary artery disease).
- "As expected" is judged against the answer part of each criterion. A history that plants a
  finding must be confirmed by Model 2 and cite one line of every planted group, and must not be
  marked possible. A history whose answer part says "Possible finding" must be marked possible and
  reach the bell. A near miss must not reach the bell.

## 4. The live table: three drafted criteria and the two demo histories

Run on Wednesday 18 November 2026 at 13:31 with `node tools/prove-records.mjs --letters --server`. Models: lantern-screen (screen), lantern-check (double-check) and lantern-letter (letter), through Ollama at http://127.0.0.1:27435. The whole run took 239.2 seconds. Fictional patients only.

**11 of 11 histories gave what the answer part expects. 7 of 7 letters were written by the model, passed the letter checks and say what a letter of their kind must say.**

### STOPP E1: Long-term digoxin 125 microgram a day or more with low kidney function

From W136. Facts it needs: result: eGFR (estimated kidney function), the most recent result.

| History | Lines (facts) | Suspected | Possible | Missing facts | Confirmed | Cited lines | Expected | As expected |
|---|---|---|---|---|---|---|---|---|
| pos-fact.csv | 53 (2) | yes | no | - | yes | L004 L011 L020 L027 L030 L035 L044 L051 | a confirmed finding with the planted lines | YES. Confirmed, with the planted lines. |
| pos-nofact.csv | 35 (1) | yes | yes | eGFR (estimated kidney function), the most recent result | yes | L002 L015 L025 L035 | a possible finding at the bell | YES. Confirmed as a possible finding. |
| near-miss.csv | 31 (2) | no | no | - | - | - | no finding | YES. Model 1 suspected nothing. |

- pos-fact.csv, Model 1 (20.5 s): Lanoxin (digoxin) was supplied from 2025-12-08 to 2026-10-04 (more than 90 days) at 250 micrograms daily, and the most recent eGFR is 24 mL/min/1.73 m2, which is below 30. This is a finding.
- pos-fact.csv, Model 2 (18.9 s): Lanoxin (digoxin) was supplied from 2025-12-08 to 2026-10-04 at a daily dose of 250 micrograms, and the record contains a RESULT line (L030) showing an eGFR of 24 mL/min/1.73 m2, which is below the threshold of 30.
- pos-fact.csv, Model 3 (12.9 s): letter written by the model, first draft passed the checks. It does not call the finding a possible one. It prints a line of 2 of 2 planted groups.
- pos-nofact.csv, Model 1 (8.2 s): Digoxin is supplied for more than 90 days at a dose of 125 micrograms daily (62.5mcg x 2), but there is no eGFR result in the record. This is a possible finding.
- pos-nofact.csv, Model 2 (7.8 s): Digoxin (Lanoxin PG) is supplied at a daily dose of 125 micrograms (2 x 62.5 micrograms) from L002 (2025-12-10) to L035 (2026-10-06), a duration exceeding 90 days. The record contains no RESULT line for eGFR.
- pos-nofact.csv, Model 3 (1.6 s): letter written by the model, first draft passed the checks. It carries the line "The record we hold does not show". It asks the doctor to confirm. It prints a line of 1 of 1 planted groups.
- near-miss.csv, Model 1 (6.4 s): Digoxin is supplied for more than 90 days at 250 micrograms daily, but the most recent eGFR is 41 mL/min/1.73 m2, which is not below 30.

### STOPP B2: Verapamil or diltiazem with severe heart failure

From W130. Facts it needs: condition: Heart failure with its NYHA class.

| History | Lines (facts) | Suspected | Possible | Missing facts | Confirmed | Cited lines | Expected | As expected |
|---|---|---|---|---|---|---|---|---|
| pos-fact.csv | 45 (1) | yes | no | - | yes | L001 L005 L009 L013 L017 L018 L022 L026 L030 L034 L038 L042 | a confirmed finding with the planted lines | YES. Confirmed, with the planted lines. |
| pos-nofact.csv | 28 (1) | yes | yes | Heart failure with its NYHA class | yes | L002 L005 L008 L011 L014 L017 L020 L023 L026 | a possible finding at the bell | YES. Confirmed as a possible finding. |
| near-miss.csv | 37 (1) | no | no | - | - | - | no finding | YES. Model 1 suspected nothing. |

- pos-fact.csv, Model 1 (9.5 s): Verapamil is supplied and the record contains a condition line for Heart failure NYHA class III. This is a finding.
- pos-fact.csv, Model 2 (10.8 s): Verapamil (Isoptin SR) is supplied on multiple dates including L001, L005, L009, L013, L018, L022, L026, L030, L034, L038, and L042. The record contains a CONDITION line L017 dated 2025-12-08 stating 'Heart failure NYHA class III', which meets the criterion for NYHA class III or IV.
- pos-fact.csv, Model 3 (1.7 s): letter written by the model, first draft passed the checks. It does not call the finding a possible one. It prints a line of 2 of 2 planted groups.
- pos-nofact.csv, Model 1 (8.6 s): Diltiazem is supplied, but there is no record of heart failure or NYHA class. This is a possible finding.
- pos-nofact.csv, Model 2 (8.2 s): Diltiazem (Cardizem CD) is supplied on multiple dates including L002, L005, L008, L011, L014, L017, L020, L023, and L026. The record contains no CONDITION, RESULT, or OBSERVATION line regarding heart failure or NYHA class.
- pos-nofact.csv, Model 3 (1.8 s): letter written by the model, first draft passed the checks. It carries the line "The record we hold does not show". It asks the doctor to confirm. It prints a line of 1 of 1 planted groups.
- near-miss.csv, Model 1 (6.2 s): Diltiazem is supplied, but the record shows heart failure NYHA class II, which does not meet the criterion for NYHA class III or IV.

### START B3: Coronary artery disease with no ACE inhibitor

From W144. Facts it needs: condition: Coronary artery disease (for example previous heart attack, stent, bypass or angina).

| History | Lines (facts) | Suspected | Possible | Missing facts | Confirmed | Cited lines | Expected | As expected |
|---|---|---|---|---|---|---|---|---|
| pos-fact.csv | 47 (1) | yes | no | - | yes | L001 | a confirmed finding with the planted lines | YES. Confirmed, with the planted lines. |
| pos-nofact.csv | 38 (0) | yes | yes | Coronary artery disease (for example previous heart attack, stent, bypass or angina) | yes | L001 L005 L006 L010 L014 L018 L022 L025 L027 L031 L035 | a possible finding at the bell | YES. Confirmed as a possible finding. |
| near-miss.csv | 37 (1) | no | no | - | - | - | no finding | YES. Model 1 suspected nothing. |

- pos-fact.csv, Model 1 (6.5 s): The patient has a recorded condition of coronary artery disease, and no ACE inhibitor from Group A was supplied in the last six months. This is a finding.
- pos-fact.csv, Model 2 (7.3 s): The record contains a CONDITION line for coronary artery disease (L001) and no supplies of Group A ACE inhibitors (perindopril, ramipril, lisinopril, enalapril, quinapril, trandolapril, captopril) are present in the dispensing history, including the last six months.
- pos-fact.csv, Model 3 (1.4 s): letter written by the model, first draft passed the checks. It does not call the finding a possible one. It prints a line of 1 of 1 planted groups.
- pos-nofact.csv, Model 1 (11.5 s): Group B medicines (isosorbide mononitrate and glyceryl trinitrate) are present, but no Group A (ACE inhibitor) medicine was supplied in the last six months. There is no condition line for coronary artery disease, making this a possible finding.
- pos-nofact.csv, Model 2 (7.5 s): Group B medicines (isosorbide mononitrate and glyceryl trinitrate) are supplied within the last six months (e.g., L025, L027, L031, L035), but no Group A (ACE inhibitor) medicines are present in the record. The record contains no condition line confirming coronary artery disease.
- pos-nofact.csv, Model 3 (4.3 s): letter written by the model, second draft passed the checks. It carries the line "The record we hold does not show". It asks the doctor to confirm. It prints a line of 1 of 1 planted groups. Check notes: First draft: The words "should" tell the doctor what to do. The letter should ask for a review. The letter was drafted again. The second draft passed the checks.
- near-miss.csv, Model 1 (6.4 s): The patient has a condition line for coronary artery disease and is currently taking perindopril (an ACE inhibitor) within the last six months. This is case 3: no finding.

### Demo criterion (NSAID with an anticoagulant): Test stand-in: an NSAID supplied with an oral anticoagulant

From the repository. Facts it needs: none.

| History | Lines (facts) | Suspected | Possible | Missing facts | Confirmed | Cited lines | Expected | As expected |
|---|---|---|---|---|---|---|---|---|
| positive.csv | 45 (0) | yes | no | - | yes | L030 L035 L036 L040 L041 L045 | a confirmed finding with the planted lines | YES. Confirmed, with the planted lines. |
| near-miss.csv | 43 (0) | no | no | - | - | - | no finding | YES. Model 1 suspected nothing. |

- positive.csv, Model 1 (7.7 s): Celecoxib (Group A) and rivaroxaban (Group B) are both present, and their supply dates overlap.
- positive.csv, Model 2 (7.4 s): Celecoxib (L036, L041) and rivaroxaban (L030, L035, L040, L045) are both present in the history with supply dates that overlap or fall within 60 days of each other.
- positive.csv, Model 3 (1.9 s): letter written by the model, first draft passed the checks. It does not call the finding a possible one. It prints a line of 2 of 2 planted groups.
- near-miss.csv, Model 1 (5.1 s): The patient is taking rivaroxaban (Xarelto), but no medicines from Group A (NSAIDs) are present in the dispensing history.

### Through the server: STOPP-E1, pos-nofact.csv

What the server wrote to its state file, which is what `GET /api/state` gives the page:

| What | Value |
|---|---|
| Lines imported (facts) | 35 (1) |
| Finding | state "accepted", possible: true |
| screen.missingFacts | eGFR (estimated kidney function), the most recent result |
| Lines Model 1 cited | L002 L015 L025 L035 |
| Bell badge before the accept | 1 |
| Letter | ready, written by the model |
| The letter says "The record we hold does not show" | yes |
| The letter asks the doctor to confirm | yes |

The activity log of that run:

- History imported: pos-nofact.csv, 35 lines. Screening is queued.
- Model 1 suspects a possible finding for STOPP E1 on pos-nofact.csv (criterion 1 of 1). The record does not show: eGFR (estimated kidney function), the most recent result. It goes to the second check.
- Model 1 finished screening pos-nofact.csv: 1 suspected finding goes to the second check.
- Model 2 confirmed the possible finding for STOPP E1 on pos-nofact.csv. The record does not show: eGFR (estimated kidney function), the most recent result. It is waiting for the pharmacist.
- The pharmacist accepted the finding for STOPP E1. A letter to the GP is queued.
- The letter for STOPP E1 on pos-nofact.csv is ready. The letter checks found nothing.

## 5. One letter for a possible finding, as Model 3 wrote it

STOPP E1 on `pos-nofact.csv`, from the run above. The first draft passed every letter check. The frame around
the three paragraphs is built by code. The line under "Re:" is the one section 6a asks for.

```
Example Community Pharmacy (fictional)
1 Example Street, Exampletown
Phone: (00) 0000 0000
Pharmacist: The pharmacist on duty

18 November 2026

To: Dr F. Example (fictional)
Example Family Practice

Patient: Fictional patient F-E1-02, male, 72 years
Fictional patient. No real person.

Re: Possible finding: Digoxin use
The record we hold does not show: eGFR (estimated kidney function), the most recent result.

Dear Doctor,

The patient is receiving a long-term maintenance dose of digoxin (Lanoxin PG) 62.5 microgram tablets, taking TWO tablets daily. Our records do not show the most recent eGFR (estimated kidney function) result.

Supplies of Lanoxin PG (digoxin) 62.5 microgram tablet were issued on 10 December 2025, 20 March 2026, 28 June 2026, and 6 October 2026.

Could you please confirm the most recent eGFR and review the digoxin dose against this result, as well as whether a digoxin blood level has been checked? Please let us know if we can assist further.

The criterion this is based on
STOPP E1: Digoxin at a long-term (i.e. more than 90 days) maintenance dose ≥ 125μg/day if eGFR < 30 ml/min/1.73m² (risk of digoxin toxicity if plasma levels not measured).
Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
Text reproduced without changes.

Dispensing lines from our records
2025-12-10 | Lanoxin PG (digoxin) 62.5 microgram tablet | qty 200 | repeats 5 | Take TWO tablets daily | Dr C. Demo
2026-03-20 | Lanoxin PG (digoxin) 62.5 microgram tablet | qty 200 | repeats 4 | Take TWO tablets daily | Dr C. Demo
2026-06-28 | Lanoxin PG (digoxin) 62.5 microgram tablet | qty 200 | repeats 3 | Take TWO tablets daily | Dr C. Demo
2026-10-06 | Lanoxin PG (digoxin) 62.5 microgram tablet | qty 200 | repeats 2 | Take TWO tablets daily | Dr C. Demo

What a dispensing history cannot show
The latest kidney test if none is on the record, any digoxin blood level, whether the dose was changed after the test, and the reason digoxin is used.

Yours sincerely,

The pharmacist on duty
Example Community Pharmacy (fictional)

Drafted by a local AI model, reviewed and edited by the pharmacist.
```

## 6. A wider sample: fourteen more drafted criteria

Three criteria are a small sample, so fourteen more were run the same way, without letters:
`node tools\prove-records.mjs --no-demo --only <names>`, in two runs. They were picked to cover what
the three do not: a check that should have been done (PINCER 3), a rule that needs one of several
facts (STOPP B9 with four, STOPP D1 with eight), a rule that needs several facts at once
(OPTIMISE T2-07, START E3), observations (STOPP K6, EU7-F46, START L4), more START items, and
criteria whose answer part has only two histories.

| Criterion | Facts it needs | History | Suspected | Possible | Confirmed | Planted lines cited | As expected |
|---|---|---|---|---|---|---|---|
| PINCER-3 | 1 result | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| PINCER-3 | 1 result | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| PINCER-3 | 1 result | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| STOPP-B9 | 3 results, 1 condition | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| STOPP-B9 | 3 results, 1 condition | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| STOPP-B9 | 3 results, 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| STOPP-D1 | 6 conditions, 2 observations | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| STOPP-D1 | 6 conditions, 2 observations | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| STOPP-D1 | 6 conditions, 2 observations | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| PINCER-1 | 1 condition | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| PINCER-1 | 1 condition | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| PINCER-1 | 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| STOPP-K6 | 1 observation | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| STOPP-K6 | 1 observation | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| STOPP-K6 | 1 observation | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| OPTIMISE-T2-07 | 2 observations, 1 condition | pos-fact.csv | yes | no | yes | 3 of 3 groups | YES. Confirmed, with the planted lines. |
| OPTIMISE-T2-07 | 2 observations, 1 condition | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| OPTIMISE-T2-07 | 2 observations, 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| START-L4 | 1 observation | pos-fact.csv | yes | no | yes | 1 of 1 groups | YES. Confirmed, with the planted lines. |
| START-L4 | 1 observation | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| START-C1 | 1 condition | pos-fact.csv | yes | no | yes | 1 of 1 groups | YES. Confirmed, with the planted lines. |
| START-C1 | 1 condition | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| START-C1 | 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| START-E3 | 3 results, 1 condition | pos-fact.csv | yes | no | yes | 3 of 3 groups | YES. Confirmed, with the planted lines. |
| START-E3 | 3 results, 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| START-D4 | 1 condition | pos-fact.csv | yes | no | yes | 1 of 1 groups | YES. Confirmed, with the planted lines. |
| START-D4 | 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| BRISNIK-OP-INSO1 | 1 condition | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| BRISNIK-OP-INSO1 | 1 condition | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| EU7-F46 | 1 observation | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| EU7-F46 | 1 observation | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| EU7-F46 | 1 observation | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| BANSAL-S15 | 1 result | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| BANSAL-S15 | 1 result | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| BANSAL-S15 | 1 result | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |
| STOPP-D6 | 1 result | pos-fact.csv | yes | no | yes | 2 of 2 groups | YES. Confirmed, with the planted lines. |
| STOPP-D6 | 1 result | pos-nofact.csv | yes | yes | yes | 1 of 1 groups | YES. Confirmed as a possible finding. |
| STOPP-D6 | 1 result | near-miss.csv | no | no | - | - | YES. Model 1 suspected nothing. |

38 of 38 histories as expected. Findings with the fact: 13 of 13. Possible findings: 11 of 11. Near misses kept from the bell: 14 of 14.
Model 1: 38 calls, 8.5 s on average. Model 2: 24 calls, 9.4 s on average.

## 7. A criterion without facts is asked exactly what it was asked before

The first ten criteria passed their first scored run this morning. They must not be asked anything
new. This was checked in three ways.

1. **Every request, byte for byte.** The engine code of the baseline commit and the code of today
   were both run on the 20 criteria and 63 histories of the baseline commit, with a stand-in that
   records what the model is sent. The two runs sent the same thing: 237 screen requests,
   177 double-check requests and 354 letter requests, identical in model, answer form, prompt and
   room for the answer. The CSV reader gave the same lines and the same problems for all
   63 histories. What the jobs made of the answers was the same too.
2. **Pinned in a unit test.** `pipeline\unchanged.test.ts` holds the hashes of the screen, part,
   double-check and letter requests of the test criterion, taken from the baseline commit. If one
   of them changes, the test fails.
3. **With the real models.** The demo positive and the demo near miss were run again (the table
   above). The positive was confirmed with the planted lines. The near miss ended clear.

The new answer form, the three cases and the note "DATES" are used only for a criterion whose file
has `needs_facts`. The letter model is asked to name recorded facts only when a fact line is among
the cited lines, and is told about a possible finding only when the finding is one. One thing does
change for every criterion: when a record holds a fact line, the heading above the lines says
"DISPENSING HISTORY WITH RECORDED FACTS". For a history of supplies only, nothing is new.

## 8. What the live runs showed, and what was done about it

- **Counting months back.** In the first wider run PINCER 3 missed its planted finding. Model 1
  found the right two dates, a result of 2025-06-04 and a latest date of 2026-09-19, and then wrote
  that the result lay "within 15 months". It is 15 months and 15 days. So the counting is now done
  for the models: a criterion that needs facts and counts months back from the end of the record
  gets a short note, "DATES", with the latest date and the date each count of months before it.
  With the note Model 1 wrote "more than 15 months before the latest date (2025-06-19)" and the
  finding was confirmed. 71 of the 256 drafted criteria that need facts get this note. It is
  calendar arithmetic only. It names no medicine and decides nothing.
- **A letter about a medicine that is missing.** For START B3 with the condition on the record,
  only the condition line is cited. In a run at 13:14 the letter said "No medicines were identified
  in the provided evidence". When the evidence holds facts and no supply, the letter model is now
  told that the finding is about a medicine that is not supplied. In the run of section 4 the letter
  says "Our dispensing records show no recent supply of an Angiotensin Converting Enzyme (ACE)
  inhibitor."
- **"Should" in a first draft.** In the run of section 4 one letter (START B3, no condition on the
  record) needed a second draft, because the first held the word "should". The second draft passed.
  The wording check did its job.

## 9. Limits, and what was not done

- **Only a sample was run with the real models**: 17 of the 256 drafted criteria that need facts.
  The scorer has to run the rest. The sample was chosen to cover each kind of fact, a rule that
  needs one of many facts, a rule that needs several, a medicine that should be there, and a
  check that should have been done.
- **The second model does not change the mark "possible".** It confirms or turns back, as section
  6a says. If Model 1 calls a fact missing and Model 2 then finds its line, the finding is still
  shown as a possible finding, with the fact line among its lines. This did not happen in the runs.
- **A criterion file that does not load is left out of the screening.** It is named on the
  server's start screen and once in the activity log, and the other criteria stay in use. The
  history is then counted as screened without it. The task said to change nothing else in the
  server, so this was not changed. All 387 drafted criteria load today.
- **A fact from a PDF or a scan.** Fact lines are made by the CSV reader only. A PDF row is plain
  text. For a criterion that needs facts, a finding on such a history is always shown as a
  possible finding, because none of its lines is a fact line.
- **A long history with fact lines** is covered by unit tests with a stand-in model. It was not run
  with the real models: every drafted history fits in one call (the longest has 86 lines).
- **The note "DATES" is given only to criteria with `needs_facts`.** A criterion without facts
  that counts months back does not get it, because its prompt must stay as it is. Two of the 131
  drafted criteria without facts count months back from the end of the record: START-H6 and START-H9.
- **A possible START finding.** Its letter names the medicines that point to the condition and
  asks the doctor to confirm the condition. It does not always say in so many words that the
  medicine the criterion is about is not supplied. The pharmacist reads and edits every letter.
- **One criterion block is very large.** EU7-F57 lists so many medicines that its block is 20,433
  characters. Its largest screen prompt is about 11,500 tokens of the 16,384. It fits today. A
  history much longer than its test histories would not.
- **Not seen with the real models:** a possible finding turned back by Model 2, a letter for a
  possible finding built from the template, and a criterion file that does not load. These paths
  are covered by unit tests.

## 10. Where this differs from section 6a, and why

Nothing in section 6a was left out. These points go beyond its words, or settle something it
leaves open.

| Point | What was done | Why |
|---|---|---|
| The answer form | `missing_facts` is in the form only for a criterion with `needs_facts`. There it is always asked for and may be empty. | A new field in the form of the first ten would change what the first model writes for them. |
| The double-check | Its answer form is unchanged. It is told the missing facts and the three cases. It does not change "possible". | Section 6a gives Model 2 two jobs: confirm a possible finding as possible, and turn back. The contract has no new field for it. |
| A finding with no fact line | Shown as a possible finding, with a note. | A fact must not be taken as recorded when no line is cited for it. |
| The names of missing facts | Written as the criterion writes them when a name fits exactly one fact. | The bell and the letter then use the signed wording. |
| CSV | A record type that is not known, a fact row with no detail, and a fact row that also names a medicine are reported as problems. A file with facts and no supply is "no supply rows". A fact with no date is not a problem. | An unreadable record is never "no findings". |
| Loading criteria | `loadCriteria` stops only when the list cannot be read or no criterion loads. A file that does not load is passed to a caller's function, and the scorer's entry point writes it to the error output. | "Reported by name" needs a way out of a function that returns a list. |
| The letter | The line "The record we hold does not show" stands under the "Re:" line. The heading over the lines reads "Lines from our records" when a fact line is cited. | A possible finding must not be read as a settled one. A result is not a dispensing line. |
| The note "DATES" | Added. See section 8. | A planted finding was missed without it. |
| Old state files | Filled in when loaded: no list means an empty list, no mark means not possible. | The contract makes both fields always there. |

## 11. How to run it again

Start Ollama first (`start-ollama.ps1`). Stop other model work: there is one GPU.

```
cd %USERPROFILE%\ClinicaLANTERN-Lantern
node tools\prove-records.mjs --letters --server
node tools\prove-records.mjs --no-demo --only PINCER-3,STOPP-B9,STOPP-D1
node tools\prove-records.mjs --list
npm run typecheck
npm test
```

The first line is the run of section 4 (about four minutes). `--only` takes any drafted criteria
by name. `--list` names the drafted criteria that need facts and calls no model. The tool reads
the wave folders where they are. It writes nothing unless `--write` or `--json` names a file.
