import { describe, expect, it } from 'vitest';
import { looksLikeMedicineName, MEDICINE_NAMES } from './medicine-names.ts';

describe('MEDICINE_NAMES', () => {
  it('is a list of lower-case names, longest first, with no blanks and no repeats', () => {
    expect(MEDICINE_NAMES.length).toBeGreaterThan(100);
    expect(new Set(MEDICINE_NAMES).size).toBe(MEDICINE_NAMES.length);
    for (const name of MEDICINE_NAMES) {
      expect(name).toBe(name.toLowerCase());
      expect(name.trim()).toBe(name);
      expect(name.length).toBeGreaterThan(0);
    }
    for (let i = 1; i < MEDICINE_NAMES.length; i++) {
      expect(MEDICINE_NAMES[i - 1]!.length).toBeGreaterThanOrEqual(MEDICINE_NAMES[i]!.length);
    }
  });

  it('holds ingredients, Australian brands, and names of more than one word', () => {
    expect(MEDICINE_NAMES).toEqual(expect.arrayContaining([
      'warfarin', 'lipitor', 'mefenamic acid', 'panadeine forte', 'panadol osteo', 'neo-mercazole', 'slow-k'
    ]));
    const forte = MEDICINE_NAMES.indexOf('panadeine forte');
    const panadeine = MEDICINE_NAMES.indexOf('panadeine');
    expect(forte).toBeGreaterThanOrEqual(0);
    expect(panadeine).toBeGreaterThan(forte);
  });
});

