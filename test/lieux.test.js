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

test('Avec position : requête Overpass avec rayon et User-Agent', async () => {
  const f = fauxFetch([['overpass-api.de', { elements: ELEMENTS }]]);
  const r = await chercherLieux({ categorie: 'pharmacie', rayon_km: 2 }, { position: { lat: 5.33641, lng: -4.02671 } }, f);
  assert.equal(r.type, 'lieux');
  assert.equal(r.total, 2);
  const corps = decodeURIComponent(f.appels[0].opts.body);
  assert.match(corps, /nwr\["amenity"="pharmacy"\]\(around:2000,5\.33641,-4\.02671\)/);
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
  const r = await chercherLieux({ categorie: 'pharmacie' }, { position: { lat: 5.33641, lng: -4.02671 } }, f);
  assert.equal(r.type, 'lieux');
  assert.ok(Date.now() - t0 < 15_000, 'le miroir rapide doit gagner sans attendre le lent');
});

test('Overpass en panne partout : message lisible, sans jargon technique', async () => {
  const f = async () => { const e = new Error('This operation was aborted'); e.name = 'AbortError'; throw e; };
  const r = await chercherLieux({ categorie: 'pharmacie' }, { position: { lat: 6.82, lng: -5.27 } }, f);
  assert.ok(r.erreur);
  assert.ok(!/abort/i.test(r.erreur), r.erreur);
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
