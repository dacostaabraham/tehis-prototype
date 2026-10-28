// Objectifs suivis (item n°2 du backlog REA) : création, progression manuelle
// ou calculée depuis les ventes, check-in hebdomadaire, journal d'activité.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { createStore } from '../server/store.js';
import { executerVente } from '../server/outils/ventes.js';
import {
  executerObjectif, synchroniserObjectifs, dateCheckin, preparerCheckinObjectif,
  assurerCheckinObjectif, annulerCheckinsObjectif
} from '../server/outils/objectifs.js';
import { traiterRappelPlanifie } from '../server/outils/planifiees.js';
import { initNotifications } from '../server/notifications.js';

before(() => {
  const cles = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = cles.publicKey;
  process.env.VAPID_PRIVATE_KEY = cles.privateKey;
});

const UID = '00000000-0000-4000-8000-000000000002';
const MAINTENANT = new Date('2026-10-28T10:00:00.000Z');
const brut = () => createStore();
const vue = (b) => b.pour(UID);
const VENTE = { client_nom: 'Awa', client_telephone: '07 07 12 34 56', produit: 'Robe en wax', prix: 20000 };

test('validation : libellé, cible, unité, échéance et source refusés quand ils sont mauvais', async () => {
  const s = vue(brut());
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: 0 })).erreur, /cible/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: -5 })).erreur, /cible/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: 10.5 })).erreur, /cible/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: ' ', cible: 100 })).erreur, /libellé/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: 100, unite: 'euros' })).erreur, /Unit/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: 100, echeance: '30/11/2026' })).erreur, /AAAA-MM-JJ/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: 100, echeance: '2026-02-30' })).erreur, /n'existe pas/);
  assert.match((await executerObjectif(s, 'creer_objectif', { libelle: 'Objectif', cible: 100, source: 'magie' })).erreur, /Source/);
});

test('création : champs stockés, progression 0, check-in hebdomadaire programmé', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: '50 000 FCFA de ventes en novembre', cible: 50000, unite: 'FCFA', echeance: '2026-11-30' }, MAINTENANT);
  assert.equal(o.type, 'objectif');
  assert.equal(o.progression, 0);
  assert.equal(o.pourcentage, 0);
  assert.equal(o.statut, 'actif');
  assert.equal(o.echeance, '2026-11-30');
  assert.equal(o.prochain_checkin, '2026-11-04T09:00:00.000Z', 'check-in dans 7 jours à 9 h');
  const rappels = await s.listReminders({ aVenir: true });
  const checkin = rappels.find((r) => r.type_action === 'checkin_objectif');
  assert.ok(checkin, 'check-in programmé');
  assert.equal(checkin.repetition, 'hebdomadaire');
  assert.equal(checkin.action_input.objectif_id, o.id);
});

test('dateCheckin : +7 jours à 9 h, heure d’Abidjan', () => {
  assert.equal(dateCheckin(MAINTENANT), '2026-11-04T09:00:00.000Z');
});

test('un seul check-in par objectif', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner pour la tontine', cible: 10000 }, MAINTENANT);
  await assurerCheckinObjectif(s, o, MAINTENANT);
  await assurerCheckinObjectif(s, o, MAINTENANT);
  const rappels = await s.listReminders({ aVenir: true });
  assert.equal(rappels.filter((r) => r.type_action === 'checkin_objectif').length, 1);
});

test('progression manuelle : pourcentage, puis atteint avec entrée dans le journal (une seule fois)', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: '50 000 FCFA de ventes en novembre', cible: 50000 }, MAINTENANT);
  const mi = await executerObjectif(s, 'maj_progression_objectif', { id: o.id, progression: 18000 });
  assert.equal(mi.pourcentage, 36);
  assert.equal(mi.restant, 32000);
  assert.equal(mi.statut, 'actif');
  const atteint = await executerObjectif(s, 'maj_progression_objectif', { id: o.id, progression: 50000 });
  assert.equal(atteint.statut, 'atteint');
  assert.equal(atteint.pourcentage, 100);
  const actions = await b.listActions(UID);
  assert.equal(actions.filter((a) => a.outil === 'objectif_atteint').length, 1, 'une seule entrée dans le journal');
  assert.match(actions[0].resume, /Objectif atteint/);
  // Une fois atteint, la progression ne bouge plus et le check-in est annulé.
  assert.match((await executerObjectif(s, 'maj_progression_objectif', { id: o.id, progression: 60000 })).erreur, /atteint/i);
  assert.equal((await s.listReminders({ aVenir: true })).filter((r) => r.type_action === 'checkin_objectif').length, 0);
});

