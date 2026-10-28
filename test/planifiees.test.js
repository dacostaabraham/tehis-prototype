// Tâches planifiées qui agissent + journal d'activité (P0 du rapport REA) :
// relance vendeur J+2 automatique, récap matinal, et boucle de rappels qui
// prépare les actions au lieu de seulement notifier.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { createStore } from '../server/store.js';
import {
  executerVente, executerEnvoiValide, preparerEnvoiClient, dateRelanceJ2, dateRecapMatinal
} from '../server/outils/ventes.js';
import {
  messageRelance, preparerRelanceVente, preparerRecapMatinal, traiterRappelPlanifie
} from '../server/outils/planifiees.js';
import { initNotifications } from '../server/notifications.js';

before(() => {
  const cles = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = cles.publicKey;
  process.env.VAPID_PRIVATE_KEY = cles.privateKey;
});

const UID = '00000000-0000-4000-8000-000000000001';
const CLIENT = { client_nom: 'Awa', client_telephone: '07 07 12 34 56', produit: 'Robe en wax « Soleil d’Assinie »', prix: 18000 };
const MAINTENANT = new Date('2026-10-28T10:00:00.000Z');
const brut = () => createStore();
const vue = (b) => b.pour(UID);

test('messageRelance : texte exact, à partir des données réelles de la vente', () => {
  const m = messageRelance({ client_nom: 'Awa', produit: 'Robe en wax', prix: 18000, statut: 'interesse' });
  assert.ok(m.includes('Awa') && m.includes('Robe en wax') && /18\s000 FCFA/.test(m));
  const reserve = messageRelance({ client_nom: 'Awa', produit: 'Robe en wax', prix: 18000, statut: 'reserve' });
  assert.match(reserve, /réservation/);
  const sansPrix = messageRelance({ client_nom: 'Awa', produit: 'Robe en wax', prix: null, statut: 'interesse' });
  assert.ok(!sansPrix.includes('FCFA'), 'pas de prix inventé quand il est absent');
});

test('dateRecapMatinal : demain à 8 h, heure d’Abidjan', () => {
  assert.equal(dateRecapMatinal(MAINTENANT).toISOString(), '2026-10-29T08:00:00.000Z');
  assert.equal(dateRelanceJ2(MAINTENANT), '2026-10-30T09:00:00.000Z');
});

test('suivre_vente programme la relance J+2 et le récap matinal', async () => {
  const b = brut(); const s = vue(b);
  const v = await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  const rappels = await s.listReminders({ aVenir: true });
  const relance = rappels.find((r) => r.type_action === 'relance_vente');
  assert.ok(relance, 'relance programmée');
  assert.equal(relance.quand, '2026-10-30T09:00:00.000Z');
  assert.equal(relance.action_input.vente_id, v.id);
  const recap = rappels.find((r) => r.type_action === 'recap_matinal');
  assert.ok(recap, 'récap programmé');
  assert.equal(recap.quand, '2026-10-29T08:00:00.000Z');
  assert.equal(recap.repetition, 'quotidien');
});

test('deuxième vente : une relance par vente, un seul récap', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...CLIENT, client_nom: 'Koffi', statut: 'reserve' }, MAINTENANT);
  const rappels = await s.listReminders({ aVenir: true });
  assert.equal(rappels.filter((r) => r.type_action === 'relance_vente').length, 2);
  assert.equal(rappels.filter((r) => r.type_action === 'recap_matinal').length, 1);
});

test('vente payée à la création : pas de relance', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'paye' }, MAINTENANT);
  const rappels = await s.listReminders({ aVenir: true });
  assert.equal(rappels.filter((r) => r.type_action === 'relance_vente').length, 0);
  assert.equal(rappels.filter((r) => r.type_action === 'recap_matinal').length, 0, 'pas de récap sans vente à suivre');
});

test('changer_statut_vente vers payé annule la relance en attente', async () => {
  const b = brut(); const s = vue(b);
  const v = await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  await executerVente(s, 'changer_statut_vente', { id: v.id, statut: 'paye' });
  const rappels = await s.listReminders({ aVenir: true });
  assert.equal(rappels.filter((r) => r.type_action === 'relance_vente').length, 0);
  assert.equal(rappels.filter((r) => r.type_action === 'recap_matinal').length, 1, 'le récap, lui, reste');
});

test('envoi validé : vente marquée envoyée et relance annulée', async () => {
  const b = brut(); const s = vue(b);
  const v = await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  const preparation = preparerEnvoiClient({ ...CLIENT, message: 'Bonjour Awa, ta robe en wax est prête.' });
  const action = await b.addAction(UID, {
    outil: 'vendeur_envoyer_message',
    input: {
      client_nom: preparation.client_nom, client_telephone: preparation.client_telephone,
      produit: preparation.produit, prix: preparation.prix, message: preparation.message, vente_id: v.id
    },
    resume: preparation.resume
  });
  const resultat = await executerEnvoiValide(s, action);
  assert.equal(resultat.envoye, true);
  assert.equal((await s.getVente(v.id)).envoye, true);
  const rappels = await s.listReminders({ aVenir: true });
  assert.equal(rappels.filter((r) => r.type_action === 'relance_vente').length, 0);
});

