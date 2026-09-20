/**
 * Parsii raakadatan, yhdistää sen ja kirjoittaa selaimen lukemat JSON-tiedostot
 * hakemistoon public/data. Kaikki datan kompastuskivet käsitellään täällä.
 *
 *   npm run build:data
 *
 * Muuttujien ja arvojen koodit luetaan px-tiedostojen metadatasta. Alla olevat
 * vakiot ovat ainoa paikka, jossa datan merkityksiä nimetään; build kaatuu
 * heti, jos metadata ei enää vastaa niitä.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { parsePx, type PxTable, type PxVariable } from './parse-px.ts';
import { RAW_DIR } from './fetch.ts';
import {
  pickBase,
  rankBases,
  quantile,
  roundSeries,
  yearOverYear,
  type BaseSeries,
} from './series.ts';
import { dissolveGroups, interiorPoints, simplifyToWgs84, type PolyFeature } from './geometry.ts';

const OUT_DIR = join(import.meta.dirname, '..', 'public', 'data');

// --- Vakiot: mitä data tarkoittaa ---------------------------------------------------

/** Nimellisen hintaindeksin sisältökoodi 15it:ssä; ryhmä 1 = perusvuosi. Reaali-indeksit eivät täsmää. */
const NOMINAL_INDEX = /_indeksi_(\d{4})$/;
/** Neliöhinnan ja kauppamäärän tunnistus 13mv:n yksiköstä (UNITS-kenttä). */
const UNIT_SQM = /neliömetri/i;
/** Tilastokeskuksen itse julkaisema nimellisen indeksin vuosimuutos-% (15is), vertailuun. */
const PUBLISHED_YOY = /_indeksi_vmuutos_\d{4}$/;
const UNIT_COUNT = /lukumäärä/i;
/** Kehyskunnat on nimetty kuntajoukko; koodi on eri taulukoissa eri (keh / sat), nimi sama. */
const KEHYSKUNNAT_NAME = 'Kehyskunnat';
/** Tuoreimpia neljänneksiä, joiden kauppamäärä jätetään pois (varainsiirtoveroaineisto tarkentuu jälkikäteen). */
const SALES_EXCLUDE_TRAILING_QUARTERS = 1;
/** Geometrian säilytettävä pisteosuus yksinkertaistuksessa. */
const MAAKUNTA_KEEP = 0.06;
const KEHYS_KEEP = 0.5;
const SOURCE_TEXT = 'Tilastokeskus, osakeasuntojen hinnat';

// --- Apurit -------------------------------------------------------------------------

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`build: ${msg}`);
}

async function loadPx(id: string): Promise<PxTable> {
  return parsePx(await readFile(join(RAW_DIR, `${id}.px`), 'utf8'), id);
}

async function loadJson<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(join(RAW_DIR, name), 'utf8')) as T;
}

function findVar(t: PxTable, pick: (v: PxVariable) => boolean, what: string): PxVariable {
  const found = t.variables.filter(pick);
  assert(found.length === 1, `${t.id}: ${what}-muuttujia löytyi ${found.length}, odotettiin 1`);
  return found[0];
}

interface TableView {
  t: PxTable;
  area: PxVariable;
  time: PxVariable;
  contents: PxVariable;
  /** Muut muuttujat kiinnitetään "yhteensä"-luokkaan (ELIMINATION) */
  fixed: Record<string, string>;
}

function view(t: PxTable): TableView {
  const area = findVar(t, (v) => v.variableCode.startsWith('alue_'), 'alue');
  const time = findVar(t, (v) => v.type === 'Time', 'aika');
  const contents = findVar(t, (v) => v.variableCode === 'contentscode', 'tiedot');
  const fixed: Record<string, string> = {};
  for (const v of t.variables) {
    if (v === area || v === time || v === contents) continue;
    assert(v.total, `${t.id}: muuttujalla "${v.name}" ei ole ELIMINATION-arvoa`);
    fixed[v.name] = v.total.code;
  }
  return { t, area, time, contents, fixed };
}

function series(v: TableView, areaCode: string, contentCode: string, times: string[]): (number | null)[] {
  return times.map((q) => {
    if (!v.time.index.has(q)) return null;
    return v.t.get({ ...v.fixed, [v.area.name]: areaCode, [v.time.name]: q, [v.contents.name]: contentCode });
  });
}

