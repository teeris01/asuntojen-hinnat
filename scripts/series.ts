/**
 * Aikasarjalogiikka. Puhdasta laskentaa ilman tiedosto-I/O:ta, jotta se on testattavissa.
 *
 * Perusvuosisääntö: yksi alue = yksi perusvuosi. Eri perusvuosien pistelukuja ei
 * koskaan yhdistetä samaan sarjaan. Muutos-% lasketaan aina yhden sarjan sisällä.
 */

export interface BaseSeries {
  /** Perusvuosi, esim. 2000 (indeksi 2000=100) */
  base: number;
  values: (number | null)[];
}

export function countValues(values: (number | null)[]): number {
  let n = 0;
  for (const v of values) if (v !== null) n++;
  return n;
}

/**
 * Järjestä perusvuodet kattavuuden mukaan koko aineiston yli.
 * Palauttaa perusvuoden -> sijoitus (0 = kattavin). Tasatilanteessa uudempi perusvuosi voittaa.
 */
export function rankBases(all: Map<number, (number | null)[][]>): Map<number, number> {
  const totals = [...all.entries()].map(([base, series]) => ({
    base,
    n: series.reduce((acc, s) => acc + countValues(s), 0),
  }));
  totals.sort((a, b) => b.n - a.n || b.base - a.base);
  return new Map(totals.map((t, i) => [t.base, i]));
}

/**
 * Valitse alueelle yksi perusvuosi: se jolla on eniten havaintoja.
 * Tasatilanteessa voittaa koko aineistossa kattavin perusvuosi.
 */
export function pickBase(candidates: BaseSeries[], rank: Map<number, number>): BaseSeries | null {
  let best: BaseSeries | null = null;
  let bestN = 0;
  for (const c of candidates) {
    const n = countValues(c.values);
    if (n === 0) continue;
    if (
      best === null ||
      n > bestN ||
      (n === bestN && (rank.get(c.base) ?? Infinity) < (rank.get(best.base) ?? Infinity))
    ) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

/** Vuosimuutos-% saman indeksisarjan sisällä (neljännesaineisto: viive 4). Yksi desimaali. */
export function yearOverYear(index: (number | null)[], lag = 4): (number | null)[] {
  return index.map((v, i) => {
    const prev = i >= lag ? index[i - lag] : null;
    if (v === null || prev === null || prev === 0) return null;
    return Math.round((v / prev - 1) * 1000) / 10;
  });
}

/** Pyöristä sarjan arvot n desimaaliin (null säilyy). */
export function roundSeries(values: (number | null)[], decimals: number): (number | null)[] {
  const f = 10 ** decimals;
  return values.map((v) => (v === null ? null : Math.round(v * f) / f));
}

/** p-kvantiili (0..1) lineaarisella interpolaatiolla. Tyhjä syöte heittää virheen. */
export function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) throw new Error('quantile: tyhjä syöte');
  const pos = (sortedAsc.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}
