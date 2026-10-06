// Tehis sur WhatsApp : signature, lecture du webhook, mise en forme, conversation simulée de bout en bout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signatureValide, lireWebhook, versWhatsApp, decouper, creerClientWhatsApp } from '../server/whatsapp.js';
import { creerCanalWhatsApp } from '../server/canal-whatsapp.js';
import { createStore } from '../server/store.js';

const notif = (messages, contacts = [{ wa_id: '2250707000001', profile: { name: 'Awa' } }]) => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts, messages } }] }] });

test('Signature Meta : bonne clé acceptée, corps modifié refusé', () => {
  const corps = Buffer.from(JSON.stringify(notif([])));
  const sig = `sha256=${createHmac('sha256', 'secret-app').update(corps).digest('hex')}`;
  assert.equal(signatureValide(corps, sig, 'secret-app'), true);
  assert.equal(signatureValide(Buffer.from(`${corps} `), sig, 'secret-app'), false);
  assert.equal(signatureValide(corps, sig, 'autre'), false);
  assert.equal(signatureValide(corps, undefined, 'secret-app'), false);
});

test('Webhook : texte, bouton, position, vocal, photo', () => {
  const m = lireWebhook(notif([
    { from: '2250707000001', id: 'a', timestamp: '1', type: 'text', text: { body: 'Salut' } },
    { from: '2250707000001', id: 'b', timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'choix:56', title: '56' } } },
    { from: '2250707000001', id: 'c', timestamp: '1', type: 'location', location: { latitude: 5.33, longitude: -4.02 } },
    { from: '2250707000001', id: 'd', timestamp: '1', type: 'audio', audio: { id: 'm1', mime_type: 'audio/ogg; codecs=opus' } },
    { from: '2250707000001', id: 'e', timestamp: '1', type: 'image', image: { id: 'm2', mime_type: 'image/jpeg', caption: 'Mon exercice' } }
  ]));
  assert.deepEqual(m.map((x) => x.type), ['text', 'reponse', 'location', 'audio', 'image']);
  assert.equal(m[0].nom, 'Awa');
  assert.equal(m[1].reponseId, 'choix:56');
  assert.deepEqual(m[2].position, { lat: 5.33, lng: -4.02 });
  assert.equal(m[4].texte, 'Mon exercice');
});

test('Mise en forme WhatsApp et découpage des longs messages', () => {
  assert.equal(versWhatsApp('## Titre\n**Gras** et [lien](https://x.ci)\n- un'), '*Titre*\n*Gras* et lien : https://x.ci\n• un');
  const parts = decouper(`${'a'.repeat(3000)}\n\n${'b'.repeat(3000)}`);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 3900));
});

function fauxGraph() {
  const envois = [];
  const f = async (url, opts = {}) => {
    if (url.includes('/media/m1') || url.endsWith('/m1')) return Response.json({ url: 'https://media.test/m1', mime_type: 'audio/ogg' });
    if (url === 'https://media.test/m1') return new Response(new Uint8Array(3000), { status: 200 });
    if (url.endsWith('/media')) return Response.json({ id: 'audio-envoye' });
    const corps = opts.body ? JSON.parse(opts.body) : null;
    if (corps?.status !== 'read') envois.push(corps);
    return Response.json({ messages: [{ id: 'wamid.x' }] });
  };
  f.envois = envois;
  return f;
}

async function preparer({ evenements, voixActive = false }) {
  const store = createStore();
  const u = await store.createUser({ telephone: '+2250707000001', pin_hash: 'x', offre: 'gratuit', role: 'testeur', data: { prenom: 'Awa', nomCompagnon: 'Kiki', espece: 'chat' } });
  const graph = fauxGraph();
  const client = creerClientWhatsApp({ token: 't', phoneId: 'P1', secret: 's', verifyToken: 'v', version: 'v25.0', graph: 'https://graph.test', modeleRappel: 'rappel_tehis', modeleCode: '', langueModeles: 'fr' }, graph);
  const appels = [];
  const canal = creerCanalWhatsApp({
    store, client, urlApp: 'https://tehis.test', iaActive: () => true,
    quotaMessageAtteint: async () => null,
    nettoyerHistorique: (h) => h.map((m) => ({ role: m.role, content: m.content })),
    repondreAgent: async (req, opts) => { appels.push(opts); for (const e of evenements(opts)) opts.send(...e); },
    voix: { active: () => voixActive, transcrire: async () => 'Pharmacie de garde près de moi', synthetiser: async () => ({ audio: Buffer.from([1]) }) },
    journal: { error() {} }
  });
  return { store, u, graph, canal, appels };
}

