import type { AppData, Area, AreaSeries, Meta } from './types';

const base = import.meta.env.BASE_URL;

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${base}data/${name}`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Lataa kaikki paikalliset JSON-tiedostot kerralla. Sovellus ei kutsu mitään ulkoista rajapintaa. */
export async function loadData(): Promise<AppData> {
  const [meta, areas, seriesFile, maakunnat, kehys, kaupungit] = await Promise.all([
    getJson<Meta>('meta.json'),
    getJson<Area[]>('areas.json'),
    getJson<{ quarters: string[]; areas: Record<string, AreaSeries> }>('series.json'),
    getJson<AppData['maakunnat']>('maakunnat.geojson'),
    getJson<AppData['kehys']>('kehyskunnat.geojson'),
    getJson<AppData['kaupungit']>('kaupungit.geojson'),
  ]);
  return {
    meta,
    quarters: seriesFile.quarters,
    areas,
    areaByCode: new Map(areas.map((a) => [a.code, a])),
    series: seriesFile.areas,
    maakunnat,
    kehys,
    kaupungit,
  };
}
