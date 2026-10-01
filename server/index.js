// Serveur du prototype Tehis : sert la PWA, protège l'accès par mot de passe,
// fait parler les agents (Claude) en flux et exécute leurs outils.
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStore, memoireAutorisee } from './store.js';
import { instructionsStatiques, contexteDynamique, outils, OUTIL_RECHERCHE_WEB } from './agents.js';
import { reponseDemo } from './demo.js';
import { creerCoffre } from './coffre.js';
import { initNotifications } from './notifications.js';
import { creerDocument, TYPES_DOCUMENTS } from './outils/documents.js';
import { executerOrganisation } from './outils/organisation.js';
import { executerDev, preparerAction, OUTILS_A_VALIDER, SCHEMAS_DEV } from './outils/dev.js';
import { OUTILS_FINANCE } from '../public/shared/finance.js';
import { OUTILS_BUDGET } from '../public/shared/budget.js';
import { AGENTS, OFFRES, accesAgent } from '../public/shared/agents.js';
import { markdown, echapper } from '../public/shared/markdown.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const APP_PASSWORD = process.env.APP_PASSWORD || '';
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const MODELE_FORT = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MODELE_LEGER = process.env.ANTHROPIC_MODEL_LEGER || 'claude-haiku-4-5-20251001';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
// Prototype : une seule personne, dont l'offre est fixée par variable d'environnement (Chariow viendra ensuite).
const OFFRE_TEST = OFFRES.includes(process.env.OFFRE_TEST) ? process.env.OFFRE_TEST : 'pro';
const MAX_TOURS_OUTILS = 8;
const COOKIE = 'tehis_session';
const NOMS_OUTILS_DEV = new Set(SCHEMAS_DEV.map((s) => s.name));

const anthropic = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;
const store = createStore();
const coffre = creerCoffre(SECRET);
const app = express();
app.disable('x-powered-by');
app.use('/api/chat', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '400kb' }));

// --- Session très simple : un cookie signé, un seul utilisateur (prototype) ---
const signer = (v) => createHmac('sha256', SECRET).update(v).digest('hex');
const jeton = () => { const t = Date.now().toString(36); return `${t}.${signer(t)}`; };
function jetonValide(v) {
  if (!v) return false;
  const [t, sig] = v.split('.');
  if (!t || !sig) return false;
  const attendu = signer(t);
  return sig.length === attendu.length && timingSafeEqual(Buffer.from(sig), Buffer.from(attendu));
}
function lireCookie(req) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
function authentifie(req) { return !APP_PASSWORD || jetonValide(lireCookie(req)); }

// Limite simple : 30 messages par minute.
const compteur = new Map();
function limite(req, res, next) {
  const cle = req.ip; const now = Date.now();
  const liste = (compteur.get(cle) || []).filter((t) => now - t < 60_000);
  if (liste.length >= 30) return res.status(429).json({ erreur: 'Trop de messages en une minute. Attends un peu.' });
  liste.push(now); compteur.set(cle, liste); next();
}

const profil = async () => ({ ...(await store.getProfile()), offre: OFFRE_TEST });
const clesDev = async () => ({ github: coffre.dechiffrer(await store.getSecret('github')), render: coffre.dechiffrer(await store.getSecret('render')) });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/status', (req, res) => {
  res.json({ authentifie: authentifie(req), motDePasseRequis: Boolean(APP_PASSWORD), modeDemo: !anthropic, stockage: store.kind, modeles: anthropic ? { fort: MODELE_FORT, leger: MODELE_LEGER } : null });
});

