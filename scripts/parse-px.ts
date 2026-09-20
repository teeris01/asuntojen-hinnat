/**
 * PX-tiedostojen parseri (Tilastokeskus StatFin).
 *
 * - Muuttujien rooli luetaan VARIABLE-TYPE-kentästä (Time / Contents / Classificatory),
 *   ei nimestä. Nimet ja koodit tulevat aina tiedoston metadatasta.
 * - Salattu/puuttuva arvo ("." ".." "..." jne.) muunnetaan nulliksi.
 * - Ennakkotieto: tähti riisutaan koodista, lippu säilytetään.
 */

export interface PxValue {
  code: string;
  label: string;
  /** Ennakkotieto: tähti joko koodissa tai selitteessä */
  preliminary: boolean;
}

export type PxVariableType = 'Time' | 'Contents' | 'Classificatory' | 'Unknown';

export interface PxVariable {
  /** Muuttujan nimi (suomeksi), esim. "Alue" */
  name: string;
  /** Muuttujakoodi, esim. "alue_43_20260625" / "timeperiod_q" / "contentscode" */
  variableCode: string;
  type: PxVariableType;
  values: PxValue[];
  /** Arvokoodi -> indeksi */
  index: Map<string, number>;
  /** ELIMINATION-arvo eli muuttujan "yhteensä"-luokka, jos taulukko määrittelee sen */
  total?: PxValue;
}

export interface PxTable {
  id: string;
  title: string;
  description: string;
  /** Tiedoston CREATION-DATE */
  created: string;
  /** Muuttujat siinä järjestyksessä kuin data on tiedostossa (viimeinen vaihtuu nopeimmin) */
  variables: PxVariable[];
  /** Tietoarvon (Tiedot-muuttujan arvo) selite -> yksikkö */
  units: Map<string, string>;
  /** Muuttujakohtaiset huomautukset, avaimena muuttujan nimi */
  notes: Map<string, string>;
  data: (number | null)[];
  /** Puuttuvien arvojen symbolit ja lukumäärät (diagnostiikkaan) */
  missingSymbols: Map<string, number>;
  variable(name: string): PxVariable;
  variableByType(type: PxVariableType): PxVariable[];
  /** Hae arvo koodeilla. Puuttuva muuttuja tai koodi heittää virheen. */
  get(selection: Record<string, string>): number | null;
}

type Entries = Map<string, string[]>;

/** Jaa merkkijono pilkuilla lainausmerkkien ulkopuolelta, poista lainausmerkit. */
export function splitList(raw: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  let sawQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') {
      // "" lainausmerkin sisällä = lainausmerkki
      if (inQuote && raw[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
        sawQuote = true;
      }
    } else if (ch === ',' && !inQuote) {
      out.push(sawQuote ? cur : cur.trim());
      cur = '';
      sawQuote = false;
    } else if (inQuote || !/[\r\n]/.test(ch)) {
      cur += ch;
    }
  }
  if (cur !== '' || sawQuote) out.push(sawQuote ? cur : cur.trim());
  return out;
}

/** Pilko otsikko lauseiksi (päättyvät ;-merkkiin lainausmerkkien ulkopuolella). */
function splitStatements(header: string): string[] {
  const out: string[] = [];
  let start = 0;
  let inQuote = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ';' && !inQuote) {
      out.push(header.slice(start, i));
      start = i + 1;
    }
  }
  return out;
}

/**
 * Lue metadata Map:iin. Avain on "KEYWORD" tai "KEYWORD|sub1|sub2".
 * Vain oletuskieli (ei [sv]/[en]-päätteisiä) otetaan mukaan.
 */
function parseHeader(header: string): Entries {
  const entries: Entries = new Map();
  for (const stmt of splitStatements(header)) {
    const s = stmt.replace(/^﻿/, '').replace(/^\s+/, '');
    if (!s) continue;
    const eq = s.indexOf('=');
    if (eq < 0) continue;
    const lhs = s.slice(0, eq).trim();
    const rhs = s.slice(eq + 1);
    const m = /^([A-Z0-9-]+)(?:\[(\w+)\])?(?:\((.*)\))?$/.exec(lhs);
    if (!m) continue;
    const [, keyword, lang, subs] = m;
    if (lang) continue;
    const key = subs ? [keyword, ...splitList(subs)].join('|') : keyword;
    entries.set(key, splitList(rhs));
  }
  return entries;
}

function first(entries: Entries, key: string): string {
  return entries.get(key)?.[0] ?? '';
}

const MISSING_TOKEN = /^\.{1,6}$/;

