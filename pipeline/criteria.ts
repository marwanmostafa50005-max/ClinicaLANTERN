// Loads the criteria in use and builds the criterion block that goes into the prompts.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActiveCriteria, Criterion, FactOption, MedicineGroup, NeededFact } from '../shared/types.ts';
import { FACT_WORDS, tidyFact } from '../shared/facts.ts';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

async function readJson(file: string): Promise<unknown> {
  const text = await fs.readFile(file, 'utf8');
  return JSON.parse(text.replace(/^\uFEFF/, ''));
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function textOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function namesOf(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map(x => x.trim()) : [];
}

/**
 * The facts a criterion needs beside the supplies (docs/SPEC.md section 6a). The field is optional.
 * When it is there its shape is checked strictly: a slip would make a criterion screen without a
 * fact it depends on, and nobody would know.
 */
function readOptions(raw: unknown, where: string): FactOption[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`${where}: "options" must be a list.`);
  return raw.map((entry: unknown, index: number) => {
    const place = `${where}, option ${index + 1}`;
    if (!isObj(entry)) throw new Error(`${place} is not an object.`);
    const words = textOf(entry.words);
    if (!words) throw new Error(`${place}: "words" is missing.`);
    const effect = textOf(entry.effect);
    if (effect !== 'meets' && effect !== 'does_not_meet' && effect !== 'unknown') {
      throw new Error(`${place}: "effect" must be meets, does_not_meet or unknown.`);
    }
    return { words, effect };
  });
}

function readAskWhen(raw: unknown, where: string, groups: MedicineGroup[]): NeededFact['ask_when'] {
  if (raw === undefined || raw === null) return undefined;
  if (raw === 'always') return 'always';
  if (!isObj(raw) || !textOf(raw.group)) {
    throw new Error(`${where}: "ask_when" must be "always" or an object with "group".`);
  }
  const group = textOf(raw.group);
  if (!groups.some(item => item.key === group)) {
    throw new Error(`${where}: "ask_when" names group ${group}, and this criterion has no medicine group with that key.`);
  }
  return { group };
}

/**
 * The optional supply count. Absent, null, or not in the file: the criterion is unchanged.
 * Present: the shape is checked strictly, so a count is never run on a group this criterion does not have.
 */
function readCountSupplies(raw: unknown, id: string, groups: MedicineGroup[]): Criterion['count_supplies'] {
  if (raw === undefined || raw === null) return undefined;
  const where = `Criterion ${id}: "count_supplies"`;
  if (!isObj(raw)) throw new Error(`${where} must be an object with "group", "months" and "window".`);
  const group = textOf(raw.group);
  if (!group) throw new Error(`${where} must name a medicine group.`);
  if (!groups.some(item => item.key === group)) {
    throw new Error(`${where} names group ${group}, and this criterion has no medicine group with that key.`);
  }
  const months = raw.months;
  if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 120) {
    throw new Error(`${where} "months" must be a whole number from 1 to 120.`);
  }
  if (raw.window !== 'any' && raw.window !== 'last') {
    throw new Error(`${where} "window" must be "any" or "last".`);
  }
  const count: NonNullable<Criterion['count_supplies']> = { group, months, window: raw.window };
  if (raw.form_has !== undefined && raw.form_has !== null) {
    if (!Array.isArray(raw.form_has) || raw.form_has.some(item => typeof item !== 'string' || item.trim() === '')) {
      throw new Error(`${where} "form_has" must be a list of words.`);
    }
    const words = raw.form_has.map(item => item.trim()).filter(word => word !== '');
    if (words.length > 0) count.form_has = words;
  }
  if (raw.packs !== undefined && raw.packs !== null) {
    if (!Array.isArray(raw.packs)) throw new Error(`${where} "packs" must be a list of pack rules.`);
    const packs: NonNullable<NonNullable<Criterion['count_supplies']>['packs']> = [];
    for (const rule of raw.packs) {
      if (!isObj(rule)) throw new Error(`${where} a pack rule must be an object with "form_has" and "per".`);
      const word = textOf(rule.form_has);
      if (!word) throw new Error(`${where} a pack rule must name a word in "form_has".`);
      const per = rule.per;
      if (typeof per !== 'number' || !Number.isInteger(per) || per < 1) {
        throw new Error(`${where} a pack rule "per" must be a whole number of 1 or more.`);
      }
      packs.push({ form_has: word, per });
    }
    if (packs.length > 0) count.packs = packs;
  }
  return count;
}