app.post('/api/login', (req, res) => {
  if (!APP_PASSWORD) return res.json({ ok: true });
  const essai = String(req.body?.password || '');
  const a = Buffer.from(signer(essai)); const b = Buffer.from(signer(APP_PASSWORD));
  if (!timingSafeEqual(a, b)) return res.status(401).json({ erreur: 'Mot de passe incorrect.' });
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(jeton())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => (authentifie(req) ? next() : res.status(401).json({ erreur: 'Connexion requise.' })));

/* ---------- Profil et mémoire ---------- */
app.get('/api/profile', async (_req, res) => res.json(await profil()));
app.put('/api/profile', async (req, res) => {
  const { prenom, nomCompagnon, espece, couleur, developpeur } = req.body || {};
  const propre = {};
  for (const [k, v] of Object.entries({ prenom, nomCompagnon, espece, couleur })) {
    if (typeof v === 'string' && v.length <= 40) propre[k] = v.trim();
  }
  if (typeof developpeur === 'boolean') propre.developpeur = developpeur;
  await store.setProfile(propre);
  res.json(await profil());
});

app.get('/api/memories', async (_req, res) => res.json(await store.listMemories()));
app.delete('/api/memories/:id', async (req, res) => { await store.deleteMemory(req.params.id); res.json({ ok: true }); });

/* ---------- Documents ---------- */
app.get('/api/documents', async (_req, res) => res.json(await store.listDocuments()));
app.get('/api/documents/:id', async (req, res) => {
  const d = await store.getDocument(req.params.id);
  return d ? res.json(d) : res.status(404).json({ erreur: 'Document introuvable.' });
});
app.delete('/api/documents/:id', async (req, res) => { await store.deleteDocument(req.params.id); res.json({ ok: true }); });
app.get('/api/documents/:id/imprimer', async (req, res) => {
  const d = await store.getDocument(req.params.id);
  if (!d) return res.status(404).send('Document introuvable.');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'unsafe-inline'");
  res.send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${echapper(d.titre)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=Space+Grotesk:wght@600&display=swap">
<style>body{font:15px/1.6 'IBM Plex Sans',system-ui,sans-serif;color:#1A1916;background:#fff;max-width:720px;margin:0 auto;padding:32px 20px}
h3,h4,h5{font-family:'Space Grotesk',system-ui,sans-serif;margin:1.2em 0 .4em}h3{font-size:22px}h4{font-size:17px}p{margin:0 0 .8em}ul,ol{margin:0 0 .8em;padding-left:22px}
pre{white-space:pre-wrap;background:#F3F0E8;padding:10px;border-radius:8px}.barre{display:flex;gap:8px;margin-bottom:24px}.barre button{font:600 14px system-ui;padding:10px 16px;border-radius:10px;border:1px solid #0E7C86;background:#0E7C86;color:#fff}
@media print{.barre{display:none}body{padding:0}}</style></head><body>
<div class="barre"><button onclick="window.print()">Enregistrer en PDF ou imprimer</button></div>
${markdown(d.contenu)}<script>setTimeout(()=>window.print(),400)</script></body></html>`);
});

/* ---------- Rappels et listes ---------- */
app.get('/api/reminders', async (_req, res) => res.json(await store.listReminders({ aVenir: true })));
app.delete('/api/reminders/:id', async (req, res) => { await store.deleteReminder(req.params.id); res.json({ ok: true }); });
app.get('/api/lists', async (_req, res) => res.json(await store.listLists()));
app.patch('/api/lists/:id/items/:item', async (req, res) => {
  const l = await store.getListById(req.params.id);
  const it = l?.items.find((i) => i.id === req.params.item);
  if (!it) return res.status(404).json({ erreur: 'Élément introuvable.' });
  it.fait = Boolean(req.body?.fait);
  res.json(await store.saveList(l));
});
app.delete('/api/lists/:id', async (req, res) => { await store.deleteList(req.params.id); res.json({ ok: true }); });

/* ---------- Notifications ---------- */
let notifications = null;
app.get('/api/push/key', (_req, res) => res.json({ cle: notifications?.clePublique || null }));
app.post('/api/push/subscribe', async (req, res) => {
  const s = req.body;
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ erreur: 'Abonnement invalide.' });
  await store.addSubscription({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
  res.json({ ok: true });
});
app.post('/api/push/test', async (_req, res) => {
  const n = await notifications.envoyerATous({ titre: 'Tehis', corps: 'Les notifications fonctionnent. Tes rappels arriveront ici.', url: '/' });
  res.json({ envoyes: n });
});

/* ---------- Mode développeur : clés et validations ---------- */
app.get('/api/dev/cles', async (_req, res) => {
  res.json({ github: (await store.getProfile()).githubLogin || ((await store.getSecret('github')) ? 'connecté' : null), render: Boolean(await store.getSecret('render')) });
});
app.put('/api/dev/cles', async (req, res) => {
  const { github, render } = req.body || {};
  const retour = {};
  if (typeof github === 'string') {
    if (!github.trim()) { await store.setSecret('github', null); await store.setProfile({ githubLogin: null }); retour.github = null; } else {
      try {
        const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github.trim()}`, 'User-Agent': 'Tehis-Prototype', Accept: 'application/vnd.github+json' } });
        if (!r.ok) return res.status(400).json({ erreur: `GitHub refuse cette clé (${r.status}).` });
        const u = await r.json();
        await store.setSecret('github', coffre.chiffrer(github.trim()));
        await store.setProfile({ githubLogin: u.login });
        retour.github = u.login;
      } catch { return res.status(502).json({ erreur: 'Impossible de joindre GitHub pour vérifier la clé.' }); }
    }
  }
  if (typeof render === 'string') {
    if (!render.trim()) { await store.setSecret('render', null); retour.render = false; } else {
      try {
        const r = await fetch('https://api.render.com/v1/owners?limit=1', { headers: { Authorization: `Bearer ${render.trim()}`, Accept: 'application/json' } });
        if (!r.ok) return res.status(400).json({ erreur: `Render refuse cette clé (${r.status}).` });
        await store.setSecret('render', coffre.chiffrer(render.trim()));
        retour.render = true;
      } catch { return res.status(502).json({ erreur: 'Impossible de joindre Render pour vérifier la clé.' }); }
    }
  }
  res.json(retour);
});

