import './style.css';
import { loadData } from './data';
import { createMap, type Selection, type Hit } from './map';
import { createPanel } from './panel';
import { createTimeline } from './timeline';
import { NO_DATA_STROKE, colorFor, cssGradient, inkOn } from './colors';
import { esc, fmtEur, fmtInt, fmtPct, fmtQuarter } from './format';
import type { AppData } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const LEGEND_KEY = 'asuntojen-hinnat.legend-collapsed';

function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(LEGEND_KEY);
    if (v !== null) return v === '1';
  } catch {
    /* localStorage ei käytössä: oletusarvo */
  }
  return window.innerWidth < 760; // kapealla näytöllä selite on oletuksena piilossa
}

function saveCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(LEGEND_KEY, collapsed ? '1' : '0');
  } catch {
    /* ei haittaa */
  }
}

/** Selite, jonka voi minimoida. Tila muistetaan selaimessa. */
function buildLegend(root: HTMLElement, data: AppData): void {
  const b = data.meta.yoyScale.bound;
  const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
  const ticks = [-b, -b / 2, 0, b / 2, b].map((v) => `<span>${sign(v)}${Math.abs(v)}</span>`).join('');
  const prelim = data.meta.preliminary.map(fmtQuarter).join(' ja ');
  const salesBreak = data.meta.salesBreaks[0];

  root.innerHTML = `
    <button type="button" class="lg-head" id="lg-toggle" aria-controls="lg-body">
      <span class="lg-title">Selite</span>
      <span class="lg-mini" style="background:${cssGradient()}" aria-hidden="true"></span>
      <span class="lg-chevron" aria-hidden="true"></span>
    </button>
    <div class="lg-body" id="lg-body">
      <h2>Vuosimuutos, %</h2>
      <div class="lg-bar" style="background:${cssGradient()}"></div>
      <div class="lg-ticks">${ticks}</div>
      <p class="lg-text">Väri kertoo, kuinka paljon vanhojen osakeasuntojen hintaindeksi on muuttunut vuodessa, eli valittu neljännes verrattuna samaan neljännekseen vuotta aiemmin. <strong>Sininen</strong> on nousu, <strong>punainen</strong> lasku ja harmaa lähes ennallaan.</p>
      <p class="lg-text">Skaala on kiinteä koko aikasarjalle (${fmtQuarter(data.meta.firstQuarter)}–), joten laman ja nousukauden voi verrata toisiinsa. Yli ±${b} %:n muutokset näkyvät ääripäiden väreinä.</p>
      <div class="lg-row"><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="7" class="lg-c"/></svg><span>Ympyrä on kaupunki. Väri kertoo kaupungin oman vuosimuutoksen.</span></div>
      <div class="lg-row"><svg width="22" height="22" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="${NO_DATA_STROKE}" stroke-width="1.5"/></svg><span>Ei tietoa: tyhjä ympyrä tai vinoviivat. Ahvenanmaa ei ole mukana tilastossa.</span></div>
      <p class="note">Muutos lasketaan laatuvakioidusta hintaindeksistä, ei neliöhinnoista. Ennakkotiedot (${prelim}) voivat tarkentua. Kauppamäärät (vihjeessä ja paneelissa) ovat varainsiirtoveroaineistoa 2006–${fmtQuarter(data.meta.lastSalesQuarter)}${salesBreak ? `, eivätkä ne ole täysin vertailukelpoisia ${fmtQuarter(salesBreak)} alkaen` : ''}.</p>
    </div>`;

  const toggle = root.querySelector<HTMLButtonElement>('#lg-toggle')!;
  const apply = (collapsed: boolean): void => {
    root.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.title = collapsed ? 'Näytä selite' : 'Piilota selite';
  };
  apply(readCollapsed());
  toggle.addEventListener('click', () => {
    const collapsed = !root.classList.contains('is-collapsed');
    apply(collapsed);
    saveCollapsed(collapsed);
  });
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
    ${hit.kind === 'city' && sales !== null ? `<br>${fmtInt(sales)} kauppaa <span class="muted">neljänneksessä</span>` : ''}`;
}

async function main(): Promise<void> {
  const data = await loadData();
  // Avaa viimeisimpiin tietoihin
  let qi = data.quarters.length - 1;
  let selection: Selection = { kind: 'none' };

  buildLegend($('legend'), data);
  $('source').textContent = `Lähde: ${data.meta.source} · päivitetty ${data.meta.updated}`;

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

  createTimeline($('timeline'), data, (i) => {
    qi = i;
    mapCtl.setQuarter(i);
    panel.update(selection, i);
  });
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
  el.textContent = `Datan lataus epäonnistui: ${(err as Error).message}. Aja "npm run build".`;
});