// --- Aluerakenne --------------------------------------------------------------------

type Level = 'koonti' | 'maakunta' | 'kunta' | 'osa-alue' | 'kehys';

interface Area {
  code: string;
  name: string;
  level: Level;
  parent: string | null;
}

function levelOf(code: string, name: string): Level {
  if (name === KEHYSKUNNAT_NAME) return 'kehys';
  if (/^MK\d+$/.test(code)) return 'maakunta';
  if (/^\d{3}$/.test(code)) return 'kunta';
  if (/^\d{3}-\d+$/.test(code)) return 'osa-alue';
  return 'koonti';
}

/** Luokituksessa tilastoalue on järjestyksessä maakunnan jälkeen; osa-alue kuuluu kaupunkiin koodinsa perusteella. */
function buildAreas(a: PxVariable): Area[] {
  const areas: Area[] = [];
  let currentMk: string | null = null;
  for (const v of a.values) {
    const name = v.label.replace(new RegExp(`^${v.code}\\s+`), '');
    const level = levelOf(v.code, name);
    let parent: string | null = null;
    if (level === 'maakunta') currentMk = v.code;
    else if (level === 'kunta') parent = currentMk;
    else if (level === 'osa-alue') parent = v.code.split('-')[0];
    areas.push({ code: v.code, name, level, parent });
  }
  return areas;
}

/** Yhdistä 15it:n alueet 13mv:n alueisiin: ensin koodilla, sitten nimellä (koodit eroavat: SSS/ksu, keh/sat). */
function matchAreas(itAreas: PxVariable, mvAreas: PxVariable): Map<string, string> {
  const norm = (s: string) => s.toLocaleLowerCase('fi').replace(/^mk\d+\s+/, '').trim();
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const a of itAreas.values) {
    if (mvAreas.index.has(a.code)) {
      map.set(a.code, a.code);
      used.add(a.code);
    }
  }
  for (const a of itAreas.values) {
    if (map.has(a.code)) continue;
    const cand = mvAreas.values.filter((b) => !used.has(b.code) && norm(b.label) === norm(a.label));
    assert(cand.length === 1, `alue ${a.code} "${a.label}" ei täsmää 13mv:n alueisiin (${cand.length} osumaa)`);
    map.set(a.code, cand[0].code);
    used.add(cand[0].code);
  }
  assert(used.size === mvAreas.values.length, '13mv:llä on alueita joita 15it:ssä ei ole');
  return map;
}

/**
 * Vertaa omaa vuosimuutosta 15is:n julkaisemaan. Ei kaada buildia: erot johtuvat siitä, että
 * uusi perusvuosi (2025) on laskettu uudelleen, joten vanhan perusvuoden sarja ei täsmää
 * täsmälleen. Suurilla alueilla ero on pieni, pienillä alueilla ja tuoreimmilla hetkillä isompi.
 */
async function compareWithPublished(
  mine: Record<string, { yoy: (number | null)[] }>,
  quarters: string[],
): Promise<void> {
  const vIs = view(await loadPx('15is'));
  const yoyCodes = vIs.contents.values.filter((c) => PUBLISHED_YOY.test(c.code));
  assert(yoyCodes.length === 1, `15is: julkaistuja vuosimuutossisältöjä ${yoyCodes.length}, odotettiin 1`);
  const diffs: number[] = [];
  let signFlips = 0;
  for (const q of vIs.time.values.map((v) => v.code)) {
    const qi = quarters.indexOf(q);
    if (qi < 0) continue;
    for (const a of vIs.area.values) {
      const pub = vIs.t.get({ ...vIs.fixed, [vIs.area.name]: a.code, [vIs.time.name]: q, [vIs.contents.name]: yoyCodes[0].code });
      const own = mine[a.code]?.yoy[qi] ?? null;
      if (pub === null || own === null) continue;
      diffs.push(Math.abs(own - pub));
      if (Math.sign(own) !== Math.sign(pub)) signFlips++;
    }
  }
  diffs.sort((x, y) => x - y);
  console.log(
    `vertailu Tilastokeskuksen julkaisemaan vuosimuutokseen (${diffs.length} pistettä): ` +
      `mediaani-ero ${quantile(diffs, 0.5).toFixed(2)} %-yks, p90 ${quantile(diffs, 0.9).toFixed(2)}, ` +
      `max ${diffs[diffs.length - 1].toFixed(2)}, eri etumerkki ${signFlips} kpl`,
  );
}

