// Pipeline rappels → notifications push (server/notifications.js).
// L'expéditeur web-push réel est remplacé par un faux : aucun réseau.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import { initNotifications } from '../server/notifications.js';

before(() => {
  const cles = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = cles.publicKey;
  process.env.VAPID_PRIVATE_KEY = cles.privateKey;
});

const abonnement = (id) => ({ endpoint: `https://push.test/${id}`, keys: { p256dh: 'x', auth: 'y' } });

function fauxStore(rappels = [], abonnements = []) {
  return {
    rappels: rappels.map((r) => ({ ...r })),
    abos: [...abonnements],
    async getSecret() { return null; },
    async setSecret() {},
    async listSubscriptions() { return [...this.abos]; },
    async deleteSubscription(endpoint) { this.abos = this.abos.filter((a) => a.endpoint !== endpoint); },
    async dueReminders(iso) { return this.rappels.filter((r) => !r.envoye && r.quand <= iso); },
    async updateReminder(id, champs) {
      const r = this.rappels.find((x) => x.id === id);
      Object.assign(r, champs);
      return r;
    }
  };
}

function fauxEnvoi(comportements = {}) {
  const appels = [];
  const fn = async (sub, charge) => {
    appels.push({ sub, charge });
    const c = comportements[sub.endpoint];
    if (c) throw c;
  };
  fn.appels = appels;
  return fn;
}

const passe = '2026-10-02T10:00:00.000Z';
const rappelDu = (champs = {}) => ({ id: 'r1', texte: 'Payer le loyer', quand: '2026-10-02T09:00:00.000Z', repetition: null, envoye: false, ...champs });

test('un rappel dû notifie chaque abonnement puis est marqué envoyé', async () => {
  const store = fauxStore([rappelDu()], [abonnement('a'), abonnement('b')]);
  const envoi = fauxEnvoi();
  const n = await initNotifications(store, { envoyerPush: envoi });
  assert.equal(n.clePublique, process.env.VAPID_PUBLIC_KEY);
  const dus = await n.verifierRappels(new Date(passe));
  assert.equal(dus, 1);
  assert.equal(envoi.appels.length, 2);
  for (const a of envoi.appels) {
    assert.equal(a.charge.titre, 'Rappel');
    assert.equal(a.charge.corps, 'Payer le loyer');
    assert.equal(a.charge.tag, 'r1');
  }
  assert.equal(store.rappels[0].envoye, true);
});

test('un rappel futur ne déclenche rien', async () => {
  const store = fauxStore([rappelDu({ quand: '2026-10-02T18:00:00.000Z' })], [abonnement('a')]);
  const envoi = fauxEnvoi();
  const n = await initNotifications(store, { envoyerPush: envoi });
  assert.equal(await n.verifierRappels(new Date(passe)), 0);
  assert.equal(envoi.appels.length, 0);
  assert.equal(store.rappels[0].envoye, false);
});

test('un rappel répétitif est reprogrammé au lieu d\u2019être marqué envoyé', async () => {
  const store = fauxStore([rappelDu({ repetition: 'quotidien' })], [abonnement('a')]);
  const envoi = fauxEnvoi();
  const n = await initNotifications(store, { envoyerPush: envoi });
  await n.verifierRappels(new Date(passe));
  assert.equal(envoi.appels.length, 1);
  assert.equal(store.rappels[0].quand, '2026-10-03T09:00:00.000Z');
  assert.equal(store.rappels[0].envoye, false);
});

test('un abonnement expiré (410) est supprimé, les autres sont notifiés', async () => {
  const store = fauxStore([rappelDu()], [abonnement('ok'), abonnement('mort')]);
  const envoi = fauxEnvoi({ 'https://push.test/mort': Object.assign(new Error('Gone'), { statusCode: 410 }) });
  const n = await initNotifications(store, { envoyerPush: envoi });
  await n.verifierRappels(new Date(passe));
  assert.equal(envoi.appels.length, 2, 'tentative sur les deux');
  assert.deepEqual(store.abos.map((a) => a.endpoint), ['https://push.test/ok']);
});

test('sans abonnement, le rappel est marqué sans erreur', async () => {
  const store = fauxStore([rappelDu()], []);
  const envoi = fauxEnvoi();
  const n = await initNotifications(store, { envoyerPush: envoi });
  await n.verifierRappels(new Date(passe));
  assert.equal(envoi.appels.length, 0);
  assert.equal(store.rappels[0].envoye, true);
});
