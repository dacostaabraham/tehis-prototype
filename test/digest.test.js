// Digest quotidien (item n°4 du backlog REA) : astuce du jour, digest du récap
// matinal, génération à la demande, aucune donnée inventée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { executerVente } from '../server/outils/ventes.js';
import { preparerRecapMatinal, traiterRappelPlanifie } from '../server/outils/planifiees.js';
import { ASTUCES, astuceDuJour, digestDuJour, presenterDigest } from '../server/outils/digest.js';

const UID = '00000000-0000-4000-8000-000000000003';
const brut = () => createStore();
const vue = (b) => b.pour(UID);
const CLIENT = { client_nom: 'Awa', client_telephone: '07 07 12 34 56', produit: 'Robe en wax', prix: 18000 };
const fauxGardes = async () => ({ pharmacies: [{ nom: 'Pharmacie du Plateau', commune: 'Plateau', telephone: '2722000000' }] });

test('astuceDuJour : une astuce par jour, déterministe, sans chiffre ni promesse', () => {
  assert.equal(astuceDuJour(new Date('2026-10-28T08:00:00.000Z')), astuceDuJour(new Date('2026-10-28T20:00:00.000Z')), 'même jour, même astuce');
  assert.notEqual(astuceDuJour(new Date('2026-10-28T08:00:00.000Z')), astuceDuJour(new Date('2026-10-29T08:00:00.000Z')));
  assert.ok(ASTUCES.length >= 10, 'assez d’astuces pour tourner');
  for (const a of ASTUCES) {
    assert.ok(a.length > 20);
    assert.doesNotMatch(a, /\d/, 'aucun chiffre : pas de promesse chiffrée');
  }
});

test('digestDuJour : réutilise le récap du jour, avec ventes, rappels, pharmacies et astuce', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, new Date('2026-10-28T10:00:00.000Z'));
  await s.addReminder({ texte: 'Payer le loyer', quand: '2026-10-29T09:00:00.000Z', repetition: 'aucune' });
  const { action } = await preparerRecapMatinal(b, UID, new Date('2026-10-29T08:00:00.000Z'), { lireGardes: fauxGardes });
  // Le récap est horodaté à l'instant réel : on le rattache au jour testé, comme le ferait la génération à 8 h en production.
  action.created_at = '2026-10-29T08:00:00.000Z';
  const d = await digestDuJour(b, UID, new Date('2026-10-29T09:00:00.000Z'));
  assert.equal(d.date, '2026-10-29');
  assert.equal(d.ventes.length, 1);
  assert.equal(d.ventes[0].client_nom, 'Awa');
  assert.equal(d.rappels.length, 1);
  assert.equal(d.rappels[0].texte, 'Payer le loyer');
  assert.equal(d.pharmacies[0].nom, 'Pharmacie du Plateau');
  assert.equal(d.astuce, astuceDuJour(new Date('2026-10-29T09:00:00.000Z')));
  await digestDuJour(b, UID, new Date('2026-10-29T10:00:00.000Z'));
  assert.equal((await b.listActions(UID)).filter((a) => a.outil === 'recap_matinal').length, 1, 'pas de doublon : le récap du jour est réutilisé');
});

test('digestDuJour : sans pharmacies lisibles, la section est absente', async () => {
  const b = brut();
  const d = await digestDuJour(b, UID, new Date('2026-10-29T09:00:00.000Z'), { lireGardes: async () => { throw new Error('site indisponible'); } });
  assert.deepEqual(d.pharmacies, []);
  assert.deepEqual(d.ventes, []);
  assert.deepEqual(d.rappels, []);
  assert.ok(d.astuce, 'l’astuce est toujours là');
});

test('digestDuJour : avant 8 h, pas encore de digest', async () => {
  const b = brut();
  assert.equal(await digestDuJour(b, UID, new Date('2026-10-29T07:30:00.000Z')), null);
  assert.equal((await b.listActions(UID)).length, 0, 'rien n’est généré avant 8 h');
});

test('digestDuJour : généré à la demande après 8 h, une seule fois par jour', async () => {
  const b = brut();
  const d = await digestDuJour(b, UID, new Date('2026-10-29T10:00:00.000Z'), { lireGardes: fauxGardes });
  assert.ok(d);
  assert.equal(d.pharmacies.length, 1);
  // Le récap généré est horodaté à l'instant réel : on le rattache au jour testé, comme le ferait la génération à 8 h en production.
  const recap = (await b.listActions(UID)).find((a) => a.outil === 'recap_matinal');
  recap.created_at = '2026-10-29T10:00:00.000Z';
  const d2 = await digestDuJour(b, UID, new Date('2026-10-29T11:00:00.000Z'), { lireGardes: fauxGardes });
  assert.equal((await b.listActions(UID)).filter((a) => a.outil === 'recap_matinal').length, 1);
  assert.equal(d2.resume, d.resume);
});

test('presenterDigest : accepte un résultat sérialisé (PostgreSQL)', () => {
  const action = {
    resume: 'Récap du matin — 1 vente en attente',
    resultat: JSON.stringify({ ventes: [{ client_nom: 'Awa', produit: 'Robe', prix: 18000, statut: 'interesse' }], rappels: [], pharmacies: [] })
  };
  const d = presenterDigest(action, new Date('2026-10-29T09:00:00.000Z'));
  assert.equal(d.ventes.length, 1);
  assert.equal(d.date, '2026-10-29');
});

test('traiterRappelPlanifie : la notification du récap renvoie vers la carte du digest', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, new Date('2026-10-28T10:00:00.000Z'));
  const recap = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'recap_matinal');
  const charges = [];
  const r = await traiterRappelPlanifie(b, recap, { notifier: async (uid, charge) => { charges.push(charge); }, maintenant: new Date('2026-10-29T08:00:00.000Z'), lireGardes: fauxGardes });
  assert.ok(r.action);
  assert.equal(charges[0].titre, 'Ton récap du matin est prêt');
  assert.equal(charges[0].url, '/?panneau=chat', 'la notification ouvre la carte du digest, sur l’écran d’accueil');
});