function readCloseWhen(raw: unknown, where: string, groups: MedicineGroup[]): NeededFact['close_when'] {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw) || !textOf(raw.group)) {
    throw new Error(`${where}: "close_when" must be an object with "group".`);
  }
  const group = textOf(raw.group);
  if (!groups.some(item => item.key === group)) {
    throw new Error(`${where}: "close_when" names group ${group}, and this criterion has no medicine group with that key.`);
  }
  const close: NonNullable<NeededFact['close_when']> = { group };
  if (raw.months !== undefined && raw.months !== null) {
    const months = raw.months;
    if (typeof months !== 'number' || !Number.isInteger(months) || months < 1 || months > 120) {
      throw new Error(`${where}: "close_when" "months" must be a whole number from 1 to 120.`);
    }
    close.months = months;
  }
  return close;
}

/** A standing question is withheld for sex only when the criterion says so. Any other value is refused. */
function readOnlySex(raw: unknown, id: string): Criterion['only_sex'] {
  if (raw === undefined || raw === null) return undefined;
  const value = textOf(raw);
  if (value === 'female' || value === 'male') return value;
  throw new Error(`Criterion ${id}: "only_sex" must be "female" or "male".`);
}

function readNeededFacts(raw: unknown, id: string, groups: MedicineGroup[]): NeededFact[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error(`Criterion ${id}: "needs_facts" must be a list of facts.`);
  return raw.map((entry: unknown, index: number) => {
    const where = `Criterion ${id}, needed fact ${index + 1}`;
    if (!isObj(entry)) throw new Error(`${where} is not an object.`);
    const kind = textOf(entry.kind).toLowerCase();
    if (kind !== 'condition' && kind !== 'result' && kind !== 'observation') {
      throw new Error(`${where}: "kind" must be condition, result or observation.`);
    }
    const what = textOf(entry.what);
    if (!what) throw new Error(`${where}: "what" is missing.`);
    const meets = textOf(entry.meets);
    if (!meets) throw new Error(`${where}: "meets" is missing.`);
    const fact: NeededFact = { kind, what, meets };
    const options = readOptions(entry.options, where);
    if (options.length > 0) fact.options = options;
    const ask = readAskWhen(entry.ask_when, where, groups);
    if (ask) fact.ask_when = ask;
    const close = readCloseWhen(entry.close_when, where, groups);
    if (close) fact.close_when = close;
    return fact;
  });
}

/** True when the criterion needs a fact that a dispensing history does not hold. */
export function needsFacts(criterion: Criterion): boolean {
  return (criterion.needs_facts?.length ?? 0) > 0;
}

