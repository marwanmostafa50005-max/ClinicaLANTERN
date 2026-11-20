// A plain list of common medicine names (ingredients and Australian brands), lower case.
// It is used ONLY by the letter fact check, to notice a medicine named in a drafted letter that is
// not in the finding. It is never used to screen a history: the screening is done by the model.
// The list is a net, not a complete register. Names in the history and in the criterion are added
// to it at run time.

const INGREDIENTS = `
warfarin apixaban rivaroxaban dabigatran enoxaparin heparin dalteparin aspirin clopidogrel ticagrelor prasugrel dipyridamole
ibuprofen diclofenac naproxen celecoxib meloxicam indometacin indomethacin piroxicam ketoprofen etoricoxib ketorolac parecoxib
paracetamol codeine oxycodone morphine tramadol tapentadol fentanyl buprenorphine hydromorphone methadone naloxone
pregabalin gabapentin
metformin gliclazide glimepiride glipizide glibenclamide sitagliptin linagliptin saxagliptin vildagliptin alogliptin
empagliflozin dapagliflozin ertugliflozin pioglitazone semaglutide dulaglutide liraglutide exenatide insulin
perindopril ramipril enalapril lisinopril captopril fosinopril quinapril trandolapril
irbesartan candesartan telmisartan valsartan losartan olmesartan eprosartan sacubitril
amlodipine felodipine lercanidipine nifedipine diltiazem verapamil
atenolol metoprolol bisoprolol carvedilol nebivolol propranolol sotalol labetalol
hydrochlorothiazide indapamide chlortalidone chlorthalidone furosemide frusemide bumetanide spironolactone eplerenone amiloride
atorvastatin rosuvastatin simvastatin pravastatin fluvastatin ezetimibe fenofibrate gemfibrozil
digoxin amiodarone flecainide nicorandil ivabradine hydralazine prazosin moxonidine clonidine methyldopa
omeprazole esomeprazole pantoprazole lansoprazole rabeprazole ranitidine famotidine nizatidine
metoclopramide domperidone ondansetron loperamide mesalazine sulfasalazine
amoxicillin amoxycillin flucloxacillin dicloxacillin phenoxymethylpenicillin cefalexin cephalexin cefuroxime cefaclor
doxycycline minocycline erythromycin clarithromycin azithromycin roxithromycin ciprofloxacin norfloxacin moxifloxacin
trimethoprim sulfamethoxazole nitrofurantoin metronidazole clindamycin fluconazole itraconazole ketoconazole terbinafine
valaciclovir aciclovir famciclovir nystatin
sertraline escitalopram citalopram fluoxetine paroxetine fluvoxamine venlafaxine desvenlafaxine duloxetine mirtazapine
amitriptyline nortriptyline dothiepin dosulepin doxepin imipramine clomipramine moclobemide agomelatine vortioxetine bupropion lithium
diazepam temazepam oxazepam lorazepam alprazolam clonazepam nitrazepam zopiclone zolpidem melatonin
quetiapine olanzapine risperidone aripiprazole haloperidol clozapine paliperidone amisulpride ziprasidone chlorpromazine prochlorperazine
donepezil rivastigmine galantamine memantine
levodopa carbidopa benserazide pramipexole ropinirole rotigotine entacapone selegiline rasagiline
carbamazepine valproate lamotrigine levetiracetam phenytoin topiramate oxcarbazepine lacosamide
salbutamol terbutaline salmeterol formoterol eformoterol vilanterol indacaterol tiotropium umeclidinium aclidinium glycopyrronium ipratropium
budesonide fluticasone beclometasone ciclesonide mometasone montelukast theophylline
prednisolone prednisone dexamethasone hydrocortisone methylprednisolone betamethasone
levothyroxine thyroxine carbimazole propylthiouracil
alendronate risedronate denosumab raloxifene calcitriol colecalciferol cholecalciferol
allopurinol febuxostat colchicine methotrexate hydroxychloroquine leflunomide azathioprine ciclosporin tacrolimus mycophenolate
tamsulosin dutasteride finasteride oxybutynin solifenacin mirabegron darifenacin tolterodine sildenafil tadalafil
promethazine cetirizine loratadine fexofenadine desloratadine dexchlorpheniramine doxylamine diphenhydramine cyproheptadine
oestradiol estradiol norethisterone levonorgestrel medroxyprogesterone tamoxifen anastrozole letrozole
baclofen orphenadrine hyoscine benzatropine benztropine trihexyphenidyl sumatriptan rizatriptan pizotifen
naltrexone varenicline disulfiram acamprosate methylphenidate dexamfetamine lisdexamfetamine atomoxetine
`;

