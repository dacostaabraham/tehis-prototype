// Pharmacies de garde de la semaine : liste publiée par abidjan.net (communes d'Abidjan et villes de l'intérieur),
// avec adresse, téléphone et coordonnées. Lue au plus toutes les 6 heures et gardée en mémoire.
// Certaines coordonnées de la source sont fausses (pharmacie de l'intérieur placée au Plateau, par exemple) :
// elles sont écartées et la pharmacie est rattachée à la commune de l'utilisateur.
import { distanceMetres } from './lieux.js';

export const SOURCE_GARDE = process.env.GARDE_URL || 'https://business.abidjan.net/pharmacies-de-garde';
const UA = 'Mozilla/5.0 (compatible; Tehis/0.1; assistant IA, Cote d\'Ivoire)';
const DUREE_CACHE = 6 * 3_600_000;
const ABIDJAN = { lat: 5.35, lng: -4.0 };
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const entites = (s) => String(s || '')
  .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/[`’]/g, "'").replace(/\s+/g, ' ').trim();
const PETITS = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'au', 'aux', "d'", "l'"]);
const majuscules = (s) => s.toLowerCase()
  .replace(/(^|[\s\-'(])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Ii|Iii|Iv|Vi|Vii)\b/g, (r) => r.toUpperCase())
  .replace(/(?<=\S\s)(De|Des|Du|La|Le|Les|Et|En|Au|Aux|D'|L')(?=[\s\p{L}])/gu, (m) => (PETITS.has(m.toLowerCase()) ? m.toLowerCase() : m));

/** « ABIDJAN ABOBO PK 18 » → « Abobo PK 18 » ; « ABENGOUROU » → « Abengourou ». */
export function nomCommune(brut) {
  const s = majuscules(entites(brut)).replace(/\bPk\b/g, 'PK');
  return (s.replace(/^Abidjan\s+/, '') || s).replace(/^II Plateau$/, 'II Plateaux');
}
const estAbidjan = (brut) => /^ABIDJAN\b/i.test(entites(brut));

function lireDate(j, mois, an) {
  const m = MOIS.indexOf(mois.toLowerCase());
  return m < 0 ? null : `${an}-${String(m + 1).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
}

/** Lit la page : période et pharmacies, commune par commune. */
export function lireGardes(html) {
  const p = /P[ée]riode du (\d{1,2}) (\p{L}+) (\d{4}) au (\d{1,2}) (\p{L}+) (\d{4})/u.exec(html);
  const periode = p ? { debut: lireDate(p[1], p[2], p[3]), fin: lireDate(p[4], p[5], p[6]), texte: `du ${p[1]} ${p[2]} au ${p[4]} ${p[5]} ${p[6]}` } : null;
  const pharmacies = [];
  const sections = html.split(/<h1 class="[^"]*margTop50[^"]*">/).slice(1);
  for (const section of sections) {
    const fin = section.indexOf('</h1>');
    const communeBrute = section.slice(0, fin);
    for (const bloc of section.slice(fin).split('class="list-box-row"').slice(1)) {
      const nom = /class="list-box-title">([^<]+)</.exec(bloc)?.[1];
      if (!nom) continue;
      const sous = /class="list-box-subtitle">(?:<i[^>]*><\/i>)?([\s\S]*?)<\/a>/.exec(bloc)?.[1] || '';
      const coord = /href="(-?\d{1,2}\.\d+)\s+(-?\d{1,3}\.\d+)"\s+class="list-box-btn"/.exec(bloc);
      const tel = /href="tel:([^"]+)"/.exec(bloc)?.[1];
      const lien = /href="(https:\/\/business\.abidjan\.net\/pharmacies\/[^"]+)"/.exec(bloc)?.[1] || null;
      const lat = coord ? Number(coord[1]) : NaN, lng = coord ? Number(coord[2]) : NaN;
      pharmacies.push({
        nom: majuscules(entites(nom)).replace(/^Pharmacie\b/, 'Pharmacie'),
        commune: nomCommune(communeBrute),
        abidjan: estAbidjan(communeBrute),
        adresse: entites(sous).replace(/^(Abidjan|[\p{L} -]+?) - /u, '').slice(0, 180) || null,
        telephone: tel ? entites(tel).replace(/[^\d+]/g, '').replace(/^(\d{10})$/, '+225$1') : null,
        lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
        lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
        lien
      });
    }
  }
  return { periode, pharmacies: verifierCoordonnees(pharmacies) };
}

