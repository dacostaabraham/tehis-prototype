#!/usr/bin/env node
// Met à jour data/lieux-ci.json.gz : lieux utiles et quartiers de Côte d'Ivoire (OpenStreetMap).
//   node scripts/maj-lieux-ci.mjs              → télécharge depuis Overpass (quelques minutes)
//   node scripts/maj-lieux-ci.mjs /tmp/dossier → compacte des fichiers ci-*.json déjà téléchargés
// À relancer une fois par mois environ, puis committer le fichier.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES } from '../server/outils/lieux.js';

const ICI = dirname(fileURLToPath(import.meta.url));
const SORTIE = join(ICI, '..', 'data', 'lieux-ci.json.gz');
const SERVEURS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const UA = "Tehis/0.1 (assistant IA, Cote d'Ivoire)";
const TYPES_PLACES = ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood'];

// « ["amenity"="pharmacy"] » → { cle: 'amenity', valeur: 'pharmacy' }
const filtres = Object.entries(CATEGORIES).map(([id, c]) => ({ id, conditions: c.filtres.map((f) => { const m = /\["([^"]+)"="([^"]+)"\]/.exec(f); return { cle: m[1], valeur: m[2] }; }) }));

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Une requête par filtre (les serveurs refusent les grosses requêtes), avec essais répétés. */
async function telecharger() {
  const requetes = [...new Set(Object.values(CATEGORIES).flatMap((c) => c.filtres))].map((f) => ({ nom: f, corps: `nwr${f}(area.ci);` }));
  requetes.push({ nom: 'villes et quartiers', corps: 'node["place"~"^(city|town|suburb|quarter|neighbourhood)$"](area.ci);' });
  requetes.push({ nom: 'villages', corps: 'node["place"="village"](area.ci);' });
  const elements = [];
  const echecs = [];
  for (const [i, r] of requetes.entries()) {
    const q = `[out:json][timeout:180];area["ISO3166-1"="CI"][admin_level=2]->.ci;(${r.corps});out center tags;`;
    let ok = false;
    for (let essai = 0; essai < 3 && !ok; essai++) {
      for (const s of SERVEURS) {
        try {
          const rep = await fetch(s, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(q)}`, signal: AbortSignal.timeout(200_000) });
          if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
          const d = await rep.json();
          elements.push(...d.elements);
          console.log(`  [${i + 1}/${requetes.length}] ${r.nom} : ${d.elements.length} (${new URL(s).host})`);
          ok = true; break;
        } catch (e) { console.warn(`  [${i + 1}/${requetes.length}] ${r.nom} : échec ${new URL(s).host} (${e.message}), on réessaie…`); await pause(5000); }
      }
      if (!ok) await pause(20_000 * (essai + 1)); // serveurs saturés : on patiente
    }
    if (!ok) echecs.push(r.nom);
    await pause(3000);
  }
  return { elements, echecs };
}

function lireDossier(dossier) {
  const elements = [];
  for (const f of readdirSync(dossier).filter((x) => /^ci-.*\.json$/.test(x))) {
    try { elements.push(...JSON.parse(readFileSync(join(dossier, f), 'utf8')).elements); console.log(`  ${f}`); } catch (e) { console.warn(`  ${f} ignoré : ${e.message}`); }
  }
  return elements;
}

const adresse = (t) => {
  const rue = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return [rue, t['addr:suburb'] || t['addr:district'], t['addr:city']].filter(Boolean).join(', ') || null;
};
const r5 = (x) => Math.round(x * 1e5) / 1e5;

export function compacter(elements, genere = new Date().toISOString().slice(0, 10)) {
  const categories = Object.fromEntries(filtres.map((f) => [f.id, []]));
  const places = [];
  const vus = new Set();
  for (const e of elements) {
    const t = e.tags || {};
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
    const nom = (t.name || t['name:fr'] || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !nom) continue;
    const osm = `${e.type}/${e.id}`;
    if (vus.has(osm)) continue;
    vus.add(osm);
    if (TYPES_PLACES.includes(t.place)) { places.push([nom, r5(lat), r5(lng), t.place]); continue; }
    const tel = (t.phone || t['contact:phone'] || t['contact:mobile'] || '').split(';')[0].trim() || 0;
    for (const f of filtres) {
      if (f.conditions.some((c) => t[c.cle] === c.valeur)) categories[f.id].push([nom, r5(lat), r5(lng), tel, t.opening_hours || 0, adresse(t) || 0, osm]);
    }
  }
  return { genere, source: 'OpenStreetMap (ODbL)', categories, places };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dossier = process.argv[2];
  console.log(dossier ? `Lecture de ${dossier}…` : 'Téléchargement depuis Overpass (patiente quelques minutes)…');
  const { elements, echecs } = dossier ? { elements: lireDossier(dossier), echecs: [] } : await telecharger();
  const d = compacter(elements);
  // Catégories qui n'ont pas pu être téléchargées : on garde celles de l'extrait précédent.
  try {
    const ancien = JSON.parse(gunzipSync(readFileSync(SORTIE)).toString('utf8'));
    for (const [k, v] of Object.entries(d.categories)) if (!v.length && ancien.categories?.[k]?.length) { d.categories[k] = ancien.categories[k]; console.log(`  ${k} : extrait précédent conservé`); }
    if (!d.places.length && ancien.places?.length) d.places = ancien.places;
  } catch { /* pas d'extrait précédent */ }
  if (echecs.length) console.warn(`Non téléchargé (serveurs saturés) : ${echecs.join(', ')}. Relance la commande plus tard pour compléter.`);
  mkdirSync(dirname(SORTIE), { recursive: true });
  const gz = gzipSync(JSON.stringify(d), { level: 9 });
  writeFileSync(SORTIE, gz);
  console.log(Object.entries(d.categories).map(([k, v]) => `${k} ${v.length}`).join(' · '));
  console.log(`${d.places.length} quartiers et villes → ${SORTIE} (${Math.round(gz.length / 1024)} Ko)`);
}
