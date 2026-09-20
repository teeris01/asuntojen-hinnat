/**
 * Geometrian käsittely rakennusvaiheessa: yhdistäminen, yksinkertaistus ja projisointi
 * ETRS-TM35FIN (EPSG:3067) -> WGS84. Selain lukee vain valmiit tiedostot.
 */
import mapshaper from 'mapshaper';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';

type Poly = Polygon | MultiPolygon;
export type PolyFeature<P = Record<string, unknown>> = Feature<Poly, P>;
export type PointFeature<P = Record<string, unknown>> = Feature<Point, P>;

const FROM = 'from=EPSG:3067';
/** Koordinaattien tarkkuus astetta: 0,0001° ≈ 11 m, riittää web-karttaan. */
const PRECISION = 0.0001;

async function run(cmd: string, input: FeatureCollection): Promise<FeatureCollection> {
  const out = await mapshaper.applyCommands(cmd, { 'in.json': JSON.stringify(input) });
  return JSON.parse(String(out['out.json'])) as FeatureCollection;
}

function collection<G extends Poly | Point>(features: Feature<G>[]): FeatureCollection<G> {
  return { type: 'FeatureCollection', features } as FeatureCollection<G>;
}

/**
 * Yhdistä kuntapolygonit alueiksi. `groups` kertoo alueen koodin ja sen kuntanumerot.
 * Sama kunta voi kuulua useaan alueeseen (esim. Hyvinkää on kaupunki ja Kehyskunnat),
 * joten jokainen alue yhdistetään omana ajonaan.
 */
export async function dissolveGroups(
  kunnat: FeatureCollection<Poly, { kunta: string }>,
  groups: { code: string; kuntaCodes: string[] }[],
): Promise<Map<string, PolyFeature<{ code: string }>>> {
  const result = new Map<string, PolyFeature<{ code: string }>>();
  for (const g of groups) {
    const members = new Set(g.kuntaCodes);
    const feats = kunnat.features
      .filter((f) => members.has(f.properties.kunta))
      .map((f) => ({ type: 'Feature' as const, properties: { code: g.code }, geometry: f.geometry }));
    const found = new Set(kunnat.features.filter((f) => members.has(f.properties.kunta)).map((f) => f.properties.kunta));
    const missing = g.kuntaCodes.filter((c) => !found.has(c));
    if (missing.length) throw new Error(`Alue ${g.code}: kuntia ei löytynyt geometriasta: ${missing.join(', ')}`);
    const out = await run('-i in.json -dissolve code -o out.json format=geojson', collection(feats));
    if (out.features.length !== 1) throw new Error(`Alue ${g.code}: dissolve tuotti ${out.features.length} kohdetta`);
    result.set(g.code, out.features[0] as PolyFeature<{ code: string }>);
  }
  return result;
}

/**
 * Piste polygonin sisältä (ei keskipiste: se osuu usein veteen).
 * Palauttaa pisteen sekä alkuperäisessä koordinaatistossa (tarkistuksia varten) että WGS84:ssä.
 */
export async function interiorPoints(polygons: PolyFeature<{ code: string }>[]): Promise<{
  native: Map<string, Feature<Point>>;
  wgs84: Map<string, [number, number]>;
}> {
  const mp = await mapshaper.applyCommands(
    `-i in.json -points inner -o native.json format=geojson ` +
      `-proj wgs84 ${FROM} -o out.json format=geojson precision=${PRECISION}`,
    { 'in.json': JSON.stringify(collection(polygons)) },
  );
  const parse = (name: string) => JSON.parse(String(mp[name])) as FeatureCollection<Point, { code: string }>;
  const native = new Map<string, Feature<Point>>();
  const wgs84 = new Map<string, [number, number]>();
  for (const f of parse('native.json').features) native.set(f.properties.code, f);
  for (const f of parse('out.json').features) wgs84.set(f.properties.code, [f.geometry.coordinates[0], f.geometry.coordinates[1]]);
  return { native, wgs84 };
}

/** Yksinkertaista ja projisoi WGS84:ään. `keep` = säilytettävä osuus pisteistä (0..1). */
export async function simplifyToWgs84<P extends Record<string, unknown>>(
  features: PolyFeature<P>[],
  keep: number,
): Promise<PolyFeature<P>[]> {
  const pct = `${(keep * 100).toFixed(1)}%`;
  const out = await run(
    `-i in.json -simplify visvalingam ${pct} keep-shapes -proj wgs84 ${FROM} -o out.json format=geojson precision=${PRECISION}`,
    collection(features),
  );
  return out.features as PolyFeature<P>[];
}
