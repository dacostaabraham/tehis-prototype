// Vérifie l'outil « lieux à proximité » (OpenStreetMap simulé) et les boutons de réponse rapide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chercherLieux, versLieux, distanceMetres, positionValide, CATEGORIES } from '../server/outils/lieux.js';
import { preparerChoix } from '../server/outils/interaction.js';

const PLATEAU = { lat: 5.3364, lng: -4.0267 };
const ELEMENTS = [
  { type: 'node', id: 1, lat: 5.3400, lon: -4.0267, tags: { amenity: 'pharmacy', name: 'Pharmacie du Rond Point', phone: '+225 27 20 00 00 00;+225 07 00 00 00 00', 'addr:street': 'Avenue Chardy' } },
  { type: 'way', id: 2, center: { lat: 5.3370, lon: -4.0270 }, tags: { amenity: 'pharmacy', name: 'Pharmacie Centrale', opening_hours: 'Mo-Sa 08:00-21:00' } },
  { type: 'node', id: 3, lat: 5.3371, lon: -4.0270, tags: { amenity: 'pharmacy', name: 'Pharmacie Centrale' } },
  { type: 'node', id: 4, lat: 5.35, lon: -4.03, tags: { amenity: 'pharmacy' } }
];

function fauxFetch(reponses) {
  const appels = [];
  const f = async (url, opts = {}) => {
    appels.push({ url, opts });
    const r = reponses.find(([motif]) => url.includes(motif));
    if (!r) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify(r[1]), { status: r[2] || 200 });
  };
  f.appels = appels;
  return f;
}

test('Distance : environ 400 m pour 0,0036° de latitude', () => {
  const d = distanceMetres(PLATEAU, { lat: 5.3400, lng: -4.0267 });
  assert.ok(d > 390 && d < 410, d);
});

test('Lieux triés par distance, doublons et lieux sans nom retirés, premier téléphone gardé', () => {
  const l = versLieux(ELEMENTS, PLATEAU);
  assert.deepEqual(l.map((x) => x.nom), ['Pharmacie Centrale', 'Pharmacie du Rond Point']);
  assert.equal(l[1].telephone, '+225 27 20 00 00 00');
  assert.equal(l[0].horaires, 'Mo-Sa 08:00-21:00');
});

test('Sans position ni quartier : demande de position, aucun appel réseau', async () => {
  const f = fauxFetch([]);
  const r = await chercherLieux({ categorie: 'pharmacie' }, {}, f);
  assert.equal(r.type, 'besoin_position');
  assert.equal(f.appels.length, 0);
});

test('Avec position : requête Overpass par phases (800 m puis élargissement) et User-Agent', async () => {
  const f = fauxFetch([['overpass-api.de', { elements: ELEMENTS }]]);
  const r = await chercherLieux({ categorie: 'pharmacie', rayon_km: 2 }, { position: { lat: 5.33641, lng: -4.02671 }, sansLocal: true }, f);
  assert.equal(r.type, 'lieux');
  assert.equal(r.total, 2);
  const corps1 = decodeURIComponent(f.appels[0].opts.body);
  assert.match(corps1, /nwr\["amenity"="pharmacy"\]\(around:800,5\.33641,-4\.02671\)/, 'la première phase cherche à 800 m');
  assert.match(f.appels[0].opts.headers['User-Agent'], /Tehis/);
  assert.ok(r.note.includes('garde'));
});

test('Avec un quartier : géocodage Nominatim limité à la Côte d\'Ivoire', async () => {
  const f = fauxFetch([
    ['nominatim', [{ lat: '5.3900', lon: '-3.9800', display_name: 'Angré, Cocody, Abidjan, Côte d\'Ivoire' }]],
    ['overpass', { elements: [] }]
  ]);
  const r = await chercherLieux({ categorie: 'marche', pres_de: 'Cocody Angré' }, {}, f);
  assert.equal(r.origine, 'quartier');
  assert.equal(r.centre.libelle, 'Angré, Cocody, Abidjan');
  assert.match(f.appels[0].url, /countrycodes=ci/);
});

