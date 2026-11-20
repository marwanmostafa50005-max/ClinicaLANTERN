# THE FOUNDER'S SIGN-OFF PACK

What you are asked to do, and how: read, correct, sign. You sign in your sign-off tool on this
PC (http://127.0.0.1:8790), one criterion at a time, with Sign or Needs a change; the criteria
below are the reference for your reading. You can also sign by telling Claude. Nobody signs for
you. Until you sign, every criterion is a draft. This pack was assembled on Thursday 19 November
in the early morning and grows with the day's results; the newest measured numbers always live
in docs\RESULTS.md. Nothing here says "validated", "approved" or "never misses".

## What only you can do

Read and sign the criteria, their medicine lists and the answer sheet. Read one letter per
criterion. Confirm the rights for the criterion text shown. Write slides 2 and 14. Record or
approve the video and upload it. Publish the judges' link. Fill the form and submit.

## The count (newest measured numbers live in docs/RESULTS.md)

10 criteria pass the planted-finding test (the measured run of Wednesday 18 November 09:30,
10 of 10, on histories the founder has not signed); 0 are signed by the clinical reviewer.

## Changes made since the proposal

1. STOPP-B13 converted to the fact set of docs/SPEC.md section 6a (commit 81eeec0, from Gemini
   GM01's "wrong" verdict, per the founder's ruling of 18 November that records may carry results
   and a missing fact falls back to a possible finding): needs_facts now lists a serum potassium
   result within 6 months; the rule for the models says when the record holds no serum potassium
   line it is a possible finding, when the newest result is more than 6 months old it is a finding,
   and when a result within 6 months is present there is no finding; cannot_be_seen now says what
   cannot be seen when the record holds no line about it. The test histories are now pos-fact.csv
   (a potassium result from July 2025, stale), pos-nofact.csv (no potassium line, the possible
   finding) and near-miss.csv (potassium checked September 2026, no finding). The medicine patterns
   are the ones the criterion already had.
2. STOPP-A3 medicine list: added Australian brands already vetted in this repository and confirmed
   in the local SNOMED CT-AU derived lists: diclofenac += Arthrotec, Clonac, Voltaren Rapid;
   naproxen += Proxen SR; meloxicam += Meloxibell; codeine += Panafen Plus (commit 46c8450).
3. STOPP-C14 medicine list: carvedilol += Dilasig, Vedilol (commit 46c8450; Gemini raised the same
   point as a doubt — already done before its note landed).

## For the founder, from Gemini's second opinion on the first ten (GM01, 18 November 15:47)

Nine "doubt" points, one per criterion except B13 which was "wrong" and is fixed above. Each names
a question only the signing pharmacist can settle; none changes a file until he says so.

- All nine supply-window criteria: rule_for_models uses a 60-day supply window; the published
  statements give no number of days. The 60-day window is this prototype's convention. Confirm it.
- All nine: STOPP v3 applies to patients 65 and older; the histories show patient_age but the rule
  for the models does not mention age. Confirm that age is read outside the rule, or that it should
  be added.
- STOPP-C10: whether skin gels, creams and eye drops should be named again inside the rule for the
  models (the group note already excludes them); whether Movalis should stay in the meloxicam list;
  whether parecoxib (Dynastat) and flurbiprofen (Strepfen) belong in the NSAID list; the must_cite
  lists name early anticoagulant rows far outside the 60-day window as acceptable citations —
  confirm that citing any ongoing supply is intended.
- STOPP-B3: same window and age questions; whether Kredex, Lobivon, Minax XL, Metrol-XL, Mistrom
  and Dilzem are sold in Australia (kept for now); the must_cite lists include beta-blocker rows
  outside the 60-day window — confirm citing any ongoing supply is intended.
- STOPP-C14: whether a short antibiotic course finished weeks before the anticoagulant started
  should count (the 60-day window flags it); whether Group B should stay limited to the statement's
  examples or add major P-gp inhibitors sold in Australia (ritonavir/Paxlovid, cobicistat,
  posaconazole, diltiazem); whether Kredex, Amdarone and Ranexa are sold in Australia (kept for
  now); must_cite includes rivaroxaban rows outside the window — confirm citing any ongoing supply
  is intended.
- STOPP-D18: whether pyridostigmine (Mestinon, peripheral) belongs in Group A of a central nervous
  system criterion; whether Group B should add ivabradine (Coralan) and amiodarone; whether Exelon
  Patch strength variants (Exelon Patch 5, Exelon Patch 10) should be listed; the same window,
  age and brand questions as B3.
- STOPP-L2, STOPP-D8, STOPP-A3, STOPP-B11, PINCER-9: the window and age questions; the local
  SNOMED CT-AU derived lists do not cover these criteria's medicines, so the medicine lists stand
  as curated (the SNOMED check record is in data/k01/snomed-check-summary.md).

Note on brand questions: the local SNOMED derived lists are a partial snapshot (even Mobic is not
in them), so they cannot settle what is sold in Australia. The brands named above stay in the
files until the founder rules.

## From Gemini's second opinion on the nine reserves (GM01-reserves, 18 November 16:10)

Eight "doubt" and one "wrong" (PINCER-10, fixed below). Each doubt names a question for the
signing pharmacist.

- All eight: rule_for_models adds a 60-day supply window where the statement gives none (this
  prototype's convention) and leaves out the published age limit (STOPP v3: 65 years and over;
  PROMPT: 45 to 64). Confirm both.
- BRISNIK-HR-F2: whether analgesic-dose aspirin products (Disprin, Aspro Clear, Aspalgin) should
  count in the antiplatelet group; the must_cite lists accept supplies far outside the window —
  confirm citing any ongoing supply is intended.
- STOPP-M1: the group lists are a closed selection that leaves out some systemic anticholinergics
  (hyoscine, prochlorperazine, pizotifen) and has no eye-drop/skin-product note; a switch from one
  anticholinergic to another within 60 days would be flagged — confirm both.
- EU7-F14: the rule flags younger adults when age is missing from the record — confirm; and the
  statement is the extract's five-row table text verbatim (with table codes) while
  statement_origin says "entrant": a rights and wording question for the founder.
- PROMPT-CN-4: the 60-day maximum gap between supplies is added, and a first 30-tablet nightly
  pack counts as more than 28 days; the PROMPT age band (45 to 64) is not in the rule and the test
  patients are 66 to 73; whether Imoclone is sold in Australia.
- STOPP-C13: only oral forms should count (diltiazem rectal ointment exists); the must_cite lists
  accept dabigatran supplies outside the window — confirm citing any ongoing supply is intended.

## Changes made to the reserves from GM01-reserves

4. PINCER-10 (commit 8574431, Gemini's "wrong", checked against the published statement): the rule
   now matches the statement — a current course (most recent amiodarone supply within the last
   three months of the record) of more than one month (more than 31 days, the prototype
   convention) with directions giving more than 200 mg a day, and the 200 mg tablet directions
   are read in whatever words ("HALF a tablet daily" and "ONE tablet once daily" do not meet it).
   pos-buried.csv now plants the four amiodarone supplies in the record's last three months
   (June to September 2026), in date order; must_cite and the answer sheet follow. The brand
   question on Rithmik and Amdarone stays a doubt for the founder.

## Changes made to further criteria after adoption (18 November evening)

5. EU7-F28 (commit ecbcef2, Gemini GM01-wave-104 "wrong"): terazosin now counts only when the
   record shows blood-pressure use (a hypertension condition row or directions); a record showing
   another use (for example prostate symptoms) is not a finding; terazosin with the use not shown
   is still reported, naming that. A part re-score on the real models follows.
6. EU7-F07 (wave W101-r1, applied in 73d1358, Gemini GM01-wave-101 "wrong"): the repaired rule
   counts a line that says only hyoscine or scopolamine, excludes belladonna alkaloid bowel
   combinations (Donnatab, Donnalix, Donnagel), and sends a possible palliative-care use to the
   pharmacist. The repair passed its re-score.
7. EU7-F46 and EU7-F54 (Gemini GM01-waves 106/107 "wrong") went to Kimi Work for the one repair
   each (repair-W106-r1.md, repair-W107-r1.md); the earlier versions stay in use until the repairs
   pass.