const BRANDS = `
coumadin marevan eliquis xarelto pradaxa clexane plavix brilinta cartia astrix
nurofen brufen advil voltaren fenac naprosyn naprogesic anaprox celebrex mobic movalis indocid feldene orudis ponstan arcoxia
panadol panamax panadeine endone oxycontin oxynorm targin tramal palexia durogesic norspan lyrica neurontin
diabex diaformin glucophage diamicron januvia janumet trajenta jardiance forxiga ozempic trulicity lantus novorapid
coversyl tritace renitec zestril avapro karvea atacand micardis diovan cozaar olmetec entresto
norvasc plendil zanidip adalat cardizem isoptin tenormin betaloc minax toprol bicor dilatrend nebilet inderal sotacor
lasix urex aldactone inspra natrilix lipitor crestor zocor lipex pravachol ezetrol lipidil
lanoxin cordarone tambocor imdur duride monodur anginine nitrolingual ikorel minipress physiotens catapres
losec nexium somac zoton pariet zantac maxolon motilium zofran imodium
amoxil augmentin keflex ibilex doryx vibramycin klacid zithromax rulide ciproxin noroxin bactrim resprim macrodantin flagyl dalacin
diflucan sporanox nizoral lamisil valtrex zovirax famvir
zoloft lexapro cipramil prozac lovan aropax luvox efexor pristiq cymbalta avanza remeron endep allegron tofranil anafranil
aurorix valdoxan brintellix zyban lithicarb quilonum
valium antenex normison temaze serepax murelax ativan xanax kalma rivotril paxam mogadon imovane stilnox circadin
seroquel zyprexa risperdal abilify serenace clozaril invega solian largactil stemetil
aricept exelon reminyl ebixa sinemet madopar sifrol tegretol epilim lamictal keppra dilantin topamax trileptal
ventolin asmol bricanyl serevent seretide symbicort oxis breo spiriva atrovent pulmicort flixotide qvar alvesco singulair nuelin
panafcortelone solone predsone panafcort eutroxsig oroxine eltroxin
fosamax actonel aclasta prolia evista zyloprim progout adenuric colgout methoblastin plaquenil arava imuran
flomaxtra avodart duodart proscar ditropan vesicare betmiga viagra cialis
phenergan zyrtec claratyne telfast aerius polaramine restavit periactin
`;

const PHRASES = [
  'mefenamic acid', 'clavulanic acid', 'zoledronic acid', 'sodium valproate', 'isosorbide mononitrate',
  'glyceryl trinitrate', 'potassium chloride', 'panadol osteo', 'panadeine forte', 'diabex xr', 'neo-mercazole',
  'slow-k', 'span-k', 'duro-k'
];

/** Common medicine names, lower case, longest first. */
export const MEDICINE_NAMES: string[] = [
  ...new Set([...INGREDIENTS.split(/\s+/), ...BRANDS.split(/\s+/), ...PHRASES].filter(Boolean))
].sort((a, b) => b.length - a.length);

// Word endings that mark a medicine name (international name stems). Each needs letters before it.
const STEMS = [
  'pril', 'sartan', 'statin', 'olol', 'dipine', 'prazole', 'tidine', 'oxacin', 'mycin', 'cillin', 'cycline',
  'conazole', 'nidazole', 'ciclovir', 'navir', 'buvir', 'tegravir', 'mab', 'tinib', 'ciclib', 'coxib', 'profen',
  'xaban', 'gatran', 'parin', 'gliptin', 'gliflozin', 'glutide', 'glitazone', 'azepam', 'zolam', 'triptan',
  'setron', 'oxetine', 'triptyline', 'ipramine', 'apine', 'peridone', 'dronate', 'caine', 'thiazide', 'semide',
  'tropium', 'afil', 'lukast', 'fenac', 'oxicam', 'codone', 'morphone', 'orphine', 'methasone', 'solone',
  'sonide', 'bactam', 'penem', 'trexate', 'grel', 'pezil', 'pamil', 'tiazem', 'darone', 'formin', 'phylline',
  'steride', 'zosin', 'losin', 'tadine', 'rizine', 'pramide', 'barbital', 'gabalin', 'trigine', 'racetam',
  'zepine', 'terol', 'lamide', 'vastatin', 'floxacin'
];

// Ordinary words that happen to end like a medicine name.
const NOT_MEDICINES = new Set(['cholesterol', 'sterol', 'april', 'cocaine', 'mongrel']);

const STEM_PATTERN = new RegExp(`^[a-z]{3,}(?:${STEMS.join('|')})$`);

/** True when a single lower-case word looks like a medicine name by its ending. */
export function looksLikeMedicineName(word: string): boolean {
  return word.length >= 7 && !NOT_MEDICINES.has(word) && STEM_PATTERN.test(word);
}
