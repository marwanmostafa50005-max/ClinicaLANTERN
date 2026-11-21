# ClinicaLANTERN

1. [The Feasible Implementation of ClinicaLANTERN across Abu Dhabi's Healthcare System, and the Expected Benefits to the Population Health](ClinicaLANTERN%20Abu%20Dhabi%20Implementation/ClinicaLANTERN_Abu-Dhabi_Implementation%231.pdf) (20 pages)
2. [ClinicaLANTERN in the pharmacies of the UAE: feasibility study and strategic plan](ClinicaLANTERN%20Abu%20Dhabi%20Implementation/ClinicaLANTERN_Abu-Dhabi_Implementation%232.pdf) (45 pages)

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

**Demonstration.** The film that was submitted is `docs/demo/ClinicaLANTERN-demonstration-film.mp4` (2 min 42 s), with a longer cut of the same recording beside it (3 min 3 s). `docs/demo/ui-after-the-recorded-test.webp` is the home page after the recorded run, and `docs/demo/GP-letter-after-the-recorded-test.pdf` is the GP letter of that run after the pharmacist accepted its findings (45 pages, 67 points, fictional patient). The submitted deck, with the signed register of the 583 criteria and the research paper, is `docs/submission/ClinicaLANTERN-Solution-Deck.pdf`.

**Earlier work.** `docs/history/ClinicaLANTERN-static-app-introduction-2026-09-10.pdf` is the introduction, written for pharmacy owners, to the earlier static ClinicaLANTERN application of September 2026: twenty-five fixed rules and no AI at runtime. It is the entrant's own earlier work and the start of the development that led to this build. The author's e-mail address and telephone number are left out of this copy.

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
- Holds a switched-off component that could open a condition's question from a supplied medicine.
  No list of medicines is shipped in this release, the `conditionMarkers` switch is off, and the
  recorded one-patient test did not use it.
- Drafts letter parts with the third model and assembles one combined patient letter in code
  (`docs\SPEC.md` sections 1 and 7.3; `docs\TECHNICAL_DOCUMENTATION.md`, step Letter).
- Tracks each letter through sent, reply recorded, closed, or overdue until the doctor's answer is recorded
  (`docs\SPEC.md` section 1, step 5).

## What was measured

`docs\RESULTS.md` holds the measured numbers from fictional test histories. This is not clinical validation.

583

100% (583 of 583, on fictional histories with planted findings)

583 of 583

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