app.post('/api/actions/:id', async (req, res) => {
  const action = await store.getAction(req.params.id);
  if (!action) return res.status(404).json({ erreur: 'Action introuvable.' });
  if (action.statut !== 'en_attente') return res.status(409).json({ erreur: 'Cette action a déjà été traitée.', statut: action.statut });
  if (!accesAgent('dev', await profil()).ok) return res.status(403).json({ erreur: 'Mode développeur non disponible.' });
  if (req.body?.decision !== 'valider') {
    await store.updateAction(action.id, { statut: 'refusee', resultat: null });
    return res.json({ statut: 'refusee' });
  }
  const input = typeof action.input === 'string' ? JSON.parse(action.input) : action.input;
  const resultat = await executerDev(action.outil, input, await clesDev());
  const statut = resultat.erreur ? 'echec' : 'executee';
  await store.updateAction(action.id, { statut, resultat });
  res.json({ statut, resultat });
});

/* ---------- Chat ---------- */
const TYPES_IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
function lireImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 3).map((u) => /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(u))).filter((m) => m && TYPES_IMAGES.has(m[1]) && m[2].length < 5_000_000)
    .map((m) => ({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }));
}

function nettoyerHistorique(messages) {
  if (!Array.isArray(messages)) return [];
  const propres = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && (m.content.trim() || m.images?.length))
    .map((m) => ({ role: m.role, content: m.content.slice(0, 12000) || '(photo)', images: m.images }))
    .slice(-24);
  while (propres.length && propres[0].role !== 'user') propres.shift();
  const fusion = [];
  for (const m of propres) {
    const last = fusion.at(-1);
    if (last && last.role === m.role) { last.content += `\n\n${m.content}`; last.images = m.images || last.images; } else fusion.push({ ...m });
  }
  // Seules les photos du dernier message sont envoyées (coût et confidentialité).
  return fusion.map((m, i) => {
    const imgs = i === fusion.length - 1 && m.role === 'user' ? lireImages(m.images) : [];
    return { role: m.role, content: imgs.length ? [...imgs, { type: 'text', text: m.content }] : m.content };
  });
}

