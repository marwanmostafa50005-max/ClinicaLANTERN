# ClinicaLANTERN test results

Fictional patients only. No real person is in these histories.

Stage: Prototype. This is one measured run on one computer. It is not a validation.

## The run

- When: 2026-11-18 11:16:22 to 2026-11-18 11:17:55, local time. It took 1 min 33 s.
- Models, by the names in the settings file: Model 1 `lantern-screen` screens. Model 2 `lantern-check` double-checks. Model 3 `lantern-letter` writes the letters.
- Ollama address in the settings file: `http://127.0.0.1:27435`.
- Answer sheet: `cases/_demo/expected.demo.json`. Not signed by the clinical reviewer yet.
- Histories: 3 of the 3 in the answer sheet. With a planted finding: 2. Near misses: 1. Clean: 0.
- Criteria: 1 of the 1 active. Signed by the clinical reviewer: 0 of 1.
- Model calls made: 3 to screen, 2 to double-check, 2 to write letters.

## The result

- Criteria that PASS: 1 of 1.
- Planted findings caught: 2 of 2.
- False flags: 0. A false flag is counted and shown. It is not a failure.
- Suspected findings that Model 2 turned back, where nothing was planted for that criterion: 0.
- Calls that could not be completed: 0. A failed call is never counted as a clean result.
- Letters: 2 of 2. Written by the model with no check notes: 2. Written by the model with check notes: 0. Built from the template: 0. Missing: 0. Without the planted lines: 0.
- Time in model calls: 1 min 33 s. Screen: 60.1 s, 20.0 s each on average. Double-check: 20.5 s, 10.3 s each on average. Letters: 12.3 s, 6.2 s each on average.

| Criterion | Result | Caught / planted | Criterion text | False flags | Failed calls | Letters | Seconds |
|---|---|---|---|---|---|---|---|
| Demo criterion (NSAID with an anticoagulant) | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2: 2 by the model | 92.9 |

## Misses

None. Every planted finding in this run was caught.

## False flags

A false flag is a confirmed finding where nothing was planted. It is counted and shown. It is not a failure.

None in this run.

## Calls that could not be completed

None in this run.

## Letters

- **Demo criterion (NSAID with an anticoagulant)** on `_demo/positive.csv`. Written by the model. The letter checks found nothing.
- **Demo criterion (NSAID with an anticoagulant)** on `_demo/long-split.csv`. Written by the model. The letter checks found nothing.

## How to read the table

- PASS: every planted finding was caught, the criterion text and its credit line are attached, and a letter was produced for every caught finding.
- PASS (part run): nothing failed, but the run did not cover everything. It is not a full pass.
- FAIL: a planted finding was missed, or the criterion text is missing, or a letter is missing, or a letter does not show the planted lines, or a call could not be completed on a history with a planted finding.
- NOT TESTED: no planted finding for the criterion was in this run.
- Caught: Model 2 confirmed the finding, and the planted lines were cited by Model 1 or by Model 2. The app shows the lines of both models under the bell and prints them in the letter.
- Criterion text: yes when the criterion file has its statement and its credit line. The app shows them with the finding.
- False flags: confirmed findings where nothing was planted. They are never a failure.
- Failed calls: model calls that could not be completed, and histories that could not be read.
- Letters: a letter built from the template counts as a letter. It is counted on its own. A text without the criterion text is not counted as a letter. A letter must show the planted lines.
- When Model 3 did not answer at all, the template letter is still shown, and the failed call is listed under "Calls that could not be completed".
- Seconds: time spent in the model calls for the criterion. The first call to a model includes loading it.

The file `results.json` in this folder holds everything. The folder `raw` holds every model answer.
