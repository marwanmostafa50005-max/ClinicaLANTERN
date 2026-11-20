# The ten criteria: check sheet for the clinical reviewer

This is the list of ten criteria proposed for the ClinicaLANTERN prototype, with nine reserves. It is a draft for you to check as the clinical reviewer.

Nothing here is signed, validated or approved. Every patient in the test histories is fictional.

To answer, reply in one message: **criteria OK**, or **swap number N for reserve X**, or **change ...** (give the number and say what to change).

This sheet was updated on 18 November 2026 after two reviews of the files and histories. One reviewer read them as a pharmacist would. The other checked the data. They raised 29 points. Each point was checked against the files and against the medicines reference on this PC. The section "What changed after the reviews", near the end, lists every change made to the files. New points under "Please check" come after the line "Added after the reviews".

## Read once: the same for all ten

- Each statement and credit line is copied word for word from its criterion file. The medicine lists, the brand names, the rule for the models and the letter request are drafts written by AI agents on 18 November 2026. They are not part of the published sources. The models also see a short note under each medicine group. Its main points are given here in the lines under the brand names.
- Where a rule needs two medicines together, "together" means supply dates that overlap or fall within 60 days of each other. The 60 days is this prototype's own convention. The published wording gives no number.
- Age is not tested in any of the ten. STOPP was written for people aged 65 and over. Every test patient is aged 66 to 75. See question G2.
- Urgency is "routine" for nine of the ten. Only number 10 (PINCER 9) is "same day".
- Brand names first came from the agents' memory. On 18 November every listed name was looked up in the medicines reference on this PC. That is your licensed copy of SNOMED CT-AU, which holds the Australian Medicines Terminology, in its release of 31 October 2026. Only plain ingredient and brand names were taken from it. All but two were found under the listed ingredient. Ranexa is not in the reference at all (see number 4). Unisom SleepGels, in reserve R2, is written Unisom Sleepgel there. Names that the reviewers found in the reference were then added. They are named under each criterion. The reference does not show which products are still supplied. Strike any that are not sold in Australia and add the ones you stock. See also question G3.
- The brand list for the same medicine still differs a little from one criterion to the next (for example carvedilol, the ACE inhibitors, the NSAIDs and the opioids). After the changes of 18 November the lists for rivaroxaban, apixaban, amiodarone, metoprolol, nebivolol, diltiazem and ticagrelor are the same in every file that names them. One shared list for every medicine is best made after you have corrected the names, so that each correction is made once.
- "Please check" under numbers 1 and 4 holds the notes of the agents who drafted those files. The notes for the other eight were cut off before they reached this sheet. For those, the points come from a second reading of the files and histories. Treat them as less complete. The points added after the reviews come from the two reviewers.
- There are 60 test histories: two planted and one near miss for each of the 19 criteria, and three clean ones in `cases/_clean`. Each was checked against all 19 criteria, by a name match and by reading its medicine list. The name match was run again after the changes of 18 November. As the files are drafted, no history meets a second criterion, apart from the one noted under number 4. One more would if diltiazem were added to number 4.
- Nothing is switched on yet. The proposed list is `criteria/active.proposed.json`. The proposed answers are `cases/expected.proposed.json`. They take effect only after your reply.
- After you sign, two kinds of working copy should be removed. The 19 `expected.part.json` files in the case folders hold the same answers a second time, and nothing reads them. The two proposed files are replaced by the signed ones. The check tool (`tools/check-cases.mjs`) now reads the signed files as soon as the signed answer sheet exists, and says so if a proposed file is still on disk.

## Questions that apply to several criteria

**G1. Findings that ended months ago.** In the buried history of each of the nine STOPP criteria (numbers 1 to 9), the planted medicine stops four to seven months before the last line. The rules have no test for how recent a finding is, so each one is still reported. Number 10 has its own point about time (point 2). The letter requests are written in the present tense, for example "while the anticoagulant continues" and "while the regular opioid continues". A pharmacist would not usually write to a GP about a pair that ended months ago. The pass rule needs a GP letter for each planted finding. Decide:

- (a) Keep reporting findings from the past. Each letter request is then reworded so that it also fits a medicine that has stopped. The letter already lists the supplies with their dates.
- (b) Add a time limit to the rules, for example a last supply within 90 days of the last line. The buried findings are then moved so that they are still current, and the line numbers in the answer sheet are worked out again.

The files were left as drafted. That is choice (a) without the rewording, so nothing is missed. The dates for each criterion are under its "Please check".

**G2. Age.** STOPP was written for patients aged 65 and over. None of the nine STOPP rules tests age. The age is shown to the models, and three reserve rules (BRISNIK-HR-F2, BRISNIK-HR-A3 and EU7-F14) do test it. A history for a younger adult or a child would be reported under a STOPP label, for example Catapres or Intuniv for ADHD under STOPP B11. Decide:

- (a) Leave the rules as they are.
- (b) Add to each STOPP rule "the patient is aged 65 or over, or the age is not shown". No test history changes, because every test patient is 66 to 75.

The files were left as drafted, so nothing is missed. PROMPT (reserves R5 and R8) was written for ages 45 to 64, and its six test patients are 66 to 75. If you use a PROMPT reserve, either accept that it is applied outside its age group, or have its six test ages changed to 45 to 64.

**G3. How long the brand lists should be.** The medicines reference on this PC holds many more product names than these lists. By a rough count it holds several hundred more for the medicines in the ten criteria, for example 41 for irbesartan, 29 for olanzapine and 23 for quetiapine. Many of them differ only by strength. Only the names the reviewers raised were added. A line that shows the ingredient name is matched either way. Only a line that shows a brand name alone depends on the list. Your design note says the medicine lists should come from SNOMED AU. Decide:

- (a) Keep short lists of the names you see most.
- (b) Load every product name from the reference. The lists become several times longer, and so does each screening prompt.

**G4. Dates on days a pharmacy is often shut.** Some supply dates fall on Good Friday, Easter Saturday, Easter Sunday or Easter Monday 2026, in 14 of the histories. 183 of the 2,872 supply rows are dated on a Sunday, in 29 histories. No rule depends on the day of the week, so scoring is not affected. Say if you want the dates moved by a day or two to look like real opening days. The row order would be kept, so no line number would change.

---

## 1. STOPP C10: NSAID with an anticoagulant

> Nonsteroidal anti-inflammatory drugs (NSAIDs) and vitamin K antagonist, direct thrombin inhibitor or factor Xa inhibitors in combination (risk of major gastrointestinal bleeding).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. NSAIDs, the anti-inflammatory pain medicines:** celecoxib, diclofenac, etoricoxib, ibuprofen, indometacin, ketoprofen, ketorolac, mefenamic acid, meloxicam, naproxen, piroxicam, sulindac.
  Brands: Celebrex, Celaxib, Voltaren, Voltaren Rapid, Fenac, Clonac, Arthrotec, Arcoxia, Nurofen, Advil, Brufen, Rafen, Nurofen Plus, Panafen Plus, Nuromol, Maxigesic, Indocid, Arthrexin, Orudis, Oruvail, Toradol, Ponstan, Mobic, Movalis, Moxicam, Meloxibell, Naprosyn, Naprosyn SR, Anaprox, Inza, Proxen SR, Naprogesic, Aleve, Vimovo, Feldene, Mobilis, Aclin.
  Not counted: skin gels, creams and eye drops. Aspirin.
- **Group B. Warfarin, dabigatran and the factor Xa inhibitors:** warfarin, dabigatran, apixaban, rivaroxaban, edoxaban, fondaparinux.
  Brands: Coumadin, Marevan, Pradaxa, Eliquis, Alexibic, Apexa, Apixor, Axibic, Elapex, Xarelto, Ixarola, Rivoxa, Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed, Arixtra.
  Not counted: heparin and enoxaparin. Antiplatelet medicines such as aspirin and clopidogrel.

**The models are told**

Suspect a finding when at least one Group A medicine (an NSAID) AND at least one Group B medicine (warfarin, dabigatran, apixaban, rivaroxaban, edoxaban or fondaparinux) both appear in the history and their supply dates overlap or fall within 60 days of each other. One supply of each is enough.

**The letter asks the GP**

Whether the NSAID is still needed while the anticoagulant continues, and the patient's risk of bleeding.

**Cannot be seen in a dispensing history**

