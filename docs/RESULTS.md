# ClinicaLANTERN results. Prototype. Fictional patients only.

Current database and final-test state first; earlier measured runs are retained below as historical
records. Final-test numbers come only from `final-db\loop\LOOP_STATUS.txt` at the timestamp stated.
Every run used drafted test histories that the clinical reviewer has not signed. This is not a
clinical validation.

## THE COUNT

- Criteria in use: 583 (the first ten and 573 further criteria), verified from
  `criteria\active.json` and the criterion files on 20 November. Thirty-one more reached main in
  8b543b6, bringing the in-use count from 534 to 565; twelve more reached main in 874a091, bringing
  it to 577; two more reached main in 8fa5b56, bringing it to 579; three more reached main in
  ba81741, bringing it to 582; MHRA-12 reached main in 0571aab, bringing it to 583. START-H7 passed
  its late run and was brought into use in commit f28deb1. CKD-C09B, KHAWAGI-G130 and KHAWAGI-G153
  entered use in commit 6d3e8de after their own runs passed. GERARD-39 and GERARD-40 entered use in
  b69735c after their own runs passed. SCOTRESP-01 entered use in f77e39b and SCOTRESP-09 in 623c0af
  after their own runs passed.
- Criteria set aside: 7 — EU7-F20, EU7-F78, KHAWAGI-G005, KHAWAGI-G048, KHAWAGI-G157,
  POPI-54, START-F6. See `docs\SET_ASIDE.md`.
- Named candidates not in use: 0.
- Never drafted: 7, listed below.
- Criteria signed by the clinical reviewer: 0.

Fifty criteria in use currently carry `needs_facts.ask_when`; 207 criteria in use carry a `needs_facts` option list.

534 of 534 passed the final test at 04:41. Thirty-three of them were given one clearer sentence at
06:20. At 2026-11-20 20:04:56, `LOOP_STATUS.txt` reports **583 criteria and 495 PASS**, with 88 in
its repair column, 0 after eight repairs, 0 waiting for their run and 0 not on the board. Its "not
passing now" line names PROMPT-RS-4, OPTIMISE-T2-20, OPTIMISE-T3-02, OPTIMISE-T3-04, STOPP-D6,
START-C1, KHAWAGI-G162 and QLDCOAG-14-1; its "not on the board" and "repair jobs queued in this
pass" lines are empty. The same status file reports 996 of 1,007 planted findings caught, 2
disputed and 27 false flags. Its sign-off state at 20:05:34 lists 241 ready to sign, 231 passed but
not yet for signing, 8 did not pass and in repair, 80 with new text waiting for a run, and 0 runs
still to come. It also reports 7 set aside, 0 not in the final test, and 23 passed and settled
criteria whose page has not yet been brought up to date. The repository's active list has the same
583 criteria in use. This paragraph reports the timestamped `LOOP_STATUS.txt` snapshot only.

The first ten's earlier measured results remain below. Run 2 on 19 November 09:26 gave 10 of 10
PASS on the then-current text. The current status supplies no separate first-ten table; its numeric
snapshot covers the 583 criteria in use and its sign-off state lists 241 as ready to sign and 231 as
passed but not yet for signing.

## THE FIRST TEN

The final text of the first ten is in main as part of the injected final database (872c1e1).
Earlier audit corrections through W100-r1 were applied before that injection. Waves W851-W855 were
final-test copies of text already in main: nothing was adopted from them. In particular, the final
text of STOPP-B3 and BRISNIK-HR-F2 was already in main when those test copies ran. STOPP-C13's
final text is in use; the current status file's not-passing list appears under THE COUNT above
and names none as not on the board.

The historical table below is run 0 of 2026-11-18 09:30 (33 histories, 330 screen calls, 21 min
30 s), not a verdict on the current final text. Run 2 of 2026-11-19 09:26 (quick shape, 180 screen
calls, 20 min) also gave 10 of 10 PASS on the then-current text, with 20 of 20 planted caught, 3
false flags in the 120-screening sample (2.5%) and 0 failed calls.

Historical run 0 results:

- Criteria that PASS: 10 of 10.
- Planted findings caught: 20 of 20.
- False flags: 0 (on 10 near-miss and 3 clean histories). Counted, not failures.
- Suspected findings that Model 2 turned back, where nothing was planted for that criterion: 2.
  By the founder's ruling of 18 November these are the two disputed near-misses of the old table's
  wording; they fail no criterion.
- Calls that could not be completed: 0.
- Letters: 20 of 20, all written by the model with no check notes; 0 built from the template.

