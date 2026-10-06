// Comptes, sessions, isolation des données entre comptes, quotas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliserTelephone, masquerTelephone, pinValide, hacherPin, verifierPin, creerJetons, creerGardien } from '../server/comptes.js';
import { createStore } from '../server/store.js';
import { quotaDe, choisirModele, etatQuota } from '../server/quotas.js';
import { executerOrganisation } from '../server/outils/organisation.js';
import { creerDocument } from '../server/outils/documents.js';

test('Numéros : formats ivoiriens et internationaux', () => {
  assert.equal(normaliserTelephone('07 07 12 34 56'), '+2250707123456');
  assert.equal(normaliserTelephone('+225 05.05.12.34.56'), '+2250505123456');
  assert.equal(normaliserTelephone('002250101123456'), '+2250101123456');
  assert.equal(normaliserTelephone('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(normaliserTelephone('12345'), null);
  assert.equal(masquerTelephone('+2250707123456'), '+225 07 •• •• 34 56');
});

test('Code PIN : format, codes trop simples refusés, hachage vérifiable', () => {
  assert.ok(pinValide('12a4'));
  assert.ok(pinValide('1234'));
  assert.equal(pinValide('4826'), null);
  const h = hacherPin('4826');
  assert.ok(h.startsWith('scrypt$') && !h.includes('4826'));
  assert.equal(verifierPin('4826', h), true);
  assert.equal(verifierPin('4827', h), false);
});

test('Session : jeton lié au compte et à sa version (changer le code déconnecte)', async () => {
  const j = creerJetons('secret');
  const uid = '11111111-1111-4111-8111-111111111111';
  const t = j.creer(uid, 0);
  assert.equal((await j.lire(t, async () => 0)).uid, uid);
  assert.equal(await j.lire(t, async () => 1), null);
  assert.equal(await j.lire(t, async () => null), null);
  assert.equal(await j.lire(t.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), async () => 0), null);
  assert.equal(await creerJetons('autre').lire(t, async () => 0), null);
});

test('Essais de connexion : blocage après 5 échecs, levé par une réussite', () => {
  const g = creerGardien();
  const cles = ['t:+2250707123456', 'ip:1'];
  for (let i = 0; i < 5; i++) g.echec(cles, 1000);
  assert.equal(g.bloque(cles, 2000), true);
  assert.equal(g.bloque(cles, 1000 + 16 * 60_000), false);
  g.reussite(cles);
  assert.equal(g.bloque(cles, 2000), false);
});

test('Isolation : un compte ne voit ni ne modifie les données d\'un autre', async () => {
  const store = createStore();
  const a = await store.createUser({ telephone: '+2250707000001', pin_hash: 'x', offre: 'gratuit', role: 'testeur', data: { prenom: 'Awa' } });
  const b = await store.createUser({ telephone: '+2250707000002', pin_hash: 'x', offre: 'gratuit', role: 'testeur', data: { prenom: 'Koffi' } });
  const sa = store.pour(a.id); const sb = store.pour(b.id);

  const doc = await creerDocument(sa, { type: 'cv', titre: 'CV Awa', contenu: 'Awa, comptable.' }, 'emploi');
  await executerOrganisation(sa, 'creer_rappel', { texte: 'Loyer', quand: '2030-01-05T09:00' });
  await executerOrganisation(sa, 'gerer_liste', { nom: 'Courses', ajouter: ['Riz'] });
  await sa.addMemory({ fait: 'Vend des pagnes à Adjamé', categorie: 'activite' });
  await sa.saveConversation('compagnon', [{ role: 'user', content: 'secret' }]);
  await sa.setSecret('github', 'chiffre-a');

  assert.equal((await sb.listDocuments()).length, 0);
  assert.equal(await sb.getDocument(doc.id), null);
  await sb.deleteDocument(doc.id);
  assert.equal((await sa.listDocuments()).length, 1, 'B ne peut pas supprimer le document de A');
  assert.equal((await sb.listReminders()).length, 0);
  assert.equal((await sb.listLists()).length, 0);
  assert.equal(await sb.getList('courses'), null);
  assert.equal((await sb.listMemories()).length, 0);
  assert.equal(await sb.getConversation('compagnon'), null);
  assert.equal(await sb.getSecret('github'), null);
  assert.equal((await sb.getProfile()).prenom, 'Koffi');

  // Même nom de liste chez B : liste séparée.
  await executerOrganisation(sb, 'gerer_liste', { nom: 'Courses', ajouter: ['Huile'] });
  assert.deepEqual((await sa.getList('courses')).items.map((i) => i.texte), ['Riz']);

  // Les rappels dus gardent leur propriétaire (notification au bon compte).
  const dus = await store.dueReminders('2030-01-06T00:00:00.000Z');
  assert.deepEqual(dus.map((r) => r.user_id), [a.id]);

  // Suppression du compte A : ses données partent, celles de B restent.
  await store.deleteUser(a.id);
  assert.equal((await store.dueReminders('2030-01-06T00:00:00.000Z')).length, 0);
  assert.equal((await sb.listLists()).length, 1);
});

test('Anciennes données du prototype rattachées au compte administrateur', async () => {
  const store = createStore();
  store.documents.push({ id: 'd0', type: 'lettre', titre: 'Ancienne', contenu: '…', created_at: '2026-09-01' });
  const admin = await store.createUser({ telephone: '+2250707000009', pin_hash: 'x', offre: 'pro', role: 'admin' });
  await store.rattacherAnciennesDonnees(admin.id);
  assert.equal((await store.pour(admin.id).listDocuments())[0].titre, 'Ancienne');
});

test('Quotas : modèle léger pour l\'offre Gratuit, compteur par compte', async () => {
  const opts = { fort: 'F', leger: 'L' };
  assert.equal(choisirModele({ ...opts, modeleAgent: 'fort', compte: { offre: 'gratuit' } }), 'L');
  assert.equal(choisirModele({ ...opts, modeleAgent: 'fort', compte: { offre: 'plus' } }), 'F');
  assert.equal(choisirModele({ ...opts, modeleAgent: 'leger', compte: { offre: 'pro' } }), 'L');
  assert.equal(quotaDe({ role: 'admin', offre: 'gratuit' }).messages, Infinity);

  const store = createStore();
  const u = await store.createUser({ telephone: '+2250707000003', pin_hash: 'x', offre: 'gratuit', role: 'testeur' });
  const s = store.pour(u.id);
  await s.incrementUsage('2026-10-06', 'messages');
  await s.incrementUsage('2026-10-06', 'recherches', 2);
  const e = await etatQuota(s, u, '2026-10-06');
  assert.deepEqual(e.messages, { utilises: 1, max: 20, restants: 19 });
  assert.equal(e.recherches.restants, 0);
  assert.equal(await store.pour('autre').getUsage('2026-10-06', 'messages'), 0);
});
