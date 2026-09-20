/**
 * Rakennetun datan invariantit. Ajetaan vain jos public/data on olemassa (npm run build:data).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(import.meta.dirname, '..', 'public', 'data');
const has = existsSync(join(DIR, 'series.json'));
const read = <T>(f: string) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as T;

interface Area { code: string; name: string; level: string; parent: string | null }
interface Series { base: number; index: (number | null)[]; yoy: (number | null)[]; sqm: (number | null)[]; sales: (number | null)[] }

describe.skipIf(!has)('public/data', () => {
  const areas = has ? read<Area[]>('areas.json') : [];
  const { quarters, areas: series } = has ? read<{ quarters: string[]; areas: Record<string, Series> }>('series.json') : { quarters: [], areas: {} };
  const meta = has ? read<{ preliminary: string[]; lastSalesQuarter: string; lastQuarter: string }>('meta.json') : null;

  it('sisältää 87 aluetta rakenteineen', () => {
    const count = (l: string) => areas.filter((a) => a.level === l).length;
    expect(areas).toHaveLength(87);
    expect([count('koonti'), count('maakunta'), count('kunta'), count('osa-alue'), count('kehys')]).toEqual([5, 18, 27, 36, 1]);
    expect(Object.keys(series).sort()).toEqual(areas.map((a) => a.code).sort());
  });

  it('kaikki sarjat ovat aika-akselin mittaisia', () => {
    for (const s of Object.values(series)) {
      for (const arr of [s.index, s.yoy, s.sqm, s.sales]) expect(arr).toHaveLength(quarters.length);
    }
  });

  it('muutos-% täsmää saman sarjan indeksiin (ei neliöhintaan)', () => {
    for (const [code, s] of Object.entries(series)) {
      s.yoy.forEach((y, i) => {
        const now = s.index[i];
        const prev = i >= 4 ? s.index[i - 4] : null;
        if (now === null || prev === null) {
          expect(y, `${code} ${quarters[i]}`).toBeNull();
        } else {
          // indeksi on tallennettu yhdellä desimaalilla, muutos lasketaan pyöristämättömästä
          expect(Math.abs((y as number) - (now / prev - 1) * 100), `${code} ${quarters[i]}`).toBeLessThan(0.15);
        }
      });
    }
  });

  it('jokaisella alueella on täsmälleen yksi perusvuosi, joka on lukuvuosi', () => {
    for (const s of Object.values(series)) expect(s.base).toBeGreaterThan(1900);
  });

  it('salassa pidetyt arvot ovat null, ei nolla tai merkkijono', () => {
    for (const s of Object.values(series)) {
      for (const arr of [s.index, s.sqm, s.sales]) for (const v of arr) expect(v === null || (typeof v === 'number' && v > 0)).toBe(true);
    }
  });

  it('ennakkotiedot on merkitty ja tuoreimman neljänneksen kauppamäärä puuttuu', () => {
    expect(meta!.preliminary).toContain(meta!.lastQuarter);
    const last = quarters.indexOf(meta!.lastQuarter);
    for (const s of Object.values(series)) expect(s.sales[last]).toBeNull();
  });

  it('kaupungeilla on piste ja maakunnilla polygoni', () => {
    const pts = read<{ features: { properties: { code: string }; geometry: { coordinates: number[] } }[] }>('kaupungit.geojson');
    expect(pts.features).toHaveLength(27);
    for (const f of pts.features) {
      const [lon, lat] = f.geometry.coordinates;
      expect(lon).toBeGreaterThan(19);
      expect(lon).toBeLessThan(32);
      expect(lat).toBeGreaterThan(59);
      expect(lat).toBeLessThan(70.5);
    }
    const mk = read<{ features: { properties: { code: string; hasData: boolean } }[] }>('maakunnat.geojson');
    expect(mk.features.filter((f) => f.properties.hasData)).toHaveLength(18);
    expect(mk.features.filter((f) => !f.properties.hasData)).toHaveLength(1); // Ahvenanmaa: harmaa, ei nolla
  });
});