| Criterion | Result | Caught / planted | Criterion text | False flags | Failed calls | Letters |
|---|---|---|---|---|---|---|
| STOPP C10 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP B3 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP B13 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP C14 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP D18 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP L2 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP D8 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP A3 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| STOPP B11 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |
| PINCER 9 | PASS | 2 / 2 | yes | 0 | 0 | 2 of 2 |

STOPP-B13's histories changed after run 0 (fact set of section 6a, commit 81eeec0). Run 1
attempted the new set but was stopped without a table. The current status supplies no separate
criterion-level table for STOPP-B13.

## FURTHER CRITERIA

There are 573 further criteria in use. Their current verdicts are part of the final-test totals at
the top of this file. Earlier wave results below are historical records from before the final
database injection; each history ran against its own criterion on fictional, unsigned test data.

- Batch 20261119-0947 (W161-r1, W181-r1, W211-r1, W215-r1, W219-r1): 7 criteria PASS in that
  run; CKD-C01A did not pass because its finding did not cite fact line L027. Full table:
  `BOARD\runs\20261119-0947-waves-W161-r1-W219-r1\table.md`.
- Batch 20261119-0810 (W133-r1, W134-r1, W135-r1, W229-r1): 9 criteria PASS in that run.
  Full table: `BOARD\runs\20261119-0810-waves-W133-r1-W229-r1\table.md`.
- Batch 20261119-0820 (W141-r1, W142-r1, W232-r1, W235-r1): 4 criteria PASS in that run;
  KHAWAGI-G153 and KHAWAGI-G130 did not pass then. Both later passed and entered use in 6d3e8de.
  Full table: `BOARD\runs\20261119-0820-waves-W141-r1-W235-r1\table.md`.
- Batch 20261118-1530 (W101-W105): 38 criteria PASS, 76 of 76 planted findings caught, 0 false
  flags, 76 of 76 letters and 0 failed calls in that run.
- Batch 20261118-1604 (W106-W110): 40 criteria PASS, 80 of 80 planted findings caught, 0 false
  flags, 80 of 80 letters and 0 failed calls in that run. Full table:
  `BOARD\runs\20261118-1604-waves-W106-W110\table.md`.

## NOT PASSING, WITH THE REASON

At 2026-11-20 20:04:56, the `LOOP_STATUS.txt` test-status row labels 88 as "did not pass, in
repair", with 0 after eight repairs, 0 waiting for their run and 0 not on the board. Its "not on the
board" and "repair jobs queued in this pass" lines are empty. The sign-off breakdown at 20:05:34
lists 8 did not pass and in repair and 80 with new text waiting for a run; the 80 are therefore
reported here as new text waiting, not as named scorer failures. Repairs are handled by GPT-6.2
Astra through Claude's keeper, not by wave adoption or a repair request from Kimi Code.

The current "not passing now" line names eight criteria. The wave summary supplies these detailed
reasons:

- OPTIMISE-T2-20 (W1121): `pos-fact.csv` and `pos-nofact.csv` reached the bell, but fact line L001
  was not cited.
- OPTIMISE-T3-04 (W1120): `pos-fact.csv` reached the bell, but none of planted lines L019 and L024
  was cited.
- START-C1 (W1121): `pos-fact.csv` reached the bell, but fact line L042 was not cited.
- KHAWAGI-G162 (W1124): `pos-fact.csv` reached the bell, but fact line L042 was not cited.
- QLDCOAG-14-1 (W1124): `pos-brand.csv` reached the bell, but planted line L032 was not cited.

PROMPT-RS-4, OPTIMISE-T3-02 and STOPP-D6 are also named on the current "not passing now" line.
Their new history-level reasons are not yet in the wave summary; its older PASS rows for these three
are historical and are not used as their current verdicts.

SCOTRESP-01 entered use in f77e39b and SCOTRESP-09 in 623c0af after their own runs passed; no named
candidate remains outside use. Their earlier scored failures are retained here as history:

- SCOTRESP-01: `pos-brand.csv` and `pos-buried.csv` were not suspected after repair.
- SCOTRESP-09: `pos-buried.csv` was not suspected after repair.

Earlier Gemini second-opinion record: OPTIMISE-T3-05 (W119) was called wrong over incomplete
`must_cite` supplies, smoker scope, Haldol naming, an added threshold and missing benzodiazepine
names (`BOARD\gemini\reviews\GM01-wave-119.md`). This is an earlier opinion, not a current
final-test verdict; no current verdict is inferred from it.

The seven never-drafted criteria are listed below; they are not repair failures.

## NOT DRAFTED (7)

- OPTIMISE-T2-14 (W115): short heparin courses are also given and supplied in hospital, so a
  missing supply proves nothing. Class C, for the founder to confirm.
