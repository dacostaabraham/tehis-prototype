// Documents avec versions et partage par lien (item n°5 du backlog REA) :
// historique conservé à chaque création ou réécriture, restauration sans
// rien perdre, lien de partage en lecture seule (jeton non devinable,
// révocable, un seul document exposé), journal d'activité.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import {
  creerDocument, modifierDocument, listerDocuments, restaurerVersion,
  partagerDocument, revoquerPartageDocument
} from '../server/outils/documents.js';

const UID = '00000000-0000-4000-8000-000000000005';
const UID2 = '00000000-0000-4000-8000-000000000006';
const brut = () => createStore();
const vue = (b, uid = UID) => b.pour(uid);
const LETTRE = { type: 'lettre', titre: 'Demande de congé', contenu: 'Madame, Monsieur,\n\nJe demande un congé du 2 au 13 novembre.\n\nCordialement, Awa' };
const LETTRE_V2 = 'Madame, Monsieur,\n\nJe demande un congé du 2 au 20 novembre.\n\nCordialement, Awa';

test('création : version 1 enregistrée, entrée dans le journal', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  assert.equal(d.numero, 1);
  assert.equal(d.enregistre, true);
  const versions = await s.listDocumentVersions(d.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].numero, 1);
  assert.equal(versions[0].origine, 'agent');
  assert.equal(versions[0].titre, 'Demande de congé');
  const actions = await s.listActions();
  assert.equal(actions.length, 1);
  assert.equal(actions[0].outil, 'document_cree');
  assert.equal(actions[0].statut, 'executee');
});

test('réécriture : version 2 créée, contenu courant mis à jour, version 1 intacte', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  const m = await modifierDocument(s, { id: d.id, contenu: LETTRE_V2 }, 'redaction');
  assert.equal(m.numero, 2);
  assert.equal((await s.getDocument(d.id)).contenu, LETTRE_V2);
  const v1 = await s.getDocumentVersion(d.id, 1);
  assert.equal(v1.contenu, LETTRE.contenu);
  const versions = await s.listDocumentVersions(d.id);
  assert.deepEqual(versions.map((v) => v.numero), [2, 1]);
  const actions = await s.listActions();
  assert.ok(actions.some((a) => a.outil === 'document_modifie'));
});

test('réécriture sans changement : pas de nouvelle version, pas de doublon dans le journal', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  const m = await modifierDocument(s, { id: d.id, contenu: LETTRE.contenu }, 'redaction');
  assert.equal(m.inchange, true);
  assert.equal((await s.listDocumentVersions(d.id)).length, 1);
  assert.equal((await s.listActions()).length, 1);
});

test('restauration : la version 1 redevient courante en version 3, rien n’est perdu', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  await modifierDocument(s, { id: d.id, contenu: LETTRE_V2 }, 'redaction');
  const r = await restaurerVersion(s, d.id, 1);
  assert.equal(r.numero, 3);
  assert.equal(r.restauree, 1);
  assert.equal((await s.getDocument(d.id)).contenu, LETTRE.contenu);
  const versions = await s.listDocumentVersions(d.id);
  assert.deepEqual(versions.map((v) => v.numero), [3, 2, 1]);
  assert.equal((await s.getDocumentVersion(d.id, 2)).contenu, LETTRE_V2);
  assert.equal((await s.getDocumentVersion(d.id, 3)).contenu, LETTRE.contenu);
  const actions = await s.listActions();
  assert.ok(actions.some((a) => a.outil === 'document_restaure'));
});

test('restauration d’une version inexistante : erreur, document inchangé', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  assert.match((await restaurerVersion(s, d.id, 9)).erreur, /introuvable/);
  assert.equal((await s.getDocument(d.id)).contenu, LETTRE.contenu);
  assert.equal((await s.listDocumentVersions(d.id)).length, 1);
});

test('validation : contenu vide ou trop long, document introuvable', async () => {
  const b = brut(); const s = vue(b);
  assert.match((await creerDocument(s, { ...LETTRE, contenu: '   ' }, 'redaction')).erreur, /vide/);
  assert.match((await creerDocument(s, { ...LETTRE, contenu: 'x'.repeat(20001) }, 'redaction')).erreur, /trop long/);
  assert.match((await modifierDocument(s, { id: 'inexistant', contenu: LETTRE_V2 }, 'redaction')).erreur, /introuvable/);
  assert.match((await modifierDocument(s, { id: 'inexistant', contenu: '   ' }, 'redaction')).erreur, /introuvable/);
  assert.match((await partagerDocument(s, 'inexistant')).erreur, /introuvable/);
  assert.match((await revoquerPartageDocument(s, 'inexistant')).erreur, /introuvable/);
});

