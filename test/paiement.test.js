// Paiement Chariow (simulé) : page de paiement, Pulse signé, prolongation, expiration, idempotence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { creerPaiement, signaturePulseValide, offreEffective } from '../server/paiement.js';
import { createStore } from '../server/store.js';

const CONFIG = { cle: 'sk_test', secretPulse: 'whsec_test', api: 'https://api.chariow.test/v1', produits: { plus: 'prd_plus', pro: 'prd_pro' }, dureeJours: 30 };
const silencieux = { log() {}, warn() {}, error() {} };

function fauxChariow(ventes = {}) {
  const appels = [];
  const f = async (url, opts = {}) => {
    appels.push({ url, opts, corps: opts.body ? JSON.parse(opts.body) : null });
    if (url.endsWith('/checkout')) return Response.json({ data: { step: 'payment', purchase: { id: 'sal_1', status: 'awaiting_payment', amount: { value: 2500 } }, payment: { checkout_url: 'https://pay.chariow.test/x', transaction_id: 't1' } } });
    const m = /\/sales\/(sal_\w+)$/.exec(url);
    if (m && ventes[m[1]]) return Response.json({ data: ventes[m[1]] });
    return Response.json({ message: 'Not found' }, { status: 404 });
  };
  f.appels = appels;
  return f;
}

async function preparer(ventes) {
  const store = createStore();
  const u = await store.createUser({ telephone: '+2250707000001', pin_hash: 'x', offre: 'gratuit', role: 'testeur', data: { prenom: 'Awa' } });
  const f = fauxChariow(ventes);
  const p = creerPaiement({ store, fetchImpl: f, config: CONFIG, journal: silencieux });
  return { store, u, f, p };
}

test('Page de paiement : bon produit, compte en métadonnées, numéro ivoirien, vente notée en attente', async () => {
  const { store, u, f, p } = await preparer();
  const r = await p.demarrer({ compte: u, offre: 'plus', prenom: 'Awa', nom: 'Koné', email: 'awa@exemple.ci', ip: '41.202.1.2', urlRetour: 'https://tehis.test/?paiement=retour' });
  assert.equal(r.url, 'https://pay.chariow.test/x');
  const c = f.appels[0].corps;
  assert.equal(c.product_id, 'prd_plus');
  assert.deepEqual(c.custom_metadata, { compte: u.id, offre: 'plus' });
  assert.deepEqual(c.phone, { number: '0707000001', country_code: 'CI' });
  assert.equal(c.customer_ip, '41.202.1.2');
  assert.equal(f.appels[0].opts.headers.Authorization, 'Bearer sk_test');
  assert.equal((await store.pour(u.id).dernierPaiementEnAttente()).vente, 'sal_1');
});

test('Pulse « vente réussie » : 30 jours de Plus, appliqué une seule fois même si Chariow réessaie', async () => {
  const { store, u, p } = await preparer();
  const pulse = { event: 'successful.sale', sale: { id: 'sal_9', status: 'completed', custom_metadata: { compte: u.id, offre: 'plus' }, amount: { value: 2500 } }, product: { id: 'prd_plus' }, customer: { phone: '+2250707000001' } };
  const r = await p.pulse(pulse);
  assert.equal(r.offre, 'plus');
  const fin1 = (await store.getUser(u.id)).data.offreJusquau;
  assert.ok(Math.abs(new Date(fin1) - Date.now() - 30 * 86_400_000) < 5000);
  assert.deepEqual(await p.pulse(pulse), { deja: true });
  assert.equal((await store.getUser(u.id)).data.offreJusquau, fin1);
});