/** Checks one criterion file and fills the gaps a prompt can live with. Throws when a part the models need is missing. */
export function readCriterion(raw: unknown, id: string): Criterion {
  if (!isObj(raw)) throw new Error(`Criterion ${id}: the file is not a JSON object.`);
  const label = textOf(raw.label);
  const statement = textOf(raw.statement);
  const rule = textOf(raw.rule_for_models);
  if (!label) throw new Error(`Criterion ${id}: "label" is missing.`);
  if (!statement) throw new Error(`Criterion ${id}: "statement" is missing.`);
  if (!rule) throw new Error(`Criterion ${id}: "rule_for_models" is missing.`);
  // The medicine list is what the models screen with. A slip in its shape is refused here, in plain
  // words, so that a criterion is never screened with an empty list without anyone knowing.
  const listed = raw.medicine_groups;
  if (listed !== undefined && listed !== null && !Array.isArray(listed)) {
    throw new Error(`Criterion ${id}: "medicine_groups" must be a list of groups.`);
  }
  const groups: MedicineGroup[] = (Array.isArray(listed) ? listed : []).map((g: unknown, index: number) => {
    const fallbackKey = String.fromCharCode(65 + index);
    if (!isObj(g)) throw new Error(`Criterion ${id}: medicine group ${fallbackKey} is not an object.`);
    const key = textOf(g.key) || fallbackKey;
    const where = `Criterion ${id}, medicine group ${key}`;
    const isNameList = (v: unknown): boolean => Array.isArray(v) && v.every(x => typeof x === 'string');
    if (g.ingredients !== undefined && !isNameList(g.ingredients)) {
      throw new Error(`${where}: "ingredients" must be a list of names.`);
    }
    if (g.brands !== undefined && (!isObj(g.brands) || !Object.values(g.brands).every(isNameList))) {
      throw new Error(`${where}: "brands" must give a list of brand names for each ingredient.`);
    }
    const brands: Record<string, string[]> = {};
    if (isObj(g.brands)) {
      for (const [ingredient, list] of Object.entries(g.brands)) brands[ingredient] = namesOf(list);
    }
    const group: MedicineGroup = {
      key,
      name: textOf(g.name),
      ingredients: namesOf(g.ingredients),
      brands
    };
    if (group.ingredients.length === 0 && Object.values(brands).every(list => list.length === 0)) {
      throw new Error(`${where}: it names no medicine. Give at least one ingredient or one brand.`);
    }
    const note = textOf(g.note);
    if (note) group.note = note;
    return group;
  });
  const source = isObj(raw.source) ? raw.source : {};
  const signed = isObj(raw.signed_by_clinical_reviewer)
    ? { name: textOf(raw.signed_by_clinical_reviewer.name), date: textOf(raw.signed_by_clinical_reviewer.date) }
    : null;
  const criterion: Criterion = {
    id: textOf(raw.id) || id,
    label,
    family: textOf(raw.family),
    title: textOf(raw.title) || label,
    statement,
    statement_origin: raw.statement_origin === 'published' ? 'published' : 'entrant',
    source: {
      document: textOf(source.document),
      citation: textOf(source.citation),
      licence: textOf(source.licence),
      licence_status: source.licence_status === 'confirmed_by_founder' ? 'confirmed_by_founder' : 'proposed',
      credit: textOf(source.credit)
    },
    plain_summary: textOf(raw.plain_summary),
    medicine_groups: groups,
    rule_for_models: rule,
    cannot_be_seen: textOf(raw.cannot_be_seen),
    ask_the_gp: textOf(raw.ask_the_gp),
    urgency: raw.urgency === 'same_day' ? 'same_day' : 'routine',
    draft: raw.draft !== false,
    signed_by_clinical_reviewer: signed
  };
  const doi = textOf(source.doi);
  if (doi) criterion.source.doi = doi;
  const url = textOf(source.url);
  if (url) criterion.source.url = url;
  const notice = textOf(source.modification_notice);
  if (notice) criterion.source.modification_notice = notice;
  const facts = readNeededFacts(raw.needs_facts, id, groups);
  if (facts.length > 0) criterion.needs_facts = facts;
  const count = readCountSupplies(raw.count_supplies, id, groups);
  if (count) criterion.count_supplies = count;
  const onlySex = readOnlySex(raw.only_sex, id);
  if (onlySex) criterion.only_sex = onlySex;
  return criterion;
}

/**
 * The IDs in criteria/active.json, or in another list file when one is named.
 * "active" holds the first ten. "further", when the file has it, holds the criteria in use after them.
 */