test('Conversation : bienvenue, réponse texte, carte des lieux en liste + épingle, historique gardé', async () => {
  const lieux = { type: 'lieux', libelle: 'Pharmacies', icone: '💊', centre: { libelle: 'ta position' }, lieux: [{ nom: 'Pharmacie des Finances', distance: 174, telephone: '+2252720212223', lat: 5.325, lng: -4.019, garde: true }], gardeDAbord: false, garde: null, note: null };
  const { graph, canal, appels, store, u } = await preparer({ evenements: () => [['token', { text: 'La plus proche est à **174 m**.' }], ['tool', { result: lieux }], ['done', {}]] });
  await canal.traiter({ de: '2250707000001', id: 'w1', type: 'text', texte: 'Pharmacie près de moi', nom: 'Awa' });
  const types = graph.envois.map((e) => e.type);
  assert.deepEqual(types, ['text', 'text', 'text', 'location']);
  assert.match(graph.envois[0].text.body, /Kiki, maintenant aussi sur WhatsApp/);
  assert.equal(graph.envois[1].text.body, 'La plus proche est à *174 m*.');
  assert.match(graph.envois[2].text.body, /Pharmacie des Finances\* 🌙 · 174 m/);
  assert.equal(graph.envois[3].location.latitude, 5.325);
  assert.equal(appels[0].canal, 'whatsapp');
  assert.equal(appels[0].agent, 'compagnon');
  const conv = await store.pour(u.id).getConversation('whatsapp:compagnon');
  assert.equal(conv.items.length, 2);
});

test('Menu des agents (liste) puis choix d\'un agent ; boutons de réponse rapide', async () => {
  const { graph, canal, store, u, appels } = await preparer({ evenements: () => [['token', { text: 'Question 1 : 7 × 8 ?' }], ['choix', { question: '7 × 8 = ?', options: ['54', '56', '64'] }]] });
  await store.updateUser(u.id, { data: { waBienvenue: true } });
  await canal.traiter({ de: '2250707000001', id: 'w1', type: 'text', texte: 'menu' });
  assert.equal(graph.envois[0].interactive.type, 'list');
  assert.ok(graph.envois[0].interactive.action.sections[0].rows.some((r) => r.id === 'agent:sante'));
  assert.ok(!graph.envois[0].interactive.action.sections[0].rows.some((r) => r.id === 'agent:budget'), 'agents Plus absents en Gratuit');
  await canal.traiter({ de: '2250707000001', id: 'w2', type: 'reponse', reponseId: 'agent:repetiteur', texte: 'Répétiteur' });
  assert.equal((await store.getUser(u.id)).data.agentWhatsapp, 'repetiteur');
  graph.envois.length = 0;
  await canal.traiter({ de: '2250707000001', id: 'w3', type: 'text', texte: 'Un quiz' });
  assert.equal(appels.at(-1).agent, 'repetiteur');
  const boutons = graph.envois.find((e) => e.type === 'interactive');
  assert.equal(boutons.interactive.type, 'button');
  assert.deepEqual(boutons.interactive.action.buttons.map((b) => b.reply.id), ['choix:54', 'choix:56', 'choix:64']);
  await canal.traiter({ de: '2250707000001', id: 'w4', type: 'reponse', reponseId: 'choix:56', texte: '56' });
  assert.equal(appels.at(-1).historique.at(-1).content, '56');
});

test('Numéro sans compte : une seule invitation par jour ; vocal transcrit et réponse vocale', async () => {
  const { graph, canal, appels, store, u } = await preparer({ evenements: () => [['token', { text: 'Voici.' }]], voixActive: true });
  await canal.traiter({ de: '2250102030405', id: 'x', type: 'text', texte: 'Bonjour' });
  await canal.traiter({ de: '2250102030405', id: 'y', type: 'text', texte: 'Allô ?' });
  assert.equal(graph.envois.length, 1);
  assert.match(graph.envois[0].text.body, /https:\/\/tehis\.test/);
  await store.updateUser(u.id, { data: { waBienvenue: true } });
  graph.envois.length = 0;
  await canal.traiter({ de: '2250707000001', id: 'z', type: 'audio', media: { id: 'm1', type: 'audio/ogg' } });
  assert.equal(appels.at(-1).historique.at(-1).content, 'Pharmacie de garde près de moi');
  assert.deepEqual(graph.envois.map((e) => e.type), ['text', 'audio']);
});

test('Rappels : seulement si demandé ; texte dans la fenêtre de 24 h, modèle approuvé sinon', async () => {
  const { graph, canal, store, u } = await preparer({ evenements: () => [] });
  assert.equal(await canal.rappel({ user_id: u.id, texte: 'Payer le loyer' }), false);
  await store.updateUser(u.id, { data: { rappelsWhatsApp: true, waDernier: Date.now() } });
  assert.equal(await canal.rappel({ user_id: u.id, texte: 'Payer le loyer' }), true);
  assert.equal(graph.envois.at(-1).text.body, '🔔 *Rappel* : Payer le loyer');
  await store.updateUser(u.id, { data: { waDernier: Date.now() - 30 * 3_600_000 } });
  await canal.rappel({ user_id: u.id, texte: 'Payer le loyer' });
  assert.equal(graph.envois.at(-1).template.name, 'rappel_tehis');
  assert.equal(graph.envois.at(-1).template.components[0].parameters[0].text, 'Payer le loyer');
});
