// Lieux de Côte d'Ivoire gardés dans l'app (extrait OpenStreetMap, data/lieux-ci.json.gz).
// Les recherches « autour de moi » répondent sans réseau et sans dépendre des serveurs Overpass,
// souvent saturés ou fermés aux hébergeurs cloud. Mise à jour : `node scripts/maj-lieux-ci.mjs`.
import { readFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FICHIER = process.env.LIEUX_CI || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'lieux-ci.json.gz');
let donnees; // undefined = pas encore lu, null = absent

/** Charge l'extrait (une fois). Format : { genere, categories: { cat: [[nom, lat, lng, tel, horaires, adresse, osm]] }, places: [[nom, lat, lng, type]] } */
export function chargerLieuxLocaux(fichier = FICHIER) {
  if (donnees !== undefined && fichier === FICHIER) return donnees;
  let d = null;
  try {
    if (existsSync(fichier)) {
      const brut = readFileSync(fichier);
      d = JSON.parse((fichier.endsWith('.gz') ? gunzipSync(brut) : brut).toString('utf8'));
      const n = Object.values(d.categories || {}).reduce((s, l) => s + l.length, 0);
      console.log(`[lieux] extrait local : ${n} lieux, ${d.places?.length || 0} quartiers et villes (OpenStreetMap, ${d.genere || 'date inconnue'})`);
    } else console.warn(`[lieux] pas d'extrait local (${fichier}) : recherche en ligne seulement`);
  } catch (e) { console.warn(`[lieux] extrait local illisible : ${e.message}`); d = null; }
  if (fichier === FICHIER) donnees = d;
  return d;
}
export const viderLieuxLocaux = () => { donnees = undefined; };

const RAD = Math.PI / 180;
function distance(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLng = (b.lng - a.lng) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * Lieux d'une catégorie autour d'un point, au format des éléments Overpass (réutilise versLieux).
 * Renvoie null si l'extrait n'existe pas ou ne couvre pas la catégorie.
 */
export function lieuxLocaux(categorie, centre, rayonM, d = chargerLieuxLocaux()) {
  const liste = d?.categories?.[categorie];
  if (!liste) return null;
  const dLat = rayonM / 111_000, dLng = rayonM / (111_000 * Math.cos(centre.lat * RAD));
  const sortie = [];
  for (const [nom, lat, lng, tel, horaires, adresse, osm] of liste) {
    if (Math.abs(lat - centre.lat) > dLat || Math.abs(lng - centre.lng) > dLng) continue;
    if (distance(centre, { lat, lng }) > rayonM) continue;
    const [type, id] = String(osm || 'node/0').split('/');
    sortie.push({ type, id: Number(id), lat, lon: lng, tags: { name: nom, ...(tel ? { phone: tel } : {}), ...(horaires ? { opening_hours: horaires } : {}), ...(adresse ? { 'addr:street': adresse } : {}) } });
  }
  return sortie;
}

const simple = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const POIDS = { city: 5, town: 4, suburb: 4, quarter: 3, neighbourhood: 3, village: 2 };

/**
 * Quartier, commune ou ville → coordonnées, sans réseau.
 * « Yopougon Selmer » : on préfère « Selmer » s'il est près de « Yopougon ».
 */
export function geocoderLocal(texte, d = chargerLieuxLocaux()) {
  if (!d?.places?.length) return null;
  const q = simple(texte).replace(/\b(abidjan|cote d ivoire|ci|quartier|commune|ville|de|du|la|le|a)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 3) {
    if (!/abidjan/.test(simple(texte))) return null;
  }
  const mots = q.split(' ').filter((m) => m.length >= 3);
  const cible = q || 'abidjan';
  const candidats = [];
  for (const [nom, lat, lng, type] of d.places) {
    const n = simple(nom);
    if (!n || n.length < 3) continue;
    let score = 0;
    if (n === cible) score = 100;
    else if (cible.includes(n)) score = 40 + n.length;
    else if (n.includes(cible) && cible.length >= 4) score = 30 + cible.length;
    else continue;
    candidats.push({ nom, lat, lng, type, n, score: score + (POIDS[type] || 1) });
  }
  if (!candidats.length) return null;
  // Bonus : un autre mot de la demande correspond à un lieu proche (« Yopougon » autour de « Selmer »).
  for (const c of candidats) {
    for (const autre of candidats) {
      // Le lieu précis (quartier) gagne s'il est dans un lieu plus large cité aussi (commune, ville).
      if (autre === c || c.n.includes(autre.n) || (POIDS[autre.type] || 1) < (POIDS[c.type] || 1)) continue;
      if (mots.some((m) => autre.n.includes(m)) && distance(c, autre) < 15_000) { c.score += 25; break; }
    }
  }
  candidats.sort((a, b) => b.score - a.score || (POIDS[b.type] || 0) - (POIDS[a.type] || 0));
  const m = candidats[0];
  return { lat: m.lat, lng: m.lng, libelle: m.nom };
}
