// Petits graphiques en canvas, couleurs tirées du thème.
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

export const fcfa = (n) => (n === null || n === undefined || Number.isNaN(n)) ? '—'
  : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n))} FCFA`;
export const court = (n) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (a >= 1e3) return `${Math.round(n / 1e3).toLocaleString('fr-FR')} k`;
  return `${Math.round(n)}`;
};

/**
 * Courbes sur un axe commun.
 * series: [{ nom, couleur: '--chart-a', valeurs: [] }], etiquettes: [], marqueur: { index, texte }
 */
export function lineChart(canvas, { series, etiquettes, marqueur, zero = true }) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 320, h = canvas.clientHeight || 190;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const pad = { l: 46, r: 12, t: 12, b: 26 };
  const toutes = series.flatMap((s) => s.valeurs);
  let min = Math.min(...toutes, zero ? 0 : Infinity), max = Math.max(...toutes, zero ? 0 : -Infinity);
  if (min === max) { max += 1; min -= 1; }
  const n = etiquettes.length;
  const X = (i) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r));
  const Y = (v) => pad.t + (1 - (v - min) / (max - min)) * (h - pad.t - pad.b);
  const police = "11px 'IBM Plex Sans', system-ui, sans-serif";

  ctx.font = police; ctx.fillStyle = css('--muted'); ctx.strokeStyle = css('--chart-grid'); ctx.lineWidth = 1;
  const pas = 4;
  for (let k = 0; k <= pas; k++) {
    const v = min + ((max - min) * k) / pas; const y = Y(v);
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(court(v), pad.l - 6, y);
  }
  if (min < 0 && max > 0) { ctx.strokeStyle = css('--muted'); ctx.beginPath(); ctx.moveTo(pad.l, Y(0)); ctx.lineTo(w - pad.r, Y(0)); ctx.stroke(); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const saut = Math.ceil(n / 8);
  etiquettes.forEach((e, i) => { if (i % saut === 0 || (i === n - 1 && (n - 1) % saut >= saut / 2)) ctx.fillText(e, X(i), h - pad.b + 8); });

  for (const s of series) {
    ctx.strokeStyle = css(s.couleur) || s.couleur; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    ctx.beginPath(); s.valeurs.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
  }
  if (marqueur && marqueur.index >= 0 && marqueur.index < n) {
    const x = X(marqueur.index), v = marqueur.valeur, y = Y(v);
    ctx.fillStyle = css('--ink'); ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.font = "600 11px 'IBM Plex Sans', system-ui, sans-serif"; ctx.textBaseline = 'bottom';
    ctx.textAlign = x > w * 0.7 ? 'right' : x < w * 0.3 ? 'left' : 'center';
    ctx.fillText(marqueur.texte, x, y - 8);
  }
}