test('Overpass : les miroirs sont interrogés en parallèle, le premier succès gagne', async () => {
  const f = async (url) => {
    if (url.includes('overpass-api.de')) await new Promise((r) => setTimeout(r, 30_000)); // miroir lent
    return new Response(JSON.stringify({ elements: ELEMENTS }), { status: 200 });
  };
  const t0 = Date.now();
  const r = await chercherLieux({ categorie: 'pharmacie' }, { position: { lat: 5.33641, lng: -4.02671 }, sansLocal: true }, f);
  assert.equal(r.type, 'lieux');
  assert.ok(Date.now() - t0 < 15_000, 'le miroir rapide doit gagner sans attendre le lent');
});

test('Overpass en panne partout : message lisible, sans jargon technique', async () => {
  const f = async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; };
  const r = await chercherLieux({ categorie: 'pharmacie' }, { position: { lat: 6.82, lng: -5.27 }, sansLocal: true }, f);
  assert.ok(r.erreur);
  assert.ok(!/abort/i.test(r.erreur), r.erreur);
});

const BEAUCOUP = [1, 2, 3, 4, 5].map((i) => ({ type: 'node', id: i, lat: 5.3364 + i * 0.0005, lon: -4.0267, tags: { amenity: 'pharmacy', name: `Pharmacie ${i}` } }));

/** Faux fetch qui répond selon le rayon demandé dans le corps Overpass. */
function fauxFetchPhases(parRayon) {
  const appels = [];
  const f = async (url, opts = {}) => {
    appels.push({ url, opts });
    if (!url.includes('overpass')) return new Response('{}', { status: 503 });
    const corps = decodeURIComponent(opts.body || '');
    const m = corps.match(/around:(\d+),/);
    const reponse = parRayon(m && m[1]);
    if (reponse instanceof Error) throw reponse;
    return new Response(JSON.stringify({ elements: reponse }), { status: 200 });
  };
  f.appels = appels;
  return f;
}

test('Phases : élargissement à 2 km quand trop peu de résultats à 800 m', async () => {
  const f = fauxFetchPhases((rayon) => (rayon === '800' ? [] : ELEMENTS));
  const r = await chercherLieux({ categorie: 'pharmacie', rayon_km: 3 }, { position: { lat: 5.36, lng: -4.05 }, sansLocal: true }, f);
  assert.equal(r.type, 'lieux');
  assert.equal(r.total, 2);
  const rayons = f.appels.filter((a) => a.url.includes('overpass')).map((a) => Number(decodeURIComponent(a.opts.body).match(/around:(\d+),/)[1]));
  assert.deepEqual([...new Set(rayons)].sort((a, b) => a - b), [800, 2000, 3000]);
});

test('Phases : pas d\u2019élargissement quand 800 m suffisent', async () => {
  const f = fauxFetchPhases(() => BEAUCOUP);
  const r = await chercherLieux({ categorie: 'pharmacie', rayon_km: 3 }, { position: { lat: 5.34, lng: -4.03 }, sansLocal: true }, f);
  assert.equal(r.type, 'lieux');
  assert.equal(r.total, 5);
  const nb = f.appels.filter((a) => a.url.includes('overpass')).length;
  assert.ok(nb <= 3, `une seule phase devrait suffire (3 miroirs en parallèle), vu ${nb} appels`);
});

test('Phases : la première phase échoue, la suivante réussit quand même', async () => {
  const f = fauxFetchPhases((rayon) => {
    if (rayon === '800') { const e = new Error('timeout'); e.name = 'AbortError'; throw e; }
    return ELEMENTS;
  });
  const r = await chercherLieux({ categorie: 'pharmacie', rayon_km: 3 }, { position: { lat: 5.35, lng: -4.04 }, sansLocal: true }, f);
  assert.equal(r.type, 'lieux');
  assert.equal(r.total, 2);
});

