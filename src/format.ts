const MINUS = '−';
const nf1 = new Intl.NumberFormat('fi-FI', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('fi-FI', { maximumFractionDigits: 0 });

/** "+3,2 %" / "−4,1 %" (oikea miinusmerkki, desimaalipilkku) */
export function fmtPct(v: number): string {
  const s = nf1.format(Math.abs(v));
  return `${v > 0 ? '+' : v < 0 ? MINUS : ''}${s} %`;
}

export function fmtInt(v: number): string {
  return nf0.format(v);
}

export function fmtEur(v: number): string {
  return `${nf0.format(v)} €/m²`;
}

/** "2026Q2" -> "2026 Q2" */
export function fmtQuarter(q: string): string {
  return `${q.slice(0, 4)} ${q.slice(4)}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
