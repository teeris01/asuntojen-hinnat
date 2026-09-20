/**
 * Kartta: maakunnat teemakarttana, 27 kaupunkia ympyröinä päällä.
 * Väri = vuosimuutos-%, koko = kauppamäärä. Ei taustakarttaa, ei tiilipalvelua, ei glyfejä
 * (nimet ovat HTML-merkkejä), ei attribuutiorivistöä.
 *
 * Arvon vaihtuessa päivitetään vain feature state; tasoja ei luoda uudelleen.
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Vite paketoi workerin riippuvuuksineen omaksi tiedostokseen; oletuspolku ei löydä sitä tuotantobuildissa
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { MultiPolygon, Polygon } from 'geojson';
import type { AppData } from './types';
import { NO_DATA_FILL, NO_DATA_STROKE, PAGE, colorExpression } from './colors';

export type Selection =
  | { kind: 'none' }
  | { kind: 'maakunta'; code: string }
  | { kind: 'city'; code: string };

export interface Hit {
  kind: 'maakunta' | 'city';
  code: string;
}

export interface MapCallbacks {
  onHover(hit: Hit | null, point: { x: number; y: number }): void;
  onSelect(sel: Selection): void;
}

export interface MapController {
  setQuarter(i: number): void;
  setSelection(sel: Selection): void;
}

const FINLAND: [[number, number], [number, number]] = [
  [19.3, 59.7],
  [31.7, 70.2],
];
const DRILL_MS = 700;

// Ympyrän säde (px): kauppamäärän neliöjuuri -> pinta-ala on suoraan verrannollinen kauppamäärään
const R_MIN = 5;
const R_MAX = 26;
const R_NO_SALES = 6;
const ZOOM_STOPS: [number, number][] = [
  [4, 0.9],
  [9, 1.6],
];

function zoomFactor(z: number): number {
  const [[z0, k0], [z1, k1]] = ZOOM_STOPS;
  const t = Math.max(0, Math.min(1, (z - z0) / (z1 - z0)));
  return k0 + (k1 - k0) * t;
}

function bboxOf(geom: Polygon | MultiPolygon): [[number, number], [number, number]] {
  let [w, south, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  const walk = (c: unknown): void => {
    const arr = c as unknown[];
    if (typeof arr[0] === 'number') {
      const [x, y] = arr as number[];
      w = Math.min(w, x);
      e = Math.max(e, x);
      south = Math.min(south, y);
      n = Math.max(n, y);
    } else arr.forEach(walk);
  };
  walk(geom.coordinates);
  return [
    [w, south],
    [e, n],
  ];
}

function hatchImage(): ImageData {
  const size = 10;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = NO_DATA_STROKE;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const o of [-size, 0, size]) {
    ctx.moveTo(o, size);
    ctx.lineTo(o + size, 0);
  }
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

maplibregl.setWorkerUrl(workerUrl);

export function createMap(container: HTMLElement, data: AppData, cb: MapCallbacks): Promise<MapController> {
  const bound = data.meta.yoyScale.bound;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const duration = reduceMotion ? 0 : DRILL_MS;

  const map = new maplibregl.Map({
    container,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': PAGE } }] },
    bounds: FINLAND,
    fitBoundsOptions: { padding: padding() },
    attributionControl: false,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    renderWorldCopies: false,
    minZoom: 3,
    maxZoom: 10.5,
  });
  map.touchZoomRotate.disableRotation();
  if (import.meta.env.DEV || location.search.includes('debug')) (window as unknown as { __map: unknown }).__map = map;
  map.on('error', (e) => console.error('[map]', e.error?.message ?? e));

  function padding() {
    const w = window.innerWidth;
    if (w < 760) return { top: 120, left: 10, right: 10, bottom: Math.round(window.innerHeight * 0.32) + 156 };
    return { top: 80, left: 24, right: 420, bottom: 150 };
  }

  // Suurimmat kaupungit ensin: pienet ympyrät piirtyvät isojen päälle
  const meanSales = (code: string): number => {
    const v = (data.series[code]?.sales ?? []).filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  };
  const cities = {
    ...data.kaupungit,
    features: [...data.kaupungit.features].sort((a, b) => meanSales(b.properties.code) - meanSales(a.properties.code)),
  };
  let sqrtMax = 1;
  for (const f of cities.features) {
    for (const v of data.series[f.properties.code]?.sales ?? []) if (v !== null) sqrtMax = Math.max(sqrtMax, Math.sqrt(v));
  }

  const radiusAt = (sales: number | null, zoom: number): number =>
    zoomFactor(zoom) * (sales === null ? R_NO_SALES : R_MIN + (R_MAX - R_MIN) * Math.min(1, Math.sqrt(sales) / sqrtMax));

  function radiusExpr(): unknown[] {
    const at = (z: number) => [
      '*',
      zoomFactor(z),
      [
        'case',
        ['boolean', ['feature-state', 'hasSales'], false],
        ['+', R_MIN, ['*', R_MAX - R_MIN, ['min', 1, ['/', ['sqrt', ['to-number', ['feature-state', 'sales'], 0]], sqrtMax]]]],
        R_NO_SALES,
      ],
    ];
    return ['interpolate', ['linear'], ['zoom'], ZOOM_STOPS[0][0], at(ZOOM_STOPS[0][0]), ZOOM_STOPS[1][0], at(ZOOM_STOPS[1][0])];
  }

  const has = ['boolean', ['feature-state', 'has'], false];
  const yoy = ['to-number', ['feature-state', 'yoy'], 0];
  const flag = (name: string) => ['boolean', ['feature-state', name], false];

  // --- Tila ---
  let qi = data.quarters.length - 1;
  let selection: Selection = { kind: 'none' };
  let hovered: Hit | null = null;

  // Maakunta, jonka näkymässä Kehyskunnat-reuna näytetään (luetaan aluejärjestyksestä, ei kovakoodata)
  const kehysMk = data.areas.find((a) => a.level === 'kehys')?.parent ?? null;

  const mkOf = (sel: Selection): string | null => {
    if (sel.kind === 'maakunta') return sel.code;
    if (sel.kind === 'city') return data.areaByCode.get(sel.code)?.parent ?? null;
    return null;
  };

  // --- Nimet HTML-merkkeinä (ei glyfipalvelinta) ---
  interface LabelItem {
    el: HTMLElement;
    lngLat: [number, number];
    /** Isompi ensin: törmäyksessä pienempi nimi piilotetaan */
    priority: number;
  }
  const mkLabels = new Map<string, LabelItem>();
  const cityLabels = new Map<string, LabelItem & { marker: maplibregl.Marker; parent: string }>();

  /** MapLibre hallitsee merkin ulkoelementin tyylejä (mm. opacity), joten luokat menevät sisäelementille. */
  function makeLabel(text: string, cls: string): { outer: HTMLElement; label: HTMLElement } {
    const outer = document.createElement('div');
    const label = document.createElement('span');
    label.className = `map-label ${cls}`;
    label.textContent = text;
    outer.append(label);
    return { outer, label };
  }

  function refreshLabels(): void {
    const mk = mkOf(selection);
    const z = map.getZoom();
    for (const [code, l] of mkLabels) {
      l.el.classList.toggle('is-hidden', mk !== null && code !== mk);
      l.el.classList.toggle('is-active', code === mk);
    }
    for (const [code, l] of cityLabels) {
      l.el.classList.toggle('is-hidden', !(mk !== null && l.parent === mk));
      l.el.classList.toggle('is-active', selection.kind === 'city' && selection.code === code);
      l.marker.setOffset([0, radiusAt(data.series[code]?.sales?.[qi] ?? null, z) + 2]);
    }
    hideCollisions();
  }

  /** Piilota nimet, jotka osuisivat jo sijoitetun nimen päälle. Ajetaan liikkeen päätyttyä, ei joka framella. */
  function hideCollisions(): void {
    const z = map.getZoom();
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const items: { l: LabelItem; below: number }[] = [
      ...[...mkLabels.values()].map((l) => ({ l, below: 0 })),
      ...[...cityLabels.entries()].map(([code, l]) => ({ l, below: radiusAt(data.series[code]?.sales?.[qi] ?? null, z) + 2 })),
    ];
    items.sort((a, b) => b.l.priority - a.l.priority);
    for (const { l, below } of items) {
      if (l.el.classList.contains('is-hidden')) continue;
      const p = map.project(l.lngLat);
      const w = l.el.offsetWidth;
      const h = l.el.offsetHeight;
      const x0 = p.x - w / 2;
      const y0 = below ? p.y + below : p.y - h / 2;
      const r = { x0: x0 - 2, y0: y0 - 1, x1: x0 + w + 2, y1: y0 + h + 1 };
      const hit = placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0);
      if (hit) l.el.classList.add('is-hidden');
      else placed.push(r);
    }
  }

  function applyDim(): void {
    const mk = mkOf(selection);
    for (const f of data.maakunnat.features) {
      const code = f.properties.code;
      map.setFeatureState({ source: 'maakunnat', id: code }, { dim: mk !== null && code !== mk, selected: code === mk });
    }
    for (const f of cities.features) {
      const code = f.properties.code;
      map.setFeatureState(
        { source: 'kaupungit', id: code },
        { dim: mk !== null && f.properties.parent !== mk, selected: selection.kind === 'city' && selection.code === code },
      );
    }
    map.setLayoutProperty('keh-line', 'visibility', mk !== null && mk === kehysMk ? 'visible' : 'none');
    refreshLabels();
  }

  function fitTo(sel: Selection): void {
    const mk = mkOf(sel);
    if (mk === null) {
      map.fitBounds(FINLAND, { padding: padding(), duration });
      return;
    }
    const f = data.maakunnat.features.find((x) => x.properties.code === mk);
    if (f) map.fitBounds(bboxOf(f.geometry), { padding: { ...padding(), top: 90 }, duration, maxZoom: 9 });
  }

  function setHover(hit: Hit | null): void {
    const same = hit?.kind === hovered?.kind && hit?.code === hovered?.code;
    if (same) return;
    if (hovered) map.setFeatureState({ source: hovered.kind === 'city' ? 'kaupungit' : 'maakunnat', id: hovered.code }, { hover: false });
    if (hit) map.setFeatureState({ source: hit.kind === 'city' ? 'kaupungit' : 'maakunnat', id: hit.code }, { hover: true });
    hovered = hit;
  }

  function hitAt(point: maplibregl.Point): Hit | null {
    const box: [maplibregl.PointLike, maplibregl.PointLike] = [
      [point.x - 5, point.y - 5],
      [point.x + 5, point.y + 5],
    ];
    const circles = map.queryRenderedFeatures(box, { layers: ['city-circles'] }) as maplibregl.MapGeoJSONFeature[];
    if (circles.length) {
      // Tarkin osuma: pienin ympyrä (se on piirretty päällimmäiseksi)
      const z = map.getZoom();
      circles.sort(
        (a, b) =>
          radiusAt(data.series[a.properties.code]?.sales?.[qi] ?? null, z) -
          radiusAt(data.series[b.properties.code]?.sales?.[qi] ?? null, z),
      );
      return { kind: 'city', code: circles[0].properties.code as string };
    }
    const polys = map.queryRenderedFeatures(point, { layers: ['mk-fill'] }) as maplibregl.MapGeoJSONFeature[];
    if (polys.length) {
      const code = polys[0].properties.code as string;
      // Ahvenanmaalla ei ole tietoa: ei valittavissa, mutta hover kertoo sen
      return { kind: 'maakunta', code };
    }
    return null;
  }

  // Ilmaisut rakennetaan ajonaikaisesti; MapLibren tiukat tyypit eivät seuraa niitä, joten tyypitys kierretään yhdessä paikassa
  const addLayer = (layer: unknown): void => void map.addLayer(layer as maplibregl.LayerSpecification);

  return new Promise((resolve) => {
    map.on('load', () => {
      map.addImage('hatch', hatchImage(), { pixelRatio: 1 });

      map.addSource('maakunnat', { type: 'geojson', data: data.maakunnat, promoteId: 'code' });
      map.addSource('kehys', { type: 'geojson', data: data.kehys });
      map.addSource('kaupungit', { type: 'geojson', data: cities, promoteId: 'code' });

      addLayer({
        id: 'mk-fill',
        type: 'fill',
        source: 'maakunnat',
        paint: {
          'fill-color': ['case', has, colorExpression(yoy, bound), NO_DATA_FILL],
          'fill-opacity': ['case', flag('dim'), 0.22, 1],
          'fill-opacity-transition': { duration: 300 },
        },
      });
      addLayer({
        id: 'mk-nodata',
        type: 'fill',
        source: 'maakunnat',
        paint: {
          'fill-pattern': 'hatch',
          'fill-opacity': ['case', has, 0, ['case', flag('dim'), 0.3, 1]],
        },
      });
      addLayer({
        id: 'mk-line',
        type: 'line',
        source: 'maakunnat',
        layout: { 'line-join': 'round' },
        paint: {
          'line-color': ['case', flag('selected'), '#ffffff', flag('hover'), '#ffffff', PAGE],
          'line-width': ['case', flag('selected'), 1.6, flag('hover'), 2, 1],
          'line-opacity': ['case', flag('dim'), ['case', flag('hover'), 0.9, 0.5], 1],
        },
      });
      addLayer({
        id: 'keh-line',
        type: 'line',
        source: 'kehys',
        layout: { visibility: 'none' },
        paint: { 'line-color': '#ffffff', 'line-width': 1.4, 'line-dasharray': [3, 3], 'line-opacity': 0.8 },
      });
      addLayer({
        id: 'city-circles',
        type: 'circle',
        source: 'kaupungit',
        paint: {
          'circle-radius': radiusExpr() as never,
          'circle-color': ['case', has, colorExpression(yoy, bound), 'rgba(0,0,0,0)'] as never,
          'circle-opacity': ['case', flag('dim'), 0.3, 0.95],
          'circle-stroke-color': ['case', flag('selected'), '#ffffff', flag('hover'), '#ffffff', has, PAGE, NO_DATA_STROKE] as never,
          'circle-stroke-width': ['case', flag('selected'), 2.5, flag('hover'), 2.5, 1.5],
          'circle-stroke-opacity': ['case', flag('dim'), 0.35, 1],
          'circle-radius-transition': { duration: 0 },
        },
      });

      for (const f of data.maakunnat.features) {
        if (!f.properties.hasData) continue;
        const { outer, label } = makeLabel(f.properties.name, 'map-label-mk');
        new maplibregl.Marker({ element: outer, anchor: 'center' }).setLngLat([f.properties.lon, f.properties.lat]).addTo(map);
        const mkSales = cities.features
          .filter((c) => c.properties.parent === f.properties.code)
          .reduce((acc, c) => acc + meanSales(c.properties.code), 0);
        mkLabels.set(f.properties.code, { el: label, lngLat: [f.properties.lon, f.properties.lat], priority: mkSales });
      }
      for (const f of cities.features) {
        const { outer, label: el } = makeLabel(f.properties.name, 'map-label-city');
        const marker = new maplibregl.Marker({ element: outer, anchor: 'top' })
          .setLngLat(f.geometry.coordinates as [number, number])
          .addTo(map);
        cityLabels.set(f.properties.code, {
          el,
          marker,
          parent: f.properties.parent,
          lngLat: f.geometry.coordinates as [number, number],
          priority: meanSales(f.properties.code),
        });
      }

      const canvas = map.getCanvas();
      map.on('mousemove', (e) => {
        const hit = hitAt(e.point);
        canvas.style.cursor = hit && !(hit.kind === 'maakunta' && !data.series[hit.code]) ? 'pointer' : '';
        setHover(hit);
        cb.onHover(hit, { x: e.point.x, y: e.point.y });
      });
      map.on('mouseout', () => {
        setHover(null);
        cb.onHover(null, { x: 0, y: 0 });
      });
      map.on('click', (e) => {
        const hit = hitAt(e.point);
        if (!hit) return cb.onSelect({ kind: 'none' });
        if (hit.kind === 'maakunta' && !data.series[hit.code]) return; // Ahvenanmaa
        // Klikkaus valittuun maakuntaan tyhjässä kohdassa poistaa valinnan
        if (hit.kind === 'maakunta' && selection.kind === 'maakunta' && selection.code === hit.code) {
          return cb.onSelect({ kind: 'none' });
        }
        cb.onSelect(hit.kind === 'city' ? { kind: 'city', code: hit.code } : { kind: 'maakunta', code: hit.code });
      });
      map.on('zoom', () => {
        for (const [code, l] of cityLabels) l.marker.setOffset([0, radiusAt(data.series[code]?.sales?.[qi] ?? null, map.getZoom()) + 2]);
      });
      map.on('moveend', refreshLabels);
      window.addEventListener('resize', () => map.fitBounds(FINLAND, { padding: padding(), duration: 0 }));

      const controller: MapController = {
        setQuarter(i) {
          qi = i;
          for (const f of data.maakunnat.features) {
            const v = data.series[f.properties.code]?.yoy[i] ?? null;
            map.setFeatureState({ source: 'maakunnat', id: f.properties.code }, { has: v !== null, yoy: v ?? 0 });
          }
          for (const f of cities.features) {
            const s = data.series[f.properties.code];
            const v = s?.yoy[i] ?? null;
            const n = s?.sales[i] ?? null;
            map.setFeatureState(
              { source: 'kaupungit', id: f.properties.code },
              { has: v !== null, yoy: v ?? 0, hasSales: n !== null, sales: n ?? 0 },
            );
          }
          refreshLabels();
        },
        setSelection(sel) {
          const before = mkOf(selection);
          selection = sel;
          applyDim();
          // Kaupunkiklikkaus saman maakunnan sisällä ei liikuta karttaa
          if (mkOf(sel) !== before || sel.kind === 'none' || sel.kind === 'maakunta') fitTo(sel);
        },
      };
      controller.setQuarter(qi);
      applyDim();
      resolve(controller);
    });
  });
}