/** Exécute un outil client. Renvoie ce que voit le modèle et l'événement à envoyer à l'app. */
async function executerOutil(agent, nom, input = {}) {
  if (nom === 'retenir') {
    if (!memoireAutorisee(input?.fait)) return { resultat: { enregistre: false, raison: 'Fait vide, trop long ou sensible : non enregistré.' } };
    const m = await store.addMemory({ fait: input.fait.trim(), categorie: input.categorie || 'profil' });
    return { resultat: { enregistre: true, id: m.id }, evenement: ['memory', { fait: m.fait }] };
  }
  const calcul = OUTILS_FINANCE[nom] || OUTILS_BUDGET[nom];
  if (calcul) {
    let r; try { r = calcul(input); } catch (e) { r = { erreur: e.message }; }
    return { resultat: r, evenement: ['tool', { name: nom, input, result: r }] };
  }
  if (nom === 'creer_document') {
    const d = await creerDocument(store, input, agent);
    if (d.erreur) return { resultat: d };
    return { resultat: { enregistre: true, id: d.id, titre: d.titre, affiche: 'La carte du document est affichée avec Copier, Partager et PDF.' }, evenement: ['document', d] };
  }
  if (['creer_rappel', 'lister_rappels', 'supprimer_rappel', 'gerer_liste', 'lister_listes'].includes(nom)) {
    const r = await executerOrganisation(store, nom, input);
    return { resultat: r, evenement: r.type && !r.erreur ? ['tool', { name: nom, input, result: r }] : null };
  }
  if (nom === 'suggerer_agent') {
    if (!AGENTS[input.agent]) return { resultat: { erreur: 'Agent inconnu.' } };
    return { resultat: { affiche: true }, evenement: ['suggestion', { agent: input.agent, raison: String(input.raison || '').slice(0, 200) }] };
  }
  if (nom === 'proposer_mode_developpeur') return { resultat: { affiche: true }, evenement: ['devoffer', {}] };
  if (NOMS_OUTILS_DEV.has(nom)) {
    if (agent !== 'dev') return { resultat: { erreur: 'Outil réservé au mode développeur.' } };
    if (OUTILS_A_VALIDER.has(nom)) {
      const cles = await clesDev();
      const service = nom.startsWith('github') ? 'github' : 'render';
      if (!cles[service]) return { resultat: { erreur: `Clé ${service === 'github' ? 'GitHub' : 'Render'} absente : demande à l'utilisateur de l'ajouter dans Réglages › Mode développeur.` } };
      const p = preparerAction(nom, input);
      if (p.erreur) return { resultat: p };
      const a = await store.addAction({ outil: nom, input, resume: p.resume });
      return {
        resultat: { statut: 'en_attente_de_validation', actionId: a.id, consigne: "L'action n'est PAS encore faite. Demande à l'utilisateur de vérifier la carte et d'appuyer sur Valider." },
        evenement: ['approval', { id: a.id, outil: nom, resume: p.resume, details: p.details, fichiers: p.fichiers || null }]
      };
    }
    const r = await executerDev(nom, input, await clesDev());
    return { resultat: r, evenement: ['activite', { texte: r.erreur ? `${nom} : ${r.erreur}` : resumeLecture(nom, r) }] };
  }
  return { resultat: { erreur: `Outil inconnu : ${nom}` } };
}

function resumeLecture(nom, r) {
  if (nom === 'github_depots') return `GitHub : ${r.depots.length} dépôts lus`;
  if (nom === 'github_lire') return r.dossier ? `GitHub : dossier ${r.dossier} lu` : `GitHub : ${r.fichier} lu`;
  if (nom === 'render_services') return `Render : ${r.services.length} services lus`;
  if (nom === 'render_statut') return `Render : dernier déploiement « ${r.deploiements[0]?.statut || 'aucun'} »`;
  return nom;
}

function sources(contenu) {
  const vues = new Map();
  for (const b of contenu) {
    for (const c of b.citations || []) if (c.url && !vues.has(c.url)) vues.set(c.url, { url: c.url, titre: c.title || c.url });
  }
  return [...vues.values()].slice(0, 8);
}

