import { describe, expect, it } from 'vitest';
import { parsePx, splitList } from '../scripts/parse-px.ts';

// Pieni px-tiedosto: 2 aluetta x 3 aikaa x 2 sisältöä. Aika kolmas on ennakkotieto.
const PX = [
  'AXIS-VERSION="2024";',
  'CODEPAGE="utf-8";',
  'TITLE="Testi";',
  'STUB="Alue","Vuosineljännes";',
  'HEADING="Tiedot";',
  'VALUES("Alue")="KOKO MAA","Helsinki";',
  'VALUES("Vuosineljännes")="2025Q1","2025Q2","2025Q3*";',
  'VALUES("Tiedot")="Indeksi","Kauppamäärä";',
  'CODES("Alue")="SSS","091";',
  'CODES("Vuosineljännes")="2025Q1","2025Q2","2025Q3";',
  'CODES("Tiedot")="idx","lkm";',
  'VARIABLE-TYPE("Alue")="Classificatory";',
  'VARIABLE-TYPE("Vuosineljännes")="Time";',
  'VARIABLECODE("Vuosineljännes")="timeperiod_q";',
  'ELIMINATION("Alue")="KOKO MAA";',
  'UNITS("Indeksi")="2025=100";',
  'UNITS[en]("Index")="ei tule mukaan";',
  'DATA=',
  '100.0 12 "." 15 101.5 "..."',
  '99.0 7 98.2 "...." 97.0 9;',
  '',
].join('\r\n');

describe('parsePx', () => {
  const t = parsePx(PX, 'test');

  it('lukee muuttujat metadatasta, ei nimistä', () => {
    expect(t.variables.map((v) => v.name)).toEqual(['Alue', 'Vuosineljännes', 'Tiedot']);
    expect(t.variableByType('Time')[0].variableCode).toBe('timeperiod_q');
    expect(t.variable('Alue').total?.code).toBe('SSS');
  });

  it('muuntaa puuttuvan arvon "." nulliksi ja ".../...." niin ikään', () => {
    expect(t.get({ Alue: 'SSS', Vuosineljännes: '2025Q2', Tiedot: 'idx' })).toBeNull();
    expect(t.get({ Alue: 'SSS', Vuosineljännes: '2025Q3', Tiedot: 'lkm' })).toBeNull();
    expect(t.get({ Alue: '091', Vuosineljännes: '2025Q2', Tiedot: 'lkm' })).toBeNull();
    expect([...t.missingSymbols.entries()].sort()).toEqual([['.', 1], ['....', 1], ['...', 1]].sort());
  });

  it('säilyttää luvut oikeissa soluissa (viimeinen muuttuja vaihtuu nopeimmin)', () => {
    expect(t.get({ Alue: 'SSS', Vuosineljännes: '2025Q1', Tiedot: 'idx' })).toBe(100);
    expect(t.get({ Alue: 'SSS', Vuosineljännes: '2025Q1', Tiedot: 'lkm' })).toBe(12);
    expect(t.get({ Alue: 'SSS', Vuosineljännes: '2025Q3', Tiedot: 'idx' })).toBe(101.5);
    expect(t.get({ Alue: '091', Vuosineljännes: '2025Q1', Tiedot: 'idx' })).toBe(99);
    expect(t.get({ Alue: '091', Vuosineljännes: '2025Q3', Tiedot: 'lkm' })).toBe(9);
  });

  it('merkitsee ennakkotiedon ja riisuu tähden koodista', () => {
    const q = t.variable('Vuosineljännes').values;
    expect(q.map((v) => v.code)).toEqual(['2025Q1', '2025Q2', '2025Q3']);
    expect(q.map((v) => v.preliminary)).toEqual([false, false, true]);
  });

  it('ottaa yksiköt vain oletuskielestä', () => {
    expect(t.units.get('Indeksi')).toBe('2025=100');
    expect(t.units.size).toBe(1);
  });

  it('kaatuu, jos arvoja on väärä määrä tai koodia ei ole', () => {
    expect(() => parsePx(PX.replace('9;', ';'), 'x')).toThrow(/odotettiin/);
    expect(() => t.get({ Alue: 'XXX', Vuosineljännes: '2025Q1', Tiedot: 'idx' })).toThrow(/koodia/);
  });
});

describe('splitList', () => {
  it('jakaa pilkulla lainausmerkkien ulkopuolelta', () => {
    expect(splitList('"a, b","c"')).toEqual(['a, b', 'c']);
    expect(splitList('"a",\r\n"b"')).toEqual(['a', 'b']);
    expect(splitList('1')).toEqual(['1']);
  });
});