function parseData(raw: string, expected: number): { data: (number | null)[]; missing: Map<string, number> } {
  const data: (number | null)[] = new Array(expected);
  const missing = new Map<string, number>();
  let n = 0;
  let i = 0;
  const len = raw.length;
  while (i < len) {
    const c = raw.charCodeAt(i);
    // välilyönnit, rivinvaihdot, lainausmerkit ja pilkut erottimina
    if (c === 32 || c === 10 || c === 13 || c === 9 || c === 34 || c === 44) {
      i++;
      continue;
    }
    let j = i;
    while (j < len) {
      const d = raw.charCodeAt(j);
      if (d === 32 || d === 10 || d === 13 || d === 9 || d === 34 || d === 44) break;
      j++;
    }
    const tok = raw.slice(i, j);
    i = j;
    if (n >= expected) throw new Error(`DATA sisältää enemmän arvoja kuin odotettu ${expected}`);
    if (MISSING_TOKEN.test(tok)) {
      data[n++] = null;
      missing.set(tok, (missing.get(tok) ?? 0) + 1);
    } else {
      const v = Number(tok);
      if (Number.isNaN(v)) throw new Error(`DATA: tunnistamaton arvo "${tok}" kohdassa ${n}`);
      data[n++] = v;
    }
  }
  if (n !== expected) throw new Error(`DATA sisältää ${n} arvoa, odotettiin ${expected}`);
  return { data, missing };
}

export function parsePx(text: string, id: string): PxTable {
  const dataStart = /^DATA\s*=/m.exec(text);
  if (!dataStart) throw new Error(`${id}: DATA-osiota ei löytynyt`);
  const header = text.slice(0, dataStart.index);
  const dataRaw = text.slice(dataStart.index + dataStart[0].length).replace(/;\s*$/, '');
  const entries = parseHeader(header);

  const stub = entries.get('STUB') ?? [];
  const heading = entries.get('HEADING') ?? [];
  const order = [...stub, ...heading];
  if (order.length === 0) throw new Error(`${id}: STUB/HEADING puuttuu`);

  const variables: PxVariable[] = order.map((name) => {
    const labels = entries.get(`VALUES|${name}`);
    if (!labels) throw new Error(`${id}: VALUES("${name}") puuttuu`);
    const codes = entries.get(`CODES|${name}`) ?? labels;
    if (codes.length !== labels.length) {
      throw new Error(`${id}: ${name}: CODES (${codes.length}) ja VALUES (${labels.length}) eri pituiset`);
    }
    const values: PxValue[] = labels.map((label, k) => {
      const rawCode = codes[k];
      const preliminary = rawCode.endsWith('*') || label.endsWith('*');
      return { code: rawCode.replace(/\*$/, ''), label: label.replace(/\*$/, ''), preliminary };
    });
    const index = new Map<string, number>();
    values.forEach((v, k) => {
      if (index.has(v.code)) throw new Error(`${id}: ${name}: koodi "${v.code}" esiintyy kahdesti`);
      index.set(v.code, k);
    });
    const rawType = first(entries, `VARIABLE-TYPE|${name}`);
    const type: PxVariableType =
      rawType === 'Time' || rawType === 'Contents' || rawType === 'Classificatory' ? rawType : 'Unknown';
    const elim = first(entries, `ELIMINATION|${name}`);
    const total = elim ? values.find((v) => v.label === elim.replace(/\*$/, '')) : undefined;
    return { name, variableCode: first(entries, `VARIABLECODE|${name}`), type, values, index, total };
  });

  const total = variables.reduce((acc, v) => acc * v.values.length, 1);
  const { data, missing } = parseData(dataRaw, total);

  // Askeleet: viimeinen muuttuja vaihtuu nopeimmin
  const strides: number[] = new Array(variables.length);
  let s = 1;
  for (let k = variables.length - 1; k >= 0; k--) {
    strides[k] = s;
    s *= variables[k].values.length;
  }

  const byName = new Map(variables.map((v, k) => [v.name, k]));

  // UNITS("Tiedot-arvon selite")="yksikkö"
  const units = new Map<string, string>();
  const notes = new Map<string, string>();
  for (const [key, val] of entries) {
    const [kw, sub] = key.split('|');
    if (kw === 'UNITS' && sub) units.set(sub, val[0] ?? '');
    if (kw === 'NOTE' && sub) notes.set(sub, val[0] ?? '');
  }

  return {
    id,
    title: first(entries, 'TITLE'),
    description: first(entries, 'DESCRIPTION'),
    created: first(entries, 'CREATION-DATE'),
    variables,
    units,
    notes,
    data,
    missingSymbols: missing,
    variable(name) {
      const k = byName.get(name);
      if (k === undefined) throw new Error(`${id}: muuttujaa "${name}" ei ole`);
      return variables[k];
    },
    variableByType(type) {
      return variables.filter((v) => v.type === type);
    },
    get(selection) {
      let idx = 0;
      for (const [name, code] of Object.entries(selection)) {
        const k = byName.get(name);
        if (k === undefined) throw new Error(`${id}: muuttujaa "${name}" ei ole`);
        const vi = variables[k].index.get(code);
        if (vi === undefined) throw new Error(`${id}: ${name}: koodia "${code}" ei ole`);
        idx += vi * strides[k];
      }
      if (Object.keys(selection).length !== variables.length) {
        throw new Error(`${id}: get() vaatii kaikki ${variables.length} muuttujaa`);
      }
      return data[idx];
    },
  };
}