const mediane = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Écarte les coordonnées incohérentes : ville de l'intérieur placée à Abidjan, ou pharmacie loin du reste de sa commune. */
export function verifierCoordonnees(pharmacies) {
  const parCommune = new Map();
  for (const ph of pharmacies) if (ph.lat !== null) (parCommune.get(ph.commune) || parCommune.set(ph.commune, []).get(ph.commune)).push(ph);
  const centres = new Map([...parCommune].filter(([, l]) => l.length >= 3).map(([c, l]) => [c, { lat: mediane(l.map((x) => x.lat)), lng: mediane(l.map((x) => x.lng)) }]));
  return pharmacies.map((ph) => {
    if (ph.lat === null) return { ...ph, coordonneesSures: false };
    const pos = { lat: ph.lat, lng: ph.lng };
    let sure = Math.abs(ph.lat) <= 11 && ph.lng <= -2 && ph.lng >= -9; // Côte d'Ivoire
    if (sure && !ph.abidjan && distanceMetres(pos, ABIDJAN) < 30_000) sure = false;
    const c = centres.get(ph.commune);
    if (sure && c && distanceMetres(pos, c) > (ph.abidjan ? 7_000 : 15_000)) sure = false;
    return sure ? { ...ph, coordonneesSures: true } : { ...ph, lat: null, lng: null, coordonneesSures: false };
  });
}

let cache = null; // { t, donnees }
let enCours = null;

/** Liste de la semaine (cache 6 h). Renvoie null si la source est injoignable ou la période dépassée. */
export async function gardesDeLaSemaine({ fetchImpl = fetch, maintenant = new Date(), forcer = false } = {}) {
  const valide = (d) => d && d.pharmacies.length && (!d.periode?.fin || maintenant.toISOString().slice(0, 10) <= d.periode.fin);
  if (!forcer && cache && Date.now() - cache.t < DUREE_CACHE && valide(cache.donnees)) return cache.donnees;
  if (!enCours) {
    enCours = (async () => {
      const ctrl = new AbortController();
      const minuterie = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const r = await fetchImpl(SOURCE_GARDE, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'fr' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const donnees = lireGardes(await r.text());
        if (!donnees.pharmacies.length) throw new Error('page vide ou format changé');
        cache = { t: Date.now(), donnees };
        console.log(`[GARDE] ${donnees.pharmacies.length} pharmacies de garde (${donnees.periode?.texte || 'période inconnue'}), ${donnees.pharmacies.filter((p) => p.coordonneesSures).length} avec position fiable`);
      } catch (e) {
        console.warn(`[ALERTE ADMIN] Pharmacies de garde indisponibles (${SOURCE_GARDE}) : ${e.message}`);
      } finally { clearTimeout(minuterie); enCours = null; }
    })();
  }
  await enCours;
  return valide(cache?.donnees) ? cache.donnees : null;
}
export const viderCacheGardes = () => { cache = null; };

/**
 * Pharmacies de garde les plus proches d'un point. Celles dont la position est incertaine
 * sont ajoutées quand elles sont dans la même commune que les plus proches (distance inconnue).
 */
export function gardesProches(donnees, centre, { rayonKm = 8, max = 8 } = {}) {
  const avecDistance = donnees.pharmacies
    .filter((p) => p.coordonneesSures)
    .map((p) => ({ ...p, distance: distanceMetres(centre, p) }))
    .sort((a, b) => a.distance - b.distance);
  const proches = avecDistance.filter((p) => p.distance <= rayonKm * 1000).slice(0, max);
  const communes = new Set(avecDistance.slice(0, 3).filter((p) => p.distance <= 15_000).map((p) => p.commune));
  const sansPosition = donnees.pharmacies.filter((p) => !p.coordonneesSures && communes.has(p.commune)).map((p) => ({ ...p, distance: null }));
  return [...proches, ...sansPosition].slice(0, max + 3).map(({ coordonneesSures, abidjan, ...p }) => p);
}
