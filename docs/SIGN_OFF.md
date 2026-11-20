# THE FOUNDER'S SIGN-OFF PACK

What you are asked to do, and how: read, correct, sign. You sign in your sign-off tool on this
PC (http://127.0.0.1:8790), one criterion at a time, with Sign or Needs a change; the criteria
below are the reference for your reading. You can also sign by telling Claude. Nobody signs for
you. Until you sign, every criterion is a draft. This pack was assembled on Thursday 19 November
in the early morning and grows with the day's results; the newest measured numbers always live
in docs\RESULTS.md. Nothing here says "validated", "approved" or "never misses".

**State at the submission, 21 November 2026.** The clinical reviewer signed all 583 criteria in use (the
last signature at 03:42 on 21 November; `docs\signoff\ledger.json`), and `tools\signoff\apply.mjs` wrote
each signature into its criterion file. The pack below is kept as the record of what was put before the
reviewer. Where it calls a criterion a draft or unsigned, it describes the state before he signed.

## What only you can do

Read and sign the criteria, their medicine lists and the answer sheet. Read the scored letter
evidence for each criterion. The scorer still judges one letter step per caught finding; in the
pharmacist's application, code assembles all accepted findings for one patient into one combined
letter. Confirm the rights for the criterion text shown. Write slides 2 and 14. Record or
approve the video and upload it. Publish the judges' link. Fill the form and submit.

## The count (current database and final test)

The final database has 583 criteria in use: the first ten and 573 further criteria. Seven are set
aside (EU7-F20, EU7-F78, KHAWAGI-G005, KHAWAGI-G048, KHAWAGI-G157, POPI-54, START-F6), no named
candidate remains outside use, and seven were never drafted. Thirty-one more reached main in
8b543b6, bringing the in-use count from 534 to 565; twelve more reached main in 874a091, bringing
it to 577; two more reached main in 8fa5b56, bringing it to 579; three more reached main in ba81741,
bringing it to 582. START-H7 passed its late run and was brought into use in commit f28deb1;
CKD-C09B, KHAWAGI-G130 and KHAWAGI-G153 followed in 6d3e8de, GERARD-39 and GERARD-40 followed in
b69735c, SCOTRESP-01 followed in f77e39b, and SCOTRESP-09 followed in 623c0af after their own runs
passed. MHRA-12 reached main in 0571aab, bringing the count to 583. All 583 are signed by the clinical
reviewer.

534 of 534 passed the final test at 04:41. Thirty-three of them were given one clearer sentence at
06:20. The timestamped `final-db\loop\LOOP_STATUS.txt` snapshot at 2026-11-21 04:39:48 reports
583 criteria and 583 PASS, with 0 in its repair column, 0 after eight repairs, 0 waiting for their
run, and 0 not on the board; its "not passing now" line is empty. It reports 1,181 of 1,183 planted
findings caught, 2 disputed and 33 false flags. Seven are set aside. The repository's active list has
the same 583 criteria in use. The earlier 10-of-10 first-ten result is retained below as a historical
measured run. Every test history is fictional. All 583 criteria in use are signed by the clinical
reviewer; the test histories are not. Nothing here is a clinical validation.

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

## The first ten, in order

### STOPP C10 - NSAID with an anticoagulant

Statement (the published wording, word for word):
> Nonsteroidal anti-inflammatory drugs (NSAIDs) and vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitors in combination (risk of major gastrointestinal bleeding).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: An anti-inflammatory pain medicine (NSAID) supplied together with a blood thinner such as warfarin, dabigatran, apixaban or rivaroxaban raises the risk of serious bleeding from the stomach or bowel.

Rule given to the models: Suspect a finding when at least one Group A medicine (an NSAID) AND at least one Group B medicine (warfarin, dabigatran, apixaban, rivaroxaban, edoxaban or fondaparinux) both appear in the history and their supply dates overlap or fall within 60 days of each other. One supply of each is enough.

Medicines that count:
- NSAIDs, the anti-inflammatory pain medicines: celecoxib, diclofenac, etoricoxib, ibuprofen, indometacin, ketoprofen, ketorolac, mefenamic acid, meloxicam, naproxen, piroxicam, sulindac. Brands - celecoxib: Celebrex, Celaxib; diclofenac: Voltaren, Voltaren Rapid, Fenac, Clonac, Arthrotec; etoricoxib: Arcoxia; ibuprofen: Nurofen, Advil, Brufen, Rafen, Nurofen Plus, Panafen Plus, Nuromol, Maxigesic; indometacin: Indocid, Arthrexin; ketoprofen: Orudis, Oruvail; ketorolac: Toradol; mefenamic acid: Ponstan; meloxicam: Mobic, Movalis, Moxicam, Meloxibell; naproxen: Naprosyn, Naprosyn SR, Anaprox, Inza, Proxen SR, Naprogesic, Aleve, Vimovo; piroxicam: Feldene, Mobilis; sulindac: Aclin. Note: Tablets, capsules, liquids, suppositories and injections count. Skin gels, creams and eye drops do not count, for example Voltaren Emulgel. Aspirin is not in this group. Nurofen Plus and Panafen Plus are ibuprofen with codeine. Nuromol and Maxigesic are ibuprofen with paracetamol. Arthrotec is diclofenac with misoprostol. Vimovo is naproxen with esomeprazole. Generic packs that show the ingredient name with a company name count too.
- Warfarin, dabigatran and the factor Xa inhibitors: warfarin, dabigatran, apixaban, rivaroxaban, edoxaban, fondaparinux. Brands - warfarin: Coumadin, Marevan; dabigatran: Pradaxa; apixaban: Eliquis, Alexibic, Apexa, Apixor, Axibic, Elapex; rivaroxaban: Xarelto, Ixarola, Rivoxa, Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed; edoxaban: ; fondaparinux: Arixtra. Note: Warfarin is the vitamin K antagonist. Dabigatran is the direct thrombin inhibitor. Apixaban, rivaroxaban, edoxaban and fondaparinux are factor Xa inhibitors. No Australian brand is listed for edoxaban. Fondaparinux is an injection. Heparin and enoxaparin are not in this group. Antiplatelet medicines such as aspirin and clopidogrel are not anticoagulants. Generic packs that show the ingredient name with a company name count too.

What a dispensing history cannot show: Why each medicine was prescribed, INR and kidney function results, and any past stomach ulcer or bleeding. Also how often the NSAID is really taken, anti-inflammatory medicines bought without a prescription, and medicines supplied by a hospital or another pharmacy.

The letter asks the GP: Whether the NSAID is still needed while the anticoagulant continues, and the patient's risk of bleeding.. Urgency: routine. Not yet signed.

### STOPP B3 - Beta-blocker with verapamil or diltiazem

Statement (the published wording, word for word):
> Beta-blocker in combination with verapamil or diltiazem (risk of heart block).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: A beta-blocker taken together with verapamil or diltiazem can slow the heart too much and may cause heart block.

Rule given to the models: Suspect a finding when at least one Group A medicine (a beta-blocker) AND at least one Group B medicine (verapamil or diltiazem) both appear in the history with supply dates that overlap or fall within 60 days of each other. Other calcium channel blockers, such as amlodipine, felodipine, lercanidipine and nifedipine, do not count.

Medicines that count:
- Beta-blockers: atenolol, bisoprolol, carvedilol, labetalol, metoprolol, nadolol, nebivolol, oxprenolol, pindolol, propranolol, sotalol. Brands - atenolol: Tenormin, Noten, Tensig; bisoprolol: Bicor, Bicard, Bispro; carvedilol: Dilatrend, Dilasig, Dicarz, Vedilol, Kredex; labetalol: Trandate, Presolol; metoprolol: Betaloc, Minax, Metohexal, Toprol-XL, Minax XL, Metrol-XL, Lopresor, Mistrom, Metrol; nadolol: ; nebivolol: Nebilet, Nepiten, Lobivon; oxprenolol: Corbeton; pindolol: Visken, Barbloc; propranolol: Inderal, Deralin; sotalol: Sotacor, Cardol, Solavert. Note: Taken by mouth. Beta-blocker eye drops, such as timolol, are not counted. No brand name is listed for nadolol.
- Verapamil or diltiazem: verapamil, diltiazem. Brands - verapamil: Isoptin, Isoptin SR, Anpec, Cordilox SR, Veracaps SR, Tarka; diltiazem: Cardizem, Cardizem CD, Vasocardol, Vasocardol CD, Coras, Dilzem, Diltahexal. Note: Taken by mouth. Tarka is trandolapril with verapamil. A diltiazem cream or ointment for the skin is not counted.

What a dispensing history cannot show: The heart rate and the ECG, why each medicine was prescribed, whether a heart specialist chose the combination on purpose, whether both medicines are still being taken, and medicines supplied by another pharmacy or a hospital.

The letter asks the GP: Whether the beta-blocker and the verapamil or diltiazem are both meant to be taken together, and the patient's heart rate and ECG.. Urgency: routine. Not yet signed.

### STOPP B13 - Aldosterone antagonist with a potassium-conserving medicine (potassium check)

Statement (the published wording, word for word):
> Aldosterone antagonists (e.g., spironolactone, eplerenone) with concurrent potassium-conserving drugs (e.g., ACEI’s, ARB’s, amiloride, triamterene) without monitoring of serum potassium (risk of dangerous hyperkalaemia i.e., > 6.0 mmol/l – serum K should be monitored regularly, i.e., at least every 6 months).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: An aldosterone antagonist such as spironolactone or eplerenone, taken with another medicine that keeps potassium in the body, can lead to dangerously high blood potassium unless the potassium level is checked at least every 6 months.

Rule given to the models: Suspect a finding when at least one Group A medicine (an aldosterone antagonist) AND at least one Group B medicine (an ACE inhibitor, a sartan, amiloride or triamterene) both appear in the history with supply dates that overlap or fall within 60 days of each other. The criterion also needs a recent serum potassium result. When the record holds no line about serum potassium, still suspect the finding and name serum potassium as the missing fact (a possible finding). When the newest serum potassium result in the record is more than 6 months before the newest supply of the two medicines, suspect the finding. When the record holds a serum potassium result within the last 6 months, there is no finding.

Medicines that count:
- Aldosterone antagonists: spironolactone, eplerenone, finerenone. Brands - spironolactone: Aldactone, Spiractin; eplerenone: Inspra, Espler, Inpler, Plera; finerenone: Kerendia
- ACE inhibitors, angiotensin receptor blockers (sartans), amiloride and triamterene: captopril, enalapril, fosinopril, lisinopril, perindopril, quinapril, ramipril, trandolapril, candesartan, eprosartan, irbesartan, losartan, olmesartan, telmisartan, valsartan, amiloride, triamterene. Brands - captopril: Capoten; enalapril: Renitec, Renitec Plus, Zan-Extra; fosinopril: Monopril, Monoplus; lisinopril: Zestril, Prinivil; perindopril: Coversyl, Prexum, Perindo, Idaprex, Coversyl Plus, Coveram, Reaptan; quinapril: Accupril, Accuretic; ramipril: Tritace, Ramace, Tryzan, Triasyn; trandolapril: Gopten, Odrik, Tarka; candesartan: Atacand, Atacand Plus; eprosartan: Teveten, Teveten Plus; irbesartan: Avapro, Karvea, Avapro HCT, Karvezide; losartan: Cozaar; olmesartan: Olmetec, Olmetec Plus, Sevikar, Sevikar HCT; telmisartan: Micardis, Micardis Plus, Twynsta; valsartan: Diovan, Co-Diovan, Exforge, Exforge HCT, Entresto; amiloride: Kaluril, Moduretic, Amizide; triamterene: Hydrene. Note: A combination product that holds one of these medicines counts. Renitec Plus, Monoplus, Accuretic, Atacand Plus, Teveten Plus, Avapro HCT, Karvezide, Olmetec Plus, Micardis Plus and Co-Diovan also hold hydrochlorothiazide. Coversyl Plus also holds indapamide. Coveram, Reaptan, Sevikar, Twynsta and Exforge also hold amlodipine. Sevikar HCT and Exforge HCT also hold amlodipine and hydrochlorothiazide. Zan-Extra is enalapril with lercanidipine. Triasyn is ramipril with felodipine. Tarka is trandolapril with verapamil. Entresto is valsartan with sacubitril. Moduretic and Amizide are amiloride with hydrochlorothiazide. Hydrene is triamterene with hydrochlorothiazide.

Facts it needs:
- serum potassium (result): meets when recorded within the 6 months before the newest supply of the two medicines

What a dispensing history cannot show: A serum potassium or kidney function result when the record holds no line about it, why each medicine was prescribed, whether both are still being taken, and potassium supplements or salt substitutes bought without a prescription.

The letter asks the GP: Whether serum potassium has been checked within the last 6 months while both medicines are being taken together.. Urgency: routine. Not yet signed.

### STOPP C14 - Apixaban, dabigatran, edoxaban or rivaroxaban with a P-glycoprotein inhibitor

Statement (the published wording, word for word):
> Apixaban, dabigatran, edoxaban, rivaroxaban and P-glycoprotein (P-gp) drug efflux pump inhibitors e.g., amiodarone, azithromycin, carvedilol, cyclosporin, dronedarone, itraconazole, ketoconazole (systemic), macrolides, quinine, ranolazine, tamoxifen, ticagrelor, verapamil (increased risk of bleeding).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: Some medicines slow the removal of apixaban, dabigatran, edoxaban and rivaroxaban from the body, so the blood thinner can build up and bleeding becomes more likely.

Rule given to the models: Suspect a finding when at least one Group A medicine (apixaban, dabigatran, edoxaban or rivaroxaban) AND at least one Group B medicine (a P-glycoprotein inhibitor on the list) both appear in the history and their supply dates overlap or fall within 60 days of each other. A short course counts, for example one pack of a macrolide antibiotic supplied while the anticoagulant is being supplied.

Medicines that count:
- Apixaban, dabigatran, edoxaban and rivaroxaban: apixaban, dabigatran, edoxaban, rivaroxaban. Brands - apixaban: Eliquis, Alexibic, Apexa, Apixor, Axibic, Elapex; dabigatran: Pradaxa; edoxaban: ; rivaroxaban: Xarelto, Ixarola, Rivoxa, Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed. Note: Edoxaban is named in the criterion. No Australian brand is listed for it. Warfarin is not in this group. Generic packs that show the ingredient name with a company name count too.
- P-glycoprotein inhibitors named by the criterion: amiodarone, azithromycin, carvedilol, ciclosporin, clarithromycin, dronedarone, erythromycin, itraconazole, ketoconazole, quinine, ranolazine, roxithromycin, tamoxifen, ticagrelor, verapamil. Brands - amiodarone: Cordarone X, Aratac, Cardinorm, Rithmik, Amdarone; azithromycin: Zithromax, Zedd; carvedilol: Dilatrend, Dicarz, Kredex, Dilasig, Vedilol; ciclosporin: Neoral, Sandimmun, Cicloral; clarithromycin: Klacid, Kalixocin, Nexium Hp7, Klacid Hp 7; dronedarone: Multaq; erythromycin: EES, E-Mycin, Eryc; itraconazole: Sporanox, Lozanoc; ketoconazole: ; quinine: Quinate, Quinbisul; ranolazine: Ranexa; roxithromycin: Rulide, Biaxsig, Roximycin; tamoxifen: Nolvadex-D, Genox, Tamosin; ticagrelor: Brilinta, Bricalor, Ticalor, Tirela; verapamil: Isoptin, Isoptin SR, Anpec, Cordilox SR, Veracaps SR, Tarka. Note: The macrolide antibiotics are azithromycin, clarithromycin, erythromycin and roxithromycin. The criterion spells ciclosporin as cyclosporin. Only medicines taken by mouth or injected count. Creams, gels, shampoos and eye drops do not count, for example ketoconazole cream or shampoo. No Australian brand of ketoconazole tablets is listed. Nexium Hp7 is esomeprazole with amoxicillin and clarithromycin. Klacid Hp 7 is omeprazole with amoxicillin and clarithromycin. Tarka is trandolapril with verapamil. Only the medicines listed here count for this group.

What a dispensing history cannot show: Why each medicine was prescribed, kidney function, body weight, and any bleeding or bruising. Also whether the prescriber has already allowed for the combination, whether a short course was finished, and medicines supplied by a hospital or another pharmacy.

The letter asks the GP: The anticoagulant together with the P-glycoprotein inhibitor, including the anticoagulant dose, kidney function and the patient's risk of bleeding.. Urgency: routine. Not yet signed.

### STOPP D18 - Acetylcholinesterase inhibitor with a medicine that slows the heart

Statement (the published wording, word for word):
> Acetylcholinesterase inhibitors with concurrent treatment with drugs that induce persistent bradycardia (< 60 beats/min.) such as beta-blockers, digoxin, diltiazem, verapamil (risk of cardiac conduction failure, syncope and injury).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: An acetylcholinesterase inhibitor, such as donepezil, galantamine or rivastigmine, taken with a medicine that slows the heart, such as a beta-blocker, digoxin, diltiazem or verapamil, can slow the heart too much and lead to fainting and injury.

Rule given to the models: Suspect a finding when at least one Group A medicine (donepezil, galantamine, rivastigmine or pyridostigmine) AND at least one Group B medicine (a beta-blocker, digoxin, diltiazem or verapamil) both appear in the history with supply dates that overlap or fall within 60 days of each other. The heart rate cannot be seen in a dispensing history, so report the finding even though the pulse is not known.

Medicines that count:
- Acetylcholinesterase inhibitors: donepezil, galantamine, rivastigmine, pyridostigmine. Brands - donepezil: Aricept, Aridon, Arazil; galantamine: Reminyl, Galantyl, Gamine XR; rivastigmine: Exelon, Exelon Patch, Rivastigmelon, Prometax; pyridostigmine: Mestinon. Note: Memantine is a dementia medicine of another kind and does not count. Exelon Patch, Rivastigmelon and Prometax are rivastigmine skin patches, and patches count. Pyridostigmine (Mestinon) is used for myasthenia gravis, not for dementia. It is listed because it is also an acetylcholinesterase inhibitor.
- Beta-blockers, digoxin, diltiazem and verapamil: atenolol, bisoprolol, carvedilol, labetalol, metoprolol, nadolol, nebivolol, oxprenolol, pindolol, propranolol, sotalol, digoxin, diltiazem, verapamil. Brands - atenolol: Tenormin, Noten, Tensig; bisoprolol: Bicor, Bicard, Bispro; carvedilol: Dilatrend, Dilasig, Dicarz, Vedilol, Kredex; labetalol: Trandate, Presolol; metoprolol: Betaloc, Minax, Metohexal, Toprol-XL, Minax XL, Metrol-XL, Lopresor, Mistrom, Metrol; nadolol: ; nebivolol: Nebilet, Nepiten, Lobivon; oxprenolol: Corbeton; pindolol: Visken, Barbloc; propranolol: Inderal, Deralin; sotalol: Sotacor, Cardol, Solavert; digoxin: Lanoxin, Lanoxin PG, Sigmaxin, Sigmaxin PG; diltiazem: Cardizem, Cardizem CD, Vasocardol, Vasocardol CD, Coras, Dilzem, Diltahexal; verapamil: Isoptin, Isoptin SR, Anpec, Cordilox SR, Veracaps SR, Tarka. Note: Taken by mouth. Tarka is trandolapril with verapamil. Eye drops and skin products are not counted. No brand name is listed for nadolol.

What a dispensing history cannot show: The heart rate and the ECG, any fainting, dizziness or falls, why each medicine was prescribed, whether both are still being taken, and medicines supplied by another pharmacy or a hospital.

The letter asks the GP: The patient's heart rate, any fainting, dizziness or falls, and whether both medicines are still meant to be taken together.. Urgency: routine. Not yet signed.

### STOPP L2 - Regular opioid with no laxative supplied

Statement (the published wording, word for word):
> Use of daily regular (as distinct from PRN) opioids without concomitant laxative (risk of severe constipation).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: A regular opioid pain medicine supplied without a laxative carries a risk of severe constipation.

Rule given to the models: Suspect a finding when a Group A medicine (an opioid) is supplied for regular daily use and no Group B medicine (a laxative) is supplied on dates that overlap the opioid supplies or fall within 60 days of them. Regular daily use means directions with fixed doses, for example every 12 hours, twice a day or a patch changed on set days; an opioid supplied only for use when required does not count.

Medicines that count:
- Opioid pain medicines: oxycodone, morphine, tapentadol, tramadol, buprenorphine, fentanyl, hydromorphone, methadone, codeine. Brands - oxycodone: OxyContin, Endone, OxyNorm, Targin, Proladone; morphine: MS Contin, Kapanol, Sevredol, Ordine, Anamorph; tapentadol: Palexia SR, Palexia IR, Tapal, Tadol, Tapex; tramadol: Tramal, Tramal SR, Durotram XR, Zaldiar; buprenorphine: Norspan, Bupredermal, Temgesic; fentanyl: Durogesic, Denpax, Fenpatch; hydromorphone: Jurnista, Dilaudid; methadone: Physeptone; codeine: Panadeine Forte, Panamax Co, Codalgin Forte, Comfarol Forte, Prodeine Forte, Codapane Forte, Mersyndol Forte, Nurofen Plus, Panafen Plus. Note: Targin is oxycodone with naloxone. The naloxone in Targin is not counted as a laxative. Proladone is an oxycodone suppository. Zaldiar is tramadol with paracetamol. Panadeine Forte, Panamax Co, Codalgin Forte, Comfarol Forte, Prodeine Forte and Codapane Forte are paracetamol with codeine. Mersyndol Forte is paracetamol with codeine and doxylamine. Nurofen Plus and Panafen Plus are ibuprofen with codeine.
- Laxatives: macrogol 3350, lactulose, docusate, senna, bisacodyl, sodium picosulfate, sorbitol, psyllium husk, sterculia, glycerol, prucalopride. Brands - macrogol 3350: Movicol, OsmoLax, Molaxole, Macrovic; lactulose: Duphalac, Actilax, Dulose; docusate: Coloxyl, Coloxyl with Senna; senna: Senokot, Coloxyl with Senna; bisacodyl: Dulcolax, Bisalax; sodium picosulfate: Dulcolax SP Drops; sorbitol: Sorbilax; psyllium husk: Metamucil, Fybogel; sterculia: Normafibe, Normacol Plus; glycerol: ; prucalopride: Resotrans. Note: Coloxyl with Senna is docusate with senna. Senna is also written as sennosides. Psyllium husk is also called ispaghula. Normacol Plus is sterculia with frangula. Glycerol counts when it is supplied as suppositories. Methylnaltrexone (Relistor) and naloxegol (Movantik) block the effect of the opioid on the bowel. Like the naloxone in Targin, they are not counted as laxatives.

What a dispensing history cannot show: Laxatives bought without a prescription, which is how many laxatives are obtained. Also whether the opioid is taken every day, whether the patient has constipation, and any laxative supplied by another pharmacy or a hospital.

The letter asks the GP: Whether this patient is using a laxative while the regular opioid continues, and the patient's bowel function.. Urgency: routine. Not yet signed.

### STOPP D8 - Benzodiazepine supplied for four weeks or longer

Statement (the published wording, word for word):
> Benzodiazepines for ≥ 4 weeks (no indication for longer treatment; risk of prolonged sedation, confusion, impaired balance, falls, road traffic accidents; all benzodiazepines should be withdrawn gradually if taken for more than 4 weeks as there is a risk of causing a benzodiazepine withdrawal syndrome if stopped abruptly).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: A benzodiazepine used for four weeks or longer can cause lasting drowsiness, confusion, poor balance and falls in an older person.

Rule given to the models: Suspect a finding when a Group A medicine (a benzodiazepine) is supplied on dates that cover four weeks (28 days) or more: repeat supplies no more than 60 days apart that together last 28 days or more, or one supply that lasts 28 days or more at the directed dose. Do not count one short course, or short courses that are many months apart.

Medicines that count:
- Benzodiazepines: diazepam, temazepam, oxazepam, nitrazepam, lorazepam, alprazolam, clonazepam, clobazam, bromazepam, flunitrazepam, triazolam, midazolam. Brands - diazepam: Valium, Antenex, Ducene, Valpam; temazepam: Normison, Temaze, Temtabs; oxazepam: Serepax, Murelax, Alepam; nitrazepam: Mogadon, Alodorm; lorazepam: Ativan; alprazolam: Xanax, Kalma, Alprax; clonazepam: Rivotril, Paxam; clobazam: Frisium; bromazepam: Lexotan; flunitrazepam: Hypnodorm; triazolam: Halcion; midazolam: Hypnovel

What a dispensing history cannot show: Why the benzodiazepine was started, and whether there is a reason for longer treatment such as epilepsy or palliative care. Also whether the tablets are taken every day or only now and then, whether a gradual dose reduction is already under way, and any supply from another pharmacy.

The letter asks the GP: Whether the benzodiazepine is still needed after four weeks or more of supply, and the patient's risk of drowsiness, confusion and falls.. Urgency: routine. Not yet signed.

### STOPP A3 - Two medicines from the same class for regular use

Statement (the published wording, word for word):
> Any duplicate drug class prescription for daily regular use (as distinct from PRN use) e.g., two concurrent NSAIDs, SSRIs, loop diuretics, ACE inhibitors, anticoagulants, antipsychotics, opioid analgesics (optimisation of monotherapy within a single drug class should be observed prior to considering a new agent).

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: Two regular medicines from the same drug class can double up on side effects, and one medicine at the right dose is usually tried first.

Rule given to the models: Suspect a finding when two different active ingredients from the same group (Group A, B, C, D, E, F or G), or from any other single drug class such as two statins or two proton pump inhibitors, are both supplied for regular daily use on dates that overlap or fall within 60 days of each other. Do not count one ingredient under two brand names or two strengths, a medicine whose directions say it is taken only when required (PRN), or two medicines from different classes that treat the same condition.

Medicines that count:
- Oral NSAIDs: ibuprofen, diclofenac, naproxen, celecoxib, meloxicam, indometacin, piroxicam, ketoprofen, mefenamic acid, etoricoxib, ketorolac, sulindac. Brands - ibuprofen: Nurofen, Brufen, Advil, Rafen, Nurofen Plus, Nuromol, Maxigesic; diclofenac: Voltaren, Fenac, Arthrotec, Clonac, Voltaren Rapid; naproxen: Naprosyn, Naprosyn SR, Inza, Anaprox, Naprogesic, Aleve, Vimovo, Proxen SR; celecoxib: Celebrex, Celaxib; meloxicam: Mobic, Movalis, Moxicam, Meloxibell; indometacin: Indocid, Arthrexin; piroxicam: Feldene, Mobilis; ketoprofen: Orudis, Oruvail; mefenamic acid: Ponstan; etoricoxib: Arcoxia; ketorolac: Toradol; sulindac: Aclin. Note: Tablets, capsules and suppositories count. Skin gels and eye drops do not. Low-dose aspirin is not counted as an NSAID here. Indometacin is also written indomethacin. Nurofen Plus is ibuprofen with codeine. Nuromol and Maxigesic are ibuprofen with paracetamol. Vimovo is naproxen with esomeprazole.
- SSRI antidepressants: citalopram, escitalopram, fluoxetine, fluvoxamine, paroxetine, sertraline. Brands - citalopram: Cipramil, Celapram, Talam; escitalopram: Lexapro, Esipram, Loxalate, Lexam; fluoxetine: Prozac, Lovan, Zactin; fluvoxamine: Luvox, Faverin, Movox; paroxetine: Aropax, Paxtine, Extine; sertraline: Zoloft, Eleva, Sertra, Setrona. Note: Antidepressants of other classes are not in this group.
- Loop diuretics: furosemide, bumetanide, etacrynic acid. Brands - furosemide: Lasix, Urex, Uremide; bumetanide: Burinex; etacrynic acid: Edecrin. Note: Furosemide is also written frusemide. Lasix-M, Urex-M and Urex Forte are other strengths of the same brands. Etacrynic acid is also written ethacrynic acid.
- ACE inhibitors: perindopril, ramipril, enalapril, lisinopril, captopril, fosinopril, quinapril, trandolapril. Brands - perindopril: Coversyl, Perindo, Prexum, Coversyl Plus, Perindo Combi, Coveram, Reaptan; ramipril: Tritace, Ramace, Tryzan; enalapril: Renitec, Alphapril, Renitec Plus, Zan-Extra; lisinopril: Zestril, Prinivil, Fibsol, Lisodur; captopril: Capoten, Acenorm; fosinopril: Monopril, Monoplus; quinapril: Accupril, Accuretic; trandolapril: Gopten, Tarka. Note: Coversyl Plus and Perindo Combi are perindopril with indapamide. Coveram and Reaptan are perindopril with amlodipine. Renitec Plus is enalapril with hydrochlorothiazide. Zan-Extra is enalapril with lercanidipine. Monoplus is fosinopril with hydrochlorothiazide. Accuretic is quinapril with hydrochlorothiazide. Tarka is trandolapril with verapamil.
- Anticoagulants: warfarin, dabigatran, apixaban, rivaroxaban, edoxaban, enoxaparin, dalteparin, fondaparinux. Brands - warfarin: Coumadin, Marevan; dabigatran: Pradaxa; apixaban: Eliquis, Alexibic, Apexa, Apixor, Axibic, Elapex; rivaroxaban: Xarelto, Ixarola, Rivoxa, Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed; edoxaban: ; enoxaparin: Clexane; dalteparin: Fragmin; fondaparinux: Arixtra. Note: Tablets, capsules and injections count. Generic apixaban and rivaroxaban are often named by the ingredient. No Australian brand is listed for edoxaban. A short overlap of an injection with warfarin when warfarin is started can be planned. Still report it and let the pharmacist decide.
- Antipsychotics: amisulpride, aripiprazole, asenapine, brexpiprazole, cariprazine, chlorpromazine, clozapine, flupentixol, haloperidol, lurasidone, olanzapine, paliperidone, periciazine, quetiapine, risperidone, ziprasidone, zuclopenthixol. Brands - amisulpride: Solian; aripiprazole: Abilify, Abilify Maintena; asenapine: Saphris; brexpiprazole: Rexulti; cariprazine: Reagila; chlorpromazine: Largactil; clozapine: Clozaril, Clopine; flupentixol: Fluanxol; haloperidol: Serenace, Haldol; lurasidone: Latuda; olanzapine: Zyprexa, Zypine; paliperidone: Invega, Invega Sustenna, Invega Trinza; periciazine: Neulactil; quetiapine: Seroquel, Quetia, Syquet; risperidone: Risperdal, Risperdal Consta, Rispa, Rixadone, Ozidal; ziprasidone: Zeldox; zuclopenthixol: Clopixol. Note: Tablets, wafers, liquids and long-acting injections count. Prochlorperazine (Stemetil) is used mainly for nausea and is not listed.
- Opioid analgesics: buprenorphine, codeine, fentanyl, hydromorphone, methadone, morphine, oxycodone, tapentadol, tramadol. Brands - buprenorphine: Norspan, Temgesic; codeine: Panadeine Forte, Panadeine, Codalgin Forte, Comfarol Forte, Mersyndol Forte, Nurofen Plus, Panafen Plus; fentanyl: Durogesic, Denpax, Fenpatch, Abstral; hydromorphone: Dilaudid, Jurnista; methadone: Physeptone; morphine: MS Contin, MS Mono, Kapanol, Sevredol, Anamorph, Ordine; oxycodone: OxyContin, OxyNorm, Endone, Targin, Proladone; tapentadol: Palexia, Tapal, Tadol, Tapex; tramadol: Tramal, Zydol, Tramedo, Durotram, Zaldiar. Note: Tablets, capsules, liquids, suppositories and patches count. Panadeine, Panadeine Forte, Codalgin Forte and Comfarol Forte are codeine with paracetamol. Mersyndol Forte is codeine with paracetamol and doxylamine. Nurofen Plus is codeine with ibuprofen. Targin is oxycodone with naloxone. Proladone is an oxycodone suppository. Zaldiar is tramadol with paracetamol. Methadone or buprenorphine supplied for opioid dependence is not listed.

What a dispensing history cannot show: Whether the prescriber meant one medicine to replace the other, whether the patient is still taking both, the reason for each medicine, and any medicines bought without a prescription or supplied by another pharmacy.

The letter asks the GP: Whether both medicines from the same class are meant to be taken together, or whether one was meant to replace the other.. Urgency: routine. Not yet signed.

### STOPP B11 - Centrally-acting blood pressure medicine

Statement (the published wording, word for word):
> Centrally-acting antihypertensives e.g., methyldopa, clonidine, moxonidine, rilmenidine, guanfacine (centrally-active antihypertensives are generally less well tolerated by older people than younger people)

Source: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y. Licence: CC BY 4.0 (status "proposed" - the founder confirms the rights). Credit line: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y Notice: Text reproduced without changes.

Plain summary: Blood pressure medicines that act on the brain, such as methyldopa, clonidine and moxonidine, are generally less well tolerated by older people than by younger people.

Rule given to the models: Suspect a finding when a Group A medicine (a centrally-acting antihypertensive) is supplied at least once in the history. Blood pressure medicines of other kinds do not count.

Medicines that count:
- Centrally-acting antihypertensives: methyldopa, clonidine, moxonidine, rilmenidine, guanfacine. Brands - methyldopa: Aldomet, Hydopa; clonidine: Catapres, Dixarit; moxonidine: Physiotens, Moxotens, Normatens; rilmenidine: ; guanfacine: Intuniv. Note: Taken by mouth. Rilmenidine is named in the criterion. No Australian brand is listed for it. Dixarit is clonidine 25 microgram tablets, used for migraine and flushing. It still counts as clonidine. Eye drops such as brimonidine and apraclonidine are not counted.

What a dispensing history cannot show: The blood pressure readings, why this medicine was chosen, whether other blood pressure medicines were tried first, side effects such as dizziness, drowsiness or a dry mouth, and whether the medicine is still being taken. Clonidine and guanfacine are sometimes used for reasons other than blood pressure.

The letter asks the GP: Whether the centrally-acting blood pressure medicine is still needed, and how well the patient is tolerating it.. Urgency: routine. Not yet signed.

### PINCER 9 - Methotrexate without a weekly instruction

Statement (the published wording, word for word):
> Patients receiving prescriptions of methotrexate without instructions that the drug should be taken weekly. - More specifically, patients with one or more prescriptions for methotrexate recorded on computer within the three months prior to data collection who do not have the term "weekly" or "week" in the dosage instructions field of the latest prescription for the drug.

Source: Avery AJ, Rodgers S, Cantrill JA, et al. Protocol for the PINCER trial. Trials 2009;10:28. doi:10.1186/1745-6215-10-28; correction Trials 2010;11:23. Licence: CC BY 2.0 (status "proposed" - the founder confirms the rights). Credit line: Avery AJ, Rodgers S, Cantrill JA, et al. Protocol for the PINCER trial. Trials 2009;10:28. doi:10.1186/1745-6215-10-28; correction Trials 2010;11:23 Notice: Text reproduced without changes.

Plain summary: Low-dose methotrexate is taken once a week, and directions that do not say so can lead to dangerous daily dosing.

Rule given to the models: Suspect a finding when the directions on the most recent supply of a Group A medicine (methotrexate) do not contain the word 'week' or 'weekly'. Directions such as 'as directed' or 'daily' are a finding, and directions such as 'once a week' or 'weekly on Monday' are not.

Medicines that count:
- Methotrexate: methotrexate. Brands - methotrexate: Methoblastin, Trexject. Note: Tablets and injections count. Generic products are usually named by the ingredient.

What a dispensing history cannot show: What the patient was told and how the patient is really taking the methotrexate, the reason for treatment, the wording on the original prescription, and blood test results.

The letter asks the GP: The intended methotrexate dose and the day of the week it is to be taken, so that the label can state this clearly.. Urgency: same_day. Not yet signed.

## The answer sheet of the ten

- STOPP-C10/pos-brand.csv (positive): Mobic (meloxicam, an NSAID) is supplied four times from June to September 2026 while Eliquis (apixaban) is supplied every month, and both appear by brand name only. STOPP-C10 proven by lines (L022 or L026 or L030 or L034) and (L001 or L004 or L007 or L011 or L015 or L019 or L023 or L027 or L031 or L035)
- STOPP-C10/pos-buried.csv (positive): Naprosyn SR (naproxen, an NSAID) is supplied three times from January to March 2026, in the middle of a 14-month history, while warfarin (Coumadin) is supplied throughout. STOPP-C10 proven by lines (L036 or L041 or L047) and (L001 or L010 or L016 or L025 or L035 or L042 or L052 or L058 or L067 or L076)
- STOPP-C10/near-miss.csv (near_miss): Voltaren (diclofenac) was last supplied in September 2025 and Xarelto (rivaroxaban) was first supplied in April 2026, about seven months later, so the two were never supplied within 60 days of each other. nothing planted
- STOPP-B3/pos-brand.csv (positive): Betaloc (metoprolol) is supplied throughout and Cardizem CD (diltiazem) is added from June 2026, both by brand name only. STOPP-B3 proven by lines (L001 or L007 or L013 or L017 or L025 or L031) and (L020 or L024 or L028 or L032 or L035)
- STOPP-B3/pos-buried.csv (positive): Verapamil (Isoptin SR) is supplied four times from January to April 2026, in the middle of a 14-month history, while atenolol (Noten) is supplied every month. STOPP-B3 proven by lines (L001 or L006 or L011 or L017 or L022 or L028 or L033 or L039 or L045 or L051 or L057 or L062 or L068 or L073 or L078) and (L036 or L042 or L048 or L054)
- STOPP-B3/near-miss.csv (near_miss): Metoprolol is supplied with amlodipine, a calcium channel blocker of another kind, and no verapamil or diltiazem is supplied. nothing planted
- STOPP-B13/pos-fact.csv (positive): Aldactone (spironolactone) is supplied from March 2026 with monthly Coversyl (perindopril), both by brand name only, and the record holds a serum potassium result from July 2025, more than 6 months before the newest supply, so the monitoring the criterion asks for is missing. STOPP-B13 proven by lines (L012 or L023 or L035) and (L006 or L010 or L014 or L017 or L021 or L025 or L028 or L032 or L036) and (L001)
- STOPP-B13/pos-nofact.csv (positive): possible finding: the record holds no line about serum potassium, and eplerenone (Inspra) is supplied four times from December 2025 to March 2026, in the middle of a 15-month history, while Karvezide (irbesartan with hydrochlorothiazide) is supplied every month. STOPP-B13 proven by lines (L029 or L034 or L039 or L046) and (L023 or L027 or L032 or L037 or L043 or L049 or L054)
- STOPP-B13/near-miss.csv (near_miss): Aldactone is supplied with monthly Coversyl, and the record holds a serum potassium result from September 2026, within the last 6 months, so the potassium monitoring the criterion asks for has been done and there is no finding. nothing planted
- STOPP-C14/pos-brand.csv (positive): Isoptin SR (verapamil, a P-glycoprotein inhibitor named by the criterion) is supplied every month from March 2026 while Eliquis (apixaban) is supplied every month, and both appear by brand name only. STOPP-C14 proven by lines (L001 or L003 or L006 or L009 or L012 or L016 or L020 or L023 or L026 or L029) and (L007 or L010 or L013 or L017 or L021 or L024 or L027 or L030)
- STOPP-C14/pos-buried.csv (positive): Two packs of Klacid (clarithromycin, a macrolide) are supplied in February 2026, in the middle of a 14-month history, while rivaroxaban (Xarelto) is supplied throughout. STOPP-C14 proven by lines (L001 or L005 or L009 or L014 or L018 or L023 or L027 or L031 or L037 or L041 or L045 or L049 or L054 or L058 or L062 or L066) and (L035 or L036)
- STOPP-C14/near-miss.csv (near_miss): Klacid (clarithromycin) was supplied once in November 2025, about seven months before Eliquis (apixaban) started in June 2026, and the medicines supplied with Eliquis (amlodipine, doxycycline, rosuvastatin, paracetamol) are not P-glycoprotein inhibitors named by the criterion. nothing planted
- STOPP-D18/pos-brand.csv (positive): Aricept (donepezil) is started in March 2026 while Tenormin (atenolol) is supplied every month, both by brand name only. STOPP-D18 proven by lines (L006 or L009 or L012 or L015 or L019 or L022 or L026 or L029 or L032) and (L001 or L003 or L007 or L010 or L013 or L017 or L020 or L023 or L027 or L030)
- STOPP-D18/pos-buried.csv (positive): Rivastigmine patches (Exelon Patch) are supplied four times from December 2025 to March 2026, in the middle of a 14-month history, while digoxin (Lanoxin PG) is supplied throughout. STOPP-D18 proven by lines (L029 or L035 or L040 or L045) and (L001 or L018 or L034 or L050 or L067)
- STOPP-D18/near-miss.csv (near_miss): Memantine is a dementia medicine but not an acetylcholinesterase inhibitor, so the metoprolol has no acetylcholinesterase inhibitor with it. nothing planted
- STOPP-L2/pos-brand.csv (positive): Palexia SR (tapentadol), named by brand only, is supplied every two weeks for regular twice-daily use from March to September 2026, and no laxative is supplied at any time. STOPP-L2 proven by lines (L009 or L010 or L013 or L014 or L017 or L018 or L021 or L023 or L026 or L027 or L030 or L031 or L032 or L035 or L036)
- STOPP-L2/pos-buried.csv (positive): OxyContin (oxycodone) is supplied every two weeks for regular twice-daily use from December 2025 to March 2026, in the middle of a 14-month history, and no laxative is supplied at any time. STOPP-L2 proven by lines (L028 or L029 or L034 or L035 or L041 or L042 or L043 or L048)
- STOPP-L2/near-miss.csv (near_miss): Palexia SR (tapentadol) is supplied regularly from March 2026, but Movicol (a macrogol laxative) is supplied with it from the first day and every four weeks after, so a laxative is supplied alongside the opioid. nothing planted
- STOPP-D8/pos-brand.csv (positive): Temaze (temazepam), named by brand only, is supplied every four weeks from February to September 2026, eight supplies of 25 tablets taken nightly, which is far longer than four weeks. STOPP-D8 proven by lines (L005 or L009 or L012 or L015 or L019 or L022 or L026 or L028)
- STOPP-D8/pos-buried.csv (positive): Antenex (diazepam) 5 mg twice a day is supplied five times from January to April 2026, in the middle of a 15-month history, which covers more than three months of use. STOPP-D8 proven by lines (L031 or L036 or L041 or L046 or L047)
- STOPP-D8/near-miss.csv (near_miss): Normison (temazepam) is supplied twice, 7 tablets each time, in August 2025 and July 2026, so there are two short courses more than ten months apart and no four-week period of use. nothing planted
- STOPP-A3/pos-brand.csv (positive): Coversyl (perindopril) is supplied monthly and Tritace (ramipril), a second ACE inhibitor, is added from 16 June 2026 while Coversyl continues, both by brand name only. STOPP-A3 proven by lines (L001 or L004 or L007 or L010 or L012 or L015 or L018 or L022 or L026 or L030) and (L017 or L021 or L025 or L028 or L032)
- STOPP-A3/pos-buried.csv (positive): Mobic (meloxicam) is supplied monthly from January to April 2026 and Naprosyn SR (naproxen), a second NSAID, is supplied in February and March 2026, in the middle of a history of about 14 months. STOPP-A3 proven by lines (L031 or L037 or L043 or L050) and (L038 or L044)
- STOPP-A3/near-miss.csv (near_miss): Celebrex (July and August 2025) and Mobic (July and August 2026) are two NSAIDs supplied about 11 months apart and never together, and atorvastatin only changes brand from Lipitor to Lorstat. nothing planted
- STOPP-B11/pos-brand.csv (positive): Physiotens (moxonidine) is supplied every month from April 2026, by brand name only. STOPP-B11 proven by lines (L011 or L014 or L016 or L020 or L024 or L027 or L030)
- STOPP-B11/pos-buried.csv (positive): Clonidine (Catapres) is supplied four times from January to April 2026, in the middle of a 14-month history. STOPP-B11 proven by lines (L038 or L044 or L050 or L059)
- STOPP-B11/near-miss.csv (near_miss): Prazosin is a blood pressure medicine of another kind, and no centrally-acting antihypertensive is supplied. nothing planted
- PINCER-9/pos-brand.csv (positive): Methoblastin (methotrexate), by brand name only, is supplied six times and no label has the word week or weekly. PINCER-9 proven by lines (L003 or L008 or L013 or L020 or L024 or L030)
- PINCER-9/pos-buried.csv (positive): Methotrexate is supplied three times in the middle of a 14-month history, no label has the word week or weekly, and the latest label (14 July 2026) says 'Take ONE tablet daily'. PINCER-9 proven by lines (L023 or L038 or L057)
- PINCER-9/near-miss.csv (near_miss): Methotrexate is supplied six times and every label says once a week or weekly, so the criterion is not met. nothing planted
- _clean/clean-1.csv (clean): Perindopril (Coversyl), atorvastatin and metformin are supplied every month for ten months, with a salbutamol inhaler for use when required, paracetamol and one course of amoxicillin. nothing planted
- _clean/clean-2.csv (clean): Amlodipine and telmisartan (two blood pressure medicines of different classes), Crestor by brand name only and pantoprazole are supplied regularly for a year, with paracetamol and short courses of cefalexin and doxycycline. nothing planted
- _clean/clean-3.csv (clean): Avapro HCT, atorvastatin, Janumet (sitagliptin with metformin), a Symbicort inhaler and levothyroxine are supplied regularly for a year, with paracetamol and one course of amoxicillin with clavulanic acid, and the corticosteroid in Symbicort is inhaled, not taken by mouth. nothing planted

## Earlier further-criteria records

The entries below are the pre-injection pack's historical wave records, not verdicts from the
current final test. The current database has 572 further criteria in use; the live criteria panel
and sign-off page read that database. Each historical line shows its label, abbreviated statement,
wave, earlier scored result, and signature state. Full current details are in the criterion files.
- EU(7)-PIM: magnesium hydroxide, aluminium antacids: The EU(7)-PIM list names magnesium hydroxide and antacids that contain aluminium as potentially inappropriate medicines for older people. Ma... | wave W101: PASS | not signed
- EU(7)-PIM: cimetidine, ranitidine, famotidine: The EU(7)-PIM list names the H2-receptor antagonists cimetidine, ranitidine and famotidine as potentially inappropriate medicines for older ... | wave W101: PASS | not signed
- EU(7)-PIM: proton pump inhibitor for more than 8 weeks: Proton pump inhibitors (PPI) (>8 weeks) e.g. omeprazole, pantoprazole | In lists: 6 (B) | Main reason: Long-term high dose PPI therapy is as... | wave W101: PASS | not signed
- EU(7)-PIM: bowel antispasmodics: The EU(7)-PIM list names these antispasmodic medicines for the gut as potentially inappropriate for older people: mebeverine, trimebutine, d... | wave W101: PASS | not signed
- EU(7)-PIM: metoclopramide, domperidone above 30 mg a day: The EU(7)-PIM list names metoclopramide, domperidone at more than 30 mg a day, and alizapride as potentially inappropriate medicines for old... | wave W101: PASS | not signed
- EU(7)-PIM: listed antihistamines: The EU(7)-PIM list names these antihistamines as potentially inappropriate medicines for older people: aceprometazine, alimemazine, bromphen... | wave W101: PASS | not signed
- EU(7)-PIM: scopolamine (hyoscine), metopimazine: Scopolamine | In lists: 1, 3 (A); 5 (B) | Main reason: Anticholinergic side effects; no proven efficacy | Dose adjustment/special considerat... | wave W101-r1: PASS | not signed
- EU(7)-PIM: liquid paraffin, oral docusate: Viscous paraffin (=Liquid paraffin) | In lists: 4, 5 (A) | Main reason: Pulmonary side effects if aspirated | Dose adjustment/special consid... | wave W101: PASS | not signed
- EU(7)-PIM: stimulant laxatives: Bisacodyl (>3 days) | In lists: 1, 3 (A); 5 (B) | Main reason: Stimulant laxative. Adverse events include abdominal pain, fluid and electrol... | wave W102: PASS | not signed
- EU(7)-PIM: prucalopride: Prucalopride is on the EU(7)-PIM list of potentially inappropriate medicines for older people. The reason given is that it can cause stomach... | wave W102: PASS | not signed
- EU(7)-PIM: diphenoxylate with atropine, loperamide: Diphenoxylate-Atropine | In lists: 1 (A); 2, 5, 6 (B) | Main reason: No proven efficacy; muscarinic blocking agent | Dose adjustment/special... | wave W102: PASS | not signed
- EU(7)-PIM: racecadotril: Racecadotril | In lists: does not appear as PIM | Main reason: No proven efficacy; selective inhibitor of enkephalinase enzyme responsible f... | wave W102: PASS | not signed
- EU(7)-PIM: sliding-scale insulin: Insulin, sliding scale | In lists: 5 (A) | Main reason: No benefits demonstrated in using sliding-scale insulin. Might facilitate fluctuatio... | wave W102: PASS | not signed
- EU(7)-PIM: acarbose: Acarbose | In lists: does not appear as PIM | Main reason: No proven efficacy | Dose adjustment/special considerations: (blank: per ESM note... | wave W102: PASS | not signed
- EU(7)-PIM: pioglitazone: Pioglitazone | In lists: 5, 6 (B) | Main reason: Age-related risks include bladder cancer, fractures and heart failure. Use for more than on... | wave W102: PASS | not signed
- EU(7)-PIM: sitagliptin, vildagliptin: Sitagliptin and vildagliptin are on the EU(7)-PIM list of potentially inappropriate medicines for older people. Three reasons are given. The... | wave W102: PASS | not signed
- EU(7)-PIM: acenocoumarol: Acenocoumarol | In lists: 6 (B) | Main reason: Risk of bleeding, especially in people with difficult control of INR value | Dose adjustment/... | wave W103: PASS | not signed
- EU(7)-PIM: ticlopidine, dipyridamole, prasugrel: The EU(7)-PIM list names ticlopidine, dipyridamole and prasugrel as potentially inappropriate medicines for older people. Ticlopidine: a ris... | wave W103: PASS | not signed
- EU(7)-PIM: dabigatran, rivaroxaban, apixaban: The EU(7)-PIM list names dabigatran, rivaroxaban and apixaban as potentially inappropriate medicines for older people. The reasons given are... | wave W103: PASS | not signed
- EU(7)-PIM: ferrous sulfate above 325 mg a day: Iron supplements / Ferrous sulfate (>325 mg/d) | In lists: 6 (B) | Main reason: Doses >325 mg/d do not considerably increase the amount abso... | wave W103: PASS | not signed
- EU(7)-PIM: digoxin and other heart glycosides: The EU(7)-PIM list names digoxin, digitoxin, acetyldigoxin and metildigoxin as potentially inappropriate medicines for older people. The rea... | wave W103: PASS | not signed
- EU(7)-PIM: quinidine, procainamide, disopyramide: The EU(7)-PIM list names quinidine, procainamide, disopyramide and quinidine combined with verapamil as potentially inappropriate medicines ... | wave W103: PASS | not signed
- EU(7)-PIM: propafenone, flecainide: The EU(7)-PIM list names propafenone and flecainide as potentially inappropriate medicines for older people. Propafenone: a high risk of int... | wave W103: PASS | not signed
- EU(7)-PIM: amiodarone, dronedarone: The EU(7)-PIM list names amiodarone and dronedarone as potentially inappropriate medicines for older people. Amiodarone: it is linked to pro... | wave W103: PASS | not signed
- EU(7)-PIM: trimetazidine and ivabradine: Trimetazidine and ivabradine are named in the EU(7)-PIM list as potentially inappropriate medicines for older people. For trimetazidine the ... | wave W104: PASS | not signed
- EU(7)-PIM: clonidine, methyldopa, moxonidine and related medicines: Reserpine, methyldopa, clonidine, guanfacine, moxonidine and rilmenidine are named in the EU(7)-PIM list as potentially inappropriate medici... | wave W104: PASS | not signed
- EU(7)-PIM: prazosin, doxazosin, terazosin and urapidil: Prazosin, doxazosin, urapidil and terazosin are named in the EU(7)-PIM list as potentially inappropriate medicines for older people. The rea... | wave W104: PASS | not signed
- EU(7)-PIM: guanethidine: Guanethidine is named in the EU(7)-PIM list as a potentially inappropriate medicine for older people. The reason given is a higher risk of l... | wave W104: PASS | not signed
- EU(7)-PIM: hydralazine: Hydralazine is named in the EU(7)-PIM list as a potentially inappropriate medicine for older people. The reason given is a risk of low blood... | wave W104: PASS | not signed
- EU(7)-PIM: spironolactone above 25 mg a day: Spironolactone at a dose above 25 mg a day is named in the EU(7)-PIM list as potentially inappropriate for older people. The reason given is... | wave W104: PASS | not signed
- EU(7)-PIM: pentoxifylline and similar vasodilators: Older people should avoid these medicines that widen blood vessels: pentoxifylline, nicergoline, dihydroergocristine (alone or with raubasin... | wave W105: PASS | not signed
- EU(7)-PIM: venotonic vein medicines: Hidrosmin | In lists: 6 (B) | Main reason: No proven efficacy; unfavourable risk/benefit profile; orthostatic hypotension and fall risks are... | wave W105: PASS | not signed
- EU(7)-PIM: non-selective beta-blockers: Older people should avoid these non-selective beta-blockers: oxprenolol, pindolol, propranolol, sotalol, nadolol and labetalol. They can cau... | wave W105: PASS | not signed
- EU(7)-PIM: nicardipine and nifedipine: Older people should avoid nicardipine and nifedipine, in both the immediate-release and the sustained-release forms. They can cause low bloo... | wave W105: PASS | not signed
- EU(7)-PIM: verapamil and diltiazem: Older people should avoid verapamil and diltiazem. They can make constipation worse and can slow the heart rate too much. Other blood pressu... | wave W105: PASS | not signed
- EU(7)-PIM: niacin: Niacin (=Nicotinic acid) | In lists: 2 (A) | Main reason: Moderate risk of side effects; ineffective for the treatment of dementia | Dose ad... | wave W105: PASS | not signed
- EU(7)-PIM: oral oestrogen: Older women should avoid oestrogen taken by mouth. It may raise the risk of breast cancer and cancer of the womb lining, and it has not been... | wave W105: PASS | not signed
- EU(7)-PIM: bladder antimuscarinics: Older people should avoid these medicines for an overactive bladder: flavoxate, oxybutynin, tolterodine, solifenacin, trospium, darifenacin ... | wave W105: PASS | not signed
- EU(7)-PIM: ofloxacin: The EU(7)-PIM list for older people notes ofloxacin even though it is in none of the listed national lists. In older people the medicine can... | wave W106: PASS | not signed
- EU(7)-PIM: nitrofurantoin over a week: Nitrofurantoin (>1 week) | In lists: 1, 4, 5 (A) | Main reason: Unfavourable risk/benefit ratio, particularly with long-term use (pulmonary ... | wave W106: PASS | not signed
- EU(7)-PIM: non-selective NSAIDs: The EU(7)-PIM list names these anti-inflammatory pain medicines (NSAIDs) as potentially inappropriate in older people because of a very high... | wave W106: PASS | not signed
- EU(7)-PIM: coxibs: Celecoxib | In lists: 1, 2, 5, 6 (B) | Main reason: Very high risk of GI bleeding, ulceration, or perforation, which may be fatal; cardiovas... | wave W106: PASS | not signed
- EU(7)-PIM: muscle relaxants: The EU(7)-PIM list names centrally acting muscle relaxants as potentially inappropriate in older people: carisoprodol, methocarbamol, orphen... | wave W106: PASS | not signed
- EU(7)-PIM: colchicine: The EU(7)-PIM list names colchicine as potentially inappropriate in older people because the risk of toxic effects is higher, particularly w... | wave W106: PASS | not signed
- EU(7)-PIM: strontium ranelate: The EU(7)-PIM list for older people notes strontium ranelate even though it appears in none of the listed national lists. It raises the risk... | wave W106-r1: PASS | not signed
- EU(7)-PIM: quinine: The EU(7)-PIM list for older people notes quinine and its derivatives even though they are in none of the listed national lists. They carry ... | wave W106: PASS | not signed
- EU(7)-PIM: pethidine: Pethidine (also called meperidine) is a medicine to avoid in older people. It raises the risk of falls, fractures, confusion, dependency and... | wave W107: PASS | not signed
- EU(7)-PIM: pentazocine: Pentazocine is a medicine to avoid in older people because of the risk of delirium and agitation. The dose should be cut by a quarter when k... | wave W107: PASS | not signed
- EU(7)-PIM: tramadol: Tramadol, both sustained-release and standard (non-sustained-release) forms, is a medicine to avoid in older people. It causes more side eff... | wave W107: PASS | not signed
- EU(7)-PIM: methadone: Methadone is a medicine to avoid in older people because it is very long-acting. If it is used, give the lowest possible dose, start slowly ... | wave W107: PASS | not signed
- EU(7)-PIM: aspirin above 325 mg: Acetylsalicylic acid (>325 mg) | In lists: 3, 5 (A); 2, 5, 6 (B) | Main reason: May exacerbate existing GI ulcers or produce new GI ulcers; ... | wave W107: PASS | not signed
- EU(7)-PIM: ergotamine: Ergotamine | In lists: 4 (A) | Main reason: Unfavourable risk/benefit profile | Dose adjustment/special considerations: (blank: per ESM note... | wave W107: PASS | not signed
- EU(7)-PIM: triptans: Triptans (for example sumatriptan, eletriptan, naratriptan and zolmitriptan) have not been shown to be safe and effective in older adults. S... | wave W107-r1: PASS | not signed
- EU(7)-PIM: phenobarbital: Phenobarbital (phenobarbitone) is a medicine to avoid in older people because of the risk of sedation and paradoxical excitation. Use the lo... | wave W107: PASS | not signed
- EU(7)-PIM: phenytoin: Phenytoin | In lists: 3 (A); 5 (B) | Main reason: Narrow therapeutic window; increased risk of toxicity in older adults (e.g. CNS and hemato... | wave W108: PASS | not signed
- EU(7)-PIM: benzodiazepines: Clonazepam | In lists: 3, 5 (A); 5 (B) | Main reason: Risk of falls, paradoxical reactions | Dose adjustment/special considerations: Start l... | wave W108: PASS | not signed
- EU(7)-PIM: carbamazepine: Carbamazepine | In lists: 5 (A); 5 (B) | Main reason: Increased risk of SIADH-like syndrome; adverse events like carbamazepine-induced confu... | wave W108: PASS | not signed
- EU(7)-PIM: topiramate: Topiramate | In lists: 5 (B) | Main reason: Risk of cognitive-related dysfunction (e.g., confusion, psychomotor slowing) | Dose adjustment/s... | wave W108: PASS | not signed
- EU(7)-PIM: anticholinergic antiparkinson medicines: Trihexyphenidyl | In lists: 1, 5 (A); 2, 5, 6 (B) | Main reason: Risk of anticholinergic and CNS side effects including orthostatic hypotens... | wave W108: PASS | not signed
- EU(7)-PIM: amantadine: Amantadine | In lists: does not appear as PIM | Main reason: Risk of anticholinergic and CNS side effects including orthostatic hypotension,... | wave W108: PASS | not signed
- EU(7)-PIM: dopamine agonists: Bromocriptine | In lists: 3 (A); 6 (B) | Main reason: Risk of CNS side effects | Dose adjustment/special considerations: (blank: per ESM not... | wave W108: PASS | not signed
- EU(7)-PIM: selegiline: Selegiline | In lists: 3 (A) | Main reason: Increased risk of orthostatic hypotension and dizziness | Dose adjustment/special considerations... | wave W108: PASS | not signed
- EU(7)-PIM: older antipsychotics: Older people should avoid these conventional antipsychotic medicines: chlorpromazine, levomepromazine, clorazepate with acepromazine, cyamem... | wave W109: PASS | not signed
- EU(7)-PIM: newer antipsychotics: Older people should avoid these newer antipsychotic medicines: sertindole, ziprasidone, clozapine and aripiprazole. Olanzapine is on the lis... | wave W109: PASS | not signed
- EU(7)-PIM: lithium: Lithium is on the list of medicines to avoid in older people. Its safe range is narrow, and it builds up in the body when the kidneys work l... | wave W109: PASS | not signed
- EU(7)-PIM: meprobamate: Meprobamate is on the list of medicines to avoid in older people because of the risk of drowsiness and confusion. If it must be used, the li... | wave W109: PASS | not signed
- EU(7)-PIM: chloral hydrate: Chloral hydrate is on the list of medicines to avoid in older people because of the risk of dizziness and changes on the heart tracing. The ... | wave W109: PASS | not signed
- EU(7)-PIM: zopiclone, zolpidem, zaleplon: Zopiclone (>3.75 mg/d) | In lists: 1, 4, 5, 6 (A); 5 (B) | Main reason: Risk of falls and hip fracture, prolonged reaction time, psychiatric... | wave W109: PASS | not signed
- EU(7)-PIM: clomethiazole, propiomazine: Clomethiazole and propiomazine are on the list of medicines to avoid in older people. Clomethiazole carries a risk of slowed breathing. Prop... | wave W109: PASS | not signed
- EU(7)-PIM: tricyclic antidepressants: Older people should avoid these tricyclic and related antidepressants: desipramine, imipramine, clomipramine, trimipramine, amitriptyline, n... | wave W109: PASS | not signed
- EU(7)-PIM: fluoxetine, paroxetine, fluvoxamine: Fluoxetine | In lists: 3, 4 (A); 2, 5, 6 (B) | Main reason: CNS side effects (nausea, insomnia, dizziness, confusion); hyponatremia | Dose a... | wave W110: PASS | not signed
- EU(7)-PIM: tranylcypromine: Tranylcypromine | In lists: 4 (A) | Main reason: Irreversible MAO inhibitor. Risk of hypertensive crises, cerebral hemorrhage and malignant ... | wave W110: PASS | not signed
- EU(7)-PIM: bupropion, venlafaxine, reboxetine: Bupropion | In lists: 5 (B) | Main reason: May lower seizure threshold | Dose adjustment/special considerations: Reduce dose and dosing freq... | wave W110: PASS | not signed
- EU(7)-PIM: methylphenidate: Methylphenidat | In lists: 2 (A); 5 (B) | Main reason: May cause or worsen insomnia; concern due to CNS-altering effects; concern due to app... | wave W110: PASS | not signed
- EU(7)-PIM: piracetam: Piracetam | In lists: 1, 4 (A) | Main reason: No efficacy proven; unfavorable risk/benefit profile | Dose adjustment/special considerations:... | wave W110: PASS | not signed
- EU(7)-PIM: ginkgo biloba: Ginkgo biloba | In lists: 1 (A) | Main reason: No efficacy proven; increased risk of orthostatic hypotension and fall | Dose adjustment/spec... | wave W110: PASS | not signed
- EU(7)-PIM: bethanechol: Bethanechol | In lists: does not appear as PIM | Main reason: Anticholinergic bladder relaxants may cause obstruction in persons with benign... | wave W110: PASS | not signed
- EU(7)-PIM: phenylpropanolamine, pseudoephedrine: Norephedrine (=Phenylpropanolamine) | In lists: 3 (A) | Main reason: Higher risk of elevation of blood pressure secondary to sympathomimetic... | wave W110-r1: PASS | not signed
- BRISNIK-HR-F2: Prescribed SSRI or SNRI - and the patient is aged ≥ 65 years and co-prescribed ≥ 2 of the following: antiplatelet, anticoagulant, and NSAID ... | scored by Kimi Code | not signed
- STOPP M1: Concomitant use of two or more drugs with antimuscarinic/anticholinergic properties (e.g., bladder antispasmodics, intestinal antispasmodics... | scored by Kimi Code | not signed
- EU7-F14: Glibenclamide | In lists: 1, 5 (A); 6 (B) | Main reason: Risk of protracted hypoglycemia | Dose adjustment/special considerations: Use conse... | scored by Kimi Code | not signed
- PINCER 10: Patients receiving prescriptions of amiodarone for at least one month who are receiving a dose of more than 200 mg per day - More specifical... | scored by Kimi Code | not signed
- PROMPT CN-4: Non-benzodiazepine hypnotics (zolpidem, zaleplon, zopiclone) should not be used long-term (greater than 4 weeks). | scored by Kimi Code | not signed
- STOPP C13: Direct thrombin inhibitor (e.g., dabigatran) and diltiazem or verapamil (increased risk of bleeding). | scored by Kimi Code | not signed
- STOPP C1: Long-term aspirin at doses greater than 100mg per day (increased risk of bleeding, no evidence for increased efficacy). | scored by Kimi Code | not signed
- PROMPT RS-3: A concomitant bisphosphonate should be prescribed if oral corticosteroids are used long-term (greater than three months). | scored by Kimi Code | not signed
- BRISNIK-HR-A3: Prescribed > 20 mg citalopram or > 10 mg escitalopram daily - and the patient is aged ≥ 65 years (risk of QTc prolongation) | scored by Kimi Code | not signed
- EU(7)-PIM: oral terbutaline: Oral terbutaline (tablets or liquid by mouth) is on the EU(7)-PIM list of medicines to avoid in older people, because it carries a higher ri... | wave W111: PASS | not signed
- EU(7)-PIM: theophylline: Theophylline is on the EU(7)-PIM list of medicines to avoid in older people, because it has a higher risk of stimulant effects on the brain ... | wave W111: PASS | not signed
- EU(7)-PIM: opioid cough medicines and long-term codeine: Three opioid medicines are on the EU(7)-PIM list of medicines to avoid in older people. Ethylmorphine and dextromethorphan are listed becaus... | wave W111-r1: PASS | not signed
- PROMPT: SSRI with venlafaxine: Selective serotonin reuptake inhibitors (e.g. citalopram, fluoxetine) should not be used in combination with venlafaxine. | wave W111: PASS | not signed
- PROMPT: tricyclic as first-line: Tricyclic antidepressants (TCAs) (e.g. amitriptyline, nortriptyline) should not be used as first-line in treatment of depression. | wave W111: PASS | not signed
- PROMPT: long-term benzodiazepine: Benzodiazepines (e.g. nitrazepam, temazepam) should not be used long-term (greater than four weeks). | wave W111: PASS | not signed
- PROMPT: carbamazepine with a macrolide: Carbamazepine should not be used in combination with clarithromycin or erythromycin. | wave W111: PASS | not signed
- PROMPT: strong opioid without laxative: Strong opioids (e.g. buprenorphine, diamorphine, fentanyl, morphine, oxycodone) should not be prescribed without the co-prescribing of laxat... | wave W111: PASS | not signed
- PROMPT CV-1: alpha blocker alone: The use of alpha-adrenoceptor blocking drugs (e.g. doxazosin, prazosin) as monotherapy for hypertension, should be avoided. | wave W112: PASS | not signed
- PROMPT CV-2: aspirin dose over 150 mg: Aspirin doses should not exceed 150 mg/day for anti-platelet therapy. | wave W112-r1: PASS | not signed
- PROMPT CV-3: verapamil or diltiazem with a beta blocker: Cardio-selective calcium-channel blockers (e.g. verapamil, diltiazem) should not be used in combination with beta-adrenoceptor blocking drug... | wave W112: PASS | not signed
- PROMPT CV-4: short-acting dipyridamole alone: The use of oral short-acting dipyridamole should not be used as monotherapy in antiplatelet treatment. | wave W112: PASS | not signed
- PROMPT DU-1: two medicines of one class: The use of two or more drugs from the same pharmacological class should be avoided, unless used for additive effects in line with current cl... | wave W112: PASS | not signed
- PROMPT EN-1: glibenclamide: In relation to the management of diabetes, the use of oral long-acting sulfonylureas (glibenclamide) should be avoided. | wave W112: PASS | not signed
- PROMPT GI-1: long-term stimulant laxative: Other than for opioid-induced constipation, stimulant laxatives (e.g. bisacodyl, senna) should not be prescribed as first-line treatment in ... | wave W112: PASS | not signed
- PROMPT GI-2: high-dose PPI over eight weeks: Proton pump inhibitors (PPIs) (e.g. esomeprazole, omeprazole) should not be prescribed at doses above the recommended maintenance dosage for... | wave W112: PASS | not signed
- PINCER 1: NSAID after peptic ulcer, no PPI: Patients with a history of peptic ulcer who have been prescribed a non-selective NSAID: - More specifically, those with a computer-coded dia... | wave W113-r1: PASS | not signed
- PROMPT: omeprazole or esomeprazole with clopidogrel: Esomeprazole or omeprazole should not be used in combination with clopidogrel. | wave W113: PASS | not signed
- PROMPT: nitrofurantoin over 7 days: Nitrofurantoin should not be prescribed for greater than 7 days for the management of uncomplicated lower urinary-tract infections. | wave W113: PASS | not signed
- PROMPT: long-term NSAID: Non-steroidal anti-inflammatory drugs (NSAIDs) (e.g. celecoxib, diclofenac, naproxen) should not be used long-term (greater than three month... | wave W113: PASS | not signed
- PROMPT: NSAID with aspirin or SSRI, no stomach protection: Unless adequate gastro-intestinal protection is provided with either a proton pump inhibitor or H 2 -receptor antagonist, non-steroidal anti... | wave W113: PASS | not signed
- PROMPT: first generation antihistamine over 7 days: First generation antihistamines (e.g. chlorphenamine, promethazine) should not be used as first-line agents for greater than seven days. | wave W113-r1: PASS | not signed
- PROMPT: theophylline alone: Theophylline should not be used as monotherapy for asthma or chronic obstructive pulmonary disease. | wave W113: PASS | not signed
- PROMPT: mucolytic in stable COPD: Mucolytic agents (e.g. carbocisteine, mecysteine) should not be used routinely in stable chronic obstructive pulmonary disease. | wave W113-r1: NOT PASSING | not signed
- PINCER 2: Patients with asthma who have been prescribed a beta-blocker: - More specifically those with a computer-coded diagnosis of asthma, at least ... | wave W114: PASS | not signed
- PINCER 3: Patients aged 75 years and older who have been prescribed an ACE inhibitor or a loop diuretic long-term (see below) who have not had a compu... | wave W114: PASS | not signed
- PINCER 4: Proportions of women with a past medical history of venous or arterial thrombosis who have been prescribed the combined oral contraceptive p... | wave W114: PASS | not signed
- PINCER 5a: Patients receiving methotrexate for at least three months who have not had a recorded full blood count and/or liver function test within the... | wave W114: PASS | not signed
- PINCER 5b: Patients receiving methotrexate for at least three months who have not had a recorded full blood count and/or liver function test within the... | wave W114: PASS | not signed
- PINCER 6: Patients receiving warfarin for at least three months who have not had a recorded check of their INR within the previous 12 weeks - More spe... | wave W114: PASS | not signed
- PINCER 7: Patients receiving lithium for at least three months who have not had a recorded check of their lithium levels within the previous three mon... | wave W114: PASS | not signed
- PINCER 8: Patients receiving amiodarone for at least six months who have not had a thyroid function test within the previous six months - More specifi... | wave W114: PASS | not signed
- OPTIMISE T2-02: statin for 10-year risk of 10% or more: Consider statin therapy (eg. Atorvastatin 20 mg daily) for those adults who have ≥ 10% 10-year risk of developing CV disease using a validat... | wave W115: PASS | not signed
- OPTIMISE T2-03: high-intensity statin after cardiovascular disease: Commence high intensity statin therapy (eg. atorvastatin 80 mg daily) in adults with existing CV disease for secondary prevention. Lower dos... | wave W115: PASS | not signed
- OPTIMISE T2-04: statin in chronic kidney disease: Commence statin therapy (eg. atorvastatin 20 mg daily) for the primary and secondary prevention of CVD in adults with chronic kidney disease... | wave W115: PASS | not signed
- OPTIMISE T2-06: simvastatin in severe mental illness: Statins with a high degree of lipophilicity eg. simvastatin may be associated with central nervous system disturbance eg. sleep disturbance,... | wave W115: PASS | not signed
- OPTIMISE T2-07: treat stage 1 hypertension with extra risk: Commence antihypertensive therapy in adults < 80 years with a clinic blood pressure of ≥ 140 mmHg systolic and/or ≥ 90 mmHg diastolic (stage... | wave W115-r1: PASS | not signed
- OPTIMISE T2-08: treat stage 2 hypertension: Commence antihypertensive therapy to adults of any age with clinic blood pressure ≥ 160/100 mmHg and ABPM ≥ 150/95 mmHg (stage 2 hypertensio... | wave W115: PASS | not signed
- OPTIMISE T2-12: antiplatelet after vascular disease: Commence antiplatelet therapy (aspirin or clopidogrel or prasugrel or ticagrelor) in adults with SMI with a documented history of coronary, ... | wave W115-r1: PASS | not signed
- OPTIMISE T2-19: When starting levothyroxine, 50-100mcg daily is the recommended starting dose for most adults. In adults over 65 years or adults with ischae... | wave W116: PASS | not signed
- OPTIMISE T2-20: TFTs should be performed 4–6 weeks after starting levothyroxine and dose adjusted according to response. TSH is the most reliable marker of ... | wave W116: PASS | not signed
- OPTIMISE T2-22: Do not routinely start thyroid supplementation with levothyroxine for the management of depression in a euthyroid adult or an adult with sym... | wave W116: PASS | not signed
- OPTIMISE T2-24: Monitor baseline prolactin for all people with SMI before initiating an antipsychotic known to raise prolactin | wave W116: PASS | not signed
- OPTIMISE T2-25: Systematically assess for symptoms of hyperprolactinaemia in people with SMI who are prescribed an antipsychotic at 3 months and biannually ... | wave W116-r1: PASS | not signed
- OPTIMISE T2-27: adjunctive aripiprazole for raised prolactin: In symptomatic hyperprolactinaemia, where a dose reduction or a switch to an alternative antipsychotic with a lower potential to elevate pro... | wave W117: PASS | not signed
- OPTIMISE T2-29: dopamine agonist for raised prolactin in severe mental illness: Dopamine agonists (eg. cabergoline, bromocriptine) should not be initiated in adults with SMI for the management of hyperprolactinaemia exce... | wave W117: PASS | not signed
- OPTIMISE T2-30: antidepressant with aspirin, NSAID or DOAC: Consider the increased risk of bleed (not limited to gastrointestinal bleed) when a selective serotonin reuptake inhibitor (SSRI), serotonin... | wave W117: PASS | not signed
- OPTIMISE T2-32: folate check on an antiepileptic: Monitor folic acid levels periodically in people who are prescribed antiepileptic drugs and correct any folic acid deficiencies | wave W117-r1: PASS | not signed
- OPTIMISE T2-33: vitamin B12 before folic acid: Always identify and correct vitamin B12 deficiency before prescribing folic acid | wave W117: PASS | not signed
- OPTIMISE T2-34: folic acid 5 mg in pregnancy on an antiepileptic: Consider folic acid 5 mg daily for women who are pregnant or planning pregnancy and who are taking antiepileptic drugs including valproate, ... | wave W117: PASS | not signed
- OPTIMISE T2-35: folic acid added to treat depression: Do not routinely prescribe folic acid as an augmenting agent in the treatment of depression | wave W117: PASS | not signed
- OPTIMISE T2-37: omega-3 fish oil in severe mental illness: Do not routinely prescribe Omega 3 fish oils in people with SMI | wave W117: PASS | not signed
- OPTIMISE T2-42: clozapine after stopping smoking: Consider a dose reduction by up to 50% in patients taking clozapine who stop smoking abruptly. Carefully monitor for adverse effects of cloz... | wave W118: PASS | not signed
- OPTIMISE T2-43: olanzapine after stopping smoking: Consider a dose reduction by up to 20% in patients taking olanzapine who stop smoking abruptly. Carefully monitor for adverse effects of ola... | wave W118: PASS | not signed
- OPTIMISE T2-49: vertebral fracture, no bisphosphonate: Adults > 50 years of age with a history of vertebral fracture should be considered for antiosteoporosis therapy with an oral bisphosphonate ... | wave W118-r1: PASS | not signed
- OPTIMISE T3-01: metformin after early weight gain: Consider adjunctive metformin, unless contraindicated, in people with SMI (Severe Mental Illness) who are prescribed clozapine or olanzapine... | wave W118: PASS | not signed
- OPTIMISE T3-02: dementia with vascular disease, no aspirin: For people with dementia who have a history of cerebrovascular disease or who have evidence on neurological examination or neuroimaging of c... | wave W118-r1: PASS | not signed
- OPTIMISE T3-04: H2 blocker with high anticholinergic burden: Where gastroprotection is indicated, low dose proton pump inhibitors (PPIs) are the preferred treatment choice in adults with SMI who are pr... | wave W118: PASS | not signed
- Bansal S01: opioid with alcohol dependence: Persistent prescription of opioid analgesics to a patient with a medical history of alcohol addiction, abuse, or dependence [32, 47–49] | wave W119: PASS | not signed
- Bansal S02: opioid in pregnancy: Acute or persistent prescription of opioid analgesics to a woman during pregnancy [50–58] | wave W119: PASS | not signed
- Bansal S04: opioid with paralytic ileus: Persistent prescription of opioid analgesics to a patient with paralytic ileus [62, 63] | wave W119: PASS | not signed
- Bansal S05: opioid with dementia: Persistent prescription of opioid analgesics to a patient with dementia [64, 65] | wave W119: PASS | not signed
- OPTIMISE T3-06: anticonvulsant in adult over 50: i.Adults over 50 years who are prescribed sodium valproate, carbamazepine, primidone, or phenytoin because these agents are associated with ... | wave W119: PASS | not signed
- OPTIMISE T3-07: long-term oral steroid under 50: ii.Adults < 50 years old on oral steroids (prednisolone > 7.5 mg/day or equivalent for ≥ 3 months) | wave W119: PASS | not signed
- BANSAL S08: persistent opioid in myasthenia gravis: Persistent prescription of opioid analgesics to a patient with myasthenia gravis [72–74] | wave W120: PASS | not signed
- BANSAL S10: opioid with benzodiazepine: Acute or persistent co-prescription of opioid analgesics with a benzodiazepine [79–83] | wave W120: PASS | not signed
- BANSAL S13: persistent opioid, constipation, no laxative: Persistent prescription of opioid analgesics to a patient with constipation and without a concurrently prescribed laxative [90, 91] | wave W120: PASS | not signed
- BANSAL S14: opioid 6 months or more, no laxative: Persistent prescription of opioid analgesics for greater than or equal to 6 months without a concurrently prescribed laxative [90, 91] | wave W120: PASS | not signed
- BANSAL S15: codeine or morphine, severe renal impairment: Prescription of codeine or morphine to a patient with severe renal impairment, i.e. the most recent eGFR < 30 mL/min per 1.73 m 2 [92, 93] | wave W120: PASS | not signed
- BANSAL S16: opioid above 120 mg morphine a day: Persistent prescription of one or more opioid analgesics at a dose above the equivalent of 120 mg of oral morphine per day [32, 61, 78] | wave W120: PASS | not signed
- BANSAL S17: opioid over 3 months after surgery discharge: Acute or persistent prescription of opioid analgesics to a patient for more than 3 months following the patient’s discharge from the hospita... | wave W120: PASS | not signed
- Bansal S18: Persistent prescription of opioid analgesics to a patient with at least moderate hepatic impairment [96–98] | wave W121: PASS | not signed
- Bansal S19: Persistent prescription of opioid analgesics to a patient aged over 65 years with a recent medical history of falling [81, 82, 99] | wave W121: PASS | not signed
- Bansal S20: Persistent prescription of tramadol, buprenorphine, or oxycodone to a patient with a medical history of ventricular tachycardia [100, 101] | wave W121: PASS | not signed
- Brisnik A1: antidepressant in heart failure: Prescribed SNRI, TCA (in doses ≥ 50 mg/day)[a], or tranylcypromine[b] - and the patient has a history of chronic heart failure | wave W122-r1: PASS | not signed
- Brisnik A2: tricyclic in ischaemic heart disease: Prescribed TCA (in doses ≥ 50 mg/day) - and the patient has a history of ischemic heart disease | wave W122: PASS | not signed
- Brisnik A4: citalopram or escitalopram with QT risk: Prescribed citalopram and escitalopram - and the patient has long QT syndrome or is at risk of long QT syndrome (e.g., (advanced) chronic he... | wave W122-r1: PASS | not signed
- Brisnik A5: QT-risk antidepressant with another QT-risk medicine: Prescribed citalopram, escitalopram, or TCA (in doses ≥ 50 mg/day) - and the patient is co-prescribed ≥ 1 further drug with any risk of TdP[... | wave W122-r1: PASS | not signed
- Brisnik A6: antidepressant with a fast heart rate: Prescribed TCA (in doses ≥ 50 mg/day), SNRI, bupropion, or tranylcypromine[b] - and the patient has developed tachycardia | wave W122: PASS | not signed
- Brisnik A7: fluoxetine, paroxetine or bupropion with metoprolol or propranolol: Prescribed fluoxetine, paroxetine, or bupropion - and the patient is co-prescribed metoprolol or propranolol (risk of bradycardia) | wave W122: PASS | not signed
- Brisnik A8: antidepressant with uncontrolled hypertension: Prescribed SNRI, TCA (in doses ≥ 50 mg/day), bupropion, or tranylcypromine - and the patient has uncontrolled hypertension[c] | wave W122: PASS | not signed
- Brisnik A9: antidepressant with three or more blood pressure medicines: Prescribed SNRI, TCA (in doses ≥ 50 mg/day), bupropion, or tranylcypromine - and achieving hypertension control requires ≥ 3 antihypertensiv... | wave W122: PASS | not signed
- Brisnik: tricyclic, trazodone or tranylcypromine with dizziness: Prescribed TCA (in doses ≥ 50 mg/day), trazodone, or tranylcypromine - and the patient has developed persistent OH/dizziness under treatment... | wave W123: PASS | not signed
- Brisnik: SSRI, SNRI or mirtazapine in over 65s with dizziness: Prescribed SSRI, SNRI, or mirtazapine - and the patient is aged ≥ 65 years and has developed persistent OH/dizziness under treatment | wave W123: PASS | not signed
- Brisnik: tricyclic or trazodone with a blood pressure medicine in over 65s: Prescribed TCA (in doses ≥ 50 mg/day), trazodone, or tranylcypromine - and the patient is aged ≥ 65 years and co-prescribed ≥ 1 further drug... | wave W123: PASS | not signed
- Brisnik: SSRI, SNRI or mirtazapine with two blood pressure medicines in over 65s: Prescribed SSRI, SNRI, or mirtazapine - and the patient is aged ≥ 65 years and co-prescribed ≥ 2 further drugs with blood pressure lowering ... | wave W123: PASS | not signed
- Brisnik: antidepressant with a fall-risk medicine in over 65s: Prescribed any antidepressant - and the patient is aged ≥ 65 years and co-prescribed ≥ 1 further fall risk-increasing drug[c] | wave W123: PASS | not signed
- Brisnik: antidepressant with a history of falls: Prescribed any antidepressant - and the patient has a history of falls | wave W123: PASS | not signed
- Brisnik: antidepressant with cognitive impairment or dementia: Prescribed any antidepressant - and the patient has cognitive impairment or dementia | wave W123: PASS | not signed
- Brisnik: antidepressant after a stroke with a fall-risk medicine: Prescribed any antidepressant - and the patient has a history of stroke and co-prescribed ≥ 1 further fall-risk-increasing drug | wave W123: PASS | not signed
- Brisnik HR-D1: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient has cognitive impair... | wave W124: PASS | not signed
- Brisnik HR-D2: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient has a history of del... | wave W124: PASS | not signed
- Brisnik HR-E1: Prescribed tranylcypromine - and the patient is co-prescribed ≥ 1 further serotonergic drug (e.g., tramadol, fentanyl, triptans, metoclopram... | wave W124: PASS | not signed
- Brisnik HR-E2: Prescribed SSRI, SNRI, or TCA (in doses ≥ 50 mg/day) - and the patient is co-prescribed ≥ 2 further serotonergic drugs other than tranylcypr... | wave W124: PASS | not signed
- Brisnik HR-F1: Prescribed SSRI or SNRI - and the patient is aged ≥ 65 years and co-prescribed a single of the following without GI protection: antiplatelet... | wave W124: PASS | not signed
- Brisnik HR-F3: Prescribed SSRI or SNRI - and the patient has at least one risk factor for GI bleeding (history of peptic ulcer disease, GI bleeding, or hem... | wave W124: PASS | not signed
- Brisnik HR-G1: Prescribed SSRI - and the patient has a history of a bleeding event and co-prescribed ≥ 1 of the following: anticoagulant or antiplatelet | wave W124: PASS | not signed
- Brisnik: SSRI with a blood thinner in an older person: Prescribed SSRI - and the patient has at least one risk factor for intracranial bleeding (aged ≥ 65 years, history of stroke, history of dem... | wave W125: PASS | not signed
- Brisnik: constipating antidepressant with constipation: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient has persistent const... | wave W125: PASS | not signed
- Brisnik: constipating antidepressant plus two constipating medicines: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient is aged ≥ 65 years a... | wave W125: PASS | not signed
- Brisnik: antidepressant with low sodium, no diuretic: Prescribed any antidepressant - and the patient has developed hyponatremia (< 130 mmol/l) under treatment without being treated with a diure... | wave W125: PASS | not signed
- Brisnik: SSRI or SNRI plus two sodium-lowering medicines: Prescribed SSRI or SNRI - and the patient is aged ≥ 65 years and co-prescribed ≥ 2 further drugs known to cause hyponatremia (e.g., (thiazid... | wave W125: PASS | not signed
- Brisnik: agomelatine with raised liver enzymes: Prescribed agomelatine - and the patient has developed elevated serum transaminase levels (> 3 times the upper normal range) under treatment... | wave W125: PASS | not signed
- Brisnik: agomelatine with liver disease: Prescribed agomelatine - and the patient has a hepatic impairment (i.e., cirrhosis or active liver disease) | wave W125: PASS | not signed
- Brisnik: constipating antidepressant with voiding problems: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient has a history of voi... | wave W125: PASS | not signed
- Brisnik HR-L1: anticholinergic antidepressant with angle closure glaucoma: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient has a history of ang... | wave W126-r1: PASS | not signed
- Brisnik HR-M1: SSRI, SNRI, MAOI or bupropion with sleep problems or agitation: Prescribed SSRI, SNRI, MAOI, or bupropion - and the patient has persistent sleeping disturbances (e.g., insomnia, restless leg syndrome) or ... | wave W126-r1: PASS | not signed
- Brisnik HR-N1: SSRI or SNRI with sexual dysfunction: Prescribed SSRI or SNRI - and the patient has developed sexual dysfunction | wave W126-r1: PASS | not signed
- Brisnik ANXI1: antidepressant for 8 weeks or more in under-65 with no improvement: Prescribed an antidepressant for ≥ 8 weeks - and the patient is aged < 65 years with no signs of clinically relevant symptom improvement[1] | wave W126-r1: PASS | not signed
- Brisnik ANXI2: antidepressant for 12 weeks or more in 65 and over with no improvement: Prescribed an antidepressant for ≥ 12 weeks - and the patient is aged ≥ 65 years with no signs of clinically relevant symptom improvement | wave W126-r1: PASS | not signed
- Brisnik ANXI3: antidepressant for anxiety over 12 months with full remission: Prescribed an antidepressant > 12 months for anxiety - and the patient has achieved full remission | wave W126-r1: PASS | not signed
- Brisnik ANXI4: antidepressant for anxiety with a benzodiazepine for over 4 weeks: Prescribed an antidepressant for anxiety - and the patient is co-prescribed benzodiazepine > 4 weeks | wave W126-r1: PASS | not signed
- Brisnik DEPR1: antidepressant for a first episode of mild depression: Prescribed an antidepressant - and the patient has a first episode of mild depression | wave W126-r1: PASS | not signed
- Brisnik OP DEPR2: two antidepressants: Co-prescribed two antidepressants - and the patient has a first episode of moderate depression | wave W127-r1: PASS | not signed
- Brisnik OP DEPR3: one antidepressant, no improvement, under 65: Prescribed an antidepressant in monotherapy for ≥ 4 weeks - and the patient is aged < 65 years with no signs of clinically relevant symptom ... | wave W127-r1: PASS | not signed
- Brisnik OP DEPR4: one antidepressant, no improvement, 65 or over: Prescribed an antidepressant in monotherapy for ≥ 6 weeks - and the patient is aged ≥ 65 years with no signs of clinically relevant symptom ... | wave W127-r1: PASS | not signed
- Brisnik OP DEPR5: one antidepressant after two or more earlier ones: Prescribed an antidepressant in monotherapy - and the patient has previously used two or more different antidepressants (inadequate response... | wave W127-r1: PASS | not signed
- Brisnik OP DEPR6: antidepressant over 12 months after full remission: Prescribed an antidepressant in monotherapy, combination, or augmentation > 12 months for a first episode of moderate or severe depression -... | wave W127-r1: PASS | not signed
- Brisnik OP DEPR7: antidepressant over 2 years after repeat episodes: Prescribed an antidepressant in monotherapy, combination, or augmentation > 2 years with a history of 2 or more depressive episodes with fun... | wave W127-r1: PASS | not signed
- Brisnik OP DEPR8: SSRI above 1 DDD without earlier improvement: Prescribed SSRI at a dose of > 1 DDD - and the patient has no clinically relevant symptom improvement under an SSRI dose ≤ 1 DDD (no further... | wave W127-r1: PASS | not signed
- Brisnik OP DEPR9: two antidepressants, none a sedating one: Prescribed two antidepressants - and none of those is mirtazapine, mianserin, or trazodone | wave W127-r1: PASS | not signed
- Brisnik: INSO1: Prescribed TCA ≥ 50 mg/day for insomnia[2] - and the patient has no other indications for an antidepressant | wave W128-r1: PASS | not signed
- Brisnik: INSO2: Prescribed trazodone ≥ 50 mg/day for insomnia - and the patient has no other indications for an antidepressant | wave W128-r1: PASS | not signed
- Brisnik: INSO3: Prescribed mirtazapine ≥ 30 mg/day for insomnia - and the patient has no other indications for an antidepressant | wave W128-r1: PASS | not signed
- Brisnik: INSO4: Prescribed a sedating antidepressant > 8 weeks for insomnia - and the patient has no other indications for an antidepressant | wave W128-r1: PASS | not signed
- Brisnik: MISC1: Prescribed any antidepressant - and the patient has chronic heart failure and a first episode of mild or moderate depression | wave W128-r1: PASS | not signed
- Brisnik: MISC2: Prescribed any antidepressant - and the patient has dementia and a first episode of mild or moderate depression | wave W128-r1: PASS | not signed
- Brisnik: MISC3: Prescribed agomelatine - and the patient is aged ≥ 75 years | wave W128-r1: PASS | not signed
- Brisnik: PAIN1: Prescribed a TCA ≥ 75 mg/day for neuropathic pain - and the patient has no other indications for an antidepressant | wave W128-r1: PASS | not signed
- Brisnik OP-PAIN2: Prescribed venlafaxine ≥ 150 mg/day for neuropathic pain - and the patient has no other indications for an antidepressant | wave W129: PASS | not signed
- Brisnik OP-PAIN3: Prescribed SSRI or mirtazapine for neuropathic pain - and the patient has no other indications for an antidepressant | wave W129: PASS | not signed
- Brisnik OP-PAIN4: Prescribed any antidepressant for non-specific low back pain - and the patient has no other indications for an antidepressant | wave W129: PASS | not signed
- Brisnik OP-PAIN5: Prescribed TCA or SNRI as analgesic for pain (e.g., pain other than neuropathic pain, tension headache, migraine, or fibromyalgia syndrome) ... | wave W129: PASS | not signed
- STOPP B1: Digoxin for heart failure with normal systolic ventricular function (no clear evidence of benefit) | wave W129: PASS | not signed
- STOPP B10: Loop diuretic for treatment of hypertension with concurrent urinary incontinence (may exacerbate incontinence). | wave W129: PASS | not signed
- STOPP B12: Angiotensin-Converting Enzyme inhibitors (ACEIs) or Angiotensin Receptor Blockers (ARBs) in patients with hyperkalaemia i.e., serum K > 5.5 ... | wave W129: PASS | not signed
- STOPP B14: Phosphodiesterase type-5 inhibitors (e.g., sildenafil, tadalafil, vardenafil) in severe heart failure characterised by hypotension i.e., sys... | wave W129: PASS | not signed
- STOPP B2: Verapamil or diltiazem with NYHA Class III or IV heart failure (may worsen heart failure with reduced ejection fraction i.e., HFREF). | wave W130-r1: PASS | not signed
- STOPP B15: Drugs that predictably prolong the QTc interval (QTc = QT/RR) in patients with known with demonstrable QTc prolongation (to >450 msec in mal... | wave W130-r1: PASS | not signed
- STOPP B16: Statins for primary cardiovascular prevention in persons aged ≥ 85 and established frailty with expected life expectancy likely less than 3 ... | wave W130-r1: PASS | not signed
- STOPP B17: Long-term systemic i.e., non-topical NSAIDs with known history of coronary, cerebral or peripheral vascular disease (increased risk of throm... | wave W130-r1: PASS | not signed
- STOPP B18: Long-term antipsychotics with known history of coronary, cerebral or peripheral vascular disease (increased risk of thrombosis). | wave W130-r1: PASS | not signed
- STOPP B19: NSAIDs or systemic corticosteroids with heart failure requiring loop diuretic therapy (risk of exacerbation of heart failure). | wave W130-r1: PASS | not signed
- STOPP B20: Antihypertensive drugs in severe symptomatic aortic stenosis (risk of severe hypotension, syncope). | wave W130-r1: PASS | not signed
- STOPP B21: Digoxin as first line treatment for long-term (> 3 months) ventricular rate control in atrial fibrillation (increased mortality from long-te... | wave W130-r1: PASS | not signed
- STOPP B4: Ventricular rate-limiting drugs i.e., beta blocker, verapamil, diltiazem, digoxin with bradycardia (< 50/min), type II heart block or comple... | wave W131-r1: PASS | not signed
- STOPP B5: Beta-blocker as monotherapy for uncomplicated hypertension i.e., not associated with angina pectoris, aortic aneurysm or other condition whe... | wave W131-r1: PASS | not signed
- STOPP B6: Amiodarone as first-line antiarrhythmic therapy in supraventricular tachyarrhythmias (higher risk of major side-effects than beta-blockers, ... | wave W131-r1: PASS | not signed
- STOPP B7: Loop diuretic as first-line treatment for hypertension unless there is concurrent heart failure requiring diuretic therapy (safer, more effe... | wave W131-r1: PASS | not signed
- STOPP B8: Loop diuretic for dependent ankle oedema without clinical, biochemical or radiological evidence of heart failure, liver failure, nephrotic s... | wave W131-r1: PASS | not signed
- STOPP B9: Thiazide diuretic with current significant hypokalaemia (i.e., serum K+ < 3.0 mmol/l), hyponatraemia (i.e., serum Na+ < 130 mmol/l) hypercal... | wave W131-r1: PASS | not signed
- STOPP C11: Vitamin K antagonist as first-line anticoagulant for atrial fibrillation, unless there is concurrent metallic heart valve in-situ, moderate-... | wave W131-r1: PASS | not signed
- STOPP C12: Selective serotonin reuptake inhibitors (SSRIs) in combination with Vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitor w... | wave W131-r1: PASS | not signed
- STOPP C2: blood thinner with high bleeding risk: Antiplatelet agents, vitamin K antagonists, direct thrombin inhibitors or factor Xa inhibitors with concurrent significant risk of major ble... | wave W132: PASS | not signed
- STOPP C3: aspirin plus clopidogrel after stroke: Aspirin plus clopidogrel as long-term secondary stroke prevention i.e., > 4 weeks, unless the patient has a coronary stent(s) inserted in th... | wave W132: PASS | not signed
- STOPP C4: antiplatelet plus anticoagulant in atrial fibrillation: Antiplatelet agents in combination with vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitors in patients with chronic atr... | wave W132: PASS | not signed
- STOPP C5: antiplatelet plus anticoagulant in stable artery disease: Antiplatelet agents with vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitors in patients with stable coronary, cerebrova... | wave W132: PASS | not signed
- STOPP C6: ticlopidine: Ticlopidine in any circumstances (clopidogrel and prasugrel have similar efficacy, stronger evidence and fewer side-effects). | wave W132: PASS | not signed
- STOPP C7: antiplatelet instead of anticoagulant in atrial fibrillation: Antiplatelet agents as alternatives to vitamin K antagonists, direct thrombin inhibitors or factor Xa inhibitors for stroke prevention in pa... | wave W132: PASS | not signed
- STOPP C15: oestrogen or androgen with past VTE: Systemic oestrogens or androgens with pervious history of venous thromboembolism (increased risk of recurrent venous thromboembolism). | wave W132: PASS | not signed
- STOPP C16: aspirin for primary prevention: Aspirin for primary prevention in cardiovascular disease (no evidence of benefit). | wave W132: PASS | not signed
- STOPP C8: Vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitors for first deep venous thrombosis without continuing provoking risk f... | wave W133: PASS | not signed
- STOPP C9: Vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitors for first pulmonary embolus without continuing provoking risk factor... | wave W133-r1: PASS | not signed
- STOPP D1: TriCyclic Antidepressants (TCAs) in patients with dementia, narrow angle glaucoma, cardiac conduction abnormalities, prostatism, chronic con... | wave W133: PASS | not signed
- STOPP D10: Benzodiazepines for insomnia for ≥ 2 weeks (high risk of dependency, increased risk of falls, fractures and road traffic accidents). | wave W133: PASS | not signed
- STOPP D11: Z-drugs (zolpidem, zopiclone, zaleplon) for insomnia for ≥ 2 weeks (increased risk of falls, fractures). | wave W133: PASS | not signed
- STOPP D12: Antipsychotics (i.e., other than clozapine or quetiapine) in those with parkinsonism or Dementia with Lewy Bodies (risk of severe extra-pyra... | wave W133: PASS | not signed
- STOPP D13: Anticholinergic/antimuscarinic drugs (biperiden, orphenadrine, procyclidine, trihexyphenidyl) to treat extra-pyramidal side-effects of antip... | wave W133: PASS | not signed
- STOPP D14: Drugs with potent anticholinergics/antimuscarinic effects** in patients with delirium or dementia (risk of exacerbation of cognitive impairm... | wave W133-r1: PASS | not signed
- OPTIMISE T3-05: smoking and psychotropic dose: Tobacco smoking can alter the pharmacokinetics of psychotropic medications: For people with SMI who are taking TCA’s, mirtazapine, haloperid... | wave W119-r1: PASS | not signed
- STOPP D2: Initiation of TriCyclic Antidepressants (TCAs) as first-line treatment for major depression (higher risk of adverse drug reactions with TCAs... | wave W134: PASS | not signed
- STOPP D15: Antipsychotics in patients with behavioural and psychological symptoms of dementia (BPSD) for longer than 12 weeks unless BPSD symptoms are ... | wave W134: PASS | not signed
- STOPP D16: Antipsychotics as hypnotics, unless sleep disorder is due to psychosis or BPSD effects of dementia (not recommended in summary of product ch... | wave W134: PASS | not signed
- STOPP D17: Acetylcholinesterase inhibitors with a known history of persistent bradycardia (< 60 beats/min.), heart block or recurrent unexplained synco... | wave W134: PASS | not signed
- STOPP D19: Memantine with known current or previous seizure disorder (increased risk of seizures). | wave W134: PASS | not signed
- STOPP D20: Nootropics in dementia including Gingko Biloba, piracetam, pramiracetam, phenylpiracetam, aniracetam, phosphatidylserine, modafinil, L-thean... | wave W134: PASS | not signed
- STOPP D21: Phenothiazines as first-line treatment for psychosis or non-cognitive symptoms of dementia, since safer and more efficacious alternatives ex... | wave W134-r1: PASS | not signed
- STOPP D22: Levodopa or dopamine agonists for benign essential tremor (no evidence of efficacy) | wave W134: PASS | not signed
- STOPP D3: SNRI with severe high blood pressure: Serotonin/noradrenaline reuptake inhibitors (SNRI’s e.g., venlafaxine, duloxetine) and severe hypertension i.e., systolic blood pressure > 1... | wave W135-r1: PASS | not signed
- STOPP D4: anticholinergic antipsychotic with prostate symptoms or urine retention: Antipsychotics with moderate-marked antimuscarinic/anticholinergic effects (acepromazine, chlorpromazine, clozapine, flupenthixol, fluphenzi... | wave W135: PASS | not signed
- STOPP D5: antipsychotic for dementia symptoms with no dose change over 3 months: Antipsychotics prescribed for behavioural and psychological symptoms of dementia (BPSD) an unchanged dose for > 3 months without medication ... | wave W135: PASS | not signed
- STOPP D6: SSRI with low blood sodium: Selective serotonin re-uptake inhibitors (SSRI’s) with current or recent significant hyponatraemia i.e., serum Na+ < 130 mmol/l (risk of exa... | wave W135-r1: PASS | not signed
- STOPP D7: SSRI with recent significant bleeding: Selective serotonin re-uptake inhibitors (SSRI’s) with current or recent significant bleeding (risk of exacerbation or recurrence of bleedin... | wave W135: PASS | not signed
- STOPP D23: levodopa or dopamine agonist for drug-induced parkinsonism: Levodopa or dopamine agonists for treatment of extrapyramidal side-effects of antipsychotics or other forms of drug-induced Parkinsonism (in... | wave W135: PASS | not signed
- STOPP D24: first-generation antihistamine for allergy or itch: First-generation antihistamines as first-line treatment for allergy or pruritus (safer antihistamines with fewer side-effects now widely ava... | wave W135-r1: PASS | not signed
- STOPP D25: first-generation antihistamine for insomnia: First-generation antihistamines for insomnia (high risk of side-effects, Z-drugs safer and more appropriate for short-term use). | wave W135-r1: PASS | not signed
- STOPP D9: Benzodiazepines for agitated behaviour or psychotic symptoms of dementia (no evidence of efficacy). | wave W136: PASS | not signed
- STOPP E1: Digoxin at a long-term (i.e. more than 90 days) maintenance dose ≥ 125μg/day if eGFR < 30 ml/min/1.73m² (risk of digoxin toxicity if plasma ... | wave W136: PASS | not signed
- STOPP E2: Direct thrombin inhibitors (e.g., dabigatran) if eGFR < 30 ml/min/1.73m² (risk of bleeding) | wave W136: PASS | not signed
- STOPP E3: Factor Xa inhibitors (e.g., rivaroxaban, apixaban, edoxaban) if eGFR < 15 ml/min/1.73m² (risk of bleeding) | wave W136: PASS | not signed
- STOPP E4: NSAID’s if eGFR < 50 ml/min/1.73m² (risk of deterioration in renal function). | wave W136: PASS | not signed
- STOPP E5: Colchicine if eGFR < 10 ml/min/1.73m² (risk of colchicine toxicity) | wave W136: PASS | not signed
- STOPP E6: Metformin if eGFR < 30 ml/min/1.73m² (risk of lactic acidosis). | wave W136: PASS | not signed
- STOPP E10: Methotrexate if eGFR <30 ml/min/1.73m² (increased risk of methotrexate toxicity). | wave W136: PASS | not signed
- STOPP E7: Mineralocorticoid receptor antagonists (e.g. spironolactone, eplerenone) if eGFR < 30 ml/min/1.73m² (risk of dangerous hyperkalaemia). | wave W137: PASS | not signed
- STOPP E8: Nitrofurantoin if eGFR < 45 ml/min/1.73m² (increased risk of nitrofurantoin toxicity). | wave W137: PASS | not signed
- STOPP E9: Bisphosphonates if eGFR<30 ml/min/1.73m² (increased risk of acute renal failure). | wave W137: PASS | not signed
- STOPP F1: Prochlorperazine or metoclopramide with Parkinsonism (risk of exacerbating Parkinsonian symptoms). | wave W137: PASS | not signed
- STOPP F2: Proton pump inhibitor (PPI) for uncomplicated peptic ulcer disease at full therapeutic dosage for > 8 weeks (dose reduction or earlier disco... | wave W137: PASS | not signed
- STOPP F3: Drugs likely to cause constipation (e.g. systemic antimuscarinics, oral iron, opioids, verapamil, aluminium antacids) with chronic constipat... | wave W137: PASS | not signed
- STOPP F4: Oral elemental iron doses greater than 200 mg daily (e.g. ferrous fumarate> 600 mg/day, ferrous sulphate > 600 mg/day, ferrous gluconate> 18... | wave W137: PASS | not signed
- STOPP F5: Corticosteroids with a history of peptic ulcer disease or erosive oesophagitis (risk of relapse unless proton pump inhibitor is co-prescribe... | wave W137: PASS | not signed
- STOPP F6: Antiplatelet or anticoagulant drugs with a history of Gastric Antral Vascular Ectasia (GAVE, “watermelon stomach”) (risk of major gastrointe... | wave W138: PASS | not signed
- STOPP F7: Antipsychotics with dysphagia (increased risk of aspiration pneumonia). | wave W138: PASS | not signed
- STOPP F8: Megestrol acetate to increase appetite (increased risk of thrombosis and death with unproven efficacy) | wave W138: PASS | not signed
- STOPP G1: Theophylline as monotherapy for COPD (safer, more effective alternative; risk of adverse effects due to narrow therapeutic index). | wave W138: PASS | not signed
- STOPP G2: Systemic corticosteroids instead of inhaled corticosteroids for maintenance therapy in moderate-severe COPD (unnecessary exposure to long-te... | wave W138: PASS | not signed
- STOPP G3: Long-acting muscarinic antagonists (e.g., tiotropium, aclidinium, umeclidinium, glycopyrronium) with a history of narrow angle glaucoma (may... | wave W138: PASS | not signed
- STOPP G4: Benzodiazepines with acute or chronic respiratory failure i.e. pO2 < 8.0 kPa ± pCO2 > 6.5 kPa (risk of exacerbation of respiratory failure).... | wave W138: PASS | not signed
- STOPP H1: Non-steroidal anti-inflammatory drugs (NSAIDs) other than COX-2 selective agents with history of peptic ulcer disease or gastrointestinal bl... | wave W138: PASS | not signed
- STOPP H2: NSAID’s with severe hypertension i.e., systolic blood pressure consistently above 170 mmHg and/or diastolic blood pressure consistently abov... | wave W139: PASS | not signed
- STOPP H3: Long-term use of NSAID (>3 months) for symptom relief of osteoarthritis pain where paracetamol has not been tried (simple analgesics prefera... | wave W139: PASS | not signed
- STOPP H4: Long-term corticosteroids (>3 months) as monotherapy for rheumatoid arthritis (risk of systemic corticosteroid side-effects). | wave W139: PASS | not signed
- STOPP H5: Corticosteroids (other than periodic intra-articular injections for mono-articular pain) for osteoarthritis (risk of systemic corticosteroid... | wave W139: PASS | not signed
- STOPP H6: Long-term NSAID or colchicine (>3 months) for chronic treatment of gout where there is no contraindication to a xanthine-oxidase inhibitor (... | wave W139: PASS | not signed
- STOPP H7: NSAID with concurrent corticosteroids for treatment of arthritis/rheumatism of any kind (increased risk of peptic ulcer disease). | wave W139: PASS | not signed
- STOPP H8: Oral bisphosphonates in patients with a current or recent history of upper gastrointestinal disease i.e. dysphagia, oesophagitis, gastritis,... | wave W139: PASS | not signed
- STOPP H9: Long-term opioids for osteoarthritis (lack of evidence of efficacy, increased risk of serious side-effects). | wave W139: PASS | not signed
- STOPP I1: bladder antimuscarinic with dementia: Systemic antimuscarinic drugs (e.g., oxybutynin, tolterodine, trospium) with dementia or chronic cognitive impairment (risk of increased con... | wave W140: PASS | not signed
- STOPP I2: bladder antimuscarinic with narrow-angle glaucoma: Systemic antimuscarinic drugs (e.g., oxybutynin, tolterodine, trospium) with narrow-angle glaucoma (risk of acute exacerbation of glaucoma).... | wave W140: PASS | not signed
- STOPP I3: bladder antimuscarinic with enlarged prostate and high residual urine: Systemic antimuscarinic (e.g., oxybutynin, tolterodine, trospium) drugs for lower urinary tract symptoms with benign prostatic hyperplasia (... | wave W140: PASS | not signed
- STOPP I4: bladder antimuscarinic with constipation: Systemic antimuscarinic drugs (e.g., oxybutynin, tolterodine, trospium) with constipation (risk of exacerbation of constipation). | wave W140: PASS | not signed
- STOPP I5: alpha-1 blocker with fainting or postural low blood pressure: Alpha-1 receptor antagonists other than silodosin (e.g., alfuzosin, doxazosin, indoramin, tamsulosin, terazosin) with symptomatic orthostati... | wave W140: PASS | not signed
- STOPP I6: mirabegron with severe or labile hypertension: Mirabegron in labile or severe hypertension (risk of exacerbation of hypertension). | wave W140-r1: PASS | not signed
- STOPP I7: duloxetine with urinary urgency or urge incontinence: Duloxetine with urinary urgency or urge incontinence (duloxetine is indicated in stress incontinence but not in urinary urgency or urge inco... | wave W140: PASS | not signed
- STOPP I8: antibiotic for asymptomatic bacteriuria: Antibiotic use in asymptomatic bacteriuria (no indication for treatment). | wave W140: PASS | not signed
- STOPP J1: Sulphonylureas with a long half-life (e.g., glibenclamide, chlorpropamide, glimepiride) with type 2 diabetes mellitus (risk of prolonged hyp... | wave W141: PASS | not signed
- STOPP J2: Thiazolidenediones (e.g., rosiglitazone, pioglitazone) with heart failure (risk of exacerbation of heart failure). | wave W141: PASS | not signed
- STOPP J3: Non-selective beta-blockers in diabetes mellitus with frequent hypoglycaemic episodes (risk of suppressing hypoglycaemic symptoms). | wave W141-r1: PASS | not signed
- STOPP J4: Sodium glucose co-transporter (SGLT2) inhibitors (e.g., canagliflozin, dapagliflozin, empagliflozin, ertugliflozin) with symptomatic hypoten... | wave W141: PASS | not signed
- STOPP J5: Systemic oestrogens with a history of breast cancer (increased risk of recurrence). | wave W141: PASS | not signed
- STOPP J7: Menopausal hormone therapy (oestrogen plus progestin) with a history of stenotic coronary, cerebral or peripheral arterial disease (increase... | wave W141: PASS | not signed
- STOPP J8: Systemic oestrogens without progestogens in patients with intact uterus (risk of endometrial cancer). | wave W141-r1: PASS | not signed
- STOPP J10: Vasopressin analogues (e.g., desmopressin, vasopressin) for urinary incontinence or urinary frequency (risk of symptomatic hyponatraemia). | wave W141: PASS | not signed
- STOPP J9: Levothyroxine in subclinical hypothyroidism i.e., normal free T4, elevated TSH but < 10 mU/L (no evidence of benefit, risk of iatrogenic thy... | wave W142-r1: PASS | not signed
- STOPP K1: Benzodiazepines in patients with recurrent falls (may cause reduced sensorium, impair balance). | wave W142: PASS | not signed
- STOPP K2: Antipsychotic drugs in patients with recurrent falls (may cause Parkinsonism). | wave W142: PASS | not signed
- STOPP K3: Vasodilator drugs in patients with recurrent falls with persistent postural hypotension i.e., systolic BP drop ≥ 20 mmHg and/or diastolic BP... | wave W142-r1: PASS | not signed
- STOPP K4: Hypnotic Z-drugs i.e., zopiclone, zolpidem, zaleplon in patients with recurrent falls (may cause protracted daytime sedation, ataxia). | wave W142: PASS | not signed
- STOPP K5: Anti-epileptic drugs in patients with recurrent falls (may impair sensorium, may adversely affect cerebellar function). | wave W142: PASS | not signed
- STOPP K10: Alpha blockers for prostatic bladder outflow symptoms, other than silodosin in patients with recurrent falls (may cause orthostatic hypotens... | wave W142: PASS | not signed
- STOPP K12: Antimuscarinics for treatment of overactive bladder or urge incontinence (may impair sensorium). | wave W142: PASS | not signed
- STOPP K6: first generation antihistamine with recurrent falls: First generation antihistamines in patients with recurrent falls (may impair sensorium). | wave W143: PASS | not signed
- STOPP K7: opioid with recurrent falls: Opioids in patients with recurrent falls (may impair sensorium). | wave W143: PASS | not signed
- STOPP K8: antidepressant with recurrent falls: Antidepressants in patients with recurrent falls (may impair sensorium). | wave W143: PASS | not signed
- STOPP K9: alpha blocker for blood pressure with recurrent falls: Alpha blockers as antihypertensives in patients with recurrent falls (may cause orthostatic hypotension). | wave W143: PASS | not signed
- STOPP L1: strong opioid as first line for mild pain: Use of oral or transdermal strong opioids (morphine, oxycodone, fentanyl, buprenorphine, diamorphine, methadone, tramadol, pethidine, pentaz... | wave W143: PASS | not signed
- STOPP L3: long-acting opioid without a short-acting opioid: Long-acting opioids without short-acting opioids for break-through moderate or severe pain (risk of persistence of severe pain). | wave W143: PASS | not signed
- STOPP L4: lignocaine patch for osteoarthritis pain: Topical lidocaine (lignocaine) patch for treatment of chronic osteoarthritis pain (lack of evidence of efficacy). | wave W143: PASS | not signed
- STOPP L5: gabapentinoid for non-neuropathic pain: Gabapentinoids (e.g., gabapentin, pregabalin) for non-neuropathic pain (lack of evidence of efficacy). | wave W143: PASS | not signed
- BANSAL S07: opioid with carbamazepine, phenytoin or phenobarbital: Co-prescription of opioid analgesics with carbamazepine, phenytoin, or phenobarbital to a patient with epilepsy [67–71] | wave W120-r1: PASS | not signed
- START B1: Antihypertensive therapy where systolic blood pressure > 140 mmHg and /or diastolic blood pressure > 90 mmHg, unless established moderate or... | wave W144: PASS | not signed
- START B2: Statin therapy with a documented history of coronary, cerebral or peripheral vascular disease, unless the patient’s status is end-of-life or... | wave W144: PASS | not signed
- START B3: Angiotensin Converting Enzyme (ACE) inhibitor with coronary artery disease. | wave W144: PASS | not signed
- START B4: Beta-blocker with symptomatic coronary artery disease. | wave W144: PASS | not signed
- START B5: Angiotensin Converting Enzyme (ACE) inhibitor for heart failure with reduced ejection fraction. | wave W144: PASS | not signed
- START B10: Beta-blocker for chronic atrial fibrillation with uncontrolled heart rate. | wave W144: PASS | not signed
- START B11: Intravenous iron for symptomatic heart failure with reduced ejection fraction and iron deficiency. | wave W144: PASS | not signed
- STOPP L6: Paracetamol at doses ≥ 3 g/24 hours in patients with poor nutritional status i.e., BMI < 18 or chronic liver disease (risk of hepatotoxicity... | wave W144: PASS | not signed
- START B6: Cardio-selective beta-blocker (bisoprolol, nebivolol, metoprolol or carvedilol) for stable heart failure with reduced ejection fraction. | wave W145: PASS | not signed
- START B7: Mineralocorticoid receptor antagonist (spironolactone, eplerenone) in heart failure without severe renal function impairment i.e., eGFR > 30... | wave W145: PASS | not signed
- START B8: SGLT-2 inhibitors (canagliflozin, dapagliflozin, empagliflozin, ertugliflozin) in symptomatic heart failure with or without reduced ejection... | wave W145: PASS | not signed
- START B9: Sacubitril/valsartan in heart failure with reduced ejection fraction causing persistent heart failure symptoms despite optimal dose of ACE i... | wave W145: PASS | not signed
- START C1: Vitamin K antagonists or direct thrombin inhibitors or factor Xa inhibitors in the presence of chronic or paroxysmal atrial fibrillation. | wave W145: PASS | not signed
- START C2: Antiplatelet therapy (aspirin or clopidogrel or prasugrel or ticagrelor) with a documented history of coronary, cerebral or peripheral vascu... | wave W145: PASS | not signed
- START D1: L-DOPA or a dopamine agonist in idiopathic Parkinson’s disease with functional impairment and resultant disability. | wave W145: PASS | not signed
- START D2: Non-TCA antidepressant for major depression. | wave W145: PASS | not signed
- START D3: Acetylcholinesterase inhibitor (donepezil, rivastigmine, galantamine) for mild-moderate Alzheimer’s dementia. | wave W146: PASS | not signed
- START D4: Rivastigmine for Dementia with Lewy Bodies or Parkinson’s disease dementia. | wave W146: PASS | not signed
- START D5: Selective serotonin reuptake inhibitor (or SNRI or pregabalin if SSRI contraindicated) for persistent severe anxiety that affects independen... | wave W146: PASS | not signed
- START D6: Dopamine agonist (ropinirole or pramipexole or rotigotine) for Restless Legs Syndrome, once iron deficiency and severe chronic kidney diseas... | wave W146: PASS | not signed
- START D7: Propranolol for essential tremor with functional impairment and resultant disability. | wave W146: PASS | not signed
- START E1: One-alpha hydroxycholecalciferol or calcitriol supplementation in severe chronic kidney (i.e., eGFR < 30 ml/min/m²) disease with hypocalcaem... | wave W146: PASS | not signed
- START E2: Phosphate binder in severe chronic kidney disease (i.e., eGFR < 30 ml/min/m²) if serum phosphate concentration persistently >1.76 mmol/l (5.... | wave W146: PASS | not signed
- START E3: Erythopoietin analogue in severe chronic kidney disease (i.e., eGFR < 30 ml/min/m²) with symptomatic anaemia not attributable to haematinic ... | wave W146: PASS | not signed
- START E4: Angiotensin receptor blocker (ARB) or Angiotensin Converting Enzyme Inhibitor (ACE-I) in chronic kidney disease with proteinuria i.e., urine... | wave W147: PASS | not signed
- START F1: Proton Pump Inhibitor with severe gastro-oesophageal reflux disease or peptic oesophageal stricture requiring dilatation. | wave W147: PASS | not signed
- START F2: Proton pump inhibitor with initiation of low-dose aspirin and previous history of peptic ulcer or reflux oesophagitis. | wave W147: PASS | not signed
- START F3: Proton pump inhibitor with short-term (< 2 weeks) or longer-term (> 2 weeks) NSAID. | wave W147: PASS | not signed
- START F4: Fibre supplements (e.g., bran, ispaghula, methylcellulose, sterculia) for diverticulosis with a history of constipation. | wave W147: PASS | not signed
- START F5: Osmotic laxative (e.g., lactulose, macrogol, sorbitol) for chronic persistent idiopathic or secondary benign constipation. | wave W147: PASS | not signed
- START F6: Probiotics used with antibiotics in patients who are not immunocompromised or severely debilitated for the prevention of Clostridioides diff... | wave W147: PASS | not signed
- START F7: Helicobacter pylori eradication therapy in HP -associated active peptic ulcer disease. | wave W147: PASS | not signed
- Brisnik HR-D3: Prescribed anticholinergic antidepressant opipramol, other TCAs (in doses ≥ 50 mg/day), or paroxetine - and the patient is aged ≥ 65 years a... | wave W124-r1: PASS | not signed
- START G1: long-acting bronchodilator in COPD or asthma: Long-acting muscarinic antagonist (LAMA e.g., tiotropium, aclidinium, umeclidinium, glycopyrronium) or long-acting beta 2 agonist (LABA e.g.... | wave W148: PASS | not signed
- START G2: inhaled corticosteroid in severe asthma or COPD: Regular i.e. daily inhaled corticosteroid (e.g., beclomethasone, budesonide, ciclesonide, fluticasone, mometasone) for moderate-severe asthm... | wave W148: PASS | not signed
- START G3: home oxygen for chronic low blood oxygen: Home continuous oxygen with documented chronic hypoxaemia (i.e., pO2 < 8.0 kPa or 60 mmHg or SaO2 < 89%). | wave W148: PASS | not signed
- START H1: DMARD in rheumatoid arthritis: Disease-modifying anti-rheumatic drug (DMARD) with chronic, active and disabling rheumatoid arthritis. | wave W148: PASS | not signed
- START H2: bone protection with long-term steroid tablets: Bisphosphonates and vitamin D and calcium in patients taking long-term systemic corticosteroid therapy for prevention of steroid-induced ost... | wave W148: PASS | not signed
- START H3: vitamin D in osteoporosis or after a fragility fracture: Vitamin D in patients with known osteoporosis and/or previous fragility fracture(s) and/or Bone Mineral Density T-scores below -2.5 in one o... | wave W148: PASS | not signed
- START H4: bone-strengthening medicine in osteoporosis: Bone anti-resorptive or anabolic therapy (e.g., bisphosphonate, teriparatide, denosumab) in patients with documented osteoporosis (Bone Mine... | wave W148: PASS | not signed
- START H5: vitamin D supplement with low vitamin D level: Vitamin D supplement in older people with confirmed 25-hydroxycolecalciferol deficiency (< 20 micrograms/L, < 50 nmol/L) who are housebound ... | wave W148: PASS | not signed
- START H6: Anti-resorptive treatment after discontinuation of at least two doses of denosumab (rebound increased bone turnover markers, BMD loss, and i... | wave W149: PASS | not signed
- START H8: Xanthine-oxidase inhibitors (e.g. allopurinol, febuxostat) with a history of recurrent episodes of gout. | wave W149: PASS | not signed
- START H9: Folic acid supplement in patients taking methotrexate. | wave W149: PASS | not signed
- START I1: Selective alpha-1 receptor blocker (e.g., tamsulosin, silodosin) for lower urinary tract symptoms related to benign prostatic hyperplasia wh... | wave W149: PASS | not signed
- START I2: 5-alpha reductase inhibitor (e.g., finasteride, dutasteride) for lower urinary tract symptoms related to benign prostatic hyperplasia where ... | wave W149: PASS | not signed
- START I3: Topical vaginal oestrogen or vaginal oestrogen pessary for symptomatic atrophic vaginitis. | wave W149: PASS | not signed
- START I4: Topical vaginal oestrogen or vaginal oestrogen pessary in women for recurrent urinary tract infections. | wave W149: PASS | not signed
- START I5: Phosphodiesterase type-5 inhibitors (e.g., avanafil, sildenafil, tadalafil, vardenafil) for persistent erectile dysfunction that causes dist... | wave W150: PASS | not signed
- START J1: ACE inhibitor or Angiotensin Receptor Blocker (if intolerant of ACE inhibitor) in diabetes with evidence of renal disease i.e., dipstick pro... | wave W150: PASS | not signed
- START K1: High-potency opioids in moderate-severe non-arthritis pain, where paracetamol, NSAIDs or low-potency opioids are not appropriate to the pain... | wave W150: PASS | not signed
- START K2: Laxatives in patients receiving opioids regularly i.e., other than PRN use. | wave W150: PASS | not signed
- START K3: Topical 5% lidocaine (lignocaine) patch for localized neuropathic pain, e.g. post-herpetic neuralgia. | wave W150: PASS | not signed
- START L2: Pneumococcal vaccine at least once according to national guidelines. | wave W150: PASS | not signed
- START L3: Varicella-zoster vaccine according to national guidelines. | wave W150: PASS | not signed
- START L4: SARS-CoV2 vaccine according to national guidelines. | wave W151: PASS | not signed
- Dreischulte 16: Patient aged ≥65 treated with an ACEI or ARB but no diuretic - is co-prescribed an oral NSAID | wave W161: PASS | not signed
- Dreischulte 17: Patient aged ≥75 treated with a diuretic but no ACEI or ARB - is co-prescribed an oral NSAID | wave W161: PASS | not signed
- Dreischulte 18: Patient treated with an ACEI or ARB AND a diuretic - is co-prescribed an oral NSAID | wave W161: PASS | not signed
- Dreischulte 19: Patient aged ≤65 treated with an ACEI or ARB but no diuretic - is co-prescribed an oral NSAID | wave W161: PASS | not signed
- Dreischulte 20: Patient aged 65 to 74 treated with a diuretic but no ACEI or ARB - is co-prescribed an oral NSAID | wave W161: PASS | not signed
- Dreischulte 35: Patient treated with warfarin - is co-presribed a macrolide | wave W162: PASS | not signed
- Dreischulte 36: Patient treated with warfarin - is co-prescribed a sulfonamide | wave W162: PASS | not signed
- Dreischulte 37: Patient treated with warfarin - is co-prescribed an azole antifungal | wave W162: PASS | not signed
- Dreischulte 38: Patient treated with warfarin - is co-prescribed metronidazole | wave W162: PASS | not signed
- Dreischulte 40: Patient treated with warfarin- is co-prescribed isoniazid | wave W162: PASS | not signed
- Dreischulte 44: Patient treated with warfarin - is co-prescribed tetracyclines | wave W162: PASS | not signed
- Dreischulte 41: warfarin with rifampicin: Patient treated with warfarin - is co-prescribed rifampin | wave W163: PASS | not signed
- Dreischulte 42: warfarin with griseofulvin: Patient treated with warfarin - is co-prescribed griseofulvin | wave W163: PASS | not signed
- Dreischulte 43: warfarin with ribavirin: Patient treated with warfarin - is co-prescribed ribavirin | wave W163: PASS | not signed
- Dreischulte 69: Two methotrexate tablet strengths in the same regimen: Patient treated with methotrexate - is prescribed > 1 strength of methotrexate tablets | wave W164: PASS | not signed
- Dreischulte 70: Full blood count more than 8 weeks ago during auranofin treatment: Patient treated with auranofin - had no FBC check in the last 8 weeks | wave W164: PASS | not signed
- Dreischulte 72: Full blood count more than 8 weeks ago during penicillamine treatment: Patient treated with penicillamine - had no FBC check in the last 8 weeks | wave W164: PASS | not signed
- Dreischulte 73: Full blood count more than 12 weeks ago during leflunomide treatment: Patient treated with leflunomide - had no FBC check in the last 12 weeks | wave W164: PASS | not signed
- Dreischulte 74: Full blood count more than 12 weeks ago during methotrexate treatment: Patient treated with methotrexate - had no FBC check in the last 12 weeks | wave W164: PASS | not signed
- Dreischulte 75: Full blood count more than 12 weeks ago during azathioprine treatment: Patient treated with azathioprine - had no FBC check in the last 12 weeks | wave W164: PASS | not signed
- Dreischulte 76: Full blood count more than 24 weeks ago during cyclophosphamide treatment: Patient treated with cyclophosphamide - had no FBC check in the last 24 weeks | wave W164: PASS | not signed
- Dreischulte 77: Full blood count more than 24 weeks ago during sulfasalazine treatment: Patient treated with sulfasalazine - had no FBC check in the last 24 weeks | wave W164: PASS | not signed
- SCOTRESP: a short-acting reliever is the only respiratory medicine in asthma: Patients who are only prescribed a SABA | wave W166: PASS | not signed
- SCOTRESP: a long-acting beta agonist without an inhaled corticosteroid in asthma: Patients prescribed long acting beta-agonist (LABA) without inhaled corticosteroid (ICS) | wave W166: PASS | not signed
- SCOTRESP: prescribed oral mucolytic treatment beyond six months: Patients prescribed mucolytics >6 months | wave W166: PASS | not signed
- POPI: two NSAIDs for pain or fever: The combined use of two NSAIDs | wave W171: PASS | not signed
- POPI: morphine and osmotic laxative cover: Failure to give an osmotic laxative to patients being treated with morphine for a period of more than 48 hours | wave W171: PASS | not signed
- POPI: an injection vial directed by mouth or tube: Oral administration of an intravenous proton pump inhibitor (notably by nasogastric tube) | wave W171: PASS | not signed
- POPI: loperamide under three: Loperamide before 3 years of age | wave W171: PASS | not signed
- POPI: loperamide during invasive diarrhoea: Loperamide in the case of invasive diarrhea | wave W171: PASS | not signed
- POPI: probiotic yeast with a central line or immunodeficiency: The use of Saccharomyces boulardii in powder form, or in a capsule that has to be opened prior to ingestion, to treat patients with a centra... | wave W171: PASS | not signed
- POPI: a cough medicine that thins mucus before age two: Mucolytic drugs, mucokinetic drugs, or helicidine before two years of age | wave W172: PASS | not signed
- POPI: ear drops during acute otitis media: Ear drops in the case of acute otitis media | wave W172: PASS | not signed
- POPI: no inhaled corticosteroid supply for persistent asthma: Preventative treatment (inhaled corticosteroids) in the case of persistent asthma | wave W172: PASS | not signed
- POPI: oral isotretinoin and a tetracycline antibiotic used together: Isotretinoin in combination with a member of the tetracycline family of antibiotics | wave W172: PASS | not signed
- POPI: second oral ivermectin dose for scabies at two weeks: A second dose of ivermectin two weeks after the first | wave W172: PASS | not signed
- POPI: no oral aciclovir supply during primary herpetic gingivostomatitis: Orally administered acyclovir to treat primary herpetic gingivostomatitis | wave W172: PASS | not signed
- POPI: tacrolimus 0.1% ointment for atopic eczema before age 16: Topically applied 0.1% tacrolimus before 16 years of age | wave W172: PASS | not signed
- POPI: a listed antiseizure medicine in a child with myoclonic epilepsy: Carbamazepine, gabapentin, oxcarbazepine, phenytoin, pregabalin, tiagabine, or vigabatrin in the case of myoclonic epilepsy | wave W173: PASS | not signed
- POPI: a listed antiseizure medicine in a child with epilepsy with absence seizures: Carbamazepine, gabapentin, oxcarbazepine, phenytoin, pregabaline, tiagabine, or vigabatrin in the case of epilepsy with absence seizures (es... | wave W173: PASS | not signed
- POPI: desmopressin nasal spray for bedwetting: Desmopressin administered by a nasal spray. | wave W173: PASS | not signed
- POPI: desmopressin for bedwetting with daytime urinary symptoms: Desmopressin in the case of daytime symptoms | wave W173: PASS | not signed
- POPI: a bladder anticholinergic alone for bedwetting without daytime symptoms: An anticholinergic agent used as a monotherapy in the absence of daytime symptoms | wave W173: PASS | not signed
- POPI: a tricyclic with a separate bladder anticholinergic for bedwetting: Tricyclic agents in combination with anticholinergic agents | wave W173: PASS | not signed
- VTE: apixaban starting dose after day 7: 10 mg BID for 7 days, then 5 mg BID | wave W176: PASS | not signed
- VTE: rivaroxaban starting dose after day 21: 15 mg BID with food × 3 weeks then 20 mg once daily with food | wave W176: PASS | not signed
- Poisons Standard: pregnancy beginning within 36 calendar months after acitretin: if the poison is acitretin or etretinate—advised the patient to avoid becoming pregnant during or for a period of 36 months after completion... | wave W181: PASS | not signed
- Poisons Standard: pregnancy beginning within one calendar month after oral isotretinoin: if the poison is bexarotene, isotretinoin or thalidomide—advised the patient to avoid becoming pregnant during or for a period of 1 month af... | wave W181: PASS | not signed
- Gerard: starting a sulfonylurea after age 75: It is necessary not to initiate treatment with a hypoglycaemic drug (repaglinide or sulfonylurea) in a patient over 75 years old. | wave W186: PASS | not signed
- Gerard: starting a sulfonylurea with HbA1c below 7%: It is necessary not to initiate treatment with a hypoglycaemic drug (repaglinide or sulfonylurea) in a patient with an HbA1c level below 7%.... | wave W186: PASS | not signed
- Gerard: sulfonylurea combination treatment with HbA1c below 7%: It is necessary to review and optimize the strategy for two- or three-drug combination treatments that include a hypoglycaemic drug (repagli... | wave W186: PASS | not signed
- Gerard: reported symptomatic hypoglycaemia during sulfonylurea treatment: It is necessary to review and optimize the prescription of a hypoglycaemic drug (repaglinide or sulfonylurea) in a patient reporting symptom... | wave W186: PASS | not signed
- Gerard: sulfonylurea treatment with BMI above 30: It is necessary to review and optimize the prescription of a hypoglycaemic drug (repaglinide or sulfonylurea) in a patient with a BMI>30kg/m... | wave W186: PASS | not signed
- Gerard: SGLT2 inhibitor during a bacterial skin infection of the pelvis or genitals: It is necessary to assess the need to temporarily discontinue an SGLT-2 inhibitor in a patient with a bacterial skin infection localized in ... | wave W187: PASS | not signed
- Gerard: Concurrent GLP-1 analogue and DPP-4 inhibitor: It is necessary to review and optimize the prescription of a GLP-1 analogue+DPP-4 inhibitor combination. | wave W187: PASS | not signed
- Gerard: SGLT2 inhibitor or GLP-1 analogue with BMI below 18 kg/m²: It is necessary to review and optimize the prescription of a weight-loss promoting drug (SGLT-2 inhibitor or GLP-1 analogue) in a patient wi... | wave W187: PASS | not signed
- Gerard: GLP-1 analogue with a history of gallstones: It is necessary to review and optimize the prescription of a GLP-1 analogue in a patient with a history of gallstones. | wave W187: PASS | not signed
- Gerard: GLP-1 analogue with confirmed malnutrition: It is necessary to review and optimize the prescription of a GLP-1 analogue in a patient with a confirmed diagnosis of malnutrition. | wave W187: PASS | not signed
- Gerard: SGLT2 inhibitor with pancreatic insufficiency: It is necessary to review and optimize the prescription of an antidiabetic drug (other than insulin) from the SGLT-2 inhibitor class in a pa... | wave W187: PASS | not signed
- Gerard 23: It is necessary to review and optimize the prescription of metformin, a GLP-1 analogue, or a DPP-4 inhibitor in a patient with a creatinine ... | wave W188-r1: PASS | not signed
- USMEC: combined pill with persistently high blood pressure: ii. Systolic ≥160 mm Hg or diastolic ≥100 mm Hg | wave W191: PASS | not signed
- USMEC: combined pill with a history of migraine with aura: ii. With aura | wave W191: PASS | not signed
- USMEC: combined pill in the first 21 days after birth: a. <21 days postpartum | wave W191: PASS | not signed
- CareTrack Kids BRON25: Infants (aged < 12 months) with mild to moderate bronchiolitis caused by a viral infection were not prescribed antibiotics. | wave W196: PASS | not signed
- CareTrack Kids CROU16: Children diagnosed with croup were not treated with antibiotics. | wave W196: PASS | not signed
- CareTrack Kids ECZE07: Children with atopic eczema and no signs of infection were not prescribed antibiotics. | wave W196: PASS | not signed
- Khawagi G141: ADHD medications | SR Methylphenidate | two doses per day, rather than one dose |  | Children | [103] | wave W219: PASS | not signed
- Khawagi G002: antipsychotic supplied before the sixth birthday: Antipsychotics | Antipsychotics | 0–5 | [69] | wave W223: PASS | not signed
- Khawagi G003: antidepressant supplied before the sixth birthday: Antidepressants | Antidepressants | 0–5 | [69] | wave W223: PASS | not signed
- Khawagi G016: antipsychotic with syncope or postural hypotension at age 65 or over: Antipsychotics | Syncope | Antipsychotics | ≥ 65 | [84] | wave W223: PASS | not signed
- Khawagi G028: amitriptyline above 75 mg a day with a heart rhythm or conduction disorder: Antidepressants | Arrhythmia | Amitriptyline at dose >75mg | - | [10] | wave W223: PASS | not signed
- Khawagi G031: tricyclic antidepressant with syncope at age 65 or over: Antidepressants | Syncope | TCA | ≥ 65 | [47, 116] | wave W223: PASS | not signed
- Khawagi G064: atomoxetine with diagnosed hypertension: ADHD medications | HTN | Atomoxetine | - | [71] | wave W223: PASS | not signed
- Khawagi: seizures or epilepsy with selected medicines: Antidepressants | Seizures or epilepsy | SSRI | - | [15, 71]
Antidepressants | Seizures or epilepsy | TCA | - | [71] | wave W224: PASS | not signed
- Khawagi: tricyclic antidepressant during acute bipolar depression in an adult: Antidepressants | Acute bipolar depression | TCA | Adults | [49] | wave W224: PASS | not signed
- Khawagi: benzodiazepine supplied at age 65 or over with recent delirium: Sedative, hypnotics and anxiolytics | Delirium | Benzodiazepines | ≥ 65 | [34, 84] | wave W224: PASS | not signed
- Khawagi: sedating antihistamine supplied at age 65 or over with an enlarged prostate: Sedative, hypnotics and anxiolytics | BPH | Antihistamine | ≥ 65 | [116] | wave W224: PASS | not signed
- Khawagi: benzodiazepine or tricyclic antidepressant supplied with liver impairment: Sedative, hypnotics and anxiolytics | Hepatic impairment or cirrhosis | Benzodiazepines | - | [71] | wave W224: PASS | not signed
- Khawagi: selegiline supplied with an SSRI or tricyclic antidepressant: Antidepressants | TCA | Selegiline | - | [102]
Antidepressants | SSRI | Selegiline | - | [111] | wave W224: PASS | not signed
- Khawagi: tramadol supplied with one SSRI: Antidepressants | SSRI | Tramadol | - | [15]
Antidepressants | MAO | Tramadol | - | [15] | wave W224: PASS | not signed
- CKD C03A: In an outpatient aged 18 or over with established CKD, review a supply containing hydrochlorothiazide when eGFR is below 30 mL/min/1.73 m². | wave W227-r1: PASS | not signed
- CKD C07A: In an outpatient aged 18 or over with established CKD, compare the directed daily dose with the limit for that medicine and eGFR in mL/min/1... | wave W227-r1: PASS | not signed
- CKD C09D: In an outpatient aged 18 or over with established CKD, review concurrent supplies of an ACE inhibitor and an ARB, whatever their indication ... | wave W227-r1: PASS | not signed
- CKD C10A: In an outpatient aged 18 or over with established CKD, review rosuvastatin above 10 mg daily if the patient is off dialysis and indexed crea... | wave W227-r1: PASS | not signed
- CKD C10B: In an outpatient aged 18 or over with established CKD, use caution if a fixed-dose ezetimibe and simvastatin tablet supplies more than 20 mg... | wave W227-r1: PASS | not signed
- CKD N03A: Pregabalin: compare daily dose with a maximum of 300 mg at CrCl 30 to below 60, 150 mg at 15 to below 30, or 75 mg below 15. Levetiracetam: ... | wave W228: PASS | not signed
- CKD N04B: For Parkinson disease, the daily immediate-release pramipexole dose exceeds 2.25 mg at CrCl 20 through 50 mL/min, or 1.5 mg below 20. | wave W228: PASS | not signed
- CKD N05A: Oral paliperidone exceeds 6 mg/day at CrCl 50 to below 80, exceeds 3 mg/day at 10 to below 50, or is supplied at all below 10 mL/min. A pali... | wave W228: PASS | not signed
- CKD N06A: Any duloxetine supply with CrCl below 30 mL/min prompts review. | wave W228: PASS | not signed
- CKD N06D: Memantine exceeds 10 mg/day with CrCl of 5 through 29 mL/min. | wave W228: PASS | not signed
- CKD N07B: Varenicline exceeds 1 mg/day with CrCl below 30 mL/min. | wave W228: PASS | not signed
- START L1: Seasonal influenza vaccine annually. | wave W150-r1: PASS | not signed
- CDC: long-acting opioid at the start of pain treatment: When starting opioid therapy for acute, subacute, or chronic pain, clinicians should prescribe immediate-release opioids instead of extended... | wave W201: PASS | not signed
- UKKA 1(a) without diabetes: eGFR of ≥ 20 mL/min/1.73m² and a urinary albumin-to-creatinine ratio (uACR) of ≥ 25 mg/mmol† | wave W206: PASS | not signed
- UKKA 1(b) with type 2 diabetes: eGFR of > 45 mL/min/1.73m² and a urinary albumin-to-creatinine ratio (uACR) of ≥ 25 mg/mmol† | wave W206: PASS | not signed
- CKD: rivaroxaban 20 mg once daily for stroke prevention in non-valvular atrial fibrillation with low creatinine clearance: Review oral rivaroxaban 20 mg once daily for stroke prevention in an adult outpatient with chronic kidney disease and non-valvular atrial fi... | wave W211: PASS | not signed
- CKD: digoxin above 125 micrograms daily in documented stage 3b, 4 or 5 chronic kidney disease: Review an adult outpatient's oral digoxin if a supply in the three months before audit exceeds 125 micrograms per day and stage 3b, 4 or 5 c... | wave W211: PASS | not signed
- Khawagi G005: antidepressant other than fluoxetine at age 18 or younger: (N) Patient aged ≤18 - is prescribed an antidepressant other than fluoxetine | wave W215: PASS | not signed
- Khawagi G007: ADHD medicine before age six and the severe ADHD exception: Pharmacological treatment before age six (before school), except in severe cases | wave W215: PASS | not signed
- Khawagi G010: antipsychotic in dementia at age 65 or older without a history of psychosis: (N) Patient aged ≥65 with dementia but no psychosis - is prescribed an antipsychotic | wave W215: PASS | not signed
- Khawagi G027: tricyclic antidepressant in chronic heart failure at a low or unknown daily dose: (N) Patient with chronic heart failure - is prescribed a tricyclic antidepressant | wave W215: PASS | not signed
- CKD: daily dose of an H2 blocker at creatinine clearance below 50: In an adult with chronic kidney disease and creatinine clearance below 50 mL/min, review famotidine above 20 mg a day, nizatidine above 150 ... | wave W229: PASS | not signed
- CKD: teriparatide at creatinine clearance below 30: Review teriparatide supplied to an adult with chronic kidney disease when their recorded creatinine clearance is below 30 mL/min. | wave W229: PASS | not signed
- CKD: methenamine for urinary infection prevention at creatinine clearance below 30: Review methenamine hippurate used to prevent urinary tract infections in an adult with CKD if the recorded creatinine clearance is below 30 ... | wave W229: PASS | not signed
- Khawagi: a non-selective MAOI with a listed stimulant or decongestant: Antidepressants | MAO | Amphetamine and derivatives | - | [102] | wave W231: PASS | not signed
- Khawagi: fluvoxamine with theophylline: Antidepressants | Fluvoxamine | Theophylline | - | [89] | wave W231: PASS | not signed
- Khawagi: a listed sedative with a strong CYP3A inhibitor at age 65 or over: Sedative, hypnotics and anxiolytics | Alprazolam | Strong CYP3A4 inhibitor | ≥ 65 | [48]
Sedative, hypnotics and anxiolytics | Midazolam | S... | wave W231: PASS | not signed
- Khawagi: carbamazepine with a pill or vaginal ring used for contraception: Mood stabilisers | Carbamazepine | oral or intravaginal contraceptives, patches or pure progestogen pills | - | [71] | wave W231: PASS | not signed
- Khawagi: carbamazepine with warfarin: Mood stabilisers | Carbamazepine | Warfarin | - | [111] | wave W231: PASS | not signed
- Khawagi: carbamazepine with rivaroxaban: Mood stabilisers | Carbamazepine | Rivaroxaban | - | [71] | wave W231: PASS | not signed
- Khawagi: lamotrigine with a combined hormonal contraceptive: Mood stabilisers | Lamotrigine | Hormonal contraceptive or combination pills | - | [71] | wave W231: PASS | not signed
- Khawagi: a cholinesterase inhibitor with an anticholinergic at age 65 or over: Anti-dementia | Anticholinesterase drugs | Anticholinergic | ≥ 65 | [77] | wave W231: PASS | not signed
- Khawagi G135: Four psychotropic medicines together for over three months at ages 6 to 17: Non-Specific Psychotropics | Four or more Psychotropics | - | >3 months | 6–17 | [69] | wave W232: PASS | not signed
- Khawagi G149: Annual blood glucose check during antipsychotic treatment: Antipsychotics | Antipsychotics | Glucose | - | Annually | [39] | wave W232: PASS | not signed
- Khawagi G151: Annual weight check during antipsychotic treatment: Antipsychotics | Antipsychotics | Weight | - | Annually | [39] | wave W232: PASS | not signed
- Khawagi G155: Annual liver function tests during carbamazepine or valproate treatment: Mood stabilisers | Carbamazepine | LFT | - | Annually | [81]
Mood stabilisers | Valproate | LFT | - | Annually | [81] | wave W232: PASS | not signed
- Khawagi G156: Annual full blood count during carbamazepine or valproate treatment: Mood stabilisers | Carbamazepine | FBC | - | Annually | [81, 105]
Mood stabilisers | Valproate | FBC | - | Annually | [81, 113] | wave W232: PASS | not signed
- Khawagi G157: Six-month carbamazepine level in the published indicator: Mood stabilisers | Carbamazepine | Carbamazepine level | - | Every 6 months | [50] | wave W232: PASS | not signed
- Khawagi G170: Antidepressant monotherapy in an adult with acute bipolar depression: Antidepressants | Patient diagnosed with acute bipolar depression is prescribed antidepressant monotherapy | Adult | [49] | wave W232: PASS | not signed
- Khawagi G122: Mood stabilisers | Lithium | Diuretics | - | [49] | wave W233: PASS | not signed
- Khawagi G161: Mood stabilisers | Lithium | TFT | - | every 6 months | [49] | wave W233: PASS | not signed
- Khawagi G162: Mood stabilisers | Lithium | Creatinine | - | annually | [81, 105] | wave W233: PASS | not signed
- Khawagi G172: Mood stabilisers | Lithium dose not adjusted or omitted in a patient with a lithium concentration above the therapeutic range (>1. - mmol l-... | wave W233: PASS | not signed
- Khawagi G173: Mood stabilisers | Lithium prescribed in conjunction with newly prescribed nonsteroidal anti-inflammatory drugs without dose adjustment or i... | wave W233: PASS | not signed
- Khawagi: benzodiazepine supply at age 65 or over with sleep apnoea: Sedative, hypnotics and anxiolytics | Sleep apnoea syndrome | Benzodiazepines | ≥ 65 | [66, 116] | wave W235: PASS | not signed
- Khawagi: lithium and an NSAID supplied together at age 65 or over: Mood stabilisers | Lithium | NSAID | ≥ 65 | [48] | wave W235: PASS | not signed
- Khawagi: clonidine and propranolol supplied together: ADHD medications | Clonidine | Propranolol | - | [111] | wave W235: PASS | not signed
- CKD: metformin or a gliptin above its kidney function dose limit: For metformin, review any dose at Cockcroft-Gault creatinine clearance below 30 mL/min and doses above 1,000 mg/day at 30 to below 60 mL/min... | wave W229-r1: PASS | not signed
- CKD: recent systemic NSAID supply after a recorded CKD stage of 3b, 4 or 5: At audit, review a systemic NSAID supplied in the preceding three months to an adult whose CKD stage of 3b, 4 or 5 was documented at least t... | wave W229-r1: PASS | not signed