test('preparerRelanceVente : crée l’action en attente, avec le message exact', async () => {
  const b = brut(); const s = vue(b);
  const v = await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  const rappel = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'relance_vente');
  const r = await preparerRelanceVente(b, rappel);
  assert.ok(r.action, 'action créée');
  assert.equal(r.action.statut, 'en_attente');
  assert.equal(r.action.outil, 'vendeur_envoyer_message');
  assert.equal(r.action.input.vente_id, v.id);
  assert.ok(r.action.input.message.includes('Robe en wax « Soleil d’Assinie »'));
  assert.ok(/18\s000 FCFA/.test(r.action.input.message));
  assert.ok(r.action.resume.includes('Awa'));
});

test('preparerRelanceVente : ignorée si la vente est payée ou introuvable', async () => {
  const b = brut(); const s = vue(b);
  const v = await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  await s.updateVente(v.id, { statut: 'paye' });
  const rappel = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'relance_vente');
  assert.deepEqual((await preparerRelanceVente(b, rappel)).ignore, true);
  assert.deepEqual((await preparerRelanceVente(b, { user_id: UID, action_input: { vente_id: 'inexistant' } })).ignore, true);
  assert.deepEqual((await preparerRelanceVente(b, { user_id: UID, action_input: {} })).ignore, true);
});

test('preparerRecapMatinal : action exécutée avec ventes, rappels et pharmacies', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  await executerVente(s, 'suivre_vente', { ...CLIENT, client_nom: 'Koffi', statut: 'paye' }, MAINTENANT);
  const fauxGardes = async () => ({ pharmacies: [{ nom: 'Pharmacie du Plateau', commune: 'Plateau', telephone: '2722000000' }] });
  const r = await preparerRecapMatinal(b, UID, new Date('2026-10-29T08:00:00.000Z'), { lireGardes: fauxGardes });
  assert.equal(r.action.statut, 'executee', 'le récap est une information, rien à valider');
  assert.equal(r.action.outil, 'recap_matinal');
  assert.equal(r.action.resultat.ventes.length, 1, 'seule la vente en attente');
  assert.equal(r.action.resultat.ventes[0].client_nom, 'Awa');
  assert.equal(r.action.resultat.pharmacies[0].nom, 'Pharmacie du Plateau');
  assert.match(r.action.resume, /1 vente en attente/);
});

test('preparerRecapMatinal : sans pharmacies lisibles, la section est absente', async () => {
  const b = brut();
  const r = await preparerRecapMatinal(b, UID, new Date('2026-10-29T08:00:00.000Z'), { lireGardes: async () => { throw new Error('site indisponible'); } });
  assert.deepEqual(r.action.resultat.pharmacies, []);
  assert.ok(!r.action.resume.includes('pharmacie'));
});

test('traiterRappelPlanifie : type inconnu ignoré', async () => {
  const b = brut();
  const r = await traiterRappelPlanifie(b, { user_id: UID, type_action: 'inconnu' }, {});
  assert.equal(r.ignore, true);
});

test('boucle complète : relance due → action créée + notification push vers Mes affaires', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  const recap = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'recap_matinal');
  await s.deleteReminder(recap.id); // ce test ne porte que sur la relance
  await b.addSubscription(UID, { endpoint: 'https://push.test/a', keys: { p256dh: 'x', auth: 'y' } });
  const envois = [];
  const n = await initNotifications(b, { envoyerPush: async (sub, charge) => { envois.push({ sub, charge }); } });
  const dus = await n.verifierRappels(new Date('2026-10-30T09:00:00.000Z'));
  assert.equal(dus, 1);
  assert.equal(envois.length, 1);
  assert.equal(envois[0].charge.titre, 'Relance prête à valider');
  assert.equal(envois[0].charge.url, '/?panneau=affaires');
  assert.ok(envois[0].charge.corps.includes('Awa'));
  const actions = await b.listActions(UID);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].outil, 'vendeur_envoyer_message');
  assert.equal(actions[0].statut, 'en_attente');
  const rappels = await s.listReminders();
  assert.equal(rappels.find((r) => r.type_action === 'relance_vente').envoye, true, 'rappel consommé');
});

test('journal d’activité : relance puis récap, les plus récents d’abord', async () => {
  const b = brut(); const s = vue(b);
  await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' }, MAINTENANT);
  const rappel = (await s.listReminders({ aVenir: true })).find((r) => r.type_action === 'relance_vente');
  await preparerRelanceVente(b, rappel);
  await preparerRecapMatinal(b, UID, new Date('2026-10-29T08:00:00.000Z'), { lireGardes: async () => ({ pharmacies: [] }) });
  const actions = await b.listActions(UID);
  assert.equal(actions.length, 2);
  assert.equal(actions[0].outil, 'recap_matinal', 'la plus récente d’abord');
  assert.equal(actions[1].outil, 'vendeur_envoyer_message');
});