describe('looksLikeMedicineName', () => {
  it('accepts a long lower-case word that ends like a medicine, and refuses ordinary words', () => {
    expect(looksLikeMedicineName('abcpril')).toBe(true);
    expect(looksLikeMedicineName('abceterol')).toBe(true);
    expect(looksLikeMedicineName('somestatin')).toBe(true);
    expect(looksLikeMedicineName('cholesterol')).toBe(false);
    expect(looksLikeMedicineName('april')).toBe(false);
    expect(looksLikeMedicineName('cocaine')).toBe(false);
    expect(looksLikeMedicineName('mongrel')).toBe(false);
    expect(looksLikeMedicineName('sterol')).toBe(false);
    expect(looksLikeMedicineName('Abcpril')).toBe(false);
    expect(looksLikeMedicineName('abpril')).toBe(false);
    expect(looksLikeMedicineName('')).toBe(false);
    expect(looksLikeMedicineName('neo-mercazole')).toBe(false);
  });

  it('accepts a made-up word for every medicine ending, and refuses a digit or a space', () => {
    const endings = [
      'pril', 'sartan', 'statin', 'olol', 'dipine', 'prazole', 'tidine', 'oxacin', 'mycin', 'cillin',
      'cycline', 'conazole', 'nidazole', 'ciclovir', 'navir', 'buvir', 'tegravir', 'mab', 'tinib', 'ciclib',
      'coxib', 'profen', 'xaban', 'gatran', 'parin', 'gliptin', 'gliflozin', 'glutide', 'glitazone', 'azepam',
      'zolam', 'triptan', 'setron', 'oxetine', 'triptyline', 'ipramine', 'apine', 'peridone', 'dronate', 'caine',
      'thiazide', 'semide', 'tropium', 'afil', 'lukast', 'fenac', 'oxicam', 'codone', 'morphone', 'orphine',
      'methasone', 'solone', 'sonide', 'bactam', 'penem', 'trexate', 'grel', 'pezil', 'pamil', 'tiazem',
      'darone', 'formin', 'phylline', 'steride', 'zosin', 'losin', 'tadine', 'rizine', 'pramide', 'barbital',
      'gabalin', 'trigine', 'racetam', 'zepine', 'terol', 'lamide', 'vastatin', 'floxacin'
    ];
    for (const ending of endings) {
      const word = `abcd${ending}`;
      expect(looksLikeMedicineName(word), word).toBe(true);
    }
    expect(looksLikeMedicineName('abcd1pril')).toBe(false);
    expect(looksLikeMedicineName('abcd pril')).toBe(false);
  });

  it('does not treat every listed name as a stem, and refuses a letter after the ending', () => {
    expect(MEDICINE_NAMES).toContain('warfarin');
    expect(looksLikeMedicineName('warfarin')).toBe(false);
    expect(looksLikeMedicineName('metformin')).toBe(true);
    expect(looksLikeMedicineName('abcprilx')).toBe(false);
    expect(looksLikeMedicineName('abcpril ')).toBe(false);
  });

  it('lists the longest ingredient first, and that name still matches an ending', () => {
    expect(MEDICINE_NAMES[0]).toBe('phenoxymethylpenicillin');
    expect(MEDICINE_NAMES).toEqual(expect.arrayContaining([
      'isosorbide mononitrate', 'glyceryl trinitrate', 'potassium chloride', 'sodium valproate',
      'diabex xr', 'span-k', 'duro-k'
    ]));
    expect(looksLikeMedicineName('phenoxymethylpenicillin')).toBe(true);
    expect(looksLikeMedicineName('PHENOXYMETHYLPENICILLIN')).toBe(false);
  });

  it('needs three letters before the ending, and a shorter ending inside a longer one still counts', () => {
    expect(looksLikeMedicineName('vastatin')).toBe(false);
    expect(looksLikeMedicineName('floxacin')).toBe(false);
    expect(looksLikeMedicineName('gliflozin')).toBe(false);
    expect(looksLikeMedicineName('xvastatin')).toBe(true);
    expect(looksLikeMedicineName('abvastatin')).toBe(true);
    expect(looksLikeMedicineName('abcprilstatin')).toBe(true);
    expect(looksLikeMedicineName('abcmab')).toBe(false);
    expect(looksLikeMedicineName('abcdmab')).toBe(true);
    expect(looksLikeMedicineName('abc-pril')).toBe(false);
    expect(looksLikeMedicineName('1bcpril')).toBe(false);
  });

  it('keeps both spellings, and a longer word that ends in april still counts', () => {
    expect(MEDICINE_NAMES).toEqual(expect.arrayContaining([
      'indometacin', 'indomethacin', 'amoxicillin', 'amoxycillin',
      'frusemide', 'furosemide', 'chlortalidone', 'chlorthalidone',
      'formoterol', 'eformoterol', 'xarelto', 'celebrex'
    ]));
    expect(looksLikeMedicineName('xxapril')).toBe(true);
    expect(looksLikeMedicineName('abcpril\n')).toBe(false);
    expect(looksLikeMedicineName('abcpril.')).toBe(false);
  });

  it('accepts three letters before a short ending, and refuses a longer ending that leaves fewer', () => {
    expect(looksLikeMedicineName('abcgrel')).toBe(true);
    expect(looksLikeMedicineName('abccycline')).toBe(true);
    expect(looksLikeMedicineName('abcycline')).toBe(false);
    expect(looksLikeMedicineName('abcaine')).toBe(false);
    expect(looksLikeMedicineName('abccaine')).toBe(true);
  });

  it('counts an ending only at the end, and refuses a mark that is not a plain letter', () => {
    expect(looksLikeMedicineName('abcdpril')).toBe(true);
    expect(looksLikeMedicineName('prilabcd')).toBe(false);
    expect(looksLikeMedicineName('statinabc')).toBe(false);
    expect(looksLikeMedicineName('abcmycin')).toBe(true);
    expect(looksLikeMedicineName('abmycin')).toBe(false);
    expect(looksLikeMedicineName('abçpril')).toBe(false);
    expect(looksLikeMedicineName('abcprilé')).toBe(false);
    expect(looksLikeMedicineName('  abcpril')).toBe(false);
    expect(looksLikeMedicineName('abcpril\t')).toBe(false);
    expect(MEDICINE_NAMES).toEqual(expect.arrayContaining(['qvar', 'breo', 'oxis']));
    expect(looksLikeMedicineName('qvar')).toBe(false);
  });

  it('needs three letters before mycin, and a listed name with no ending is not a stem', () => {
    expect(looksLikeMedicineName('xxmycin')).toBe(false);
    expect(looksLikeMedicineName('xxamycin')).toBe(true);
    expect(looksLikeMedicineName('xxfloxacin')).toBe(true);
    expect(MEDICINE_NAMES).toContain('glycopyrronium');
    expect(looksLikeMedicineName('glycopyrronium')).toBe(false);
    expect(looksLikeMedicineName('MONGREL')).toBe(false);
  });
});