test('Renouvellement : la même offre se prolonge depuis la date de fin ; passer à Pro repart d\'aujourd\'hui', async () => {
  const { store, u, p } = await preparer();
  const vente = (id, produit) => ({ event: 'successful.sale', sale: { id, custom_metadata: { compte: u.id } }, product: { id: produit } });
  await p.pulse(vente('sal_a', 'prd_plus'));
  const fin1 = new Date((await store.getUser(u.id)).data.offreJusquau).getTime();
  await p.pulse(vente('sal_b', 'prd_plus'));
  const fin2 = new Date((await store.getUser(u.id)).data.offreJusquau).getTime();
  assert.ok(Math.abs(fin2 - fin1 - 30 * 86_400_000) < 5000, 'prolongée de 30 jours');
  await p.pulse(vente('sal_c', 'prd_pro'));
  const c = await store.getUser(u.id);
  assert.equal(c.offre, 'pro');
  assert.ok(Math.abs(new Date(c.data.offreJusquau) - Date.now() - 30 * 86_400_000) < 5000);
});

test('Achat direct sur la boutique (sans métadonnées) : compte retrouvé par le téléphone', async () => {
  const { store, u, p } = await preparer();
  await p.pulse({ event: 'successful.sale', sale: { id: 'sal_d' }, product: { id: 'prd_pro' }, customer: { phone: '+225 07 07 00 00 01' } });
  assert.equal((await store.getUser(u.id)).offre, 'pro');
  assert.deepEqual(await p.pulse({ event: 'successful.sale', sale: { id: 'sal_e' }, product: { id: 'prd_pro' }, customer: { phone: '+2259999999999' } }), { ignore: 'compte introuvable' });
});

test('Pulse de test Chariow (test_sale_…) : reconnu, aucune offre ni alerte', async () => {
  const { store, u, p } = await preparer();
  const r = await p.pulse({ event: 'successful.sale', sale: { id: 'test_sale_98kmff1cqqjw' }, product: { id: 'prd_plus' }, customer: { phone: '1234567890' } });
  assert.deepEqual(r, { test: true });
  assert.equal(await store.getPaiement('test_sale_98kmff1cqqjw'), null);
  assert.equal((await store.getUser(u.id)).offre, 'gratuit');
});

test('Échec ou abandon : rien n\'est activé ; produit inconnu signalé', async () => {
  const { store, u, p } = await preparer();
  await p.pulse({ event: 'failed.sale', sale: { id: 'sal_f', custom_metadata: { compte: u.id } }, product: { id: 'prd_plus' } });
  assert.equal((await store.getUser(u.id)).offre, 'gratuit');
  assert.equal((await store.getPaiement('sal_f')).statut, 'failed');
  assert.deepEqual(await p.pulse({ event: 'successful.sale', sale: { id: 'sal_g', custom_metadata: { compte: u.id } }, product: { id: 'prd_autre' } }), { ignore: 'produit inconnu' });
});

test('Retour dans l\'app : vérification directe de la vente auprès de Chariow', async () => {
  const { store, u, p } = await preparer({ sal_h: { status: 'completed', custom_metadata: { compte: '' }, product: { id: 'prd_plus' }, customer: { phone: '+2250707000001' } } });
  await store.addPaiement({ vente: 'sal_h', user_id: u.id, offre: 'plus' });
  assert.equal((await p.verifier('sal_h')).offre, 'plus');
  assert.equal((await store.getUser(u.id)).offre, 'plus');
});

test('Signature du Pulse et expiration de l\'offre', () => {
  const corps = Buffer.from('{"event":"successful.sale","url":"https:\\/\\/x"}');
  const sig = `sha256=${createHmac('sha256', 'whsec_test').update(corps).digest('hex')}`;
  assert.equal(signaturePulseValide(corps, sig, 'whsec_test'), true);
  assert.equal(signaturePulseValide(Buffer.from(JSON.stringify(JSON.parse(corps))), sig, 'whsec_test'), false, 'corps réécrit refusé');
  assert.equal(signaturePulseValide(corps, sig.replace('sha256=', 'md5='), 'whsec_test'), false);
  const hier = new Date(Date.now() - 86_400_000).toISOString();
  assert.equal(offreEffective({ offre: 'plus', data: { offreSource: 'chariow', offreJusquau: hier } }), 'gratuit');
  assert.equal(offreEffective({ offre: 'plus', data: { offreSource: 'admin' } }), 'plus');
  assert.equal(offreEffective({ offre: 'pro', role: 'admin', data: { offreSource: 'chariow', offreJusquau: hier } }), 'pro');
});
