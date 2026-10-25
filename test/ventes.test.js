// Vérifie la V1 « Vendeur qui agit » : suivi de vente, envoi client avec
// validation obligatoire, relance à J+2, et périmètre limité au Vendeur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import {
  preparerEnvoiClient, executerVente, executerEnvoiValide, dateRelanceJ2,
  lienWhatsApp, STATUTS_VENTE
} from '../server/outils/ventes.js';
import { executerOrganisation } from '../server/outils/organisation.js';
import { outils, instructionsStatiques } from '../server/agents.js';

const store = () => createStore().pour('00000000-0000-4000-8000-000000000001');
const CLIENT = { client_nom: 'Awa', client_telephone: '07 07 12 34 56', produit: 'Robe en wax « Soleil d’Assinie »', prix: 18000 };

test('Envoi client : message exact, destinataire et lien wa.me pré-rempli', () => {
  const message = 'Bonjour Awa, ta robe en wax est prête. Prix : 18 000 FCFA, livraison à Abidjan 1 000 FCFA.';
  const p = preparerEnvoiClient({ ...CLIENT, message });
  assert.equal(p.resume, 'Envoyer un message WhatsApp à Awa (+2250707123456)');
  assert.ok(p.details.join('\n').includes(message), 'la carte montre le message exact');
  assert.equal(p.lien, `https://wa.me/2250707123456?text=${encodeURIComponent(message)}`);
  assert.equal(lienWhatsApp('07 07 12 34 56', 'Salut'), 'https://wa.me/2250707123456?text=Salut');
});

test('Envoi client : numéro, message et prix invalides refusés', () => {
  assert.ok(preparerEnvoiClient({ client_nom: 'Awa', client_telephone: '', message: 'Bonjour Awa, ta robe est prête.' }).erreur);
  assert.ok(preparerEnvoiClient({ client_nom: 'Awa', client_telephone: 'pas un numéro', message: 'Bonjour Awa, ta robe est prête.' }).erreur);
  assert.ok(preparerEnvoiClient({ ...CLIENT, client_nom: '' }).erreur);
  assert.ok(preparerEnvoiClient({ ...CLIENT, message: 'Oui' }).erreur, 'message trop court refusé');
  assert.ok(preparerEnvoiClient({ ...CLIENT, message: 'x'.repeat(3501) }).erreur, 'message trop long refusé');
  assert.ok(preparerEnvoiClient({ ...CLIENT, message: 'Bonjour Awa.', prix: -100 }).erreur, 'prix négatif refusé');
  assert.ok(preparerEnvoiClient({ ...CLIENT, message: 'Bonjour Awa.', prix: 18000.5 }).erreur, 'prix non entier refusé');
});

test('Suivi de vente : création, liste, changement de statut', async () => {
  const s = store();
  const v = await executerVente(s, 'suivre_vente', { ...CLIENT, statut: 'interesse' });
  assert.equal(v.type, 'vente');
  assert.equal(v.client_telephone, '+2250707123456');
  assert.equal(v.prix, 18000);
  assert.equal(v.libelle_statut, 'Intéressé');
  assert.equal(v.envoye, false);
  const liste = await executerVente(s, 'lister_ventes', {});
  assert.equal(liste.ventes.length, 1);
  const payee = await executerVente(s, 'changer_statut_vente', { id: v.id, statut: 'paye' });
  assert.equal(payee.libelle_statut, 'Payé');
  assert.ok((await executerVente(s, 'changer_statut_vente', { id: v.id, statut: 'expedie' })).erreur, 'statut inconnu refusé');
  assert.ok((await executerVente(s, 'changer_statut_vente', { id: '00000000-0000-4000-8000-000000000099', statut: 'paye' })).erreur, 'vente inconnue refusée');
  assert.ok((await executerVente(s, 'suivre_vente', { client_nom: 'Awa', client_telephone: '07 07 12 34 56' })).erreur, 'produit manquant refusé');
  assert.ok((await executerVente(s, 'suivre_vente', { client_nom: 'Awa', client_telephone: '07 07 12 34 56', produit: 'Robe', prix: 1000, statut: 'interesse' })).id, 'suivi sans statut explicite accepté');
});

test('Validation requise : rien n’est marqué envoyé tant que l’utilisateur n’a pas validé', async () => {
  const s = store();
  const vente = await executerVente(s, 'suivre_vente', CLIENT);
  const input = { ...CLIENT, message: 'Bonjour Awa, ta robe est prête.', vente_id: vente.id };
  const p = preparerEnvoiClient(input);
  assert.ok(p.lien);
  // La proposition crée une action en attente : la vente n'est pas marquée envoyée.
  const action = await s.addAction({ outil: 'vendeur_envoyer_message', input, resume: p.resume });
  assert.equal(action.statut, 'en_attente');
  assert.equal((await s.getVente(vente.id)).envoye, false);
  // Après validation, la vente est marquée envoyée et le lien est renvoyé.
  const r = await executerEnvoiValide(s, action, new Date('2026-10-25T10:00:00Z'));
  assert.equal(r.url, p.lien);
  assert.equal(r.envoye, true);
  const maj = await s.getVente(vente.id);
  assert.equal(maj.envoye, true);
  assert.equal(maj.envoye_le, '2026-10-25T10:00:00.000Z');
  // Une action d'un autre type ou une vente inconnue ne valide rien.
  assert.ok((await executerEnvoiValide(s, { outil: 'github_ecrire_fichiers', input })).erreur);
  assert.ok((await executerEnvoiValide(s, { outil: 'vendeur_envoyer_message', input: { ...input, vente_id: '00000000-0000-4000-8000-000000000099' } })).erreur);
});

test('Relance J+2 : date calculée à 9 h et rappel créé avec le texte prêt', async () => {
  assert.equal(dateRelanceJ2(new Date('2026-10-25T09:00:00Z')), '2026-10-27T09:00:00.000Z');
  const s = store();
  const maintenant = new Date('2026-10-25T09:00:00Z');
  const r = await executerOrganisation(s, 'creer_rappel', {
    texte: 'Relancer Awa pour la robe en wax (18 000 FCFA) : « Bonjour Awa, ta robe est toujours réservée, dis-moi si tu la veux. »',
    quand: dateRelanceJ2(maintenant)
  }, maintenant);
  assert.equal(r.type, 'rappel');
  assert.equal(r.quand, '2026-10-27T09:00:00.000Z');
  assert.equal((await s.listReminders({ aVenir: true })).length, 1);
});

test('Périmètre : outils V1 chez le Vendeur seulement, autres agents inchangés', () => {
  const noms = outils('vendeur').map((o) => o.name);
  for (const outil of ['suivre_vente', 'lister_ventes', 'changer_statut_vente', 'proposer_envoi_client', 'creer_rappel']) assert.ok(noms.includes(outil), `Vendeur : ${outil} présent`);
  const redaction = outils('redaction').map((o) => o.name);
  for (const outil of ['suivre_vente', 'proposer_envoi_client']) assert.ok(!redaction.includes(outil), `Rédaction : ${outil} absent`);
  assert.deepEqual(STATUTS_VENTE, ['interesse', 'reserve', 'paye', 'livre']);
  assert.match(instructionsStatiques('vendeur'), /proposer_envoi_client/);
  assert.match(instructionsStatiques('vendeur'), /validation/);
  assert.match(instructionsStatiques('redaction'), /n'envoies aucun message à sa place/);
});
