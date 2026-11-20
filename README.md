# ClinicaLANTERN

ClinicaLANTERN helps a community pharmacist screen a dispensing history, write to the patient's GP,
and track the case until the doctor's answer is on record. It runs open models on the pharmacy's own
computer through Ollama. Three local models work one after another: Mantle screens the history
against each criterion, Lumen double-checks each suspected finding, and Ogee drafts each finding's
letter part. Code assembles those parts into one letter for the patient, with one head, one ending
and one signature. The pharmacist decides at every step.

The stage is Prototype. Every patient in every test history is fictional. No real person, pharmacy
or doctor is involved.

## The three things the organiser asks for

**Working prototype.** How to start it and how to run the tests: `docs\RUNNING.md`. Before you start,
this computer needs Node 24 or newer, Ollama with the three local models named in that file (shown on
the page as Mantle, Lumen and Ogee), and a graphics card with about 24 GB of memory.

**Demonstration film (at most three minutes).** [[FILL: where the film is | the coordinator, at the end]]

**Technical documentation.** `docs\TECHNICAL_DOCUMENTATION.md` is the organiser's document.

- System architecture: how the page, server, models, criteria and state file connect.
- Dataset assumptions: what a dispense history is, what it does not hold, and how the criteria are built.
- Clinical boundaries: who decides, what a finding is, and what the reader does not interpret.
- Limitations: what one history cannot do, speed, scoring limits, and what was not measured.

## What it does today

- Screens an imported CSV or PDF history against every criterion in use (`docs\SPEC.md` sections 1, 6 and 7).
- Double-checks each suspected finding with the second model before anything reaches the bell (`docs\SPEC.md` section 7.2).
- Asks the pharmacist for facts the dispensing record cannot hold (`docs\SPEC.md` section 6b; `docs\TECHNICAL_DOCUMENTATION.md` under **Path of one dispense history**, step Questions).
- Reads an uploaded pathology test at a result question (path-O-finder). The panel carries this line:
  "Every result finds its path, and every path is one a pharmacist chose."
  (`docs\TECHNICAL_DOCUMENTATION.md`, **Reading a pathology test at the question**).
- Uses shared condition medicine lists when the `conditionMarkers` switch is on: a supplied medicine
  that points to a condition can open that condition's question (`docs\TECHNICAL_DOCUMENTATION.md`,
  **Condition markers**). Checked-in configuration keeps the switch off; [[FILL: conditionMarkers on or off in the recorded test | the coordinator]].
- Drafts letter parts with the third model and assembles one combined patient letter in code
  (`docs\SPEC.md` sections 1 and 7.3; `docs\TECHNICAL_DOCUMENTATION.md`, step Letter).
- Tracks each letter through sent, reply recorded, closed, or overdue until the doctor's answer is recorded
  (`docs\SPEC.md` section 1, step 5).

## What was measured

`docs\RESULTS.md` holds the measured numbers from fictional test histories. This is not clinical validation.

[[FILL: criteria in use]]

[[FILL: criteria that pass the final test, as one percentage]]

[[FILL: criteria signed by the clinical reviewer]]

## Clinical boundaries and limits

The pharmacist accepts, bypasses or dismisses every finding and must preview a letter before it is sent
(`docs\TECHNICAL_DOCUMENTATION.md`, **The pharmacist decides**).

Every test patient and prescriber name is fictional; real dispensing exports must not be imported
(`docs\TECHNICAL_DOCUMENTATION.md`, **Test data**; `docs\SPEC.md` section 6).

Diagnoses, laboratory results and observations are not inferred from supplies alone; criteria declare
what must be known and the pharmacist may answer questions (`docs\TECHNICAL_DOCUMENTATION.md`,
**What a dispense history does not hold**).

A finding is a flag with cited lines, not a diagnosis; nothing here is medical advice and no patient
outcomes were measured (`docs\TECHNICAL_DOCUMENTATION.md`, **Evidence, not outcomes**).

The full list of limits (one history at a time, scoring on planted findings only, hardware timing, and more)
is under **Limitations** in `docs\TECHNICAL_DOCUMENTATION.md`. How a criterion passes is in `docs\SCORING.md`.

## Sources and licences

Every source of the criteria in use and its licence line: `docs\SOURCES_AND_LICENCES.md`.

Until the founder confirms a source, criterion files keep `licence_status: "proposed"`. That label means
the project has recorded a licence from a publisher page, from an earlier project extract, or from a
delegated reader. It is not the publisher's written confirmation (`docs\SOURCES_AND_LICENCES.md`, opening paragraphs).
Licence of the code: to be stated by the author.
