import type { FeatureCollection, MultiPolygon, Point, Polygon } from 'geojson';

export type Level = 'koonti' | 'maakunta' | 'kunta' | 'osa-alue' | 'kehys';

export interface Area {
  code: string;
  name: string;
  level: Level;
  parent: string | null;
}

export interface AreaSeries {
  /** Perusvuosi, jonka indeksisarjaa tämä alue käyttää (yksi per alue) */
  base: number;
  index: (number | null)[];
  /** Vuosimuutos-% laskettuna indeksistä, ei neliöhinnoista */
  yoy: (number | null)[];
  sqm: (number | null)[];
  sales: (number | null)[];
}

export interface Meta {
  source: string;
  updated: string;
  firstQuarter: string;
  lastQuarter: string;
  lastSalesQuarter: string;
  lastSqmQuarter: string;
  preliminary: string[];
  salesBreaks: string[];
  yoyScale: { min: number; max: number; bound: number };
}

type Poly = Polygon | MultiPolygon;

export interface AppData {
  meta: Meta;
  quarters: string[];
  areas: Area[];
  areaByCode: Map<string, Area>;
  series: Record<string, AreaSeries>;
  maakunnat: FeatureCollection<Poly, { code: string; name: string; hasData: boolean; lon: number; lat: number }>;
  kehys: FeatureCollection<Poly, { code: string; name: string }>;
  kaupungit: FeatureCollection<Point, { code: string; name: string; parent: string }>;
}
