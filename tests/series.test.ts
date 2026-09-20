import { describe, expect, it } from 'vitest';
import { pickBase, quantile, rankBases, yearOverYear } from '../scripts/series.ts';

describe('yearOverYear', () => {
  it('laskee muutoksen neljän neljänneksen viiveellä saman sarjan sisällä', () => {
    expect(yearOverYear([100, 101, 102, 103, 110, 99])).toEqual([null, null, null, null, 10, -2]);
  });
  it('palauttaa nullin kun jompikumpi arvo puuttuu (ei interpoloi)', () => {
    expect(yearOverYear([100, 100, 100, 100, null, 110, 110, 110, 110])).toEqual([
      null, null, null, null, null, 10, 10, 10, null,
    ]);
  });
});

describe('perusvuoden valinta', () => {
  const full = Array.from({ length: 10 }, (_, i) => 100 + i);
  const short = full.map((v, i) => (i < 6 ? null : v));
  const rank = rankBases(new Map([[2000, [full, full]], [2015, [short, short]]]));

  it('järjestää perusvuodet kattavuuden mukaan', () => {
    expect(rank.get(2000)).toBe(0);
    expect(rank.get(2015)).toBe(1);
  });
  it('valitsee alueelle sarjan, jolla on eniten havaintoja, ja pitää sen yhtenä sarjana', () => {
    const picked = pickBase([{ base: 2015, values: short }, { base: 2000, values: full }], rank);
    expect(picked?.base).toBe(2000);
    expect(picked?.values).toBe(full);
  });
  it('putoaa lyhyempään perusvuoteen, jos pitkää ei ole', () => {
    const none = full.map(() => null);
    expect(pickBase([{ base: 2000, values: none }, { base: 2015, values: short }], rank)?.base).toBe(2015);
  });
  it('tasatilanteessa voittaa kattavin perusvuosi', () => {
    expect(pickBase([{ base: 2015, values: full }, { base: 2000, values: full }], rank)?.base).toBe(2000);
  });
  it('palauttaa null kun dataa ei ole', () => {
    expect(pickBase([{ base: 2000, values: full.map(() => null) }], rank)).toBeNull();
  });
});

describe('quantile', () => {
  it('interpoloi lineaarisesti', () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([1, 2, 3, 4], 0)).toBe(1);
    expect(quantile([1, 2, 3, 4], 1)).toBe(4);
  });
});
