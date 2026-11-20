# ClinicaLANTERN test results

Fictional patients only. No real person is in these histories.

Stage: Prototype. This is one measured run on one computer. It is not a validation.

## The run

- When: 2026-11-18 08:30:49 to 2026-11-18 08:31:28, local time. It took 39 s.
- Models, by the names in the settings file: Model 1 `lantern-screen` screens. Model 2 `lantern-check` double-checks. Model 3 `lantern-letter` writes the letters.
- Ollama address in the settings file: `http://127.0.0.1:27435`.
- Answer sheet: `cases/_demo/expected.demo.json`. Not signed by the clinical reviewer yet.
- Histories: 2 of the 2 in the answer sheet. With a planted finding: 1. Near misses: 1. Clean: 0.
- Criteria: 1 of the 1 active. Signed by the clinical reviewer: 0 of 1.
- Model calls made: 2 to screen, 1 to double-check, 1 to write letters.

## The result

- Criteria that PASS: 1 of 1.
- Planted findings caught: 1 of 1.
- False flags: 0. A false flag is counted and shown. It is not a failure.
- Suspected findings that Model 2 turned back, where nothing was planted for that criterion: 0.
- Calls that could not be completed: 0. A failed call is never counted as a clean result.
- Letters: 1 of 1. Written by the model with no check notes: 1. Written by the model with check notes: 0. Built from the template: 0. Missing: 0.
- Time in model calls: 39 s. Screen: 11.0 s, 5.5 s each on average. Double-check: 17.7 s, 17.7 s each on average. Letters: 10.6 s, 10.6 s each on average.

| Criterion | Result | Caught / planted | Criterion text | False flags | Failed calls | Letters | Seconds |
|---|---|---|---|---|---|---|---|
| Demo criterion (NSAID with an anticoagulant) | PASS | 1 / 1 | yes | 0 | 0 | 1 of 1: 1 by the model | 39.3 |

## Misses

None. Every planted finding in this run was caught.

## False flags

A false flag is a confirmed finding where nothing was planted. It is counted and shown. It is not a failure.

None in this run.

## Calls that could not be completed

None in this run.

## Letters

- **Demo criterion (NSAID with an anticoagulant)** on `_demo/positive.csv`. Written by the model. The letter checks found nothing.

## How to read the table

- PASS: every planted finding was caught, the criterion text and its credit line are attached, and a letter was produced for every caught finding.
- PASS (part run): nothing failed, but the run did not cover everything. It is not a full pass.
- FAIL: a planted finding was missed, or the criterion text is missing, or a letter is missing.
- NOT TESTED: no planted finding for the criterion was in this run.
- Caught: Model 2 confirmed the finding, and the planted lines were cited by Model 1 or by Model 2.
- Criterion text: yes when the criterion file has its statement and its credit line. The app shows them with the finding.
- False flags: confirmed findings where nothing was planted. They are never a failure.
- Failed calls: model calls that could not be completed, and histories that could not be read.
- Letters: a letter built from the template counts as a letter. It is counted on its own. A text without the criterion text is not counted as a letter.
- Seconds: time spent in the model calls for the criterion. The first call to a model includes loading it.

The file `results.json` in this folder holds everything. The folder `raw` holds every model answer.