test('progression négative refusée ; objectif introuvable', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner', cible: 10000 }, MAINTENANT);
  assert.match((await executerObjectif(s, 'maj_progression_objectif', { id: o.id, progression: -1 })).erreur, /progression/);
  assert.match((await executerObjectif(s, 'maj_progression_objectif', { id: 'inexistant', progression: 100 })).erreur, /introuvable/);
  assert.match((await executerObjectif(s, 'cloturer_objectif', { id: 'inexistant', statut: 'atteint' })).erreur, /introuvable/);
});

test('clôturer abandonné : statut et check-in annulé', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner', cible: 10000 }, MAINTENANT);
  const ferme = await executerObjectif(s, 'cloturer_objectif', { id: o.id, statut: 'abandonne' });
  assert.equal(ferme.statut, 'abandonne');
  assert.equal((await s.listReminders({ aVenir: true })).filter((r) => r.type_action === 'checkin_objectif').length, 0);
  assert.match((await executerObjectif(s, 'cloturer_objectif', { id: o.id, statut: 'atteint' })).erreur, /déjà/);
});

test('objectif ventes : progression calculée depuis les ventes payées et livrées, après sa création', async () => {
  const b = brut(); const s = vue(b);
  // Une vente payée avant l'objectif ne compte pas (on fige sa date dans le passé).
  const ancienne = await executerVente(s, 'suivre_vente', { ...VENTE, statut: 'paye' }, new Date('2026-10-20T10:00:00.000Z'));
  b.ventes.find((v) => v.id === ancienne.id).created_at = '2026-10-20T10:00:00.000Z';
  const o = await executerObjectif(s, 'creer_objectif', { libelle: '50 000 FCFA de ventes en novembre', cible: 50000, source: 'ventes' }, MAINTENANT);
  // La vente d'avant est datée d'avant l'objectif : elle ne compte pas.
  assert.equal((await synchroniserObjectifs(s)).find((x) => x.id === o.id).progression, 0);
  await executerVente(s, 'suivre_vente', { ...VENTE, client_nom: 'Koffi', statut: 'paye' }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...VENTE, client_nom: 'Mariam', statut: 'interesse' }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...VENTE, client_nom: 'Yao', statut: 'livre', prix: 15000 }, MAINTENANT);
  const presente = (await synchroniserObjectifs(s)).find((x) => x.id === o.id);
  assert.equal(presente.progression, 35000, 'payée 20 000 + livrée 15 000 ; intéressée exclue');
  assert.equal(presente.pourcentage, 70);
  assert.equal(presente.statut, 'actif');
  assert.equal(ancienne.statut, 'paye');
});

test('objectif ventes : franchissement de la cible → atteint + journal, une seule fois', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: '40 000 FCFA de ventes', cible: 40000, source: 'ventes' }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...VENTE, statut: 'paye' }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...VENTE, client_nom: 'Koffi', statut: 'paye' }, MAINTENANT);
  const presente = (await synchroniserObjectifs(s)).find((x) => x.id === o.id);
  assert.equal(presente.progression, 40000);
  assert.equal(presente.statut, 'atteint');
  await synchroniserObjectifs(s);
  assert.equal((await b.listActions(UID)).filter((a) => a.outil === 'objectif_atteint').length, 1);
  // Saisie manuelle refusée pour un objectif « ventes » encore actif.
  const autre = await executerObjectif(s, 'creer_objectif', { libelle: 'Autre objectif ventes', cible: 100000, source: 'ventes' }, MAINTENANT);
  assert.match((await executerObjectif(s, 'maj_progression_objectif', { id: autre.id, progression: 100 })).erreur, /tout seul/);
});

test('preparerCheckinObjectif : point dans le journal avec la progression réelle', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: '50 000 FCFA de ventes en novembre', cible: 50000 }, MAINTENANT);
  await executerObjectif(s, 'maj_progression_objectif', { id: o.id, progression: 18000 });
  const rappel = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'checkin_objectif');
  const r = await preparerCheckinObjectif(s, rappel);
  assert.ok(r.action, 'action créée');
  assert.equal(r.action.outil, 'checkin_objectif');
  assert.equal(r.action.statut, 'executee', 'le check-in est une information, rien à valider');
  assert.equal(r.action.resultat.objectif.progression, 18000);
  assert.equal(r.action.resultat.objectif.pourcentage, 36);
  assert.match(r.action.resume, /18\s000 FCFA/);
});