Why each medicine was prescribed, INR and kidney function results, and any past stomach ulcer or bleeding. Also how often the NSAID is really taken, anti-inflammatory medicines bought without a prescription, and medicines supplied by a hospital or another pharmacy.

**Test histories**

- Planted, brand names only: Mobic four times (June to September 2026) while Eliquis is supplied every month.
- Planted, buried: Naprosyn SR three times (January to March 2026) in the middle of 14 months of warfarin (Coumadin).
- Near miss, must not flag: Voltaren last supplied September 2025. Xarelto first supplied April 2026. Seven months apart.

**Please check** (the drafting agents' notes)

1. Brands that may be uncommon or withdrawn: Celaxib, Clonac, Arthrotec, Rafen, Panafen Plus, Arthrexin, Oruvail, Toradol, Moxicam, Meloxibell, Inza, Proxen SR, Mobilis, Aclin.
2. Ixarola and Rivoxa (rivaroxaban) come from the drafting agent's memory. Both are in the medicines reference on this PC. That reference holds 12 more rivaroxaban names and 5 more apixaban names that do not show the ingredient. They were added on 18 November, as one shared list here, in number 4, in number 8 and in reserve R1. Rivaroxaban: Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed. Apixaban: Alexibic, Apexa, Apixor, Axibic, Elapex. The reference does not show which are on the shelf. Strike the ones you do not want.
3. Fondaparinux (Arixtra, an injection) is counted as a factor Xa inhibitor. Enoxaparin and heparin are left out. Edoxaban is listed with no brand, because it is believed not to be marketed here. Confirm all three choices.
4. Aspirin is not counted as an NSAID at any dose. Skin gels, creams and eye drops are not counted. Confirm.
5. Not listed: parecoxib (Dynastat, a hospital injection), tiaprofenic acid (Surgam) and diflunisal. They are believed not to be supplied in the community now.
6. Ibuprofen, diclofenac and naproxen bought without a prescription will be missed.
7. Urgency is routine. A new NSAID for a patient on an anticoagulant may deserve a same-day call. Your decision.
8. Packs in the histories to check: Coumadin 2 mg, 50 tablets, 2 repeats, one strength only, directions "as directed". Panadol Osteo 96 with 2 repeats.
9. The near miss relies on time alone: Voltaren last supplied 9 September 2025, Xarelto first supplied 14 April 2026.

Added after the reviews on 18 November:

10. The buried finding ended months before the history ends. Naprosyn SR was last supplied on 13 March 2026. The history ends on 27 August 2026. The rule still reports it. The letter request speaks of the present: "while the anticoagulant continues". See question G1.
11. Age is not tested. See question G2.

---

## 2. STOPP B3: Beta-blocker with verapamil or diltiazem

> Beta-blocker in combination with verapamil or diltiazem (risk of heart block).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Beta-blockers:** atenolol, bisoprolol, carvedilol, labetalol, metoprolol, nadolol, nebivolol, oxprenolol, pindolol, propranolol, sotalol.
  Brands: Tenormin, Noten, Tensig, Bicor, Bicard, Bispro, Dilatrend, Dilasig, Dicarz, Vedilol, Kredex, Trandate, Presolol, Betaloc, Minax, Metohexal, Toprol-XL, Minax XL, Metrol-XL, Lopresor, Mistrom, Metrol, Nebilet, Nepiten, Lobivon, Corbeton, Visken, Barbloc, Inderal, Deralin, Sotacor, Cardol, Solavert.
  Not counted: beta-blocker eye drops such as timolol.
- **Group B. Verapamil or diltiazem:** verapamil, diltiazem.
  Brands: Isoptin, Isoptin SR, Anpec, Cordilox SR, Veracaps SR, Tarka, Cardizem, Cardizem CD, Vasocardol, Vasocardol CD, Coras, Dilzem, Diltahexal.
  Not counted: diltiazem cream or ointment. Other calcium channel blockers such as amlodipine, felodipine, lercanidipine and nifedipine.

**The models are told**

Suspect a finding when at least one Group A medicine (a beta-blocker) AND at least one Group B medicine (verapamil or diltiazem) both appear in the history with supply dates that overlap or fall within 60 days of each other. Other calcium channel blockers, such as amlodipine, felodipine, lercanidipine and nifedipine, do not count.

**The letter asks the GP**

Whether the beta-blocker and the verapamil or diltiazem are both meant to be taken together, and the patient's heart rate and ECG.

**Cannot be seen in a dispensing history**

The heart rate and the ECG, why each medicine was prescribed, whether a heart specialist chose the combination on purpose, whether both medicines are still being taken, and medicines supplied by another pharmacy or a hospital.

**Test histories**

- Planted, brand names only: Betaloc throughout. Cardizem CD added from June 2026.
- Planted, buried: Isoptin SR four times (January to April 2026) in the middle of 14 months of atenolol (Noten).
- Near miss, must not flag: metoprolol (Minax) with amlodipine (Norvasc). No verapamil or diltiazem.

**Please check** (from a second reading)

1. Brand names not confirmed: Tensig, Bicard, Bispro, Dilasig, Dicarz, Vedilol, Presolol, Metohexal, Metrol-XL, Nepiten, Corbeton, Barbloc, Deralin, Cardol, Solavert, Anpec, Cordilox SR, Veracaps SR, Vasocardol, Tarka.
2. Nadolol has no brand listed. Oxprenolol (Corbeton) and pindolol (Visken, Barbloc) may no longer be supplied. Keep or strike.
3. Added on 18 November from the medicines reference on this PC: Lopresor, Mistrom and Metrol (metoprolol), Kredex (carvedilol), Lobivon (nebivolol), and Coras, Dilzem and Diltahexal (diltiazem). The diltiazem list is now the same here, in number 5 and in reserve STOPP C13. The reference does not show which are still supplied. Strike the ones you do not want.
4. Beta-blocker eye drops such as timolol are left out. Confirm.
5. A heart specialist may have chosen the pair on purpose. The history cannot show that. The letter asks. It does not judge.
6. Urgency is routine. A second medicine that has just been added may deserve a same-day call. Your decision.
7. Verapamil is also listed in numbers 4 and 5. The three histories here hold no anticoagulant and no dementia medicine, so they meet this criterion only.

Added after the reviews on 18 November:

8. The buried finding ended months before the history ends. Isoptin SR was last supplied on 14 April 2026. The history ends on 12 September 2026. See question G1.
9. Age is not tested. See question G2.

---

## 3. STOPP B13: Aldosterone antagonist with a potassium-conserving medicine (potassium check)

> Aldosterone antagonists (e.g., spironolactone, eplerenone) with concurrent potassium-conserving drugs (e.g., ACEI’s, ARB’s, amiloride, triamterene) without monitoring of serum potassium (risk of dangerous hyperkalaemia i.e., > 6.0 mmol/l – serum K should be monitored regularly, i.e., at least every 6 months).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Aldosterone antagonists:** spironolactone, eplerenone, finerenone.
  Brands: Aldactone, Spiractin, Inspra, Espler, Inpler, Plera, Kerendia.
- **Group B. ACE inhibitors, angiotensin receptor blockers (sartans), amiloride and triamterene:** captopril, enalapril, fosinopril, lisinopril, perindopril, quinapril, ramipril, trandolapril, candesartan, eprosartan, irbesartan, losartan, olmesartan, telmisartan, valsartan, amiloride, triamterene.
  Brands: Capoten, Renitec, Renitec Plus, Zan-Extra, Monopril, Monoplus, Zestril, Prinivil, Coversyl, Prexum, Perindo, Idaprex, Coversyl Plus, Coveram, Reaptan, Accupril, Accuretic, Tritace, Ramace, Tryzan, Triasyn, Gopten, Odrik, Tarka, Atacand, Atacand Plus, Teveten, Teveten Plus, Avapro, Karvea, Avapro HCT, Karvezide, Cozaar, Olmetec, Olmetec Plus, Sevikar, Sevikar HCT, Micardis, Micardis Plus, Twynsta, Diovan, Co-Diovan, Exforge, Exforge HCT, Entresto, Kaluril, Moduretic, Amizide, Hydrene.
  A combination product that holds one of these counts.

**The models are told**

Suspect a finding when at least one Group A medicine (an aldosterone antagonist) AND at least one Group B medicine (an ACE inhibitor, a sartan, amiloride or triamterene) both appear in the history with supply dates that overlap or fall within 60 days of each other. A dispensing history cannot show blood tests, so report the finding even though potassium monitoring cannot be seen.

**The letter asks the GP**

Whether serum potassium and kidney function have been checked in the last 6 months while both medicines are being taken.

**Cannot be seen in a dispensing history**

Whether blood potassium and kidney function have been checked in the last 6 months and what the results were, why each medicine was prescribed, whether both are still being taken, and potassium supplements or salt substitutes bought without a prescription.

**Test histories**

- Planted, brand names only: Aldactone added from March 2026 to monthly Coversyl.
- Planted, buried: Inspra four times (December 2025 to March 2026) in the middle of 15 months of Karvezide (irbesartan with hydrochlorothiazide).
- Near miss, must not flag: Coversyl last supplied July 2025. Aldactone first supplied July 2026. A year apart.

**Please check** (from a second reading)

1. The criterion is about missing potassium checks. A dispensing history cannot show blood tests. So the rule reports every aldosterone antagonist that is supplied with an ACE inhibitor, a sartan, amiloride or triamterene. That pair is standard treatment in heart failure, so expect many findings. Each letter asks whether potassium and kidney function were checked in the last 6 months. Confirm this is what you want.
2. Finerenone (Kerendia) was added by the drafting agent. The criterion names spironolactone and eplerenone as its examples. Keep or strike.
3. The published list of potassium-conserving drugs is open ("e.g."). Not listed, for you to decide: potassium supplements such as Span-K, and trimethoprim.
4. Entresto (sacubitril with valsartan) counts through its valsartan. Confirm.
5. Brand names not confirmed: Spiractin, Capoten, Zan-Extra, Monopril, Prinivil, Prexum, Idaprex, Reaptan, Accupril, Ramace, Tryzan, Triasyn, Odrik, Teveten, Karvea, Kaluril, Amizide, Hydrene. Some may be withdrawn.
6. The ACE inhibitor brand list here is not the same as in number 8. Only in number 8: Perindo Combi, Alphapril, Fibsol, Lisodur, Acenorm. Only here: Idaprex, Triasyn, Odrik. One list would be safer.
7. Packs in the histories to check: Aldactone 25 mg in 100s, Inspra 25 mg in 30s, Karvezide 300 mg/12.5 mg in 30s.

Added after the reviews on 18 November:

8. Added from the medicines reference on this PC: Espler, Inpler and Plera (eplerenone). The reference does not show which are still supplied. Strike the ones you do not want.
9. The buried finding ended months before the history ends. Inspra was last supplied on 16 March 2026. The history ends on 14 September 2026. The letter request speaks of the present: "while both medicines are being taken". See question G1.
10. The buried history also holds a thiazide (hydrochlorothiazide, in Karvezide) with Inspra. The answer sheet expects number 3 only. See number 8, point 10.
11. Age is not tested. See question G2.

---

## 4. STOPP C14: Apixaban, dabigatran, edoxaban or rivaroxaban with a P-glycoprotein inhibitor

> Apixaban, dabigatran, edoxaban, rivaroxaban and P-glycoprotein (P-gp) drug efflux pump inhibitors e.g., amiodarone, azithromycin, carvedilol, cyclosporin, dronedarone, itraconazole, ketoconazole (systemic), macrolides, quinine, ranolazine, tamoxifen, ticagrelor, verapamil (increased risk of bleeding).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Apixaban, dabigatran, edoxaban and rivaroxaban:** apixaban, dabigatran, edoxaban, rivaroxaban.
  Brands: Eliquis, Alexibic, Apexa, Apixor, Axibic, Elapex, Pradaxa, Xarelto, Ixarola, Rivoxa, Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed.
  Not counted: warfarin.
- **Group B. P-glycoprotein inhibitors named by the criterion:** amiodarone, azithromycin, carvedilol, ciclosporin, clarithromycin, dronedarone, erythromycin, itraconazole, ketoconazole, quinine, ranolazine, roxithromycin, tamoxifen, ticagrelor, verapamil.
  Brands: Cordarone X, Aratac, Cardinorm, Rithmik, Amdarone, Zithromax, Zedd, Dilatrend, Dicarz, Kredex, Neoral, Sandimmun, Cicloral, Klacid, Kalixocin, Nexium Hp7, Klacid Hp 7, Multaq, EES, E-Mycin, Eryc, Sporanox, Lozanoc, Quinate, Quinbisul, Ranexa, Rulide, Biaxsig, Roximycin, Nolvadex-D, Genox, Tamosin, Brilinta, Bricalor, Ticalor, Tirela, Isoptin, Isoptin SR, Anpec, Cordilox SR, Veracaps SR, Tarka.
  Not counted: creams, gels, shampoos and eye drops. Any medicine that is not on this list.

**The models are told**

Suspect a finding when at least one Group A medicine (apixaban, dabigatran, edoxaban or rivaroxaban) AND at least one Group B medicine (a P-glycoprotein inhibitor on the list) both appear in the history and their supply dates overlap or fall within 60 days of each other. A short course counts, for example one pack of a macrolide antibiotic supplied while the anticoagulant is being supplied.

**The letter asks the GP**

The anticoagulant together with the P-glycoprotein inhibitor, including the anticoagulant dose, kidney function and the patient's risk of bleeding.

**Cannot be seen in a dispensing history**

Why each medicine was prescribed, kidney function, body weight, and any bleeding or bruising. Also whether the prescriber has already allowed for the combination, whether a short course was finished, and medicines supplied by a hospital or another pharmacy.

**Test histories**

- Planted, brand names only: Isoptin SR every month from March 2026 while Eliquis is supplied every month.
- Planted, buried: two packs of Klacid in February 2026, in the middle of 14 months of Xarelto.
- Near miss, must not flag: Klacid once in November 2025. Eliquis starts June 2026. Seven months apart.
- Also planted, from a reserve folder: STOPP-C13/pos-buried (Pradaxa with Isoptin SR) meets this criterion too. So number 4 has three planted findings, not two. The drafting agent kept this on purpose. If you want one finding in each history, say so, and the verapamil there can be swapped for diltiazem.

**Please check** (the drafting agents' notes)

1. The published list is open ("e.g."). Only the named medicines are listed, with "macrolides" spelt out as azithromycin, clarithromycin, erythromycin and roxithromycin. Not listed, for you to decide: ritonavir (including Paxlovid), posaconazole, voriconazole, diltiazem, tacrolimus, glecaprevir with pibrentasvir. The models are told that only listed medicines count.
2. Diltiazem matters most. The reserve history STOPP-C13/pos-brand is Pradaxa with Cardizem CD. As drafted it must not flag here. If you add diltiazem, that history gains a second expected finding.
3. Carvedilol is named by the criterion and is very often supplied with these anticoagulants. Expect many findings. Roxithromycin and azithromycin are weaker inhibitors, but they are macrolides, so they are listed.
4. A short course counts: one pack of a macrolide is enough. The buried history is exactly that. A letter about a course that has finished may be of little use. Decide whether past short courses should count.
5. Brand names to confirm: Aratac, Zedd, Dicarz, Sandimmun, Kalixocin, Nexium Hp7, Klacid Hp 7, EES, E-Mycin, Eryc, Lozanoc, Quinate, Quinbisul, Biaxsig, Roximycin, Genox, Tamosin, Anpec, Cordilox SR, Veracaps SR, Tarka, Ixarola, Rivoxa.
6. Ranexa (ranolazine) is not in the medicines reference on this PC. The reference holds no ranolazine product at all. Ranexa is the only listed brand that could not be found there. Ranolazine stays, because the criterion names it. Ranexa also stays until you decide, so that a line that shows only "Ranexa" is not missed. Strike the brand if it is not supplied in Australia. Multaq (dronedarone) is in the reference. It may no longer be supplied.
7. Ketoconazole tablets are believed to be no longer marketed here, so no brand is listed. The medicines reference on this PC still holds Nizoral tablets. Ketoconazole cream and shampoo, erythromycin gel and ciclosporin eye drops are left out. Confirm.
8. Edoxaban is named by the criterion but has no Australian brand. The medicines reference on this PC holds no edoxaban product.
9. In the near miss, Eliquis is supplied with amlodipine, doxycycline, rosuvastatin and paracetamol. Confirm that none of these is a P-glycoprotein inhibitor that matters here.
10. Urgency is routine. A strong inhibitor such as itraconazole may deserve same-day contact. Your decision.

Added after the reviews on 18 November:

11. Added from the medicines reference on this PC: the rivaroxaban and apixaban names listed under number 1, point 2. Also Cardinorm, Rithmik and Amdarone (amiodarone), Kredex (carvedilol), Cicloral (ciclosporin), and Bricalor, Ticalor and Tirela (ticagrelor). Amiodarone with apixaban or rivaroxaban is one of the commonest pairs for this criterion. Some of the new names look alike: Roxator, Roxabic and Roxalem are rivaroxaban, and Roximycin is roxithromycin. Both groups of this criterion now hold such names. The reference does not show which are still supplied. Strike the ones you do not want.
12. Two of the three planted findings ended months before the history ends. The two packs of Klacid were supplied on 9 and 17 February 2026, and that history ends on 4 September 2026. In STOPP-C13/pos-buried, Isoptin SR was last supplied on 30 March 2026, and that history ends on 24 September 2026. The letter request for this criterion names no time, so it also fits a course that has finished. See point 4 and question G1.
13. Age is not tested. See question G2.

---

## 5. STOPP D18: Acetylcholinesterase inhibitor with a medicine that slows the heart

> Acetylcholinesterase inhibitors with concurrent treatment with drugs that induce persistent bradycardia (< 60 beats/min.) such as beta-blockers, digoxin, diltiazem, verapamil (risk of cardiac conduction failure, syncope and injury).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Acetylcholinesterase inhibitors:** donepezil, galantamine, rivastigmine, pyridostigmine.
  Brands: Aricept, Aridon, Arazil, Reminyl, Galantyl, Gamine XR, Exelon, Exelon Patch, Rivastigmelon, Prometax, Mestinon.
  Not counted: memantine. Rivastigmine patches count. Pyridostigmine (Mestinon) is for myasthenia gravis, not dementia. It was added on 18 November. See point 8.
- **Group B. Beta-blockers, digoxin, diltiazem and verapamil:** atenolol, bisoprolol, carvedilol, labetalol, metoprolol, nadolol, nebivolol, oxprenolol, pindolol, propranolol, sotalol, digoxin, diltiazem, verapamil.
  Brands: Tenormin, Noten, Tensig, Bicor, Bicard, Bispro, Dilatrend, Dilasig, Dicarz, Vedilol, Kredex, Trandate, Presolol, Betaloc, Minax, Metohexal, Toprol-XL, Minax XL, Metrol-XL, Lopresor, Mistrom, Metrol, Nebilet, Nepiten, Lobivon, Corbeton, Visken, Barbloc, Inderal, Deralin, Sotacor, Cardol, Solavert, Lanoxin, Lanoxin PG, Sigmaxin, Sigmaxin PG, Cardizem, Cardizem CD, Vasocardol, Vasocardol CD, Coras, Dilzem, Diltahexal, Isoptin, Isoptin SR, Anpec, Cordilox SR, Veracaps SR, Tarka.
  Not counted: eye drops and skin products.

**The models are told**

Suspect a finding when at least one Group A medicine (donepezil, galantamine, rivastigmine or pyridostigmine) AND at least one Group B medicine (a beta-blocker, digoxin, diltiazem or verapamil) both appear in the history with supply dates that overlap or fall within 60 days of each other. The heart rate cannot be seen in a dispensing history, so report the finding even though the pulse is not known.

**The letter asks the GP**

The patient's heart rate, any fainting, dizziness or falls, and whether both medicines are still meant to be taken together.

**Cannot be seen in a dispensing history**

The heart rate and the ECG, any fainting, dizziness or falls, why each medicine was prescribed, whether both are still being taken, and medicines supplied by another pharmacy or a hospital.

**Test histories**

- Planted, brand names only: Aricept started March 2026 while Tenormin is supplied every month.
- Planted, buried: Exelon patches four times (December 2025 to March 2026) in the middle of 14 months of digoxin (Lanoxin PG).
- Near miss, must not flag: memantine (Ebixa) with metoprolol (Betaloc). Memantine is not an acetylcholinesterase inhibitor.

**Please check** (from a second reading)

1. The criterion speaks of a persistent slow pulse (under 60 beats a minute). A dispensing history cannot show the pulse. So the rule reports every pair, whatever the pulse. Each letter asks about heart rate, fainting and falls. Confirm this is what you want.
2. The published list is open ("such as"). Listed: beta-blockers, digoxin, diltiazem, verapamil. Not listed, for you to decide: amiodarone, ivabradine (Coralan), clonidine and moxonidine.
3. Brand names not confirmed: Aridon, Galantyl, Sigmaxin, Sigmaxin PG, and the beta-blocker names listed under number 2. Please also confirm Reminyl for galantamine.
4. Beta-blocker eye drops such as timolol are left out. Confirm.
5. Rivastigmine patches count. The buried history names them "Exelon Patch 5" and "Exelon Patch 10". Check that this reads like a real label. The medicines reference on this PC writes them as Exelon-5 and Exelon-10.
6. Urgency is routine. Your decision.
7. Packs in the histories to check: Lanoxin PG 62.5 microgram, 200 tablets, TWO daily. Aricept 5 mg for two supplies, then 10 mg.

Added after the reviews on 18 November:

8. Group A is named "Acetylcholinesterase inhibitors". The draft listed the three dementia medicines and ruled out memantine only. Pyridostigmine (Mestinon), used for myasthenia gravis, is also an acetylcholinesterase inhibitor and can also slow the heart. The criterion sits in the nervous system section of STOPP and most likely means the dementia medicines. Its words cover both. On 18 November pyridostigmine was added with the brand Mestinon, so that this pair is reported and is not left to the model's own choice. No test history holds it. Decide: keep it, or strike it and have the note say that only dementia medicines count.
9. Added from the medicines reference on this PC: Arazil (donepezil), Gamine XR (galantamine), and the patches Rivastigmelon and Prometax (rivastigmine). In Group B, the names added under number 2: Lopresor, Mistrom, Metrol, Kredex, Lobivon, Coras, Dilzem and Diltahexal. The reference does not show which are still supplied. Strike the ones you do not want.
10. The buried finding ended months before the history ends. The Exelon patches were last supplied on 9 March 2026. The history ends on 29 August 2026. The letter request speaks of the present: "still meant to be taken together". See question G1.
11. Age is not tested. See question G2.

---

## 6. STOPP L2: Regular opioid with no laxative supplied

> Use of daily regular (as distinct from PRN) opioids without concomitant laxative (risk of severe constipation).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Opioid pain medicines:** oxycodone, morphine, tapentadol, tramadol, buprenorphine, fentanyl, hydromorphone, methadone, codeine.
  Brands: OxyContin, Endone, OxyNorm, Targin, Proladone, MS Contin, Kapanol, Sevredol, Ordine, Anamorph, Palexia SR, Palexia IR, Tapal, Tadol, Tapex, Tramal, Tramal SR, Durotram XR, Zaldiar, Norspan, Bupredermal, Temgesic, Durogesic, Denpax, Fenpatch, Jurnista, Dilaudid, Physeptone, Panadeine Forte, Panamax Co, Codalgin Forte, Comfarol Forte, Prodeine Forte, Codapane Forte, Mersyndol Forte, Nurofen Plus, Panafen Plus.
  Targin (oxycodone with naloxone) is counted as an opioid.
- **Group B. Laxatives:** macrogol 3350, lactulose, docusate, senna, bisacodyl, sodium picosulfate, sorbitol, psyllium husk, sterculia, glycerol, prucalopride.
  Brands: Movicol, OsmoLax, Molaxole, Macrovic, Duphalac, Actilax, Dulose, Coloxyl, Coloxyl with Senna, Senokot, Dulcolax, Bisalax, Dulcolax SP Drops, Sorbilax, Metamucil, Fybogel, Normafibe, Normacol Plus, Resotrans.
  Not counted as laxatives: methylnaltrexone (Relistor), naloxegol (Movantik) and the naloxone in Targin. See point 2. Glycerol counts as suppositories.

**The models are told**

Suspect a finding when a Group A medicine (an opioid) is supplied for regular daily use and no Group B medicine (a laxative) is supplied on dates that overlap the opioid supplies or fall within 60 days of them. Regular daily use means directions with fixed doses, for example every 12 hours, twice a day or a patch changed on set days; an opioid supplied only for use when required does not count.

**The letter asks the GP**

Whether this patient is using a laxative while the regular opioid continues, and the patient's bowel function.

**Cannot be seen in a dispensing history**

Laxatives bought without a prescription, which is how many laxatives are obtained. Also whether the opioid is taken every day, whether the patient has constipation, and any laxative supplied by another pharmacy or a hospital.

**Test histories**

- Planted, brand name only: Palexia SR every 12 hours, supplied every two weeks from March to September 2026. No laxative at any time.
- Planted, buried: OxyContin every 12 hours, supplied every two weeks from December 2025 to March 2026, in the middle of 14 months. No laxative at any time.
- Near miss, must not flag: Palexia SR as above, with Movicol supplied from the first day and every four weeks after.

**Please check** (from a second reading)

1. Many laxatives are bought without a prescription, so a dispensing history often shows none. Expect a finding for most people on a regular opioid. You may prefer to ask the patient at the counter before any letter goes to the GP. Confirm this criterion still earns a place in the ten.
2. Three opioid blockers are used for constipation caused by opioids: the naloxone in Targin, methylnaltrexone (Relistor) and naloxegol (Movantik). None is a laxative in the usual sense. The draft counted Relistor as a laxative, but not the naloxone in Targin and not naloxegol. On 18 November Relistor was taken out of the laxative group, so that the three are treated the same way. A patient on a regular opioid with one of them and no other laxative is now reported. Targin still counts as an opioid. Decide: none of the three counts as cover (as now), or all three do.
3. Fibre laxatives (psyllium, sterculia) count as cover. They are not the usual choice with an opioid. Keep or strike.
4. Methadone and buprenorphine are listed by ingredient. Supplies for opioid dependence, such as methadone liquid or Suboxone, may be reported too. Decide.
5. "Regular" is read from the directions. Fixed doses count. "When required" does not. A label that says only "as directed" is unclear, and the models are told to report when in doubt.
6. The rule does not say clearly whether one laxative pack early in a long opioid course is enough cover. Decide.
7. Brand names not confirmed: Anamorph, Sevredol, Palexia IR, Durotram XR, Bupredermal, Denpax, Fenpatch, Panamax Co, Comfarol Forte, Prodeine Forte, Codapane Forte, Molaxole, Macrovic, Dulose, Bisalax, Sorbilax, Normafibe, Normacol Plus, Resotrans.
8. Not listed as laxatives: liquid paraffin and enemas such as Microlax. For naloxegol see point 2.
9. The opioid lines in the histories show 28 tablets every two weeks with no repeats. Check that this reads like real supply.

Added after the reviews on 18 November:

10. Added from the medicines reference on this PC: Tapal, Tadol and Tapex (tapentadol), Zaldiar (tramadol with paracetamol) and Proladone (an oxycodone suppository). In the reference, Tadol is tapentadol, not tramadol. The same names were added under number 8. The reference does not show which are still supplied. Strike the ones you do not want.
11. The buried finding ended months before the history ends. OxyContin was last supplied on 17 March 2026. The history ends on 1 September 2026. The letter request speaks of the present: "while the regular opioid continues". See question G1.
12. Age is not tested. See question G2.

---

## 7. STOPP D8: Benzodiazepine supplied for four weeks or longer

> Benzodiazepines for ≥ 4 weeks (no indication for longer treatment; risk of prolonged sedation, confusion, impaired balance, falls, road traffic accidents; all benzodiazepines should be withdrawn gradually if taken for more than 4 weeks as there is a risk of causing a benzodiazepine withdrawal syndrome if stopped abruptly).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Benzodiazepines:** diazepam, temazepam, oxazepam, nitrazepam, lorazepam, alprazolam, clonazepam, clobazam, bromazepam, flunitrazepam, triazolam, midazolam.
  Brands: Valium, Antenex, Ducene, Valpam, Normison, Temaze, Temtabs, Serepax, Murelax, Alepam, Mogadon, Alodorm, Ativan, Xanax, Kalma, Alprax, Rivotril, Paxam, Frisium, Lexotan, Hypnodorm, Halcion, Hypnovel.

**The models are told**

Suspect a finding when a Group A medicine (a benzodiazepine) is supplied on dates that cover four weeks (28 days) or more: repeat supplies no more than 60 days apart that together last 28 days or more, or one supply that lasts 28 days or more at the directed dose. Do not count one short course, or short courses that are many months apart.

**The letter asks the GP**

Whether the benzodiazepine is still needed after four weeks or more of supply, and the patient's risk of drowsiness, confusion and falls.

**Cannot be seen in a dispensing history**

Why the benzodiazepine was started, and whether there is a reason for longer treatment such as epilepsy or palliative care. Also whether the tablets are taken every day or only now and then, whether a gradual dose reduction is already under way, and any supply from another pharmacy.

**Test histories**

- Planted, brand name only: Temaze, 25 tablets, one at night, every four weeks from February to September 2026. Eight supplies.
- Planted, buried: Antenex (diazepam) 5 mg twice a day, five supplies from January to April 2026, in the middle of 15 months.
- Near miss, must not flag: Normison, 7 tablets, twice: August 2025 and July 2026. Two short courses more than ten months apart.

**Please check** (from a second reading)

1. How "4 weeks or more" is counted: repeat supplies no more than 60 days apart that together last 28 days or more, or one supply that lasts 28 days or more. So one pack of 50 diazepam taken once a day already meets it. One pack of 25 temazepam does not. Two packs do. Confirm.
2. The rule does not say whether monthly packs labelled "when required" count. The models are told to report when in doubt, so they are likely to be reported. Decide.
3. Clonazepam and clobazam are often used for epilepsy, where long treatment is intended. They are listed, so those patients will be reported. Midazolam (Hypnovel, an injection) is listed too. Keep or strike.
4. Zolpidem and zopiclone are not benzodiazepines and are not counted here. They are in reserve PROMPT CN-4. Two reserve histories hold long-term Stilnox and Imovane. They must not flag under this criterion.
5. Brand names not confirmed: Ducene, Valpam, Temtabs, Murelax, Alepam, Alodorm, Kalma, Alprax, Paxam, Lexotan, Hypnodorm, Halcion. Flunitrazepam and triazolam may no longer be supplied.
6. The published text says a benzodiazepine taken for more than 4 weeks must be withdrawn gradually. The letter asks whether it is still needed. It does not say stop. Check you are content with that wording.
7. The near miss uses 7 tablets of Normison. The usual pack is 25. Change it if you want the supply to look real.

Added after the reviews on 18 November:

8. The buried finding ended months before the history ends. Antenex was last supplied on 28 April 2026. The history ends on 26 September 2026. The letter request speaks of the present: "still needed". See question G1.
9. Age is not tested. See question G2.

---

## 8. STOPP A3: Two medicines from the same class for regular use

> Any duplicate drug class prescription for daily regular use (as distinct from PRN use) e.g., two concurrent NSAIDs, SSRIs, loop diuretics, ACE inhibitors, anticoagulants, antipsychotics, opioid analgesics (optimisation of monotherapy within a single drug class should be observed prior to considering a new agent).
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Oral NSAIDs:** ibuprofen, diclofenac, naproxen, celecoxib, meloxicam, indometacin, piroxicam, ketoprofen, mefenamic acid, etoricoxib, ketorolac, sulindac.
  Brands: Nurofen, Brufen, Advil, Rafen, Nurofen Plus, Nuromol, Maxigesic, Voltaren, Fenac, Naprosyn, Naprosyn SR, Inza, Anaprox, Naprogesic, Aleve, Vimovo, Celebrex, Celaxib, Mobic, Movalis, Moxicam, Indocid, Arthrexin, Feldene, Mobilis, Orudis, Oruvail, Ponstan, Arcoxia, Toradol, Aclin.
  Not counted: skin gels and eye drops. Low-dose aspirin.
- **Group B. SSRI antidepressants:** citalopram, escitalopram, fluoxetine, fluvoxamine, paroxetine, sertraline.
  Brands: Cipramil, Celapram, Talam, Lexapro, Esipram, Loxalate, Lexam, Prozac, Lovan, Zactin, Luvox, Faverin, Movox, Aropax, Paxtine, Extine, Zoloft, Eleva, Sertra, Setrona.
  Not counted: antidepressants of other classes.
- **Group C. Loop diuretics:** furosemide, bumetanide, etacrynic acid.
  Brands: Lasix, Urex, Uremide, Burinex, Edecrin.
- **Group D. ACE inhibitors:** perindopril, ramipril, enalapril, lisinopril, captopril, fosinopril, quinapril, trandolapril.
  Brands: Coversyl, Perindo, Prexum, Coversyl Plus, Perindo Combi, Coveram, Reaptan, Tritace, Ramace, Tryzan, Renitec, Alphapril, Renitec Plus, Zan-Extra, Zestril, Prinivil, Fibsol, Lisodur, Capoten, Acenorm, Monopril, Monoplus, Accupril, Accuretic, Gopten, Tarka.
  Combination products count.
- **Group E. Anticoagulants:** warfarin, dabigatran, apixaban, rivaroxaban, edoxaban, enoxaparin, dalteparin, fondaparinux.
  Brands: Coumadin, Marevan, Pradaxa, Eliquis, Alexibic, Apexa, Apixor, Axibic, Elapex, Xarelto, Ixarola, Rivoxa, Relaban, Rivalembic, Rivarelto, Rivator, Rivaxib, Rivaxotor, Roxabic, Roxalem, Roxator, Toriva, Troxa, Xaremed, Clexane, Fragmin, Arixtra.
  Tablets, capsules and injections count. No Australian brand is listed for edoxaban.
- **Group F. Antipsychotics:** amisulpride, aripiprazole, asenapine, brexpiprazole, cariprazine, chlorpromazine, clozapine, flupentixol, haloperidol, lurasidone, olanzapine, paliperidone, periciazine, quetiapine, risperidone, ziprasidone, zuclopenthixol.
  Brands: Solian, Abilify, Abilify Maintena, Saphris, Rexulti, Reagila, Largactil, Clozaril, Clopine, Fluanxol, Serenace, Haldol, Latuda, Zyprexa, Zypine, Invega, Invega Sustenna, Invega Trinza, Neulactil, Seroquel, Quetia, Syquet, Risperdal, Risperdal Consta, Rispa, Rixadone, Ozidal, Zeldox, Clopixol.
  Long-acting injections count. Not counted: prochlorperazine (Stemetil).
- **Group G. Opioid analgesics:** buprenorphine, codeine, fentanyl, hydromorphone, methadone, morphine, oxycodone, tapentadol, tramadol.
  Brands: Norspan, Temgesic, Panadeine Forte, Panadeine, Codalgin Forte, Comfarol Forte, Mersyndol Forte, Nurofen Plus, Durogesic, Denpax, Fenpatch, Abstral, Dilaudid, Jurnista, Physeptone, MS Contin, MS Mono, Kapanol, Sevredol, Anamorph, Ordine, OxyContin, OxyNorm, Endone, Targin, Proladone, Palexia, Tapal, Tadol, Tapex, Tramal, Zydol, Tramedo, Durotram, Zaldiar.
  Patches and suppositories count. Methadone or buprenorphine supplied for opioid dependence is not listed.

**The models are told**

Suspect a finding when two different active ingredients from the same group (Group A, B, C, D, E, F or G), or from any other single drug class such as two statins or two proton pump inhibitors, are both supplied for regular daily use on dates that overlap or fall within 60 days of each other. Do not count one ingredient under two brand names or two strengths, a medicine whose directions say it is taken only when required (PRN), or two medicines from different classes that treat the same condition.

**The letter asks the GP**

Whether both medicines from the same class are meant to be taken together, or whether one was meant to replace the other.

**Cannot be seen in a dispensing history**

Whether the prescriber meant one medicine to replace the other, whether the patient is still taking both, the reason for each medicine, and any medicines bought without a prescription or supplied by another pharmacy.

**Test histories**

- Planted, brand names only: Coversyl every month. Tritace, a second ACE inhibitor, added from 16 June 2026 while Coversyl continues.
- Planted, buried: Mobic every month from January to April 2026, with Naprosyn SR in February and March, in the middle of 14 months.
- Near miss, must not flag: Celebrex (July and August 2025) and Mobic (July and August 2026), eleven months apart. Atorvastatin only changes brand, from Lipitor to Lorstat.

**Please check** (from a second reading)

1. This criterion is open: "any duplicate drug class". Seven classes are listed. The models are also told to report two medicines from any other single class, such as two statins or two proton pump inhibitors. So findings can come from outside the lists. The test histories plant only ACE inhibitors and NSAIDs.
2. What counts as one class is a judgement. These pairs may be reported although they are often intended: a slow-release opioid with a regular immediate-release opioid, an antipsychotic tablet with a long-acting injection, warfarin with enoxaparin while warfarin is started, aspirin with clopidogrel. Say which of these you want reported.
3. A change from one medicine to another of the same class shows both within 60 days. It will be reported. The pharmacist can bypass it with a reason.
4. An ACE inhibitor with a sartan is not counted. An SSRI with an SNRI is not counted. The draft treats each pair as two classes. Confirm.
5. Medicines for use "when required" are not counted. This is read from the directions.
6. The lists here are still not the same as in other criteria. NSAIDs differ from number 1, ACE inhibitors from number 3, and opioids from number 6. On 18 November Naprosyn SR was added here, because the buried history plants it and number 1 lists it. The rivaroxaban and apixaban lists were made the same as in number 1, and edoxaban was added with no brand. One shared list for each class is best made after you have corrected the names.
7. Methadone and buprenorphine are named in the opioid group. The note says supplies for opioid dependence are not listed. A model may still report them. Decide.
8. This criterion has about 170 brand names. Please read the brand lines. Among those not confirmed: Alphapril, Fibsol, Lisodur, Acenorm, Perindo Combi, Uremide, Burinex, Edecrin, Zactin, Faverin, Movox, Extine, Setrona, Zypine, Syquet, Rixadone, Ozidal, MS Mono, Zydol, Tramedo, Abstral.

Added after the reviews on 18 November:

9. The rule tells the models: "Do not count one ingredient under two brand names or two strengths". That stops false flags when a brand is swapped, and the near miss (Lipitor then Lorstat) tests it. It also means a true double supply of one medicine under two names at the same time is never reported, for example Coversyl and Perindo both supplied every month. That is a duplication a pharmacist wants to catch. Decide: (a) keep the rule as drafted, or (b) narrow the exception to brand changes, and count the same ingredient under two names when both are supplied on overlapping dates for two or more supplies each. The rule was left as drafted. Choice (b) asks the models to tell a double supply from two brands that alternate from month to month, and no test history plants a double supply. If you choose (b), the rule is reworded and a test history is drafted for it.
10. The rule also covers "any other single drug class". The buried history of number 3 holds two diuretics within 7 days of each other: hydrochlorothiazide (in Karvezide) and eplerenone (Inspra). The answer sheet expects no finding for this criterion there, because a thiazide and an aldosterone antagonist are two classes. A model may still report "two diuretics". By a scan of the medicine names, it is the only such pair in the 60 histories apart from the two planted pairs. Confirm they are two classes. Say if the rule should state that diuretics of different kinds (loop, thiazide, aldosterone antagonist) are different classes. The rule was not changed.
11. Added from the medicines reference on this PC: the rivaroxaban and apixaban names listed under number 1, point 2, and the opioid names added under number 6: Tapal, Tadol and Tapex (tapentadol), Zaldiar (tramadol with paracetamol) and Proladone (an oxycodone suppository). The reference does not show which are still supplied. Strike the ones you do not want.
12. The buried finding ended months before the history ends. Naprosyn SR was last supplied on 17 March 2026 and Mobic on 2 April 2026. The history ends on 20 October 2026. See question G1.
13. Age is not tested. See question G2.

---

## 9. STOPP B11: Centrally-acting blood pressure medicine

> Centrally-acting antihypertensives e.g., methyldopa, clonidine, moxonidine, rilmenidine, guanfacine (centrally-active antihypertensives are generally less well tolerated by older people than younger people)
>
> Credit: O'Mahony D, Cherubini A, Guiteras AR, et al. STOPP/START criteria for potentially inappropriate prescribing in older people: version 3. Eur Geriatr Med 2023;14:625-632. doi:10.1007/s41999-023-00777-y
>
> Text reproduced without changes. Licence as read: CC BY 4.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Centrally-acting antihypertensives:** methyldopa, clonidine, moxonidine, rilmenidine, guanfacine.
  Brands: Aldomet, Hydopa, Catapres, Dixarit, Physiotens, Moxotens, Normatens, Intuniv.
  Not counted: eye drops such as brimonidine and apraclonidine. Dixarit (clonidine 25 microgram, used for migraine and flushing) counts as clonidine. See point 8.

**The models are told**

Suspect a finding when a Group A medicine (a centrally-acting antihypertensive) is supplied at least once in the history. Blood pressure medicines of other kinds do not count.

**The letter asks the GP**

Whether the centrally-acting blood pressure medicine is still needed, and how well the patient is tolerating it.

**Cannot be seen in a dispensing history**

The blood pressure readings, why this medicine was chosen, whether other blood pressure medicines were tried first, side effects such as dizziness, drowsiness or a dry mouth, and whether the medicine is still being taken. Clonidine and guanfacine are sometimes used for reasons other than blood pressure.

**Test histories**

- Planted, brand name only: Physiotens every month from April 2026.
- Planted, buried: Catapres (clonidine) four times (January to April 2026) in the middle of 14 months.
- Near miss, must not flag: prazosin (Minipress), a blood pressure medicine of another kind.

**Please check** (from a second reading)

1. One supply is enough. There is no time rule.
2. The reason for the medicine cannot be seen. Clonidine is also used for hot flushes, migraine, ADHD and drug withdrawal. Guanfacine (Intuniv) is believed to be supplied here for ADHD, not for blood pressure. Both would be reported. Keep guanfacine or strike it.
3. Age is not tested. A young person on clonidine or guanfacine for ADHD would be reported if such a history were imported. Decide whether this rule needs "aged 65 or over". See question G2, which asks the same for all nine STOPP rules.
4. Rilmenidine is named by the criterion. It has no brand listed, because it is believed not to be sold here.
5. Brand names to confirm: Aldomet, Hydopa, Catapres, Physiotens, Intuniv.
6. Stopping clonidine suddenly can cause a sharp rise in blood pressure. The letter asks whether the medicine is still needed. It does not say stop.
7. Packs in the histories to check: Catapres 100 microgram in 100s, three times a day, with repeats. Physiotens 200 microgram once, then 400 microgram.

Added after the reviews on 18 November:

8. Added from the medicines reference on this PC: Moxotens and Normatens (moxonidine), and Dixarit (clonidine 25 microgram tablets). Dixarit is used for migraine and flushing, not for blood pressure. It was added so that no clonidine supply is missed, the same as Catapres supplied for another reason. Keep or strike Dixarit together with your answer to point 2. The reference does not show which of the three are still supplied.
9. The buried finding ended months before the history ends. Catapres was last supplied on 29 April 2026. The history ends on 5 September 2026. The letter request speaks of the present: "still needed". See question G1.

---

## 10. PINCER 9: Methotrexate without a weekly instruction

> Patients receiving prescriptions of methotrexate without instructions that the drug should be taken weekly. - More specifically, patients with one or more prescriptions for methotrexate recorded on computer within the three months prior to data collection who do not have the term "weekly" or "week" in the dosage instructions field of the latest prescription for the drug.
>
> Credit: Avery AJ, Rodgers S, Cantrill JA, et al. Protocol for the PINCER trial. Trials 2009;10:28. doi:10.1186/1745-6215-10-28; correction Trials 2010;11:23
>
> Text reproduced without changes. Licence as read: CC BY 2.0. Not yet confirmed by you.

**Medicines that count**

- **Group A. Methotrexate:** methotrexate.
  Brands: Methoblastin, Trexject.
  Tablets and injections count.

**The models are told**

Suspect a finding when the directions on the most recent supply of a Group A medicine (methotrexate) do not contain the word 'week' or 'weekly'. Directions such as 'as directed' or 'daily' are a finding, and directions such as 'once a week' or 'weekly on Monday' are not.

**The letter asks the GP**

The intended methotrexate dose and the day of the week it is to be taken, so that the label can state this clearly.

**Cannot be seen in a dispensing history**

What the patient was told and how the patient is really taking the methotrexate, the reason for treatment, the wording on the original prescription, and blood test results.

**Test histories**

- Planted, brand name only: Methoblastin six times. The labels say "Take TWO tablets as directed" and "Take as directed by your specialist". No label has the word week.
- Planted, buried: methotrexate three times in the middle of 14 months. No label has the word week. The latest label (14 July 2026) says "Take ONE tablet daily".
- Near miss, must not flag: methotrexate six times. Every label says "ONCE a WEEK on MONDAY" or "weekly on Mondays".

**Please check** (from a second reading)

1. This is a word test, as published: does the latest label hold "week" or "weekly"? A label that says "every Monday" or "every 7 days" would be reported, although it means weekly. Decide whether that is acceptable.
2. The published measure looks at prescriptions in the three months before the check. The rule given to the models has no time limit. In the buried history the last methotrexate supply is 14 July 2026 and the history runs to 6 October 2026. Decide whether to add a time limit.
3. PINCER was written for the prescribing records of general practices, not for pharmacy labels. The directions in a dispensing history are the words on the pharmacy label. Is a letter to the GP the right first step? Or would you correct the label, and contact the GP only when the prescription itself is unclear?
4. Urgency is same day. This is the only one of the ten. Confirm.
5. Only two brand names are listed: Methoblastin and Trexject. Please confirm Trexject, and add any generic names you stock.
6. The buried history plants "Take ONE tablet daily" on a 10 mg tablet. It is there on purpose, as the dangerous case.

---

## The nine reserves

Each reserve has a drafted criterion file, two planted histories and one near miss. They are already in the proposed answer sheet, so a swap needs no new answers. To use one, name it in your reply.

The reserves are in the order of the pool. On 18 November STOPP M1 and EU7-F14 changed places (R2 and R3), because the list file had them the other way round. No program depends on the order of the reserves.

The buried histories of the reserves follow the same pattern as the ten: the planted supplies stop more than three months before the last line. Question G1 applies to them too.

- **R1. BRISNIK-HR-F2: SSRI or SNRI with two or more of antiplatelet, anticoagulant and NSAID at age 65 or over**
  - Reports an SSRI or SNRI at age 65 or over when medicines from at least two of three kinds are supplied with it: antiplatelet, anticoagulant, NSAID.
  - To check: "two or more" is read as two different kinds, so aspirin with clopidogrel counts as one kind. The article's Additional file 3, which defines the co-prescribed medicines, was not opened.
  - Changed on 18 November: the near miss showed Astrix 100 mg as a capsule in a pack of 112. In the medicines reference on this PC the pack of 112 is the tablet, and the capsule comes in 28 and 84. The four lines now say tablet. The answer does not change: aspirin 100 mg a day is still one antiplatelet only. The rivaroxaban, apixaban and ticagrelor names were added as in numbers 1 and 4, and edoxaban was added with no brand.
- **R2. STOPP M1: Two or more anticholinergic medicines together**
  - Reports two different anticholinergic medicines within 60 days of each other, from six draft groups.
  - To check: the published list is open ("e.g."), so the six groups are the drafting agent's choice. Sedating antihistamines are often bought without a prescription and will be missed. The medicines reference on this PC writes Unisom SleepGels as Unisom Sleepgel.
- **R3. EU7-F14: Glibenclamide or another listed sulfonylurea in an older person**
  - Reports glibenclamide, glipizide or glimepiride at age 65 or over, or when no age is shown. Gliclazide does not count. Chlorpropamide and carbutamide are named but have no brand here.
  - To check: the statement is five table rows joined together. It shows dose advice that the source marks as taken from other references, and the licence note says to take care with that. The number F14 is the project's own.
  - Changed on 18 November: Semi-Daonil, Glucovance and Diavance were added under glibenclamide from the medicines reference on this PC. Glucovance and Diavance also hold metformin. The file said the statement was "published", while its own notice says "Adapted by the entrant". The flag now says "entrant", so the two agree.
  - Decide before any swap to this reserve: keep the joined text of five rows, or cut the statement to the glibenclamide row without the dose advice and have the notice reworded to match. The joined text is 2,088 characters long. It is what the bell panel and the GP letter would show. Four rights points on the dose advice are still open.
- **R4. PINCER 10: Amiodarone at more than 200 mg a day for more than one month**
  - Reports amiodarone supplied for more than one month with directions that give more than 200 mg a day.
  - To check: the source says "at least one month" in one place and "more than one month" in another. The draft uses "more than". A short starting course at a higher dose is normal, and no test history covers it.
  - Added after the reviews: the published text counts amiodarone prescribed for more than one month "in the three months prior to data collection". The rule says "at any time in the history". In the buried history the last amiodarone supply is 13 March 2026 and the history ends on 16 September 2026. So that planted finding meets the rule but not the published time window. Decide: keep "at any time", or add "within three months of the last line of the history" and have the four Aratac supplies moved into the last three months. The rule was left as drafted, so nothing is missed.
  - Added after the reviews: in the two planted histories Cordarone X and Aratac 200 mg are supplied 60 at a time with repeats. The medicines reference on this PC holds only a pack of 30 for both, so each supply is two packs. That is possible but unusual. Leave it if it reads as real to you. Otherwise the supplies become 30 every 15 days with the same directions, and the line numbers in the answer sheet are worked out again.
  - Changed on 18 November: Cardinorm, Rithmik and Amdarone were added under amiodarone from the medicines reference on this PC, as in number 4.
- **R5. PROMPT CN-4: Zolpidem or zopiclone supplied for more than four weeks**
  - Reports zolpidem, zopiclone or zaleplon supplies that together cover more than 28 days.
  - To check: PROMPT was written for people aged 45 to 64, and the test patients are 66 to 73. See question G2. The number CN-4 is the project's own. The published table has no item numbers, and this label is shown in the bell panel and in the letter.
  - Changed on 18 November: the file said zaleplon had no brand. The medicines reference on this PC holds Sonata (zaleplon 5 mg and 10 mg capsules), so Sonata was added. It may no longer be supplied. Keep or strike it. The DOI of the article and its link were added to the file.
- **R6. STOPP C13: Dabigatran with diltiazem or verapamil**
  - Reports dabigatran with diltiazem or verapamil within 60 days of each other.
  - To check: it overlaps number 4. Its buried history (Pradaxa with Isoptin SR) already counts as a planted finding for number 4.
  - Changed on 18 November: Diltahexal was added to the diltiazem list, so the list is the same as in numbers 2 and 5.
- **R7. STOPP C1: Long-term aspirin above 100 mg a day**
  - Reports aspirin at more than 100 mg a day for 3 months or more. The daily dose is worked out from the strength and the directions.
  - To check: the source does not define "long-term". Three months is the draft's choice. Most aspirin is bought without a prescription and will be missed.
- **R8. PROMPT RS-3: Long-term oral corticosteroid without a bisphosphonate**
  - Reports an oral corticosteroid supplied for more than 3 months with no bisphosphonate supplied in that time.
  - To check: PROMPT was written for people aged 45 to 64, and the test patients are 68 to 75. See question G2. The number RS-3 is the project's own. The published table has no item numbers, and this label is shown in the bell panel and in the letter. Denosumab (Prolia) is not a bisphosphonate, so it does not cancel the finding. An infusion given in a clinic cannot be seen.
  - Added after the reviews: Group A lists hydrocortisone (Hysone) and cortisone acetate (Cortate). In the community these tablets are nearly always long-term replacement for adrenal insufficiency, where a bisphosphonate is not expected. Every such patient would be reported. Decide: remove the two from Group A, or keep them. They were kept, so nothing is missed, and a sentence about replacement treatment was added to "cannot be seen". The DOI of the article and its link were added to the file.
- **R9. BRISNIK-HR-A3: Citalopram or escitalopram above the daily limit at age 65 or over**
  - Reports more than 20 mg of citalopram or more than 10 mg of escitalopram a day at age 65 or over.
  - To check: the daily dose is worked out from the tablet strength and the directions. Exactly 20 mg or 10 mg does not count, and the near miss tests this.
  - Changed on 18 November: the brand Loxalate was spelt "LoxaLate" here and "Loxalate" in number 8 and in R1. It is now "Loxalate" in all three, as the medicines reference on this PC spells it.

---

## What changed after the reviews (18 November 2026)

Two reviewers raised 29 points. Each was checked against the files and against the medicines reference on this PC. 11 were corrected. 16 are for you to decide, and for 7 of those the files now hold the more cautious choice until you do. 2 needed no change.

**Corrected (11 points)**

- BRISNIK-HR-F2 near miss: Astrix 100 mg capsule in a pack of 112 is now Astrix 100 mg tablet, on four lines. No line number changed.
- Reserve order: STOPP M1 is second and EU7-F14 third, as in the pool. The list file, the answer sheet and this sheet now agree. Both reviewers raised this.
- Answer sheet: the "about" text of each clean history is now one sentence.
- PROMPT CN-4 and PROMPT RS-3: the DOI of the article and its link were added to the two files. This sheet now says that the item numbers are the project's own.
- An ingredient with no brand is now written the same way in every file, as an empty list: edoxaban, ketoconazole and glycerol.
- Brand lists that did not agree: Naprosyn SR was added to number 8, which plants it in its buried history. Loxalate is spelt one way. Number 8 now names edoxaban and the same rivaroxaban names as number 1.
- EU7-F14: Semi-Daonil, Glucovance and Diavance were added under glibenclamide.
- PROMPT CN-4: Sonata was added under zaleplon.
- The check tool `tools/check-cases.mjs` reads the signed answer sheet and the list in use as soon as the signed sheet exists. It says so when a proposed file is still on disk.
- The same tool held a hidden character in two of its patterns. It is now written out as an escape.

**Changed to the more cautious choice, for you to confirm (7 points)**

- Number 6: Relistor was taken out of the laxative group (point 2).
- Number 5: pyridostigmine (Mestinon) was added to Group A (point 8).
- Amiodarone names were added to number 4 and reserve R4.
- The rivaroxaban and apixaban names were added to numbers 1, 4 and 8 and reserve R1, as one shared list.
- Further names from the medicines reference were added to numbers 2, 3, 4, 5, 6, 8 and 9 and to reserves R1 and R6. Each list is under its "Please check".
- Reserve R3 (EU7-F14): the statement flag now says "entrant".
- Reserve R8 (PROMPT RS-3): hydrocortisone and cortisone acetate were kept, and a sentence was added to "cannot be seen".

**Left as drafted, for you to decide (9 points)**

- Findings that ended months ago: question G1, and a point under each of numbers 1 to 9.
- Age: question G2, and a point under each of numbers 1 to 9.
- Number 8: one ingredient under two brand names (point 9).
- Number 8: two diuretics of different kinds (point 10).
- Number 4: Ranexa (point 6).
- Reserve R4 (PINCER 10): the time window.
- Reserve R4 (PINCER 10): the supplies of 60 tablets.
- Dates on days a pharmacy is often shut: question G4.
- After you sign: the 19 part files that repeat the answers (see "Read once").

**No change needed (2 points)**

- `cases/STOPP-C1/pos-brand.csv` has 29 rows. Every other short history has 30 to 39. No range of rows is written in the specification, the type file or this sheet, so nothing is broken. No row was added, so its line numbers stay as they are.
- The extract files under `criteria/_extract` hold WHO ATC codes in their source notes. ATC is not SNOMED. No SNOMED code and no SNOMED full name is in the criterion files, the histories, the answer sheet or this sheet. The extract files belong to another tool and were not changed.

Question G3, on how long the brand lists should be, came out of checking these points. It is not one of the 29.

---

## Sources and licences

Nine of the ten come from STOPP/START version 3 (O'Mahony and others, European Geriatric Medicine, 2023). One comes from the PINCER trial protocol (Avery and others, Trials, 2009). The reserves add PROMPT (2014), the antidepressant indicators of Brisnik and others (2024) and the EU(7)-PIM list (2015). The licence lines were read on the publishers' own pages on 18 November 2026 and are written up in `docs/SOURCES_AND_LICENCES.md`. Section 8 of that file lists eleven open points for you. As read, all five articles are open access: four under CC BY 4.0 and the PINCER protocol under the older CC BY 2.0. Both licences allow use and changes as long as credit is given and changes are stated. Three points are not settled by the pages. The STOPP criteria sit in a supplementary file (Appendix 1) that carries no licence line of its own. The PROMPT web page does not print its licence sentence, though the PDF does. Most supplementary files were not opened. Two more things to know. The wording of all 19 statements comes from the earlier project's package. Each criterion file matches the text taken from that package, character for character. For STOPP, the package's source note says the text was taken from a copy hosted by NHS Somerset and matched an earlier reading sentence for sentence. In this build the STOPP wording was not compared with the publisher's Appendix 1, and only the label of A3 was checked against it. The credit lines shown in this sheet are the short ones in the criterion files. They do not name the licence. The licence file holds longer draft credit lines that do. Every criterion file still says the licence is "proposed". This is a reading by an AI assistant. It is not legal advice and it is not clearance. You confirm the rights yourself before anything is shown in public.
