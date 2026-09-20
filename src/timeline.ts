/**
 * Aikaliuku neljänneksittäin + play-painike, joka ajaa koko sarjan läpi ~30 sekunnissa.
 * Liu'ussa ei tehdä yhtään verkkokutsua: kaikki data on jo muistissa.
 */
import type { AppData } from './types';
import { fmtQuarter } from './format';

export const PLAY_TOTAL_MS = 30_000;

/** Merkityt jaksot: tulkinta on datan kansallisesta vuosimuutoksesta (minimit tarkistettu). */
const EPISODES: { quarter: string; label: string }[] = [
  { quarter: '1992Q4', label: 'Lama' },
  { quarter: '2009Q1', label: 'Finanssikriisi' },
  { quarter: '2023Q3', label: 'Korkojen nousu' },
];

export interface Timeline {
  set(i: number): void;
  pause(): void;
}

export function createTimeline(
  root: HTMLElement,
  data: AppData,
  onChange: (i: number) => void,
  initial?: number,
): Timeline {
  const n = data.quarters.length;
  const last = n - 1;
  const msPerStep = PLAY_TOTAL_MS / last;
  let idx = initial ?? last;
  let playing = false;
  let raf = 0;

  const frac = (i: number) => i / last;
  // Liukusäätimen peukalo on 16 px: tikkujen ja käyrän on osuttava saman kohtaan kuin peukalo
  const pos = (f: number) => `calc(8px + (100% - 16px) * ${f.toFixed(5)})`;

  const national = data.series[data.areas[0].code];
  const nat = national.yoy;
  const vals = nat.filter((v): v is number => v !== null);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);

  const W = 1000;
  const H = 44;
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * (H - 4) - 2;
  let d = '';
  let pen = false;
  nat.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${(frac(i) * W).toFixed(1)},${y(v).toFixed(1)}`;
    pen = true;
  });
  const zeroY = y(0).toFixed(1);

  const years: string[] = [];
  data.quarters.forEach((q, i) => {
    if (q.endsWith('Q1') && Number(q.slice(0, 4)) % 10 === 0) years.push(`<span class="tl-tick" style="left:${pos(frac(i))}">${q.slice(0, 4)}</span>`);
  });
  const episodes = EPISODES.map((e) => ({ ...e, i: data.quarters.indexOf(e.quarter) }))
    .filter((e) => e.i >= 0)
    .map((e) => `<span class="tl-episode" style="left:${pos(frac(e.i))}">${e.label}</span>`)
    .join('');

  root.innerHTML = `
    <div class="tl-head">
      <button type="button" class="tl-play" aria-label="Toista aikasarja"></button>
      <output class="tl-q" aria-live="off"></output>
      <span class="tl-hint">Kansallinen vuosimuutos aikajanalla</span>
    </div>
    <div class="tl-track">
      <svg class="tl-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" class="tl-zero" />
        <path d="${d}" class="tl-line" />
      </svg>
      <input class="tl-range" type="range" min="0" max="${last}" step="1" value="${initial ?? last}" aria-label="Neljännes" />
      <div class="tl-marks">${episodes}</div>
      <div class="tl-ticks">${years.join('')}</div>
    </div>`;

  const btn = root.querySelector<HTMLButtonElement>('.tl-play')!;
  const out = root.querySelector<HTMLOutputElement>('.tl-q')!;
  const range = root.querySelector<HTMLInputElement>('.tl-range')!;

  function render(): void {
    const q = data.quarters[idx];
    const prelim = data.meta.preliminary.includes(q);
    out.innerHTML = `${fmtQuarter(q)}${prelim ? ' <span class="tl-prelim" title="Ennakkotieto: voi tarkentua">ennakkotieto</span>' : ''}`;
    range.value = String(idx);
    range.setAttribute('aria-valuetext', fmtQuarter(q));
    btn.setAttribute('aria-label', playing ? 'Pysäytä' : 'Toista aikasarja');
    btn.classList.toggle('is-playing', playing);
    range.style.setProperty('--f', String(frac(idx)));
  }

  function set(i: number): void {
    const next = Math.max(0, Math.min(last, i));
    if (next === idx) return;
    idx = next;
    render();
    onChange(idx);
  }

  function pause(): void {
    playing = false;
    cancelAnimationFrame(raf);
    render();
  }

  function play(): void {
    if (idx >= last) {
      idx = 0;
      onChange(idx);
    }
    playing = true;
    // Aloitushetki otetaan ensimmäisen framen omasta aikaleimasta: rAF:n aikaleima on framen alkuhetki
    // ja voi olla aikaisempi kuin performance.now() klikkaushetkellä, jolloin ero olisi negatiivinen.
    let startT: number | null = null;
    const startI = idx;
    const tick = (t: number): void => {
      if (!playing) return;
      startT ??= t;
      const target = Math.max(startI, Math.min(last, startI + Math.floor((t - startT) / msPerStep)));
      if (target !== idx) {
        idx = target;
        onChange(idx);
      }
      render();
      if (idx >= last) pause();
      else raf = requestAnimationFrame(tick);
    };
    render();
    raf = requestAnimationFrame(tick);
  }

  btn.addEventListener('click', () => (playing ? pause() : play()));
  range.addEventListener('input', () => {
    if (playing) pause();
    set(Number(range.value));
  });
  range.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      playing ? pause() : play();
    }
  });

  render();
  return { set, pause };
}
