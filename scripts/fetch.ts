/**
 * Hakee raakadatan verkosta hakemistoon data/raw. Ajetaan käsin datajulkistusten jälkeen.
 *
 *   npm run fetch
 *
 * - px-taulukot: yksi GET / taulukko
 * - alueluokitus: luokitus-API, tunniste luetaan 15it.px:n Alue-muuttujan koodista
 * - geometria: Tilastokeskuksen WFS (EPSG:3067), yksi kutsu / taso
 */
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePx } from './parse-px.ts';

export const RAW_DIR = join(import.meta.dirname, '..', 'data', 'raw');

const PX_BASE = 'https://pxdata.stat.fi/PXWeb/Resources/PX/Databases/StatFin/ashi';
const WFS = 'https://geo.stat.fi/geoserver/tilastointialueet/wfs';
const CLASSIFICATION_API = 'https://data.stat.fi/api/classifications/v2/classifications';

/** 13mx (301 kuntaa) on varalla, ei haeta ennen kuin kuntakattavuutta tarvitaan. */
export const PX_TABLES = ['15it', '15is', '13mv', '13mq'] as const;
export const WFS_LAYERS = ['kunta4500k_2026', 'maakunta1000k_2026'] as const;

async function get(url: string, attempts = 3): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) throw new Error('tyhjä vastaus');
      return buf;
    } catch (err) {
      lastErr = err;
      if (i < attempts) await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
  throw new Error(`${url}: ${(lastErr as Error).message}`);
}

async function save(name: string, buf: Buffer): Promise<void> {
  await writeFile(join(RAW_DIR, name), buf);
  console.log(`  ${name}  ${(buf.length / 1024).toFixed(0)} kt`);
}

async function main(): Promise<void> {
  await mkdir(RAW_DIR, { recursive: true });

  console.log('px-taulukot');
  for (const id of PX_TABLES) {
    await save(`${id}.px`, await get(`${PX_BASE}/${id}.px`));
  }

  // Alueluokituksen tunniste on taulukon metadatassa, ei koodissa
  const it = parsePx(await readFile(join(RAW_DIR, '15it.px'), 'utf8'), '15it');
  const classId = it.variableByType('Classificatory').find((v) => v.variableCode.startsWith('alue_'))?.variableCode;
  if (!classId) throw new Error('15it.px: alueluokituksen muuttujakoodia ei löytynyt');

  console.log(`alueluokitus ${classId}`);
  await save(
    'alue-luokitus.json',
    await get(`${CLASSIFICATION_API}/${classId}/classificationItems?content=data&meta=max&lang=fi`),
  );

  console.log('geometria (WFS)');
  for (const layer of WFS_LAYERS) {
    const url =
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=tilastointialueet:${layer}&outputFormat=application/json`;
    await save(`${layer}.geojson`, await get(url));
  }
  console.log('valmis');
}

// Suoritetaan vain kun tiedosto ajetaan suoraan (ei kun build.ts tuo vakioita)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
