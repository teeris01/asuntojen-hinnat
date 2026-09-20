/**
 * Väriskaala: divergoiva, ankkuroitu nollaan, ääripäät kiinnitetty koko aikasarjan yli.
 * Nousu = sininen, lasku = punainen, nolla = neutraali harmaa. Tumma pinta.
 * Haarat ovat OKLab-vaaleudeltaan symmetriset (L ≈ 0,48 / 0,57 / 0,67 / 0,76).
 * Sama skaala kartalle, ympyröille, selitteelle ja paneelin merkeille.
 */

export const SURFACE = '#1a1a19';
export const PAGE = '#0d0d0d';
export const MID = '#383835';
/** Ei tietoa: pinnan sävy + vinoviivakuvio (ei koskaan nollan väri) */
export const NO_DATA_FILL = '#1f1f1e';
export const NO_DATA_STROKE = '#6b6a66';

const BLUE = ['#1c5cab', '#2a78d6', '#5598e7', '#86b6ef'];
const RED = ['#9c3737', '#c24646', '#e66767', '#ef9191'];

/** [osuus rajasta -1..1, väri], nollasta ulospäin neljä askelta / haara */
export const STOPS: [number, string][] = [
  ...RED.map((c, i) => [-(4 - i) / 4, c] as [number, string]),
  [0, MID],
  ...BLUE.map((c, i) => [(i + 1) / 4, c] as [number, string]),
];

/** MapLibre-ilmaisu: arvo (%) -> väri, skaala ±bound. */
export function colorExpression(value: unknown, bound: number): unknown[] {
  const stops: unknown[] = [];
  for (const [t, c] of STOPS) stops.push(t * bound, c);
  return ['interpolate-lab', ['linear'], value, ...stops];
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** Sama skaala JS:ssä (paneeli, selite). Interpolointi sRGB:ssä, riittää pieniin merkkeihin. */
export function colorFor(value: number, bound: number): string {
  const t = Math.max(-1, Math.min(1, value / bound));
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    if (t <= t1) {
      const [t0, c0] = STOPS[i - 1];
      const f = (t - t0) / (t1 - t0);
      const a = rgb(c0);
      const b = rgb(c1);
      return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(',')})`;
    }
  }
  return STOPS[STOPS.length - 1][1];
}

/** CSS-liukuväri selitteelle. */
export function cssGradient(): string {
  return `linear-gradient(to right, ${STOPS.map(([t, c]) => `${c} ${((t + 1) * 50).toFixed(1)}%`).join(', ')})`;
}

/** Tekstiväri, joka erottuu annetusta taustasta. */
export function inkOn(bg: string): string {
  const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(bg);
  const [r, g, b] = m ? [Number(m[1]), Number(m[2]), Number(m[3])] : rgb(bg);
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? '#0b0b0b' : '#ffffff';
}