// --- Pääohjelma ---------------------------------------------------------------------

interface KuntaProps {
  kunta: string;
  nimi: string;
}
interface MaakuntaProps {
  maakunta: string;
  nimi: string;
}
interface ClassItem {
  code: string;
  explanatoryNotes?: { includes?: string[] }[];
}

async function main(): Promise<void> {
  const [it, mv] = await Promise.all([loadPx('15it'), loadPx('13mv')]);
  const vIt = view(it);
  const vMv = view(mv);

  // Aika-akseli: 15it:n neljännekset, oltava yhtenäinen
  const quarters = vIt.time.values.map((v) => v.code);
  const preliminary = vIt.time.values.filter((v) => v.preliminary).map((v) => v.code);
  assert(quarters.every((q) => /^\d{4}Q[1-4]$/.test(q)), 'odottamaton neljännesformaatti');
  quarters.forEach((q, i) => {
    if (i === 0) return;
    const [y0, q0] = [Number(quarters[i - 1].slice(0, 4)), Number(quarters[i - 1][5])];
    const expected = q0 === 4 ? `${y0 + 1}Q1` : `${y0}Q${q0 + 1}`;
    assert(q === expected, `aika-akseli ei ole yhtenäinen kohdassa ${q}`);
  });

  const areas = buildAreas(vIt.area);
  const byLevel = (l: Level) => areas.filter((a) => a.level === l);
  assert(areas.length === 87, `alueita ${areas.length}, odotettiin 87`);
  console.log(
    `alueita ${areas.length}: koosteet ${byLevel('koonti').length}, maakunnat ${byLevel('maakunta').length}, ` +
      `kunnat ${byLevel('kunta').length}, osa-alueet ${byLevel('osa-alue').length}, kehys ${byLevel('kehys').length}`,
  );
  assert(byLevel('kehys').length === 1, 'Kehyskunnat-aluetta ei löytynyt');
  assert(byLevel('kunta').every((a) => a.parent), 'kaupungilta puuttuu maakunta');

  // --- Hintaindeksi: yksi perusvuosi / alue ---
  const baseCodes = vIt.contents.values
    .map((c) => ({ code: c.code, base: NOMINAL_INDEX.exec(c.code)?.[1] }))
    .filter((c): c is { code: string; base: string } => !!c.base);
  assert(baseCodes.length >= 2, 'nimellisiä indeksisarjoja ei löytynyt');

  const perBase = new Map<number, (number | null)[][]>();
  const perArea = new Map<string, BaseSeries[]>();
  for (const a of areas) {
    const cands: BaseSeries[] = baseCodes.map((c) => ({
      base: Number(c.base),
      values: series(vIt, a.code, c.code, quarters),
    }));
    perArea.set(a.code, cands);
    for (const c of cands) {
      if (!perBase.has(c.base)) perBase.set(c.base, []);
      perBase.get(c.base)!.push(c.values);
    }
  }
  const rank = rankBases(perBase);
  console.log('perusvuosien kattavuusjärjestys:', [...rank.entries()].sort((x, y) => x[1] - y[1]).map(([b]) => b).join(' > '));

  const indexByArea = new Map<string, { base: number; index: (number | null)[] }>();
  const noIndex: string[] = [];
  for (const a of areas) {
    const picked = pickBase(perArea.get(a.code)!, rank);
    if (!picked) {
      noIndex.push(a.code);
      continue;
    }
    indexByArea.set(a.code, { base: picked.base, index: picked.values });
  }
  assert(noIndex.length === 0, `alueilla ei ole lainkaan indeksiä: ${noIndex.join(', ')}`);

  // --- Neliöhinta ja kauppamäärä (13mv) ---
  const mvMap = matchAreas(vIt.area, vMv.area);
  const unitOf = (c: { label: string }) => mv.units.get(c.label) ?? '';
  const sqmContent = vMv.contents.values.filter((c) => UNIT_SQM.test(unitOf(c)));
  assert(sqmContent.length === 1, `13mv: neliöhintasisältöjä ${sqmContent.length}, odotettiin 1`);
  const salesContents = vMv.contents.values.filter((c) => UNIT_COUNT.test(unitOf(c))).map((c) => c.code).sort();
  assert(salesContents.length >= 1, '13mv: kauppamääräsisältöjä ei löytynyt');

  const mvQuarters = vMv.time.values.map((v) => v.code);
  const lastMvQuarter = mvQuarters[mvQuarters.length - 1];
  const salesCutoff = mvQuarters.length - SALES_EXCLUDE_TRAILING_QUARTERS;
  const salesExcluded = new Set(mvQuarters.slice(salesCutoff));
  const salesBreaks: string[] = [];

  const sqmByArea = new Map<string, (number | null)[]>();
  const salesByArea = new Map<string, (number | null)[]>();
  for (const a of areas) {
    const mvCode = mvMap.get(a.code)!;
    sqmByArea.set(a.code, series(vMv, mvCode, sqmContent[0].code, quarters));
    const combined: (number | null)[] = quarters.map(() => null);
    for (const sc of salesContents) {
      const s = series(vMv, mvCode, sc, quarters);
      s.forEach((v, i) => {
        if (v === null) return;
        assert(combined[i] === null, `${a.code}: kauppamäärät ${sc} menevät päällekkäin kohdassa ${quarters[i]}`);
        combined[i] = salesExcluded.has(quarters[i]) ? null : v;
      });
    }
    salesByArea.set(a.code, combined);
  }
  // Kauppamääräsarjojen vaihtumiskohdat (vertailukelpoisuuden katko), luetaan datasta
  for (const sc of salesContents.slice(1)) {
    const first = quarters.find((q) => areas.some((a) => series(vMv, mvMap.get(a.code)!, sc, [q])[0] !== null));
    if (first) salesBreaks.push(first);
  }

  // --- Sarjat ja väriskaala ---
  const seriesOut: Record<string, unknown> = {};
  const drawnYoy: number[] = [];
  const drawnLevels = new Set<Level>(['maakunta', 'kunta']);
  for (const a of areas) {
    const { base, index } = indexByArea.get(a.code)!;
    const yoy = yearOverYear(index);
    if (drawnLevels.has(a.level)) for (const v of yoy) if (v !== null) drawnYoy.push(v);
    seriesOut[a.code] = {
      base,
      index: roundSeries(index, 1),
      yoy,
      sqm: sqmByArea.get(a.code),
      sales: salesByArea.get(a.code),
    };
  }
  drawnYoy.sort((x, y) => x - y);
  const p01 = quantile(drawnYoy, 0.01);
  const p99 = quantile(drawnYoy, 0.99);
  const bound = Math.ceil(Math.max(Math.abs(p01), Math.abs(p99)) / 5) * 5;
  console.log(
    `vuosimuutos (piirretyt alueet): min ${drawnYoy[0]} %, p1 ${p01.toFixed(1)}, p99 ${p99.toFixed(1)}, max ${drawnYoy.at(-1)} % -> skaala ±${bound} %`,
  );

  await compareWithPublished(seriesOut as Record<string, { yoy: (number | null)[] }>, quarters);

  // --- Geometria ---
  const [kuntaRaw, maakuntaRaw, classification] = await Promise.all([
    loadJson<FeatureCollection<Polygon | MultiPolygon, KuntaProps>>('kunta4500k_2026.geojson'),
    loadJson<FeatureCollection<Polygon | MultiPolygon, MaakuntaProps>>('maakunta1000k_2026.geojson'),
    loadJson<ClassItem[]>('alue-luokitus.json'),
  ]);
  const kuntaByName = new Map(kuntaRaw.features.map((f) => [f.properties.nimi, f.properties.kunta]));
  const kuntaByCode = new Map(kuntaRaw.features.map((f) => [f.properties.kunta, f.properties.nimi]));
  const codeOfName = (n: string, ctx: string) => {
    const c = kuntaByName.get(n);
    assert(c, `${ctx}: kuntaa "${n}" ei löydy geometriasta`);
    return c;
  };

  // Kaupungit: koodi = kuntanumero; jos nimi ei täsmää geometrian nimeen (Espoo-Kauniainen), jaa nimi viivasta
  const cityGroups = byLevel('kunta').map((a) => {
    const geoName = kuntaByCode.get(a.code);
    assert(geoName, `kaupunki ${a.code} ${a.name}: kuntanumeroa ei löydy geometriasta`);
    const kuntaCodes =
      geoName === a.name ? [a.code] : a.name.split('-').map((n) => codeOfName(n.trim(), `kaupunki ${a.code}`));
    return { code: a.code, kuntaCodes };
  });

  // Kehyskunnat: kokoonpano luetaan alueluokituksesta
  const kehys = byLevel('kehys')[0];
  const kehysItem = classification.find((i) => i.code === kehys.code);
  const kehysText = kehysItem?.explanatoryNotes?.[0]?.includes?.[0];
  assert(kehysText, `alueluokituksesta ei löydy Kehyskunnat-alueen (${kehys.code}) kokoonpanoa`);
  const kehysNames = kehysText.split(/,\s*|\s+ja\s+/).map((s) => s.trim()).filter(Boolean);
  const kehysCodes = kehysNames.map((n) => codeOfName(n, 'Kehyskunnat'));
  console.log(`Kehyskunnat: ${kehysNames.join(', ')}`);

  const dissolvedCities = await dissolveGroups(kuntaRaw, cityGroups);
  const dissolvedKehys = await dissolveGroups(kuntaRaw, [{ code: kehys.code, kuntaCodes: kehysCodes }]);

  const { native, wgs84 } = await interiorPoints([...dissolvedCities.values()]);

  // Tarkistus: kaupungin piste on sen maakunnan sisällä, johon aluejako sen sijoittaa
  const mkByCode = new Map(maakuntaRaw.features.map((f) => [`MK${f.properties.maakunta}`, f]));
  for (const a of byLevel('kunta')) {
    const mk = mkByCode.get(a.parent!);
    assert(mk, `kaupungin ${a.name} maakuntaa ${a.parent} ei löydy geometriasta`);
    const p = native.get(a.code)!;
    assert(
      booleanPointInPolygon(p, mk),
      `kaupunki ${a.name} (${a.code}) ei ole maakunnassa ${a.parent} — aluejärjestyksen tulkinta on väärä`,
    );
  }

  const statCodes = new Set(areas.map((a) => a.code));
  const maakunnat = await simplifyToWgs84(
    maakuntaRaw.features.map(
      (f): PolyFeature<{ code: string; name: string; hasData: boolean }> => {
        const code = `MK${f.properties.maakunta}`;
        return {
          type: 'Feature',
          properties: { code, name: f.properties.nimi, hasData: statCodes.has(code) },
          geometry: f.geometry,
        };
      },
    ),
    MAAKUNTA_KEEP,
  );
  const kehysPoly = await simplifyToWgs84(
    [{ ...dissolvedKehys.get(kehys.code)!, properties: { code: kehys.code, name: kehys.name } }],
    KEHYS_KEEP,
  );
  const cityPoints = {
    type: 'FeatureCollection',
    features: byLevel('kunta').map((a) => ({
      type: 'Feature',
      properties: { code: a.code, name: a.name, parent: a.parent },
      geometry: { type: 'Point', coordinates: wgs84.get(a.code)! },
    })),
  };

  // --- Kirjoitus ---
  await mkdir(OUT_DIR, { recursive: true });
  const write = async (name: string, data: unknown) => {
    const text = JSON.stringify(data);
    await writeFile(join(OUT_DIR, name), text);
    console.log(`  ${name}  ${(text.length / 1024).toFixed(0)} kt`);
  };

  await write('meta.json', {
    source: SOURCE_TEXT,
    updated: it.created,
    firstQuarter: quarters[0],
    lastQuarter: quarters[quarters.length - 1],
    lastSalesQuarter: mvQuarters[salesCutoff - 1],
    lastSqmQuarter: lastMvQuarter,
    preliminary,
    salesBreaks,
    yoyScale: { min: drawnYoy[0], max: drawnYoy[drawnYoy.length - 1], bound },
  });
  await write('areas.json', areas);
  await write('series.json', { quarters, areas: seriesOut });
  await write('maakunnat.geojson', { type: 'FeatureCollection', features: maakunnat });
  await write('kehyskunnat.geojson', { type: 'FeatureCollection', features: kehysPoly });
  await write('kaupungit.geojson', cityPoints);
  console.log('valmis');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
