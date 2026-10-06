// Pharmacies de garde : lecture de la liste hebdomadaire, coordonnées douteuses écartées, fusion avec la carte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lireGardes, gardesProches, gardesDeLaSemaine, viderCacheGardes, nomCommune } from '../server/outils/garde.js';
import { chercherLieux, estHeureDeGarde } from '../server/outils/lieux.js';

const HTML = readFileSync(new URL('./fixtures/garde.html', import.meta.url), 'utf8');
const PLATEAU = { lat: 5.3236, lng: -4.0197 };

test('Lecture : période, communes, téléphones au format international', () => {
  const d = lireGardes(HTML);
  assert.deepEqual(d.periode, { debut: '2026-10-03', fin: '2026-10-09', texte: 'du 3 octobre au 9 octobre 2026' });
  assert.deepEqual(d.pharmacies.map((p) => [p.nom, p.commune]), [
    ["Pharmacie de l'Indenie", 'Abengourou'], ['Pharmacie des Finances', 'Plateau'], ['Pharmacie du Port', 'Plateau'], ['Pharmacie Saint Gabriel', 'II Plateaux']
  ]);
  assert.equal(d.pharmacies[1].telephone, '+2252720212223');
  assert.equal(d.pharmacies[3].adresse, "2 Plateaux sur le Bd Latrille non loin d'Ivoire Oil");
  assert.equal(nomCommune('ABIDJAN ABOBO PK 18'), 'Abobo PK 18');
});

test('Coordonnées douteuses écartées (pharmacie d\'Abengourou placée au Plateau)', () => {
  const d = lireGardes(HTML);
  const indenie = d.pharmacies[0];
  assert.equal(indenie.lat, null);
  assert.equal(indenie.coordonneesSures, false);
  assert.equal(d.pharmacies[1].coordonneesSures, true);
});

test('Plus proches d\'abord ; même commune sans position ajoutée avec distance inconnue', () => {
  const p = gardesProches(lireGardes(HTML), PLATEAU);
  assert.equal(p[0].nom, 'Pharmacie des Finances');
  assert.ok(p[0].distance < 300);
  assert.equal(p[1].nom, 'Pharmacie Saint Gabriel');
  assert.deepEqual(p.at(-1), { ...p.at(-1), nom: 'Pharmacie du Port', distance: null });
  assert.ok(!p.some((x) => x.commune === 'Abengourou'));
});

test('Source injoignable : null, sans planter ; liste périmée ignorée', async () => {
  viderCacheGardes();
  assert.equal(await gardesDeLaSemaine({ fetchImpl: async () => new Response('x', { status: 503 }) }), null);
  viderCacheGardes();
  const ok = async () => new Response(HTML, { status: 200 });
  assert.equal((await gardesDeLaSemaine({ fetchImpl: ok, maintenant: new Date('2026-10-05T20:00:00Z') })).pharmacies.length, 4);
  assert.equal(await gardesDeLaSemaine({ fetchImpl: ok, maintenant: new Date('2026-10-12T20:00:00Z'), forcer: true }), null);
  viderCacheGardes();
});

test('Recherche de pharmacies : onglet de garde, pharmacie OSM reconnue comme de garde', async () => {
  const fauxOsm = async () => new Response(JSON.stringify({ elements: [
    { type: 'node', id: 1, lat: 5.3251, lon: -4.0191, tags: { amenity: 'pharmacy', name: 'Pharmacie des Finances' } },
    { type: 'node', id: 2, lat: 5.3300, lon: -4.0200, tags: { amenity: 'pharmacy', name: 'Pharmacie Mazuet' } }
  ] }), { status: 200 });
  const r = await chercherLieux({ categorie: 'pharmacie', garde: true }, { position: PLATEAU, gardes: async () => lireGardes(HTML) }, fauxOsm);
  assert.equal(r.garde.periode, 'du 3 octobre au 9 octobre 2026');
  assert.equal(r.gardeDAbord, true);
  assert.deepEqual(r.lieux.map((l) => [l.nom, l.garde]), [['Pharmacie des Finances', true], ['Pharmacie Mazuet', false]]);
  assert.match(r.note, /abidjan\.net/);
});

test('Heures de garde : nuit, samedi après-midi et dimanche', () => {
  assert.equal(estHeureDeGarde(new Date('2026-10-06T21:00:00Z')), true);
  assert.equal(estHeureDeGarde(new Date('2026-10-06T10:00:00Z')), false);
  assert.equal(estHeureDeGarde(new Date('2026-10-04T10:00:00Z')), true);
  assert.equal(estHeureDeGarde(new Date('2026-10-03T15:00:00Z')), true);
});