test('preparerCheckinObjectif : ignoré si l’objectif est clôturé ou introuvable', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner', cible: 10000 }, MAINTENANT);
  await executerObjectif(s, 'cloturer_objectif', { id: o.id, statut: 'abandonne' });
  assert.deepEqual((await preparerCheckinObjectif(s, { action_input: { objectif_id: o.id } })).ignore, true);
  assert.deepEqual((await preparerCheckinObjectif(s, { action_input: { objectif_id: 'inexistant' } })).ignore, true);
});

test('traiterRappelPlanifie : check-in dû → point + notification vers Mes affaires', async () => {
  const b = brut(); const s = vue(b);
  await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner pour la tontine', cible: 10000 }, MAINTENANT);
  const rappel = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'checkin_objectif');
  const envois = [];
  const r = await traiterRappelPlanifie(b, rappel, { notifier: async (uid, charge) => { envois.push(charge); }, maintenant: new Date('2026-11-04T09:00:00.000Z') });
  assert.ok(r.action, 'action créée');
  assert.equal(r.action.outil, 'checkin_objectif');
  assert.equal(envois.length, 1);
  assert.equal(envois[0].titre, 'Point sur ton objectif');
  assert.equal(envois[0].url, '/?panneau=affaires');
  assert.ok(envois[0].corps.includes('Épargner pour la tontine'));
});

test('boucle complète : check-in dû → journal + notification, puis reprogrammé une semaine plus tard', async () => {
  const b = brut(); const s = vue(b);
  await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner pour la tontine', cible: 10000 }, MAINTENANT);
  await b.addSubscription(UID, { endpoint: 'https://push.test/b', keys: { p256dh: 'x', auth: 'y' } });
  const envois = [];
  const n = await initNotifications(b, { envoyerPush: async (sub, charge) => { envois.push({ sub, charge }); } });
  const dus = await n.verifierRappels(new Date('2026-11-04T09:00:00.000Z'));
  assert.equal(dus, 1);
  assert.equal(envois.length, 1);
  assert.equal(envois[0].charge.titre, 'Point sur ton objectif');
  const actions = await b.listActions(UID);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].outil, 'checkin_objectif');
  const rappels = await s.listReminders();
  const prochain = rappels.find((r) => r.type_action === 'checkin_objectif');
  assert.equal(prochain.quand, '2026-11-11T09:00:00.000Z', 'répété une semaine plus tard');
  assert.equal(prochain.envoye, false);
});

test('lister_objectifs : présentés avec pourcentage, les plus récents d’abord', async () => {
  const b = brut(); const s = vue(b);
  await executerObjectif(s, 'creer_objectif', { libelle: 'Premier objectif', cible: 10000 }, MAINTENANT);
  const deuxieme = await executerObjectif(s, 'creer_objectif', { libelle: 'Deuxième objectif', cible: 20000, unite: 'nombre' }, MAINTENANT);
  // Dates de création distinctes (même milliseconde sinon) : le plus récent d'abord.
  b.objectifs.find((o) => o.id === deuxieme.id).created_at = '2026-10-28T12:00:00.000Z';
  const r = await executerObjectif(s, 'lister_objectifs', {});
  assert.equal(r.type, 'objectifs');
  assert.equal(r.objectifs.length, 2);
  assert.equal(r.objectifs[0].libelle, 'Deuxième objectif');
  assert.equal(r.objectifs[0].unite, 'nombre');
});

test('annulerCheckinsObjectif : ne touche pas les autres rappels', async () => {
  const b = brut(); const s = vue(b);
  const o = await executerObjectif(s, 'creer_objectif', { libelle: 'Épargner', cible: 10000 }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...VENTE, statut: 'interesse' }, MAINTENANT);
  await annulerCheckinsObjectif(s, o.id);
  const rappels = await s.listReminders({ aVenir: true });
  assert.equal(rappels.filter((r) => r.type_action === 'checkin_objectif').length, 0);
  assert.equal(rappels.filter((r) => r.type_action === 'relance_vente').length, 1, 'la relance vendeur reste');
});
