// Vérifie les outils serveur : mode développeur (avec GitHub et Render simulés), rappels, listes, documents, coffre.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executerDev, preparerAction } from '../server/outils/dev.js';
import { executerOrganisation, lireDate, prochaineOccurrence } from '../server/outils/organisation.js';
import { creerDocument } from '../server/outils/documents.js';
import { createStore } from '../server/store.js';
import { creerCoffre } from '../server/coffre.js';
import { markdown } from '../public/shared/markdown.js';
import { accesAgent } from '../public/shared/agents.js';

function fauxFetch(routes) {
  const appels = [];
  const f = async (url, opts = {}) => {
    appels.push({ url, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null, auth: opts.headers?.Authorization });
    const cle = `${opts.method || 'GET'} ${url}`;
    const r = routes[cle];
    if (!r) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  f.appels = appels;
  return f;
}

test('GitHub : écrire des fichiers en un commit sur une nouvelle branche', async () => {
  const G = 'https://api.github.com/repos/abraham/app';
  const f = fauxFetch({
    [`GET ${G}`]: { default_branch: 'main' },
    [`GET ${G}/git/ref/heads/main`]: { object: { sha: 'base111' } },
    [`POST ${G}/git/refs`]: { object: { sha: 'base111' } },
    [`GET ${G}/git/commits/base111`]: { tree: { sha: 'tree111' } },
    [`POST ${G}/git/trees`]: { sha: 'tree222' },
    [`POST ${G}/git/commits`]: { sha: 'commit333abcdef' },
    [`PATCH ${G}/git/refs/heads/feature`]: { object: { sha: 'commit333abcdef' } }
  });
  const r = await executerDev('github_ecrire_fichiers', { depot: 'abraham/app', branche: 'feature', message: 'Ajout API', fichiers: [{ chemin: 'server.js', contenu: 'console.log(1)' }] }, { github: 'ghtok' }, f);
  assert.equal(r.envoye, true);
  assert.equal(r.commit, 'commit3');
  const arbre = f.appels.find((a) => a.url.endsWith('/git/trees'));
  assert.deepEqual(arbre.body.tree[0], { path: 'server.js', mode: '100644', type: 'blob', content: 'console.log(1)' });
  assert.equal(arbre.body.base_tree, 'tree111');
  assert.ok(f.appels.every((a) => a.auth === 'Bearer ghtok'));
});

test('GitHub : chemins dangereux et clés secrètes refusés avant tout envoi', () => {
  assert.ok(preparerAction('github_ecrire_fichiers', { depot: 'a/b', message: 'x', fichiers: [{ chemin: '../etc/passwd', contenu: 'x' }] }).erreur);
  assert.ok(preparerAction('github_ecrire_fichiers', { depot: 'a/b', message: 'x', fichiers: [{ chemin: '.git/config', contenu: 'x' }] }).erreur);
  assert.ok(preparerAction('github_ecrire_fichiers', { depot: 'a/b', message: 'x', fichiers: [{ chemin: 'a.js', contenu: 'const k = "sk-ant-abc"' }] }).erreur);
  const ok = preparerAction('github_ecrire_fichiers', { depot: 'a/b', message: 'x', fichiers: [{ chemin: '.github/workflows/ci.yml', contenu: 'on: push' }] });
  assert.match(ok.details.join(' '), /workflow/);
});

test('Render : création de service avec le premier compte, offre gratuite à Francfort', async () => {
  const R = 'https://api.render.com/v1';
  const f = fauxFetch({
    [`GET ${R}/owners?limit=20`]: [{ owner: { id: 'own1', name: 'Abraham' } }],
    [`POST ${R}/services`]: { service: { id: 'srv-1', name: 'api', serviceDetails: { url: 'https://api.onrender.com' }, dashboardUrl: 'https://dashboard.render.com/web/srv-1' } }
  });
  const r = await executerDev('render_creer_service', { nom: 'api', depot: 'abraham/app', environnement: 'node', commandeBuild: 'npm install', commandeStart: 'node server.js' }, { render: 'rnd' }, f);
  assert.equal(r.serviceId, 'srv-1');
  const corps = f.appels.find((a) => a.method === 'POST').body;
  assert.equal(corps.ownerId, 'own1');
  assert.equal(corps.serviceDetails.plan, 'free');
  assert.equal(corps.repo, 'https://github.com/abraham/app');
});

test('Mode développeur : clé absente = message clair, pas d\'appel réseau', async () => {
  const f = fauxFetch({});
  const r = await executerDev('github_depots', {}, {}, f);
  assert.match(r.erreur, /Clé GitHub absente/);
  assert.equal(f.appels.length, 0);
});

test('Rappels : date d\'Abidjan, date passée refusée, répétition mensuelle', async () => {
  const store = createStore();
  const maintenant = new Date('2026-10-01T09:00:00Z');
  const r = await executerOrganisation(store, 'creer_rappel', { texte: 'Payer le loyer', quand: '2026-10-05T09:00', repetition: 'mensuel' }, maintenant);
  assert.equal(r.quand, '2026-10-05T09:00:00.000Z');
  assert.ok((await executerOrganisation(store, 'creer_rappel', { texte: 'x', quand: '2026-09-30T09:00' }, maintenant)).erreur);
  assert.equal(prochaineOccurrence(r.quand, 'mensuel'), '2026-11-05T09:00:00.000Z');
  assert.equal(lireDate('2026-10-05').toISOString(), '2026-10-05T09:00:00.000Z');
  assert.equal((await store.dueReminders('2026-10-05T09:00:30.000Z')).length, 1);
});

test('Listes : ajout sans doublon, coche, retrait', async () => {
  const store = createStore();
  await executerOrganisation(store, 'gerer_liste', { nom: 'Courses', ajouter: ['Riz', 'Huile', 'riz'] });
  const l = await executerOrganisation(store, 'gerer_liste', { nom: 'courses', cocher: ['Huile'], retirer: ['Riz'], ajouter: ['Attiéké'] });
  assert.deepEqual(l.items.map((i) => [i.texte, i.fait]), [['Huile', true], ['Attiéké', false]]);
});

test('Documents : enregistrés et vides refusés', async () => {
  const store = createStore();
  assert.ok((await creerDocument(store, { type: 'lettre', titre: 'x', contenu: '' })).erreur);
  const d = await creerDocument(store, { type: 'lettre', titre: 'Demande', contenu: 'Monsieur, …' }, 'redaction');
  assert.equal((await store.getDocument(d.id)).titre, 'Demande');
});

test('Coffre : chiffre et déchiffre, refuse une autre clé', () => {
  const a = creerCoffre('secret-1');
  const paquet = a.chiffrer('ghp_123');
  assert.notEqual(paquet, 'ghp_123');
  assert.equal(a.dechiffrer(paquet), 'ghp_123');
  assert.equal(creerCoffre('secret-2').dechiffrer(paquet), null);
});

test('Markdown : tout est échappé, seuls les liens https passent', () => {
  const h = markdown('**gras** <script>x</script> [ok](https://a.ci) [ko](javascript:alert(1))');
  assert.ok(!h.includes('<script>'));
  assert.ok(h.includes('<a href="https://a.ci"'));
  assert.ok(!h.includes('href="javascript'));
});

test('Accès : offre et mode développeur', () => {
  assert.equal(accesAgent('finance', { offre: 'plus' }).ok, false);
  assert.equal(accesAgent('budget', { offre: 'plus' }).ok, true);
  assert.equal(accesAgent('dev', { offre: 'pro' }).ok, false);
  assert.equal(accesAgent('dev', { offre: 'pro', developpeur: true }).ok, true);
  assert.equal(accesAgent('redaction', {}).ok, true);
});
