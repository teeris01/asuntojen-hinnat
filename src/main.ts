import './style.css';
import { loadData } from './data';
import { createMap, type Selection, type Hit } from './map';
import { createPanel } from './panel';
import { createTimeline } from './timeline';
import { NO_DATA_STROKE, colorFor, cssGradient, inkOn } from './colors';
import { esc, fmtEur, fmtInt, fmtPct, fmtQuarter } from './format';
import type { AppData } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Selite; palauttaa päivityksen, joka kertoo kun neljännekselle ei ole kauppamääriä (ympyrät vakiokokoisia). */
function buildLegend(root: HTMLElement, data: AppData): (qi: number) => void {
  const b = data.meta.yoyScale.bound;
  const ticks = [-b, -b / 2, 0, b / 2, b].map((v) => `<span>${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}</span>`).join('');
  root.innerHTML = `
    <h2>Vuosimuutos, %</h2>
    <div class="lg-bar" style="background:${cssGradient()}"></div>
    <div class="lg-ticks">${ticks}</div>
    <p class="note">Skaala on kiinnitetty koko aikasarjan yli, joten laman ja nousukauden voi verrata toisiinsa. Ääriarvot näkyvät ääripäiden väreinä.</p>
    <div class="lg-row"><svg width="64" height="26" aria-hidden="true"><circle cx="7" cy="13" r="4" class="lg-c"/><circle cx="24" cy="13" r="7" class="lg-c"/><circle cx="48" cy="13" r="11" class="lg-c"/></svg><span>Ympyrän koko: kauppamäärä neljänneksessä</span></div>
    <p class="note lg-sales-note" hidden></p>
    <div class="lg-row"><svg width="46" height="22" aria-hidden="true"><circle cx="14" cy="11" r="5" fill="none" stroke="${NO_DATA_STROKE}" stroke-width="1.5"/></svg><span>Ei tietoa: tyhjä ympyrä tai vinoviivat</span></div>`;

  const note = root.querySelector<HTMLElement>('.lg-sales-note')!;
  const cities = data.areas.filter((a) => a.level === 'kunta');
  return (qi) => {
    const hasSales = cities.some((a) => data.series[a.code].sales[qi] !== null);
    note.hidden = hasSales;
    if (!hasSales) {
      const q = data.quarters[qi];
      note.textContent =
        q > data.meta.lastSalesQuarter
          ? `Tälle neljännekselle ei ole vielä kauppamääriä, joten ympyrät ovat vakiokokoisia. Viimeisin kauppamäärätieto: ${fmtQuarter(data.meta.lastSalesQuarter)}.`
          : 'Kauppamääriä on vasta vuodesta 2006, joten ympyrät ovat vakiokokoisia.';
    }
  };
}

function tooltipHtml(data: AppData, hit: Hit, qi: number): string {
  const a = data.areaByCode.get(hit.code);
  const s = data.series[hit.code];
  if (!s) {
    const name = data.maakunnat.features.find((f) => f.properties.code === hit.code)?.properties.name ?? hit.code;
    return `<strong>${esc(name)}</strong><br><span class="muted">Ei mukana tilastossa</span>`;
  }
  const yoy = s.yoy[qi];
  const sqm = s.sqm[qi];
  const sales = s.sales[qi];
  const bg = yoy === null ? '' : colorFor(yoy, data.meta.yoyScale.bound);
  const chip = yoy === null ? '<span class="chip chip-none">ei tietoa</span>' : `<span class="chip" style="background:${bg};color:${inkOn(bg)}">${fmtPct(yoy)}</span>`;
  const prelim = data.meta.preliminary.includes(data.quarters[qi]) ? ' <span class="muted">(ennakkotieto)</span>' : '';
  return `<strong>${esc(a?.name ?? hit.code)}</strong>${prelim}<br>${chip} <span class="muted">vuosimuutos, ${fmtQuarter(data.quarters[qi])}</span>
    <br>${sqm === null ? '<span class="muted">neliöhinta: ei tietoa</span>' : `${fmtEur(sqm)} <span class="muted">neliöhinta</span>`}
    ${hit.kind === 'city' ? `<br>${sales === null ? '<span class="muted">kauppamäärä: ei tietoa</span>' : `${fmtInt(sales)} kauppaa <span class="muted">neljänneksessä</span>`}` : ''}`;
}

async function main(): Promise<void> {
  const data = await loadData();
  // Avaa viimeiseen neljännekseen, jolla on kauppamäärät (tuoreimmilta ei ole, ja silloin ympyrät ovat vakiokokoisia)
  const salesIdx = data.quarters.indexOf(data.meta.lastSalesQuarter);
  let qi = salesIdx >= 0 ? salesIdx : data.quarters.length - 1;
  let selection: Selection = { kind: 'none' };

  const updateLegend = buildLegend($('legend'), data);
  $('source').innerHTML = `Lähde: ${esc(data.meta.source)}. Päivitetty ${esc(data.meta.updated)}. ` +
    `Ennakkotiedot (${data.meta.preliminary.map(fmtQuarter).join(', ')}) voivat tarkentua. ` +
    `Kauppamäärät varainsiirtoveroaineistosta 2006–${fmtQuarter(data.meta.lastSalesQuarter)}; ne eivät ole täysin vertailukelpoisia ${fmtQuarter(data.meta.salesBreaks[0] ?? '')} alkaen.`;

  const tooltip = $('tooltip');
  let mapCtl: Awaited<ReturnType<typeof createMap>>;

  const panel = createPanel($('panel'), data, (sel) => choose(sel));

  function choose(sel: Selection): void {
    selection = sel;
    mapCtl.setSelection(sel);
    panel.update(sel, qi);
  }

  mapCtl = await createMap($('map'), data, {
    onHover(hit, p) {
      if (!hit) {
        tooltip.hidden = true;
        return;
      }
      tooltip.innerHTML = tooltipHtml(data, hit, qi);
      tooltip.hidden = false;
      const w = tooltip.offsetWidth;
      const h = tooltip.offsetHeight;
      const x = Math.min(p.x + 16, window.innerWidth - w - 8);
      const y = Math.max(8, Math.min(p.y + 16, window.innerHeight - h - 8));
      tooltip.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
    },
    onSelect: choose,
  });

  createTimeline(
    $('timeline'),
    data,
    (i) => {
      qi = i;
      mapCtl.setQuarter(i);
      panel.update(selection, i);
      updateLegend(i);
    },
    qi,
  );
  updateLegend(qi);
  mapCtl.setQuarter(qi);
  panel.update(selection, qi);

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (selection.kind === 'city') {
      const parent = data.areaByCode.get(selection.code)?.parent;
      choose(parent ? { kind: 'maakunta', code: parent } : { kind: 'none' });
    } else if (selection.kind === 'maakunta') choose({ kind: 'none' });
  });
}

main().catch((err) => {
  console.error(err);
  const el = $('error');
  el.hidden = false;
  el.textContent = `Datan lataus epäonnistui: ${(err as Error).message}. Aja "npm run build:data".`;
});