test('Catégorie inconnue et position invalide refusées', async () => {
  assert.ok((await chercherLieux({ categorie: 'casino' }, {})).erreur);
  assert.equal(positionValide({ lat: 200, lng: 0 }), false);
  assert.ok(Object.keys(CATEGORIES).includes('pharmacie'));
});

test('Boutons de réponse : options nettoyées, dédoublonnées, 5 au plus', () => {
  const c = preparerChoix({ question: 'Ton budget ?', options: ['50 000', '50 000', ' 100 000 ', '', 'a', 'b', 'c', 'd'] });
  assert.deepEqual(c.options, ['50 000', '100 000', 'a', 'b', 'c']);
  assert.ok(preparerChoix({ question: 'x', options: ['seul'] }).erreur);
});

// ---------- Extrait local (data/lieux-ci.json.gz) ----------
import { lieuxLocaux, geocoderLocal } from '../server/outils/lieux-local.js';
import { compacter } from '../scripts/maj-lieux-ci.mjs';

const EXTRAIT = compacter([
  { type: 'node', id: 1, lat: 5.3251, lon: -4.0191, tags: { amenity: 'pharmacy', name: 'Pharmacie des Finances', phone: '+225 27 20 21 22 23' } },
  { type: 'way', id: 2, center: { lat: 5.40, lon: -4.00 }, tags: { amenity: 'pharmacy', name: 'Pharmacie Azur' } },
  { type: 'node', id: 3, lat: 5.33, lon: -4.02, tags: { amenity: 'dentist', name: 'Cabinet dentaire' } },
  { type: 'node', id: 4, lat: 5.33, lon: -4.02, tags: { amenity: 'pharmacy' } },
  { type: 'node', id: 10, lat: 5.3450, lon: -4.0750, tags: { place: 'suburb', name: 'Yopougon' } },
  { type: 'node', id: 11, lat: 5.3390, lon: -4.0820, tags: { place: 'neighbourhood', name: 'Selmer' } },
  { type: 'node', id: 12, lat: 7.6900, lon: -5.0300, tags: { place: 'city', name: 'Bouaké' } },
  { type: 'node', id: 13, lat: 6.0000, lon: -5.0000, tags: { place: 'neighbourhood', name: 'Selmer' } }
], '2026-10-07');

test('Extrait local : compactage par catégorie, lieux sans nom écartés', () => {
  assert.equal(EXTRAIT.categories.pharmacie.length, 2);
  assert.equal(EXTRAIT.categories.dentiste.length, 1);
  assert.equal(EXTRAIT.places.length, 4);
});

test('Extrait local : lieux dans le rayon, au format Overpass', () => {
  const l = lieuxLocaux('pharmacie', PLATEAU, 3000, EXTRAIT);
  assert.deepEqual(l.map((e) => e.tags.name), ['Pharmacie des Finances']);
  assert.equal(l[0].tags.phone, '+225 27 20 21 22 23');
  assert.equal(lieuxLocaux('mairie', PLATEAU, 3000, null), null);
});

test('Extrait local : quartier trouvé sans réseau, le bon « Selmer » près de Yopougon', () => {
  const g = geocoderLocal('Yopougon Selmer', EXTRAIT);
  assert.equal(g.libelle, 'Selmer');
  assert.ok(Math.abs(g.lat - 5.339) < 0.001);
  assert.equal(geocoderLocal('bouake', EXTRAIT).libelle, 'Bouaké');
  assert.equal(geocoderLocal('Paris', EXTRAIT), null);
});

test('Recherche : l\'extrait local répond sans appeler Overpass', async () => {
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { gzipSync } = await import('node:zlib');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { chargerLieuxLocaux } = await import('../server/outils/lieux-local.js');
  const f = join(mkdtempSync(join(tmpdir(), 'tehis-')), 'ci.json.gz');
  writeFileSync(f, gzipSync(JSON.stringify(EXTRAIT)));
  assert.equal(chargerLieuxLocaux(f).categories.pharmacie.length, 2);
});