export async function loadActiveList(repoRoot: string, activeFile?: string): Promise<ActiveCriteria> {
  const file = activeFile ?? path.join(repoRoot, 'criteria', 'active.json');
  let raw: unknown;
  try {
    raw = await readJson(file);
  } catch (e) {
    throw new Error(`The list of criteria could not be read (${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isObj(raw) || !Array.isArray(raw.active)) throw new Error(`The list of criteria has no "active" list (${file}).`);
  const list: ActiveCriteria = { active: namesOf(raw.active), reserves: namesOf(raw.reserves) };
  if (raw.further !== undefined && raw.further !== null) {
    if (!Array.isArray(raw.further)) throw new Error(`The "further" entry in the list of criteria is not a list (${file}).`);
    list.further = namesOf(raw.further);
  }
  return list;
}

/** A criterion file that did not load, by name, with the reason in plain words. */
export interface CriterionProblem { id: string; error: string }

export interface CriteriaLoad {
  criteria: Criterion[];              // the criteria that loaded, in the order of the list
  ids: string[];                      // every name in the list, in order, each once
  problems: CriterionProblem[];       // the files that did not load; the others still load
  /** The first ten, in list order, including one whose file did not load. A loaded criterion not in this list is further. */
  activeIds: string[];
}

/** Reads <folder>/<ID>/criterion.json for each ID, in order, each ID once. A file that does not load is reported by name and the others still load. */
async function readCriterionFiles(folder: string, ids: string[]): Promise<CriteriaLoad> {
  const load: CriteriaLoad = { criteria: [], ids: [], problems: [], activeIds: [] };
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    load.ids.push(id);
    try {
      if (!SAFE_ID.test(id)) throw new Error(`The criterion name "${id}" in the list is not a valid folder name.`);
      const file = path.join(folder, id, 'criterion.json');
      let raw: unknown;
      try {
        raw = await readJson(file);
      } catch (e) {
        throw new Error(`Criterion ${id} could not be read (${file}): ${e instanceof Error ? e.message : String(e)}`);
      }
      const criterion = readCriterion(raw, id);
      criterion.id = id;              // the folder name is the ID
      load.criteria.push(criterion);
    } catch (e) {
      load.problems.push({ id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return load;
}

/**
 * The criteria in use with a report: the first ten (active) first, then the further ones, in the
 * order of the list, with no name twice. A criterion file that does not load is named in
 * "problems" and the others still load. Throws only when the list itself cannot be read.
 */
export async function loadCriteriaReport(repoRoot: string, activeFile?: string): Promise<CriteriaLoad> {
  const list = await loadActiveList(repoRoot, activeFile);
  const activeIds: string[] = [];
  const seen = new Set<string>();
  for (const id of list.active) {
    if (seen.has(id)) continue;
    seen.add(id);
    activeIds.push(id);
  }
  const further: string[] = [];
  for (const id of list.further ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    further.push(id);
  }
  const load = await readCriterionFiles(path.join(repoRoot, 'criteria'), [...activeIds, ...further]);
  load.activeIds = activeIds;
  return load;
}

function settle(load: CriteriaLoad, onProblem?: (problem: CriterionProblem) => void): Criterion[] {
  // When nothing loaded there is nothing to screen with: that stops the caller, with the reason.
  if (load.criteria.length === 0 && load.problems.length > 0) throw new Error(load.problems[0].error);
  for (const problem of load.problems) onProblem?.(problem);
  return load.criteria;
}

/**
 * The criteria in use, in order: the first ten (active), then the further ones when the list has
 * them. No name comes twice. An ID in both lists counts once, with the ten.
 * A missing or broken file among the ten stops the caller with a plain message: the ten do not
 * start without their files. A further criterion whose file is missing or broken is left out and
 * named through onProblem. It never stops the ten. Throws when the list itself cannot be read,
 * or when no criterion of the list loads.
 */
export async function loadCriteria(
  repoRoot: string, activeFile?: string, onProblem?: (problem: CriterionProblem) => void
): Promise<Criterion[]> {
  const load = await loadCriteriaReport(repoRoot, activeFile);
  const active = new Set(load.activeIds);
  const tenProblem = load.problems.find(problem => active.has(problem.id));
  if (tenProblem) throw new Error(tenProblem.error);
  return settle(load, onProblem);
}

/**
 * Criteria from any folder that holds <ID>/criterion.json, for example the "criteria" folder of a
 * drafted wave. They need not be in the repository or in its list. The rules are the same as for
 * loadCriteria: in the order given, no name twice, a file that does not load is reported by name
 * through onProblem and the others still load, and it throws when none loads.
 */
export async function loadCriteriaFrom(
  folder: string, ids: string[], onProblem?: (problem: CriterionProblem) => void
): Promise<Criterion[]> {
  return settle(await readCriterionFiles(folder, ids), onProblem);
}

/** The same as loadCriteriaFrom, with the report: what loaded, every name asked for, and what did not load. */
export function loadCriteriaFromReport(folder: string, ids: string[]): Promise<CriteriaLoad> {
  return readCriterionFiles(folder, ids);
}

function groupLine(group: MedicineGroup): string {
  const names = group.ingredients.map(ingredient => {
    const brands = group.brands[ingredient] ?? [];
    return brands.length > 0 ? `${ingredient} (${brands.join(', ')})` : ingredient;
  });
  // Brands listed under an ingredient that is not in the ingredient list are still shown.
  for (const [ingredient, brands] of Object.entries(group.brands)) {
    if (!group.ingredients.includes(ingredient) && brands.length > 0) names.push(`${ingredient} (${brands.join(', ')})`);
  }
  const title = group.name ? `Group ${group.key} (${group.name})` : `Group ${group.key}`;
  const note = group.note ? ` Note: ${group.note}` : '';
  return `${title}: ${names.join(', ')}${note}`;
}

function oneSentence(text: string): string {
  const t = tidyFact(text);
  return t ? `${t}.` : '';
}

/** One needed fact as the models read it: "Fact 1 (RESULT line): eGFR. Meets the criterion when: below 30 mL/min/1.73 m2." */
function factLine(fact: NeededFact, index: number): string {
  return `Fact ${index + 1} (${FACT_WORDS[fact.kind]} line): ${oneSentence(fact.what)} Meets the criterion when: ${oneSentence(fact.meets)}`;
}

/**
 * The criterion as the models read it: label, statement, the medicines that count by group with
 * brands, and the rule. A criterion that needs facts (docs/SPEC.md section 6a) also lists them,
 * under "FACTS THIS CRITERION NEEDS". A criterion without them reads exactly as before.
 */
export function criterionBlock(criterion: Criterion): string {
  const medicines = criterion.medicine_groups.length > 0
    ? criterion.medicine_groups.map(groupLine).join('\n')
    : 'No fixed list. Use the criterion and the rule.';
  const facts = needsFacts(criterion)
    ? `FACTS THIS CRITERION NEEDS\n${(criterion.needs_facts ?? []).map(factLine).join('\n')}\n\n`
    : '';
  return `CRITERION ${criterion.label}\n${criterion.statement}\n\n` +
    `MEDICINES THAT COUNT\n${medicines}\n\n` +
    facts +
    `RULE\n${criterion.rule_for_models}`;
}

/** Every ingredient and brand name the criterion lists, lower case, longest first. */
export function criterionMedicineNames(criterion: Criterion): string[] {
  const names = new Set<string>();
  for (const group of criterion.medicine_groups) {
    for (const ingredient of group.ingredients) names.add(ingredient.toLowerCase());
    for (const [ingredient, brands] of Object.entries(group.brands)) {
      names.add(ingredient.toLowerCase());
      for (const brand of brands) names.add(brand.toLowerCase());
    }
  }
  return [...names].filter(Boolean).sort((a, b) => b.length - a.length);
}

/** All the criterion wording a letter may quote facts from. */
export function criterionAllowedText(criterion: Criterion): string {
  const groups = criterion.medicine_groups.map(g =>
    [g.name, g.note ?? '', g.ingredients.join(', '), Object.values(g.brands).flat().join(', ')].join('\n'));
  // The facts the criterion needs are criterion wording too: a letter may name them and their limits.
  const facts = (criterion.needs_facts ?? []).map(f => `${f.what}\n${f.meets}`);
  return [
    criterion.label, criterion.title, criterion.statement, criterion.plain_summary,
    criterion.rule_for_models, criterion.cannot_be_seen, criterion.ask_the_gp,
    criterion.source.credit, ...groups, ...facts
  ].join('\n');
}