app.post('/api/chat', limite, async (req, res) => {
  const agent = AGENTS[req.body?.agent] ? req.body.agent : 'compagnon';
  const p = await profil();
  const acces = accesAgent(agent, p);
  if (!acces.ok) return res.status(403).json({ erreur: acces.raison });
  const historique = nettoyerHistorique(req.body?.messages);
  if (!historique.length || historique.at(-1).role !== 'user') return res.status(400).json({ erreur: 'Message manquant.' });

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let ferme = false;
  res.on('close', () => { ferme = true; });
  const send = (event, data) => { if (!ferme) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  const modele = AGENTS[agent].modele === 'leger' ? MODELE_LEGER : MODELE_FORT;
  try {
    if (!anthropic) {
      const dernier = historique.at(-1).content;
      await reponseDemo(agent, typeof dernier === 'string' ? dernier : dernier.at(-1).text, { nomCompagnon: p.nomCompagnon, send, store });
      send('done', { demo: true });
      return res.end();
    }

    const souvenirs = (await store.listMemories()).slice(0, 40);
    const system = [
      { type: 'text', text: instructionsStatiques(agent), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contexteDynamique({ ...p, souvenirs }) }
    ];
    let listeOutils = outils(agent);
    const messages = [...historique];
    const usage = { input: 0, output: 0, recherches: 0 };
    const toutesSources = new Map();
    send('mood', { mood: 'reflechit' });

    for (let tour = 0; tour <= MAX_TOURS_OUTILS; tour++) {
      let msg;
      try {
        const stream = anthropic.messages.stream({ model: modele, max_tokens: agent === 'dev' ? 12000 : 2500, system, tools: listeOutils, messages });
        let premier = true;
        stream.on('text', (t) => {
          if (premier) { send('mood', { mood: 'ecoute' }); premier = false; }
          send('token', { text: t });
        });
        stream.on('contentBlock', (b) => {
          if (b.type === 'server_tool_use' && b.name === 'web_search') {
            usage.recherches++;
            send('mood', { mood: 'travaille' });
            send('activite', { texte: `Recherche : ${b.input?.query || '…'}` });
            premier = true;
          }
        });
        msg = await stream.finalMessage();
      } catch (e) {
        // Recherche web non activée pour cette organisation : on continue sans elle.
        if (e?.status === 400 && /web_search/i.test(e?.message || '') && listeOutils.includes(OUTIL_RECHERCHE_WEB)) {
          listeOutils = listeOutils.filter((o) => o !== OUTIL_RECHERCHE_WEB);
          system[1] = { type: 'text', text: `${system[1].text}\n- La recherche web est indisponible : dis-le, donne des indications générales et conseille de vérifier auprès de l'organisme officiel.` };
          send('activite', { texte: 'Recherche web indisponible pour cette clé API' });
          tour--; continue;
        }
        throw e;
      }
      usage.input += msg.usage?.input_tokens || 0;
      usage.output += msg.usage?.output_tokens || 0;
      for (const s of sources(msg.content)) toutesSources.set(s.url, s);

      if (msg.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: msg.content }); continue; }
      if (msg.stop_reason !== 'tool_use' || tour === MAX_TOURS_OUTILS) break;
      messages.push({ role: 'assistant', content: msg.content });
      const resultats = [];
      for (const bloc of msg.content.filter((b) => b.type === 'tool_use')) {
        send('mood', { mood: 'travaille' });
        const { resultat, evenement } = await executerOutil(agent, bloc.name, bloc.input);
        if (evenement) send(...evenement);
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify(resultat), ...(resultat?.erreur ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: resultats });
      send('token', { text: '\n\n' });
    }
    if (toutesSources.size) send('sources', { sources: [...toutesSources.values()] });
    send('mood', { mood: 'fete' });
    send('done', { usage, modele });
  } catch (e) {
    // L'utilisateur voit un message simple ; le détail technique part dans les journaux Render pour l'équipe.
    const texte = e?.message || '';
    const panneAdmin = /credit balance|billing|purchase credits/i.test(texte) ? 'CRÉDIT ANTHROPIC ÉPUISÉ : recharger sur console.anthropic.com (Billing)'
      : e?.status === 401 ? 'CLÉ API REFUSÉE : vérifier ANTHROPIC_API_KEY dans Render'
      : e?.status === 404 ? `MODÈLE INTROUVABLE (${modele}) : vérifier ANTHROPIC_MODEL et ANTHROPIC_MODEL_LEGER`
      : e?.status === 403 ? 'ACCÈS REFUSÉ PAR ANTHROPIC : vérifier les droits de la clé et de l\'organisation'
      : null;
    if (panneAdmin) console.error(`[ALERTE ADMIN] ${panneAdmin} · détail : ${e?.status} ${texte}`);
    else console.error('Erreur chat :', e?.status, texte);
    const msg = panneAdmin ? `${p.nomCompagnon || 'Ton compagnon'} fait une petite pause. Réessaie dans quelques minutes ; les calculs et « Mes affaires » restent disponibles.`
      : e?.status === 429 || e?.status === 529 ? 'Beaucoup de demandes en ce moment. Réessaie dans une minute.'
      : e?.status === 400 && /image/i.test(texte) ? "La photo n'a pas pu être lue. Essaie avec une autre image."
      : 'Une erreur est survenue pendant la réponse. Réessaie.';
    send('error', { message: msg });
    send('mood', { mood: 'repos' });
  }
  res.end();
});

// Fichiers statiques de la PWA.
app.use(express.static(join(here, '..', 'public'), {
  extensions: ['html'],
  setHeaders(res, path) {
    if (path.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    if (path.endsWith('.glb')) res.setHeader('Content-Type', 'model/gltf-binary');
  }
}));
app.get('*', (_req, res) => res.sendFile(join(here, '..', 'public', 'index.html')));

await store.init();
notifications = await initNotifications(store);
app.listen(PORT, () => {
  console.log(`Tehis prototype sur le port ${PORT} · ${anthropic ? `modèles ${MODELE_FORT} / ${MODELE_LEGER}` : 'MODE DÉMO (pas de clé API)'} · offre ${OFFRE_TEST} · stockage ${store.kind}${APP_PASSWORD ? '' : ' · ATTENTION : aucun mot de passe (APP_PASSWORD)'}`);
});

export { TYPES_DOCUMENTS };