test('lister_documents : identifiant, type et titre, sans le contenu complet', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  const l = await listerDocuments(s);
  assert.equal(l.type, 'documents');
  assert.equal(l.documents.length, 1);
  assert.equal(l.documents[0].id, d.id);
  assert.equal(l.documents[0].titre, 'Demande de congé');
  assert.equal(l.documents[0].contenu, undefined);
});

test('partage : jeton non devinable, un seul lien actif, lecture seule du bon document', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  const p1 = await partagerDocument(s, d.id, 'https://tehis.example');
  assert.equal(p1.nouveau, true);
  assert.ok(p1.url.startsWith('https://tehis.example/partage/'));
  assert.ok(p1.jeton.length >= 20, 'jeton assez long pour ne pas être deviné');
  const p2 = await partagerDocument(s, d.id, 'https://tehis.example');
  assert.equal(p2.nouveau, false);
  assert.equal(p2.jeton, p1.jeton, 'le même lien actif est réutilisé');
  const lu = await b.getDocumentParJeton(p1.jeton);
  assert.equal(lu.titre, 'Demande de congé');
  assert.equal(lu.contenu, LETTRE.contenu);
  assert.equal(lu.user_id, undefined, 'aucune donnée du compte exposée');
  assert.equal(await b.getDocumentParJeton('jeton-inconnu'), null);
  const actions = await s.listActions();
  assert.ok(actions.some((a) => a.outil === 'document_partage'));
  assert.equal(actions.filter((a) => a.outil === 'document_partage').length, 1, 'un seul journal pour les deux appels');
});

test('partage : un lien ne donne accès qu’à son document, pas aux autres', async () => {
  const b = brut(); const s = vue(b);
  const d1 = await creerDocument(s, LETTRE, 'redaction');
  const d2 = await creerDocument(s, { type: 'cv', titre: 'CV — Awa', contenu: 'Expérience : trois ans en relation client.' }, 'emploi');
  const p = await partagerDocument(s, d1.id, '');
  assert.equal((await b.getDocumentParJeton(p.jeton)).id, d1.id);
  assert.notEqual((await b.getDocumentParJeton(p.jeton)).id, d2.id);
});

test('partage : révocation coupe l’accès, un nouveau lien est ensuite possible', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  const p1 = await partagerDocument(s, d.id, '');
  assert.equal((await revoquerPartageDocument(s, d.id)).ok, true);
  assert.equal(await b.getDocumentParJeton(p1.jeton), null);
  assert.match((await revoquerPartageDocument(s, d.id)).erreur, /Aucun lien/);
  const p2 = await partagerDocument(s, d.id, '');
  assert.equal(p2.nouveau, true);
  assert.notEqual(p2.jeton, p1.jeton, 'le jeton révoqué n’est jamais réutilisé');
  assert.ok(await b.getDocumentParJeton(p2.jeton));
  const actions = await s.listActions();
  assert.ok(actions.some((a) => a.outil === 'document_partage_revoque'));
});

test('suppression du document : versions et partage supprimés avec lui', async () => {
  const b = brut(); const s = vue(b);
  const d = await creerDocument(s, LETTRE, 'redaction');
  await modifierDocument(s, { id: d.id, contenu: LETTRE_V2 }, 'redaction');
  const p = await partagerDocument(s, d.id, '');
  await s.deleteDocument(d.id);
  assert.equal(await s.getDocument(d.id), null);
  assert.deepEqual(await s.listDocumentVersions(d.id), []);
  assert.equal(await b.getDocumentParJeton(p.jeton), null);
});

test('isolement des comptes : un autre compte ne voit ni le document ni ses versions', async () => {
  const b = brut();
  const d = await creerDocument(vue(b), LETTRE, 'redaction');
  const autre = vue(b, UID2);
  assert.equal(await autre.getDocument(d.id), null);
  assert.deepEqual(await autre.listDocumentVersions(d.id), []);
  assert.equal((await autre.getPartage(d.id)), null);
  assert.match((await modifierDocument(autre, { id: d.id, contenu: LETTRE_V2 }, 'redaction')).erreur, /introuvable/);
});