- OPTIMISE-T2-16 (W116): the trigger is that a lifestyle programme did not work, and no record of
  supplies, conditions, results or measurements holds that judgement.
- OPTIMISE-T2-18 (W116): the criterion asks for a medicine that is not being supplied, and the
  only trigger is one blood test result (TSH above 10 mU/L).
- OPTIMISE-T2-26 (W116): the trigger is a symptom that appears at any stage, and a dispensing
  history cannot show symptoms.
- OPTIMISE-T2-47 (W118): flagging every woman over 65 and man over 75 would be a rule about age
  alone. The pharmacist may wish to decide whether it should be merged with T2-49 or T2-48.
- OPTIMISE-T2-48 (W118): a rule built on these risk factors alone would flag a large share of
  older adults.
- OPTIMISE-T3-08 (W119): any pattern test would only say "no vitamin D supplied", which fits most
  people.

## FRESH HISTORIES

Written by Kimi Code on 19 November about 07:30 (Gemini's GM03 never landed): one positive and
one near miss for each of the ten, other patients, brands and dates than the original answer sheet, with the
answer sheet cases\expected.fresh.json. Measured the same morning on the card (BOARD\runs\20261119-fresh-ten,
full shape, 200 screen calls, 16 min): 10 of 10 criteria pass, 10 of 10 planted caught, 0 failed
calls, letters 9 of 9. Two drafter faults in the new histories were found and fixed the same hour
(STOPP-L2's opioid was worded as needed-use, which its own rule excludes; STOPP-D8's near miss held
a 20-tablet supply that lasted 20 weeks at its directed dose): after the fixes the re-check of the
two criteria caught 2 of 2 with 0 false flags (BOARD\runs\20261119-fresh-recheck). 1 false flag was
counted in the first fresh run, on the miscalibrated D8 near miss; it is not a failure.
The founder has not signed these histories.


## PDF AND SCAN ROUTES

Task K05, measured on Thursday 19 November in the early hours. For each of the 20 planted
histories of the ten, a text PDF and scan-style page pictures were made (cases\_twins\) and read
back the way the app reads them. No pharmacist confirmed the rows in this test run.

- Text PDF route: 1,099 of 1,099 printed rows read exactly (date, brand and quantity all right);
  the planted lines came back in 20 of 20 planted findings.
- Scan route (Model 1 reads each page picture): 1,094 of 1,099 printed rows read exactly; the
  planted lines came back in 20 of 20 planted findings.

Full table: `eval\results\twins-table.md`. What Mantle read from each page is kept beside the
picture as scan-<n>.read.txt.

## EVERY RUN SO FAR

Scored runs of the first ten (the original answer sheet):
- 2026-11-19 09:26 scored run 2 (quick) on main 21e60f4: the first-ten sheet, 180 screen
  calls, 20 min. 10 of 10 PASS, planted caught 20 of 20, pos-nofact 1 of 1, pos-fact 1 of 1,
  disputed 0, false flags 3 (all in the 120-screening sample, 2.5%), failed calls 0, letters
  20 of 20 (18 clean, 2 with check notes). BOARD\runs\20261119-0926-run2. Quick shape, not
  the full 330 of run 0: the near misses were not cross-screened against the other nine.

Final-test batches (test copies of text already in main; nothing was adopted from them):
- 2026-11-19 13:26 W851-W855: 34 PASS and 2 did not pass in that snapshot (OPTIMISE-T2-24 and
  OPTIMISE-T3-04, both in repair in that snapshot). The final text was already in main; these waves
  were not an adoption source.
- 2026-11-19 12:43 W901-W905: 3 newly reported PASS in that snapshot (EU7-F44, F53, F59); no
  criteria were adopted from these test copies.

Earlier audit wave batches of Thursday 19 November midday (adopted before the final freeze):
- 2026-11-19 12:31 W101-r3,W103-r3,W106-r4,W106-r5,W108-r4: 6 PASS (EU7-F08, F19, F43, F46, F47, F57; the third-look takebacks, highest -r wins).
- 2026-11-19 12:09 W112-r3,W113-r2,W113-r3,W114-r1,W115-r2: 19 PASS (PROMPT-CV/GI/IN/MS/RS, PINCER-1/2/3/4/7/8, OPTIMISE-T2-02/03/04/06/08); PROMPT-RS-4 back in use; OPTIMISE-T2-07 keeps its earlier copy while its repair is made.
- 2026-11-19 11:52 W109-r2,W110-r2,W111-r2,W111-r3,W112-r2: 20 PASS (EU7-F65-F82, PROMPT-CN/CV/DU/EN/GI).
- 2026-11-19 11:33 W106-r3,W107-r2,W108-r1,W108-r2,W109-r1: 15 PASS (EU7-F47-F71 range).

Wave batches of Thursday 19 November morning (repairs and the last fresh waves; adopted the same morning):
- 2026-11-19 09:57 W149-r2,W196-r1,W223-r1,W224-r1,W227-r2: 27 PASS (START-H6 to START-I4 minus H7; the three CARETRACK; twelve KHAWAGI; CKD-C03A, CKD-C07A, CKD-C09D, CKD-C10A, CKD-C10B); 1 not passing (CKD-C09B, its second repair failed: pos-nofact not suspected, listed). Adopted 11:05.
- 2026-11-19 09:47 W161-r1,W181-r1,W211-r1,W215-r1,W219-r1: 7 PASS (the repaired DREISCHULTE-18, DREISCHULTE-19, POISONSTD-D2-1, POISONSTD-D2-4, CKD-B01A, KHAWAGI-G007, KHAWAGI-G141); 1 not passing (CKD-C01A, repair failed: fact line L027 not cited, listed).
- 2026-11-19 08:20 W141-r1,W142-r1,W232-r1,W235-r1: 4 PASS (STOPP-J3, STOPP-J8, STOPP-J9, STOPP-K3); 2 not passing (KHAWAGI-G153, KHAWAGI-G130, listed).
- 2026-11-19 08:10 W133-r1,W134-r1,W135-r1,W229-r1: 9 PASS (STOPP-C9, STOPP-D3, STOPP-D6, STOPP-D14, STOPP-D21, STOPP-D24, STOPP-D25, CKD-A10B, CKD-M01A).
- 2026-11-19 08:06 W140-r1: 1 PASS (STOPP-I6).
- 2026-11-19 07:03 W131-r1: 8 PASS (STOPP-B4 to STOPP-B9, STOPP-C11, STOPP-C12).
- 2026-11-19 06:50 W130-r1,W227-r1: 14 PASS (STOPP-B2, STOPP-B15 to STOPP-B21; CKD-C03A, CKD-C07A, CKD-C09B, CKD-C09D, CKD-C10A, CKD-C10B).
- 2026-11-19 06:38 W128-r1: 8 PASS (BRISNIK-OP-INSO1 to INS04, BRISNIK-OP-MISC1 to MISC3, BRISNIK-OP-PAIN1).
- 2026-11-19 06:31 W188-r1: 1 PASS (GERARD-23); 2 not passing (GERARD-39, GERARD-40, listed).
- 2026-11-19 06:17 W127-r1: 8 PASS (BRISNIK-OP-DEPR2 to DEPR9).

- 2026-11-18 15:30 wave batch W101-W105: 38 criteria PASS (own-criterion runs).
- 2026-11-18 23:02 wave batch W163-W172 (Astra): 27 PASS, 2 not passing (SCOTRESP-01/09).
- 2026-11-18 22:48 wave batch W106-r1,W107-r1,W110-r1,W161,W162: 14 PASS (the three repairs among them); the first Astra criteria in use.
- 2026-11-19 02:24 wave batch W229-W235: 26 PASS, 4 not passing.
- 2026-11-19 01:55 wave batch W113-r1,W201-W215: 11 PASS; PROMPT-RS-4 repair failed and is listed; PINCER-1 and PROMPT-RS-1 repairs applied.
- 2026-11-19 02:06 wave batch W219-W228: 25 PASS, 1 not passing (CKD-C09B).
- 2026-11-19 01:40 wave batch W186-W196: 18 PASS, 2 not passing (GERARD-39/40).
- 2026-11-19 01:29 wave batch W111-r1,W112-r1,W173,W176,W181: 12 PASS (the two repairs among them); 10 fresh Astra.
- 2026-11-18 23:28 scored run 1 (quick) on main ab8f09f: stopped by the merge engine run cap
  at screen 1823 of 4784 after 120 minutes; no table, not a result. Cause and options:
  BOARD/unattended/RUN1_CAP.md. At that point the latest full first-ten table was run 0; run 2
  later supplied the 09:26 result above. What the stopped run saved (raw screens only, stage 1 of 3,
  counted 19 November 08:55): 442 histories against their own criterion (298 suspected,
  0 failed calls), 30 clean histories against the first ten (0 suspected), and 1351 false-flag
  sample screenings, of which 65 were suspected at stage 1 - suspected only: stage 2 would have
  checked each, and a history planted for its own criterion can legitimately fire on another
  criterion that shares the medicine, so these are not counted as false flags.
- 2026-11-18 21:17 wave batch W124-r1,W148-W151: 24 criteria PASS, 2 not passing (START-H7, START-L1, to repair); every drafted criterion scored.
- 2026-11-18 20:52 wave batch W120-r1,W144-W147: 33 criteria PASS; the repaired BANSAL-S07 among them.
- 2026-11-18 20:20 wave batch W139-W143: 40 criteria PASS.
- 2026-11-18 19:42 wave batch W134-W138: 40 criteria PASS.
- 2026-11-18 19:13 wave batch W119-r1,W130-W133: 33 criteria PASS; the repaired OPTIMISE-T3-05 among them.
- 2026-11-18 19:39 Kimi Code: EU7-F28 part re-score after its GM01 rule fix: PASS (2 of 2, letters 2 of 2).
- 2026-11-18 18:42 wave batch W125-W129: 40 criteria PASS.
- 2026-11-18 17:51 wave batch W101-r1,W116-W119: 26 PASS (the repaired EU7-F07 among them), 1 not passing (OPTIMISE-T3-05, to repair), 6 not drafted.
- 2026-11-18 17:20 wave batch W111-W115: 39 criteria PASS, 1 not drafted (OPTIMISE-T2-14).
- 2026-11-18 17:14 Kimi Code: the nine reserves in part runs (each on its own histories): 9 of 9 PASS, 18 of 18 planted caught, 18 of 18 letters, in 17 minutes of the card.
- 2026-11-18 16:04 wave batch W106-W110: 40 criteria PASS.

- 2026-11-18 09:30 run 0 (the merge engine's numbering starts at run 1; this run was made before
  the build began): the ten proposed criteria, 33 histories. 10 of 10 PASS. BOARD\runs\20261118-0930-run0.
- 2026-11-18 15:30 wave batch W101-W105: 38 criteria, each history against its own criterion.
  38 PASS. BOARD\runs\20261118-1530-waves-W101-W105.

## NUMBERS FOR THE WORDS

- [KIMI: criteria that pass the planted-finding test]: 495 of 583 in the test-status row at
  2026-11-20 20:04:56 (LOOP_STATUS.txt); the same file's sign-off row lists 241 ready to sign and
  231 passed but not yet for signing.
- [KIMI: criteria signed by the clinical reviewer]: 0
- [KIMI: criteria not passing]: 8 named on "not passing now" at 2026-11-20 20:04:56 (listed under
  NOT PASSING above); the test-status row labels 88 as "did not pass, in repair", while the sign-off
  row lists 8 did not pass and in repair and 80 with new text waiting for a run. 0 did not pass after
  eight repairs, 0 are waiting for their run and 0 are not on the board.
- [KIMI: first ten, criteria that pass the planted-finding test]: 10 of 10 in earlier run 2
  (2026-11-19 09:26, then-current text); the 20:04:56 final-test status supplies no separate
  first-ten table.
- [KIMI: first ten, criteria signed by the clinical reviewer]: 0
- [KIMI: first ten, criteria swapped for a reserve]: 0
- [KIMI: planted findings caught out of planted]: 996 of 1,007 in the final-test status at
  2026-11-20 20:04:56, with 2 disputed.
- [KIMI: false flags out of clean and near-miss histories]: 27 reported by the final-test status
  at 2026-11-20 20:04:56 (no denominator reported); historical run 0 had 0 of 13.
- [KIMI: number of test histories]: 1,766 entries in the two current answer sheets (33 in the
  first-ten and clean sheet; 1,733 in the further sheet), counted without a model on 20 November.
- [KIMI: findings shown with their criterion text]: 20 of 20 in historical run 0; not reported by
  the current LOOP_STATUS.txt summary.
- [KIMI: letters that passed their checks out of letters drafted]: 20 of 20 in historical run 0;
  not reported by the current LOOP_STATUS.txt summary.
- [KIMI: letters built from the template]: 0 in historical run 0.
- [KIMI: model calls that failed twice]: 0 in earlier run 2; not reported by the current
  LOOP_STATUS.txt summary.
- [KIMI: seconds to screen one history against the first ten criteria]: about 32 s (historical
  run 0: 10 screen calls at 3.2 s each).
- [KIMI: seconds to screen one history against every criterion in use]: not measured yet.
- [KIMI: date and time of the scored run these numbers come from]: final-test status
  2026-11-20 20:04:56; earlier first-ten run 2 at 2026-11-19 09:26.
- [KIMI: fresh histories, planted findings caught out of planted]: 10 of 10 in the earlier fresh
  history run after the two drafter fixes; not a final-database retest.
