/**
 * Sivupaneeli: koko maa -> maakunta (kaupungit) -> kaupunki (osa-alueet pylväinä hintatason mukaan).
 * Muutos-% tulee aina indeksisarjasta (`yoy`). Neliöhinta näytetään vain tasona.
 */
import type { AppData } from './types';
import type { Selection } from './map';
import { colorFor, inkOn } from './colors';
import { esc, fmtEur, fmtInt, fmtPct, fmtQuarter } from './format';

export interface Panel {
  update(sel: Selection, qi: number): void;
}

/** "KOKO MAA" -> "Koko maa" */
const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLocaleLowerCase('fi');

export function createPanel(root: HTMLElement, data: AppData, onSelect: (sel: Selection) => void): Panel {
  const bound = data.meta.yoyScale.bound;
  const national = data.areas[0].code;
  const kehys = data.areas.find((a) => a.level === 'kehys');
  let current: Selection = { kind: 'none' };
  let qi = data.quarters.length - 1;

  const val = (code: string, key: 'yoy' | 'sqm' | 'sales'): number | null => data.series[code]?.[key][qi] ?? null;

  function chip(code: string): string {
    const v = val(code, 'yoy');
    if (v === null) return '<span class="chip chip-none" title="Ei tietoa tälle neljännekselle">ei tietoa</span>';
    const bg = colorFor(v, bound);
    return `<span class="chip" style="background:${bg};color:${inkOn(bg)}">${fmtPct(v)}</span>`;
  }

  /** Neliöhinnan rivi: tieto, tai perustelu miksi sitä ei ole (ei koskaan pelkkä nolla). */
  function sqmLine(code: string): string {
    const sqm = val(code, 'sqm');
    if (sqm !== null) return `${fmtEur(sqm)} <span class="muted">keskimääräinen neliöhinta</span>`;
    const arr = data.series[code].sqm;
    const first = arr.findIndex((v) => v !== null);
    const lastIdx = arr.length - 1 - [...arr].reverse().findIndex((v) => v !== null);
    if (first < 0) return '<span class="muted">neliöhinta: ei tietoa</span>';
    if (qi < first) return `<span class="muted">neliöhintatiedot alkavat ${fmtQuarter(data.quarters[first])}</span>`;
    const latest = arr[lastIdx] as number;
    return `${fmtEur(latest)} <span class="muted">neliöhinta ${fmtQuarter(data.quarters[lastIdx])} (viimeisin tieto)</span>`;
  }

  function headline(code: string): string {
    const s = data.series[code];
    const firstIdx = s.index.findIndex((v) => v !== null);
    const since = firstIdx > 0 ? `<p class="note">Indeksisarja alkaa ${fmtQuarter(data.quarters[firstIdx])}.</p>` : '';
    return `
      <div class="hero">
        <div class="hero-main">${chip(code)}<span class="hero-cap">vuosimuutos, ${fmtQuarter(data.quarters[qi])}</span></div>
        <div class="hero-sub">${sqmLine(code)}</div>
      </div>${since}${sparkline(code)}`;
  }

  /** Vuosimuutos koko sarjan yli, sama ±skaala kuin kartalla, valittu neljännes merkittynä. */
  function sparkline(code: string): string {
    const yoy = data.series[code].yoy;
    const W = 320;
    const H = 84;
    const x = (i: number) => (i / (yoy.length - 1)) * W;
    const y = (v: number) => H / 2 - (Math.max(-bound, Math.min(bound, v)) / bound) * (H / 2 - 4);
    let d = '';
    let pen = false;
    yoy.forEach((v, i) => {
      if (v === null) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    const cur = yoy[qi];
    return `
      <svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vuosimuutos ${fmtQuarter(data.quarters[0])}–${fmtQuarter(data.quarters[yoy.length - 1])}">
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="spark-zero" />
        <line x1="${x(qi).toFixed(1)}" x2="${x(qi).toFixed(1)}" y1="0" y2="${H}" class="spark-now" />
        <path d="${d}" class="spark-line" />
        ${cur === null ? '' : `<circle cx="${x(qi).toFixed(1)}" cy="${y(cur).toFixed(1)}" r="3.5" class="spark-dot" style="fill:${colorFor(cur, bound)}" />`}
      </svg>
      <div class="spark-axis"><span>${data.quarters[0].slice(0, 4)}</span><span>vuosimuutos, kiinteä skaala ±${bound} %</span><span>${data.quarters[yoy.length - 1].slice(0, 4)}</span></div>`;
  }

  interface Row {
    code: string;
    label: string;
    action?: Selection;
  }

  /** Rivit pylväinä: pituus = neliöhinta (taso), merkki = vuosimuutos (indeksistä). */
  function bars(rows: Row[], extra?: (code: string) => string): string {
    const max = Math.max(1, ...rows.map((r) => val(r.code, 'sqm') ?? 0));
    const anySqm = rows.some((r) => val(r.code, 'sqm') !== null);
    return `<ul class="bars${anySqm ? '' : ' no-sqm'}">${rows
      .map((r, k) => {
        const sqm = val(r.code, 'sqm');
        const w = sqm === null ? 0 : (sqm / max) * 100;
        const body = `
          <span class="bar-label">${esc(r.label)}</span>
          <span class="bar-track">${sqm === null ? (anySqm ? '<span class="bar-none">ei tietoa</span>' : '') : `<span class="bar-fill" style="width:${w.toFixed(1)}%"></span>`}</span>
          <span class="bar-val">${sqm === null ? '' : fmtInt(sqm)}</span>
          ${chip(r.code)}${extra ? extra(r.code) : ''}`;
        return r.action
          ? `<li><button type="button" class="bar-row" data-row="${k}">${body}</button></li>`
          : `<li><div class="bar-row">${body}</div></li>`;
      })
      .join('')}</ul>`;
  }

  function render(): void {
    const sel = current;
    let html = '';
    let rows: Row[] = [];

    if (sel.kind === 'none') {
      const mks = data.areas.filter((a) => a.level === 'maakunta');
      rows = mks.map((a) => ({ code: a.code, label: a.name, action: { kind: 'maakunta', code: a.code } }));
      html = `
        <h2>${esc(titleCase(data.areaByCode.get(national)!.name))}</h2>
        ${headline(national)}
        <h3>Maakunnat <span class="muted">(klikkaa karttaa tai riviä)</span></h3>
        ${bars(rows)}
        <p class="note">Ahvenanmaa ei ole mukana tilastossa eikä koko maan luvuissa.</p>`;
    } else if (sel.kind === 'maakunta') {
      const a = data.areaByCode.get(sel.code)!;
      const cities = data.areas.filter((c) => c.level === 'kunta' && c.parent === sel.code);
      rows = cities
        .slice()
        .sort((p, q) => (val(q.code, 'sqm') ?? -1) - (val(p.code, 'sqm') ?? -1))
        .map((c) => ({ code: c.code, label: c.name, action: { kind: 'city', code: c.code } }));
      const kehysRow = kehys && sel.code === kehys.parent ? bars([{ code: kehys.code, label: kehys.name }]) : '';
      html = `
        <button type="button" class="back" data-back>← Koko maa</button>
        <h2>${esc(a.name)}</h2>
        ${headline(sel.code)}
        <h3>Kaupungit <span class="muted">neliöhinnan mukaan</span></h3>
        ${bars(rows, (code) => salesCell(code))}
        ${kehysRow ? `<h3>Kehyskunnat <span class="muted">(katkoviiva kartalla)</span></h3>${kehysRow}` : ''}`;
    } else {
      const a = data.areaByCode.get(sel.code)!;
      const parent = data.areaByCode.get(a.parent ?? '');
      const subs = data.areas.filter((s) => s.level === 'osa-alue' && s.parent === sel.code);
      // Numero 1 on kallein: järjestys hintatason mukaan on koodin numerojärjestys
      rows = subs.map((s) => ({ code: s.code, label: s.name.replace(`${a.name} `, 'Osa-alue ') }));
      html = `
        <button type="button" class="back" data-back>← ${esc(parent?.name ?? 'Koko maa')}</button>
        <h2>${esc(a.name)}</h2>
        ${headline(sel.code)}
        ${
          subs.length
            ? `<h3>Osa-alueet <span class="muted">hintatason mukaan, 1 = kallein</span></h3>${bars(rows)}
               <p class="note">Osa-alueet on muodostettu postinumeroalueista hintatason mukaan. Niillä ei ole karttageometriaa.</p>`
            : '<p class="note">Tilasto ei jaa tätä kaupunkia osa-alueisiin.</p>'
        }`;
    }

    html += `<p class="note fine">Muutos-% lasketaan laatuvakioidusta hintaindeksistä, ei neliöhinnoista: neliöhinta on toteutuneiden kauppojen keskiarvo ja heiluu sen mukaan, minkä kokoisia ja ikäisiä asuntoja sattui myydyksi.</p>`;
    root.innerHTML = html;

    root.querySelector('[data-back]')?.addEventListener('click', () => {
      if (sel.kind === 'city') {
        const parent = data.areaByCode.get(sel.code)?.parent;
        onSelect(parent ? { kind: 'maakunta', code: parent } : { kind: 'none' });
      } else onSelect({ kind: 'none' });
    });
    root.querySelectorAll<HTMLButtonElement>('[data-row]').forEach((b) => {
      b.addEventListener('click', () => {
        const action = rows[Number(b.dataset.row)].action;
        if (action) onSelect(action);
      });
    });
  }

  function salesCell(code: string): string {
    const n = val(code, 'sales');
    return n === null ? '' : `<span class="bar-sales" title="Kauppoja neljänneksessä">${fmtInt(n)} kpl</span>`;
  }

  return {
    update(sel, i) {
      const changedSel = sel.kind !== current.kind || ('code' in sel && 'code' in current ? sel.code !== current.code : false);
      current = sel;
      qi = i;
      // Säilytä vieritysasento, kun vain neljännes vaihtuu
      const top = changedSel ? 0 : root.scrollTop;
      render();
      root.scrollTop = top;
    },
  };
}
