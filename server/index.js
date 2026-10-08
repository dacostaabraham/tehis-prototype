// Serveur du prototype Tehis : sert la PWA, protège l'accès par mot de passe,
// fait parler les agents (Claude) en flux et exécute leurs outils.
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createStore, memoireAutorisee, MAX_CONVERSATION } from './store.js';
import { normaliserTelephone, masquerTelephone, pinValide, hacherPin, verifierPin, pinProvisoire, creerJetons, creerGardien, egalTempsConstant } from './comptes.js';
import { quotaDe, choisirModele, etatQuota, jourAbidjan } from './quotas.js';
import { voixIAActive, synthetiser, transcrire, quotaVoix, alerteVoix, typeAudioAccepte } from './voix-ia.js';
import { configWhatsApp, whatsappActif, signatureValide, lireWebhook, creerClientWhatsApp } from './whatsapp.js';
import { creerCanalWhatsApp } from './canal-whatsapp.js';
import { configPaiement, paiementActif, signaturePulseValide, offreEffective, creerPaiement } from './paiement.js';
import { appliquer, resume as resumeProgression, accessoiresDebloques, niveauPour, ACCESSOIRES } from '../public/shared/progression.js';
import { instructionsStatiques, contexteDynamique, outils, OUTIL_RECHERCHE_WEB } from './agents.js';
import { reponseDemo } from './demo.js';
import { creerCoffre } from './coffre.js';
import { initNotifications } from './notifications.js';
import { creerDocument, TYPES_DOCUMENTS } from './outils/documents.js';
import { executerOrganisation } from './outils/organisation.js';
import { chercherLieux, positionValide } from './outils/lieux.js';
import { preparerChoix } from './outils/interaction.js';
import { executerDev, preparerAction, OUTILS_A_VALIDER, SCHEMAS_DEV } from './outils/dev.js';
import { OUTILS_FINANCE } from '../public/shared/finance.js';
import { OUTILS_BUDGET } from '../public/shared/budget.js';
import { AGENTS, OFFRES, NOMS_OFFRES as NOMS_OFFRES_SERVEUR, accesAgent, estPerso } from '../public/shared/agents.js';
import { nettoyerFiche, instructionsPerso, outilsPerso, limites, OUTIL_FICHE, SYSTEME_FICHE, ficheDemo } from './perso.js';
import { markdown, echapper } from '../public/shared/markdown.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// Code d'invitation demandé à l'inscription (bêta privée). APP_PASSWORD reste accepté pour compatibilité.
const CODE_INVITATION = process.env.CODE_INVITATION || process.env.APP_PASSWORD || '';
// Le compte créé avec ce numéro devient administrateur et récupère les données de l'ancien prototype.
const ADMIN_TELEPHONE = normaliserTelephone(process.env.ADMIN_TELEPHONE || '');
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const MODELE_FORT = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const MODELE_LEGER = process.env.ANTHROPIC_MODEL_LEGER || 'claude-haiku-4-5-20251001';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
// Offre des nouveaux comptes (l'administrateur la change ensuite par compte ; Chariow viendra plus tard).
const OFFRE_DEFAUT = OFFRES.includes(process.env.OFFRE_DEFAUT) ? process.env.OFFRE_DEFAUT : 'gratuit';
const MAX_TOURS_OUTILS = 8;
const COOKIE = 'tehis_session';
const NOMS_OUTILS_DEV = new Set(SCHEMAS_DEV.map((s) => s.name));

const anthropic = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;
const store = createStore();
const coffre = creerCoffre(SECRET);
const app = express();
app.disable('x-powered-by');
// WhatsApp : corps brut, nécessaire pour vérifier la signature de Meta.
app.use('/webhook/whatsapp', express.raw({ type: '*/*', limit: '2mb' }));
app.use('/webhook/chariow', express.raw({ type: '*/*', limit: '1mb' }));
app.use('/api/chat', express.json({ limit: '8mb' }));
app.use('/api/conversations', express.json({ limit: '1mb' }));
app.use('/api/voix/transcrire', express.raw({ type: (req) => Boolean(typeAudioAccepte(req.headers['content-type'])), limit: '8mb' }));
app.use(express.json({ limit: '400kb' }));

// --- Comptes et sessions ---
const jetons = creerJetons(SECRET);
const gardien = creerGardien();
function lireCookie(req) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : null;
}
async function compteDeLaRequete(req) {
  let compte = null;
  const s = await jetons.lire(lireCookie(req), async (uid) => {
    compte = await store.getUser(uid);
    return compte ? (compte.data?.versionSession || 0) : null;
  });
  return s ? compte : null;
}
function poserCookie(req, res, valeur, maxAge = 60 * 60 * 24 * 90) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(valeur)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}
const ouvrirSession = (req, res, u) => poserCookie(req, res, jetons.creer(u.id, u.data?.versionSession || 0));

// Limite simple : 30 messages par minute et par compte.
const compteur = new Map();
function limite(req, res, next) {
  const cle = req.compte?.id || req.ip; const now = Date.now();
  const liste = (compteur.get(cle) || []).filter((t) => now - t < 60_000);
  if (liste.length >= 30) return res.status(429).json({ erreur: 'Trop de messages en une minute. Attends un peu.' });
  liste.push(now); compteur.set(cle, liste); next();
}

/** Profil vu par les agents et l'app : données du compte + offre + rôle. */
const profil = (req) => ({ ...(req.compte.data || {}), offre: req.compte.offre, role: req.compte.role });
const clesDev = async (req) => ({ github: coffre.dechiffrer(await req.store.getSecret('github')), render: coffre.dechiffrer(await req.store.getSecret('render')) });

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.get('/api/status', async (req, res) => {
  const compte = await compteDeLaRequete(req);
  res.json({ authentifie: Boolean(compte), invitationRequise: Boolean(CODE_INVITATION), modeDemo: !anthropic, voixIA: voixIAActive(), whatsapp: WHATSAPP.actif ? { numero: WHATSAPP.config.numero || null } : null, stockage: store.kind, modeles: anthropic ? { fort: MODELE_FORT, leger: MODELE_LEGER } : null });
});

const reponseCompte = (u) => ({ ok: true, prenom: u.data?.prenom || '', nouveau: !u.data?.espece });

app.post('/api/inscription', async (req, res) => {
  const telephone = normaliserTelephone(req.body?.telephone);
  const pin = String(req.body?.pin || '');
  const prenom = String(req.body?.prenom || '').trim().slice(0, 40);
  if (CODE_INVITATION && !egalTempsConstant(String(req.body?.invitation || '').trim().toUpperCase(), CODE_INVITATION.trim().toUpperCase())) {
    return res.status(403).json({ erreur: "Code d'invitation incorrect. Demande-le à l'équipe Tehis." });
  }
  if (!telephone) return res.status(400).json({ erreur: 'Numéro invalide. Exemple : 07 07 12 34 56.' });
  const pb = pinValide(pin);
  if (pb) return res.status(400).json({ erreur: pb });
  if (!prenom) return res.status(400).json({ erreur: 'Indique ton prénom.' });
  if (await store.getUserAuth(telephone)) return res.status(409).json({ erreur: 'Ce numéro a déjà un compte. Connecte-toi avec ton code.' });
  // Administrateur : le numéro ADMIN_TELEPHONE, ou à défaut le tout premier compte.
  const admin = ADMIN_TELEPHONE ? telephone === ADMIN_TELEPHONE : (await store.countUsers()) === 0;
  const u = await store.createUser({ telephone, pin_hash: hacherPin(pin), offre: admin ? 'pro' : OFFRE_DEFAUT, role: admin ? 'admin' : 'testeur', data: { prenom } });
  if (admin) {
    await store.rattacherAnciennesDonnees(u.id);
    console.log(`[COMPTES] Compte administrateur créé (${masquerTelephone(telephone)}) ; anciennes données rattachées.`);
  }
  const complet = await store.getUser(u.id);
  ouvrirSession(req, res, complet);
  res.json(reponseCompte(complet));
});

app.post('/api/connexion', async (req, res) => {
  const telephone = normaliserTelephone(req.body?.telephone);
  const cles = [`t:${telephone}`, `ip:${req.ip}`];
  if (gardien.bloque(cles)) return res.status(429).json({ erreur: 'Trop d\'essais. Attends 15 minutes avant de réessayer.' });
  const u = telephone ? await store.getUserAuth(telephone) : null;
  if (!u || !verifierPin(req.body?.pin, u.pin_hash)) {
    gardien.echec(cles);
    return res.status(401).json({ erreur: 'Numéro ou code incorrect.' });
  }
  gardien.reussite(cles);
  const complet = await store.getUser(u.id);
  ouvrirSession(req, res, complet);
  res.json(reponseCompte(complet));
});

/* ---------- WhatsApp : webhook Meta ---------- */
const WHATSAPP = { config: configWhatsApp(), actif: whatsappActif(), canal: null };
const URL_APP = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || '';
app.get('/webhook/whatsapp', (req, res) => {
  const ok = WHATSAPP.actif && req.query['hub.mode'] === 'subscribe' && egalTempsConstant(String(req.query['hub.verify_token'] || ''), WHATSAPP.config.verifyToken);
  return ok ? res.type('text/plain').send(String(req.query['hub.challenge'] || '')) : res.sendStatus(403);
});
app.post('/webhook/whatsapp', (req, res) => {
  if (!WHATSAPP.actif) return res.sendStatus(404);
  if (!signatureValide(req.body, req.headers['x-hub-signature-256'], WHATSAPP.config.secret)) {
    console.warn('[WhatsApp] signature invalide : message ignoré');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // Meta attend une réponse rapide ; le traitement continue ensuite.
  try {
    const messages = lireWebhook(JSON.parse(req.body.toString('utf8')));
    if (messages.length) WHATSAPP.canal.recu(messages);
  } catch (e) { console.error('[WhatsApp] notification illisible :', e.message); }
});

/* ---------- Paiement Chariow : Pulse signé ---------- */
const PAIEMENT = { config: configPaiement(), actif: paiementActif() };
PAIEMENT.service = creerPaiement({ store, config: PAIEMENT.config });
const livraisonsVues = new Set();
app.post('/webhook/chariow', async (req, res) => {
  if (!PAIEMENT.config.secretPulse) return res.sendStatus(404);
  if (!signaturePulseValide(req.body, req.headers['x-chariow-signature'], PAIEMENT.config.secretPulse)) {
    console.warn('[PAIEMENT] Pulse à signature invalide : ignoré');
    return res.status(401).send('Signature invalide');
  }
  const livraison = req.headers['x-pulse-delivery-id'];
  if (livraison && livraisonsVues.has(livraison)) return res.status(200).send('OK');
  let corps;
  try { corps = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).send('JSON invalide'); }
  try {
    const r = await PAIEMENT.service.pulse(corps);
    if (r.test) { console.log(`[PAIEMENT] Pulse de test reçu et vérifié (${corps.event || 'test'})`); return res.status(200).send('OK'); }
    if (livraison) { livraisonsVues.add(livraison); if (livraisonsVues.size > 5000) livraisonsVues.clear(); }
    console.log(`[PAIEMENT] Pulse ${corps.event} ${corps.sale?.id || ''} → ${JSON.stringify(r)}`);
    res.status(200).send('OK');
  } catch (e) {
    console.error('[ALERTE ADMIN] Pulse Chariow non traité :', e.message);
    res.status(500).send('Erreur'); // Chariow réessaiera
  }
});

/* ---------- Code secret oublié : nouveau code par WhatsApp ---------- */
const codesOublies = new Map(); // téléphone → { hache, expire, essais }
app.post('/api/code-oublie', async (req, res) => {
  const telephone = normaliserTelephone(req.body?.telephone);
  if (!WHATSAPP.actif) return res.status(503).json({ erreur: "Écris à l'équipe Tehis : elle t'enverra un code provisoire." });
  if (!telephone) return res.status(400).json({ erreur: 'Numéro invalide.' });
  const cles = [`oubli:${telephone}`, `oubli-ip:${req.ip}`];
  if (gardien.bloque(cles)) return res.status(429).json({ erreur: 'Trop de demandes. Réessaie dans 15 minutes.' });
  gardien.echec(cles); // chaque demande compte : 5 au plus par quart d'heure
  const u = await store.getUserAuth(telephone);
  if (u) {
    const valeur = pinProvisoire();
    codesOublies.set(telephone, { hache: hacherPin(valeur), expire: Date.now() + 10 * 60_000, essais: 0 });
    try { await WHATSAPP.canal.code(await store.getUser(u.id), valeur); } catch (e) {
      console.error(`[ALERTE ADMIN] Code oublié non envoyé sur WhatsApp : ${e.message}`);
      return res.status(503).json({ erreur: "Le code n'a pas pu partir sur WhatsApp. Écris d'abord « bonjour » au numéro WhatsApp de Tehis, puis réessaie." });
    }
  }
  // Même réponse que le numéro ait un compte ou non.
  res.json({ ok: true });
});
app.post('/api/code-oublie/valider', async (req, res) => {
  const telephone = normaliserTelephone(req.body?.telephone);
  const attente = telephone && codesOublies.get(telephone);
  if (!attente || attente.expire < Date.now() || attente.essais >= 5) return res.status(400).json({ erreur: 'Code expiré. Demande un nouveau code.' });
  if (!verifierPin(String(req.body?.code || ''), attente.hache)) { attente.essais++; return res.status(401).json({ erreur: 'Code incorrect.' }); }
  const pb = pinValide(req.body?.nouveau);
  if (pb) return res.status(400).json({ erreur: pb });
  const u = await store.getUserAuth(telephone);
  codesOublies.delete(telephone);
  const maj = await store.updateUser(u.id, { pin_hash: hacherPin(req.body.nouveau), data: { versionSession: (u.data?.versionSession || 0) + 1 } });
  ouvrirSession(req, res, maj);
  res.json(reponseCompte(maj));
});

app.post('/api/deconnexion', (req, res) => { poserCookie(req, res, '', 0); res.json({ ok: true }); });

// Tout le reste de l'API exige un compte connecté.
app.use('/api', async (req, res, next) => {
  try {
    const compte = await compteDeLaRequete(req);
    if (!compte) return res.status(401).json({ erreur: 'Connexion requise.' });
    // Offre payée arrivée à échéance : retour à l'offre Gratuit.
    const effective = offreEffective(compte);
    if (effective !== compte.offre) {
      Object.assign(compte, await store.updateUser(compte.id, { offre: effective, data: { offreExpiree: compte.offre } }));
      console.log(`[PAIEMENT] Offre ${compte.data?.offreExpiree} expirée pour ${compte.id.slice(0, 8)} : retour en Gratuit`);
    }
    req.compte = compte;
    req.store = store.pour(compte.id);
    // Dernière visite, au plus une fois par heure (tableau de bord des testeurs).
    if (!compte.derniere_visite || Date.now() - new Date(compte.derniere_visite).getTime() > 3_600_000) {
      store.updateUser(compte.id, { derniere_visite: new Date().toISOString() }).catch(() => {});
    }
    next();
  } catch (e) { next(e); }
});

/* ---------- Mon compte ---------- */
app.get('/api/compte', async (req, res) => {
  res.json({
    telephone: masquerTelephone(req.compte.telephone), offre: req.compte.offre, role: req.compte.role, quota: await etatQuota(req.store, req.compte), depuis: req.compte.created_at,
    offreJusquau: req.compte.data?.offreSource === 'chariow' ? req.compte.data.offreJusquau : null, offreExpiree: req.compte.data?.offreExpiree || null
  });
});
app.put('/api/compte/pin', async (req, res) => {
  const u = await store.getUserAuthById(req.compte.id);
  if (!verifierPin(req.body?.ancien, u.pin_hash)) return res.status(401).json({ erreur: 'Code actuel incorrect.' });
  const pb = pinValide(req.body?.nouveau);
  if (pb) return res.status(400).json({ erreur: pb });
  const version = (u.data?.versionSession || 0) + 1;
  const maj = await store.updateUser(u.id, { pin_hash: hacherPin(req.body.nouveau), data: { versionSession: version } });
  ouvrirSession(req, res, maj); // cet appareil reste connecté, les autres sont déconnectés
  res.json({ ok: true });
});
app.delete('/api/compte', async (req, res) => {
  const u = await store.getUserAuthById(req.compte.id);
  if (!verifierPin(req.body?.pin, u.pin_hash)) return res.status(401).json({ erreur: 'Code incorrect.' });
  await store.deleteUser(u.id);
  poserCookie(req, res, '', 0);
  res.json({ ok: true });
});

/* ---------- Administration des testeurs ---------- */
function admin(req, res, next) { return req.compte.role === 'admin' ? next() : res.status(403).json({ erreur: 'Réservé à l\'administrateur.' }); }
app.get('/api/admin/comptes', admin, async (_req, res) => {
  const jour = jourAbidjan();
  const comptes = await store.listUsers();
  res.json(await Promise.all(comptes.map(async (u) => ({
    id: u.id, telephone: u.telephone, prenom: u.data?.prenom || '', offre: u.offre, role: u.role,
    inscrit: u.created_at, derniereVisite: u.derniere_visite, messagesAujourdhui: await store.pour(u.id).getUsage(jour, 'messages')
  }))));
});
app.put('/api/admin/comptes/:id', admin, async (req, res) => {
  const offre = req.body?.offre;
  if (!OFFRES.includes(offre)) return res.status(400).json({ erreur: 'Offre inconnue.' });
  // Offre donnée à la main : sans date de fin (une offre payée garde sa date si on la remet).
  const u = await store.updateUser(req.params.id, { offre, data: { offreSource: 'admin', offreJusquau: null } });
  return u ? res.json({ ok: true, offre: u.offre }) : res.status(404).json({ erreur: 'Compte introuvable.' });
});
app.post('/api/admin/comptes/:id/pin', admin, async (req, res) => {
  const u = await store.getUserAuthById(req.params.id);
  if (!u) return res.status(404).json({ erreur: 'Compte introuvable.' });
  const pin = pinProvisoire();
  await store.updateUser(u.id, { pin_hash: hacherPin(pin), data: { versionSession: (u.data?.versionSession || 0) + 1 } });
  res.json({ pin, telephone: u.telephone });
});

/* ---------- Profil et mémoire ---------- */
app.get('/api/profile', async (req, res) => res.json({ ...profil(req), compte: req.compte.id }));
app.put('/api/profile', async (req, res) => {
  const { prenom, nomCompagnon, espece, couleur, developpeur } = req.body || {};
  const propre = {};
  for (const [k, v] of Object.entries({ prenom, nomCompagnon, espece, couleur })) {
    if (typeof v === 'string' && v.length <= 40) propre[k] = v.trim();
  }
  if (typeof developpeur === 'boolean') propre.developpeur = developpeur;
  if (typeof req.body?.rappelsWhatsApp === 'boolean') propre.rappelsWhatsApp = req.body.rappelsWhatsApp;
  req.compte.data = await req.store.setProfile(propre);
  res.json({ ...profil(req), compte: req.compte.id });
});

app.get('/api/memories', async (req, res) => res.json(await req.store.listMemories()));
app.delete('/api/memories/:id', async (req, res) => { await req.store.deleteMemory(req.params.id); res.json({ ok: true }); });

/* ---------- Documents ---------- */
app.get('/api/documents', async (req, res) => res.json(await req.store.listDocuments()));
app.get('/api/documents/:id', async (req, res) => {
  const d = await req.store.getDocument(req.params.id);
  return d ? res.json(d) : res.status(404).json({ erreur: 'Document introuvable.' });
});
app.delete('/api/documents/:id', async (req, res) => { await req.store.deleteDocument(req.params.id); res.json({ ok: true }); });
app.get('/api/documents/:id/imprimer', async (req, res) => {
  const d = await req.store.getDocument(req.params.id);
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
app.get('/api/reminders', async (req, res) => res.json(await req.store.listReminders({ aVenir: true })));
app.delete('/api/reminders/:id', async (req, res) => { await req.store.deleteReminder(req.params.id); res.json({ ok: true }); });
app.get('/api/lists', async (req, res) => res.json(await req.store.listLists()));
app.patch('/api/lists/:id/items/:item', async (req, res) => {
  const l = await req.store.getListById(req.params.id);
  const it = l?.items.find((i) => i.id === req.params.item);
  if (!it) return res.status(404).json({ erreur: 'Élément introuvable.' });
  it.fait = Boolean(req.body?.fait);
  res.json(await req.store.saveList(l));
});
app.delete('/api/lists/:id', async (req, res) => { await req.store.deleteList(req.params.id); res.json({ ok: true }); });

/* ---------- Notifications ---------- */
let notifications = null;
app.get('/api/push/key', (_req, res) => res.json({ cle: notifications?.clePublique || null }));
app.post('/api/push/subscribe', async (req, res) => {
  const s = req.body;
  if (!s?.endpoint || !/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) return res.status(400).json({ erreur: 'Abonnement invalide.' });
  await req.store.addSubscription({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
  res.json({ ok: true });
});
app.post('/api/push/test', async (req, res) => {
  const n = await notifications.envoyerA(req.compte.id, { titre: 'Tehis', corps: 'Les notifications fonctionnent. Tes rappels arriveront ici.', url: '/' });
  res.json({ envoyes: n });
});

/* ---------- Mode développeur : clés et validations ---------- */
app.get('/api/dev/cles', async (req, res) => {
  res.json({ github: req.compte.data?.githubLogin || ((await req.store.getSecret('github')) ? 'connecté' : null), render: Boolean(await store.getSecret('render')) });
});
app.put('/api/dev/cles', async (req, res) => {
  const { github, render } = req.body || {};
  const retour = {};
  if (typeof github === 'string') {
    if (!github.trim()) { await req.store.setSecret('github', null); await req.store.setProfile({ githubLogin: null }); retour.github = null; } else {
      try {
        const r = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${github.trim()}`, 'User-Agent': 'Tehis-Prototype', Accept: 'application/vnd.github+json' } });
        if (!r.ok) return res.status(400).json({ erreur: `GitHub refuse cette clé (${r.status}).` });
        const u = await r.json();
        await req.store.setSecret('github', coffre.chiffrer(github.trim()));
        await req.store.setProfile({ githubLogin: u.login });
        retour.github = u.login;
      } catch { return res.status(502).json({ erreur: 'Impossible de joindre GitHub pour vérifier la clé.' }); }
    }
  }
  if (typeof render === 'string') {
    if (!render.trim()) { await req.store.setSecret('render', null); retour.render = false; } else {
      try {
        const r = await fetch('https://api.render.com/v1/owners?limit=1', { headers: { Authorization: `Bearer ${render.trim()}`, Accept: 'application/json' } });
        if (!r.ok) return res.status(400).json({ erreur: `Render refuse cette clé (${r.status}).` });
        await req.store.setSecret('render', coffre.chiffrer(render.trim()));
        retour.render = true;
      } catch { return res.status(502).json({ erreur: 'Impossible de joindre Render pour vérifier la clé.' }); }
    }
  }
  res.json(retour);
});

app.post('/api/actions/:id', async (req, res) => {
  const action = await req.store.getAction(req.params.id);
  if (!action) return res.status(404).json({ erreur: 'Action introuvable.' });
  if (action.statut !== 'en_attente') return res.status(409).json({ erreur: 'Cette action a déjà été traitée.', statut: action.statut });
  if (!accesAgent('dev', profil(req)).ok) return res.status(403).json({ erreur: 'Mode développeur non disponible.' });
  if (req.body?.decision !== 'valider') {
    await req.store.updateAction(action.id, { statut: 'refusee', resultat: null });
    return res.json({ statut: 'refusee' });
  }
  const input = typeof action.input === 'string' ? JSON.parse(action.input) : action.input;
  const resultat = await executerDev(action.outil, input, await clesDev(req));
  const statut = resultat.erreur ? 'echec' : 'executee';
  await req.store.updateAction(action.id, { statut, resultat });
  res.json({ statut, resultat });
});

/* ---------- Lieux à proximité (accès direct, sans IA) ---------- */
const appelsLieux = new Map();
app.get('/api/lieux', async (req, res) => {
  const now = Date.now();
  const l = (appelsLieux.get(req.ip) || []).filter((t) => now - t < 60_000);
  if (l.length >= 10) return res.status(429).json({ erreur: 'Trop de recherches en une minute. Attends un peu.' });
  l.push(now); appelsLieux.set(req.ip, l);
  const position = { lat: Number(req.query.lat), lng: Number(req.query.lng) };
  const r = await chercherLieux({ categorie: String(req.query.categorie || ''), pres_de: req.query.pres_de ? String(req.query.pres_de) : '', rayon_km: Number(req.query.rayon) || 3, garde: req.query.garde === '1' }, { position });
  if (r.erreur) return res.status(400).json(r);
  res.json(r.type === 'lieux' ? { ...r, progression: await progresser(req, [{ type: 'lieux' }]) } : r);
});

/* ---------- Agents personnalisés ---------- */
async function etatPersos(req) {
  const lim = limites(req.compte.offre);
  const agents = await req.store.listCustomAgents();
  return { agents: agents.map((a, i) => ({ ...a, verrouille: i >= lim.agents })), limites: lim, offre: req.compte.offre, utilisesAujourdhui: await req.store.getUsage(jourAbidjan(), 'perso') };
}
app.get('/api/persos', async (req, res) => res.json(await etatPersos(req)));

app.post('/api/persos/brouillon', limite, async (req, res) => {
  const description = String(req.body?.description || '').trim().slice(0, 1500);
  if (description.length < 15) return res.status(400).json({ erreur: 'Décris ton besoin en une ou deux phrases.' });
  if (!anthropic) return res.json(ficheDemo(description));
  if (!(await consommerMessage(req, res))) return;
  try {
    const r = await anthropic.messages.create({
      model: MODELE_LEGER, max_tokens: 2000, system: SYSTEME_FICHE, tools: [OUTIL_FICHE],
      tool_choice: { type: 'tool', name: 'proposer_fiche' },
      messages: [{ role: 'user', content: `Description de l'agent souhaité :\n${description}` }]
    });
    const bloc = r.content.find((b) => b.type === 'tool_use');
    if (!bloc) return res.status(502).json({ erreur: 'Pas de proposition. Réessaie en décrivant ton besoin autrement.' });
    if (bloc.input.refus) return res.status(422).json({ erreur: bloc.input.refus });
    res.json(bloc.input);
  } catch (e) {
    console.error(/credit balance|billing/i.test(e?.message || '') ? '[ALERTE ADMIN] CRÉDIT ANTHROPIC ÉPUISÉ' : 'Brouillon agent :', e?.status, e?.message);
    res.status(503).json({ erreur: 'La proposition automatique est indisponible pour le moment. Tu peux remplir la fiche toi-même.' });
  }
});

app.post('/api/persos', async (req, res) => {
  const p = profil(req);
  const lim = limites(p.offre);
  if ((await req.store.listCustomAgents()).length >= lim.agents) {
    return res.status(403).json({ erreur: `Ton offre permet ${lim.agents} agent${lim.agents > 1 ? 's' : ''} personnalisé${lim.agents > 1 ? 's' : ''}. Passe à une offre supérieure pour en créer plus.` });
  }
  const { fiche, erreur } = nettoyerFiche(req.body, p.offre);
  if (erreur) return res.status(400).json({ erreur });
  res.json(await req.store.saveCustomAgent(fiche));
});

app.put('/api/persos/:id', async (req, res) => {
  const existante = await req.store.getCustomAgent(req.params.id);
  if (!existante) return res.status(404).json({ erreur: 'Agent introuvable.' });
  const { fiche, erreur } = nettoyerFiche(req.body, req.compte.offre, existante);
  if (erreur) return res.status(400).json({ erreur });
  res.json(await req.store.saveCustomAgent(fiche));
});

app.delete('/api/persos/:id', async (req, res) => { await req.store.deleteCustomAgent(req.params.id); res.json({ ok: true }); });

/* ---------- Le compagnon qui grandit ---------- */
/** Ajoute des points ; renvoie ce que l'app affiche (gains, niveau gagné, accessoires débloqués). */
async function progresser(req, evenements) {
  try {
    const r = appliquer(await req.store.getProgression(), evenements);
    await req.store.saveProgression(r.progression);
    return { ...resumeProgression(r.progression), gains: r.gains, niveauGagne: r.niveauGagne, nouveaux: r.debloques };
  } catch (e) { console.warn('Progression :', e.message); return null; }
}
const EVENEMENT_OUTIL = { creer_document: 'document', creer_rappel: 'rappel', gerer_liste: 'liste', chercher_lieux: 'lieux' };
app.get('/api/progression', async (req, res) => res.json(resumeProgression(await req.store.getProgression())));
app.post('/api/progression/visite', async (req, res) => res.json(await progresser(req, [])));
app.post('/api/progression/calcul', async (req, res) => res.json(await progresser(req, [{ type: 'calcul' }])));
app.put('/api/progression/portes', async (req, res) => {
  const prog = (await req.store.getProgression()) || null;
  const debloques = accessoiresDebloques(niveauPour(prog?.points || 0).niveau);
  const portes = Array.isArray(req.body?.portes) ? [...new Set(req.body.portes.filter((id) => ACCESSOIRES[id] && debloques.includes(id)))] : null;
  if (!portes) return res.status(400).json({ erreur: 'Liste invalide.' });
  const maj = { ...(prog || {}), portes };
  if (!prog) Object.assign(maj, appliquer(null, []).progression, { portes });
  await req.store.saveProgression(maj);
  res.json(resumeProgression(maj));
});

/* ---------- Offres et paiement ---------- */
app.get('/api/offres', (req, res) => res.json({ paiement: PAIEMENT.actif, offres: Object.keys(PAIEMENT.config.produits).filter((o) => PAIEMENT.config.produits[o]), dureeJours: PAIEMENT.config.dureeJours }));
app.post('/api/paiement', limite, async (req, res) => {
  if (!PAIEMENT.actif) return res.status(503).json({ erreur: "Le paiement en ligne n'est pas encore ouvert. Écris à l'équipe Tehis." });
  const offre = req.body?.offre;
  const prenom = String(req.body?.prenom || '').trim().slice(0, 50);
  const nom = String(req.body?.nom || '').trim().slice(0, 50);
  const email = String(req.body?.email || '').trim().slice(0, 255);
  const code = String(req.body?.code || '').trim().toUpperCase();
  if (!['plus', 'pro'].includes(offre)) return res.status(400).json({ erreur: 'Offre inconnue.' });
  if (code && !/^[A-Z0-9_-]{1,100}$/.test(code)) return res.status(400).json({ erreur: 'Code promo invalide : lettres et chiffres seulement.' });
  if (!prenom || !nom) return res.status(400).json({ erreur: 'Indique ton prénom et ton nom, comme sur ton compte Mobile Money.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ erreur: 'Adresse e-mail invalide : Chariow y envoie ton reçu.' });
  await req.store.setProfile({ nomFamille: nom, email });
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined;
    const r = await PAIEMENT.service.demarrer({ compte: req.compte, offre, prenom, nom, email, code, ip, urlRetour: URL_APP ? `${URL_APP}/?paiement=retour` : undefined });
    if (r.etape === 'completed') return res.json({ termine: true });
    if (!r.url) return res.status(502).json({ erreur: r.message || 'Paiement indisponible pour le moment.' });
    res.json({ url: r.url });
  } catch (e) {
    console.error(e.statut === 401 ? '[ALERTE ADMIN] CLÉ CHARIOW REFUSÉE : vérifier CHARIOW_API_KEY' : e.statut === 404 ? '[ALERTE ADMIN] PRODUIT CHARIOW INTROUVABLE OU NON PUBLIÉ : vérifier CHARIOW_PRODUIT_PLUS / PRO' : 'Paiement :', e.statut, e.message, JSON.stringify(e.details || ''));
    const codeRefuse = e.statut === 422 && e.details && 'discount_code' in e.details;
    res.status(e.statut === 422 ? 400 : 502).json({ erreur: codeRefuse ? 'Ce code promo est invalide, expiré ou ne s\'applique pas à cette offre.' : e.statut === 422 ? (e.message || 'Informations refusées par Chariow.') : 'Le paiement est indisponible pour le moment. Réessaie dans quelques minutes.' });
  }
});
/** Retour de la page de paiement : on vérifie la dernière vente en attente auprès de Chariow. */
app.post('/api/paiement/verifier', async (req, res) => {
  if (!PAIEMENT.actif) return res.json({ offre: req.compte.offre });
  const attente = await req.store.dernierPaiementEnAttente();
  if (attente) {
    try { await PAIEMENT.service.verifier(attente.vente); } catch (e) { console.warn('Vérification paiement :', e.statut, e.message); }
  }
  const compte = await store.getUser(req.compte.id);
  const p = await store.getPaiement(attente?.vente || '');
  res.json({ offre: compte.offre, offreJusquau: compte.data?.offreJusquau || null, statut: p?.statut || null });
});

/* ---------- Voix du compagnon (OpenAI) ---------- */
app.post('/api/voix/parler', async (req, res) => {
  if (!voixIAActive()) return res.status(404).json({ erreur: 'Voix indisponible.' });
  const texte = String(req.body?.texte || '').trim().slice(0, 1200);
  if (!texte) return res.status(400).json({ erreur: 'Texte vide.' });
  const jour = jourAbidjan();
  if ((await req.store.getUsage(jour, 'voix_caracteres')) + texte.length > quotaVoix(req.compte).caracteres) {
    return res.status(429).json({ erreur: 'La voix du compagnon est épuisée pour aujourd\'hui : la voix du téléphone prend le relais.' });
  }
  try {
    const espece = ['chat', 'elephant', 'perroquet', 'tortue'].includes(req.body?.espece) ? req.body.espece : (req.compte.data?.espece || 'chat');
    const { audio, enCache } = await synthetiser(texte, espece);
    if (!enCache) await req.store.incrementUsage(jour, 'voix_caracteres', texte.length);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(audio);
  } catch (e) {
    const a = alerteVoix(e);
    console.error(a ? `[ALERTE ADMIN] ${a}` : 'Voix :', e.statut, e.message);
    res.status(503).json({ erreur: 'Voix indisponible pour le moment.' });
  }
});
app.post('/api/voix/transcrire', async (req, res) => {
  if (!voixIAActive()) return res.status(404).json({ erreur: 'Transcription indisponible.' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(415).json({ erreur: 'Enregistrement illisible.' });
  const jour = jourAbidjan();
  if ((await req.store.getUsage(jour, 'transcriptions')) >= quotaVoix(req.compte).transcriptions) {
    return res.status(429).json({ erreur: 'Dictée épuisée pour aujourd\'hui. Utilise le micro du clavier de ton téléphone.' });
  }
  try {
    const texte = await transcrire(req.body, req.headers['content-type']);
    await req.store.incrementUsage(jour, 'transcriptions');
    res.json({ texte });
  } catch (e) {
    const a = alerteVoix(e);
    console.error(a ? `[ALERTE ADMIN] ${a}` : 'Transcription :', e.statut, e.message);
    res.status(e.statut === 415 || e.statut === 413 ? e.statut : 503).json({ erreur: e.statut === 413 ? 'Enregistrement trop long : 2 minutes au plus.' : 'Je n\'ai pas pu écouter ton message. Réessaie ou écris-le.' });
  }
});

/* ---------- Quota de messages ---------- */
/** Compte un message ; renvoie le texte à afficher si le quota du jour est atteint, sinon null. */
async function quotaMessageAtteint(req) {
  const max = quotaDe(req.compte).messages;
  const jour = jourAbidjan();
  if ((await req.store.getUsage(jour, 'messages')) >= max) {
    return `Tu as utilisé tes ${max} messages du jour. Ils reviennent à minuit.${req.compte.offre === 'pro' ? '' : ' Les offres Plus et Pro en donnent davantage.'} Les calculs, « Autour de moi » et « Mes affaires » restent disponibles.`;
  }
  await req.store.incrementUsage(jour, 'messages');
  return null;
}
async function consommerMessage(req, res) {
  const m = await quotaMessageAtteint(req);
  if (m) { res.status(429).json({ erreur: m, quota: true }); return false; }
  return true;
}
const CONSIGNE_WHATSAPP = `
- Canal : WhatsApp. Réponds court (900 caractères au plus), sans tableau ni titre Markdown ; *gras* avec une seule étoile. Les cartes (lieux, documents, boutons de choix) partent en messages séparés : ne les recopie pas.`;

/* ---------- Conversations (synchronisées entre appareils) ---------- */
const AGENT_VALIDE = /^([a-z]{2,20}|perso:[0-9a-f-]{36})$/;
app.get('/api/conversations/:agent', async (req, res) => {
  if (!AGENT_VALIDE.test(req.params.agent)) return res.status(400).json({ erreur: 'Agent invalide.' });
  res.json((await req.store.getConversation(req.params.agent)) || { items: [], updated_at: null });
});
app.put('/api/conversations/:agent', async (req, res) => {
  if (!AGENT_VALIDE.test(req.params.agent)) return res.status(400).json({ erreur: 'Agent invalide.' });
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(-80) : null;
  if (!items) return res.status(400).json({ erreur: 'Conversation invalide.' });
  if (JSON.stringify(items).length > MAX_CONVERSATION) return res.status(413).json({ erreur: 'Conversation trop longue.' });
  res.json(await req.store.saveConversation(req.params.agent, items));
});
app.delete('/api/conversations', async (req, res) => { await req.store.deleteConversations(); res.json({ ok: true }); });

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
async function executerOutil(agent, nom, input = {}, ctx = {}) {
  if (nom === 'retenir') {
    if (!memoireAutorisee(input?.fait)) return { resultat: { enregistre: false, raison: 'Fait vide, trop long ou sensible : non enregistré.' } };
    const m = await ctx.store.addMemory({ fait: input.fait.trim(), categorie: input.categorie || 'profil' });
    return { resultat: { enregistre: true, id: m.id }, evenement: ['memory', { fait: m.fait }] };
  }
  const calcul = OUTILS_FINANCE[nom] || OUTILS_BUDGET[nom];
  if (calcul) {
    let r; try { r = calcul(input); } catch (e) { r = { erreur: e.message }; }
    return { resultat: r, evenement: ['tool', { name: nom, input, result: r }] };
  }
  if (nom === 'creer_document') {
    const d = await creerDocument(ctx.store, input, agent);
    if (d.erreur) return { resultat: d };
    return { resultat: { enregistre: true, id: d.id, titre: d.titre, affiche: 'La carte du document est affichée avec Copier, Partager et PDF.' }, evenement: ['document', d] };
  }
  if (['creer_rappel', 'lister_rappels', 'supprimer_rappel', 'gerer_liste', 'lister_listes'].includes(nom)) {
    const r = await executerOrganisation(ctx.store, nom, input);
    return { resultat: r, evenement: r.type && !r.erreur ? ['tool', { name: nom, input, result: r }] : null };
  }
  if (nom === 'chercher_lieux') {
    const r = await chercherLieux(input, { position: ctx.position });
    if (r.erreur) return { resultat: r };
    if (r.type === 'besoin_position') return { resultat: r, evenement: ['position', { categorie: r.categorie, libelle: r.libelle }] };
    // Le modèle reçoit une version courte (noms, distances) ; la carte complète part à l'app.
    const court = {
      libelle: r.libelle, centre: r.centre.libelle, total: r.total,
      lieux: r.lieux.map((l) => ({ nom: l.nom, distance_m: l.distance, telephone: l.telephone, horaires: l.horaires, ...(l.garde ? { de_garde: true } : {}) })),
      ...(r.garde ? { pharmacies_de_garde: { periode: r.garde.periode, liste: r.garde.pharmacies.slice(0, 6).map((g) => ({ nom: g.nom, commune: g.commune, distance_m: g.distance, telephone: g.telephone, adresse: g.adresse })) } } : {}),
      note: r.note, affiche: 'La carte et la liste sont affichées avec Y aller et Appeler (onglet « De garde » pour les pharmacies).'
    };
    return { resultat: court, evenement: ['tool', { name: nom, input, result: r }] };
  }
  if (nom === 'poser_choix') {
    const c = preparerChoix(input);
    return c.erreur ? { resultat: c } : { resultat: { affiche: true, consigne: "Les boutons sont affichés. Attends la réponse de l'utilisateur." }, evenement: ['choix', c] };
  }
  if (nom === 'suggerer_agent') {
    if (!AGENTS[input.agent]) return { resultat: { erreur: 'Agent inconnu.' } };
    return { resultat: { affiche: true }, evenement: ['suggestion', { agent: input.agent, raison: String(input.raison || '').slice(0, 200) }] };
  }
  if (nom === 'proposer_mode_developpeur') return { resultat: { affiche: true }, evenement: ['devoffer', {}] };
  if (NOMS_OUTILS_DEV.has(nom)) {
    if (agent !== 'dev') return { resultat: { erreur: 'Outil réservé au mode développeur.' } };
    if (OUTILS_A_VALIDER.has(nom)) {
      const cles = await clesDev(ctx.req);
      const service = nom.startsWith('github') ? 'github' : 'render';
      if (!cles[service]) return { resultat: { erreur: `Clé ${service === 'github' ? 'GitHub' : 'Render'} absente : demande à l'utilisateur de l'ajouter dans Réglages › Mode développeur.` } };
      const p = preparerAction(nom, input);
      if (p.erreur) return { resultat: p };
      const a = await ctx.store.addAction({ outil: nom, input, resume: p.resume });
      return {
        resultat: { statut: 'en_attente_de_validation', actionId: a.id, consigne: "L'action n'est PAS encore faite. Demande à l'utilisateur de vérifier la carte et d'appuyer sur Valider." },
        evenement: ['approval', { id: a.id, outil: nom, resume: p.resume, details: p.details, fichiers: p.fichiers || null }]
      };
    }
    const r = await executerDev(nom, input, await clesDev(ctx.req));
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

/**
 * Fait répondre un agent (Claude + outils). Partagé par l'app (flux SSE) et WhatsApp.
 * send(evenement, donnees) reçoit : mood, token, tool, document, choix, position, sources, progression, done, error…
 */
async function repondreAgent(req, { agent, fiche = null, historique, position = null, send, canal = 'app' }) {
  const p = profil(req);
  const modele = choisirModele({ modeleAgent: fiche ? (fiche.modeleFort || fiche.outils.includes('recherche_web') ? 'fort' : 'leger') : AGENTS[agent].modele, compte: req.compte, fort: MODELE_FORT, leger: MODELE_LEGER });
  try {
    const evenements = [{ type: 'message', agent: fiche ? `perso:${fiche.id}` : agent }];
    const finir = async () => { const pr = await progresser(req, evenements); if (pr) send('progression', pr); };
    if (!anthropic) {
      const dernier = historique.at(-1).content;
      await reponseDemo(agent, typeof dernier === 'string' ? dernier : dernier.at(-1).text, { nomCompagnon: p.nomCompagnon, send, store: req.store, fiche, position });
      await finir();
      send('done', { demo: true });
      return;
    }

    const souvenirs = (await req.store.listMemories()).slice(0, 40);
    const system = [
      { type: 'text', text: fiche ? instructionsPerso(fiche) : instructionsStatiques(agent), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: contexteDynamique({ ...p, souvenirs, positionPartagee: Boolean(position), progression: resumeProgression(await req.store.getProgression()) }) + (canal === 'whatsapp' ? CONSIGNE_WHATSAPP : '') }
    ];
    let listeOutils = fiche ? outilsPerso(fiche) : outils(agent);
    if (fiche) await req.store.incrementUsage(jourAbidjan(), 'perso');
    // Recherches web du jour épuisées : l'agent répond sans elles et le dit.
    const quotaRech = quotaDe(req.compte).recherches;
    if (listeOutils.includes(OUTIL_RECHERCHE_WEB) && (await req.store.getUsage(jourAbidjan(), 'recherches')) >= quotaRech) {
      listeOutils = listeOutils.filter((o) => o !== OUTIL_RECHERCHE_WEB);
      system[1] = { type: 'text', text: `${system[1].text}\n- Les recherches sur internet du jour sont épuisées pour cette offre : réponds avec tes connaissances, dis-le en une phrase et conseille de vérifier auprès de la source officielle.` };
    }
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
            send('mood', { mood: 'cherche' });
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
        send('mood', { mood: bloc.name === 'chercher_lieux' ? 'cherche' : 'travaille' });
        const { resultat, evenement } = await executerOutil(agent, bloc.name, bloc.input, { position, store: req.store, req });
        if (EVENEMENT_OUTIL[bloc.name] && !resultat?.erreur && resultat?.type !== 'besoin_position') evenements.push({ type: EVENEMENT_OUTIL[bloc.name] });
        if (evenement) send(...evenement);
        resultats.push({ type: 'tool_result', tool_use_id: bloc.id, content: JSON.stringify(resultat), ...(resultat?.erreur ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: resultats });
      send('token', { text: '\n\n' });
    }
    if (toutesSources.size) send('sources', { sources: [...toutesSources.values()] });
    if (usage.recherches) await req.store.incrementUsage(jourAbidjan(), 'recherches', usage.recherches);
    await finir();
    send('mood', { mood: 'fete' });
    send('done', { usage, modele, quota: await etatQuota(req.store, req.compte) });
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
}

app.post('/api/chat', limite, async (req, res) => {
  const p = profil(req);
  let agent = AGENTS[req.body?.agent] ? req.body.agent : 'compagnon';
  let fiche = null;
  if (estPerso(req.body?.agent)) {
    const id = req.body.agent.slice(6);
    const tous = await req.store.listCustomAgents();
    const rang = tous.findIndex((a) => a.id === id);
    if (rang < 0) return res.status(404).json({ erreur: 'Cet agent n\'existe plus.' });
    const lim = limites(p.offre);
    if (rang >= lim.agents) return res.status(403).json({ erreur: 'Cet agent est verrouillé avec ton offre actuelle.' });
    if ((await req.store.getUsage(jourAbidjan(), 'perso')) >= lim.messagesParJour) {
      return res.status(429).json({ erreur: `Tu as utilisé tes ${lim.messagesParJour} messages du jour avec tes agents personnalisés. Ils reviennent demain${p.offre === 'pro' ? '.' : ', ou passe à une offre supérieure pour en avoir plus.'}` });
    }
    fiche = tous[rang];
    agent = 'perso';
  } else {
    const acces = accesAgent(agent, p);
    if (!acces.ok) return res.status(403).json({ erreur: acces.raison });
  }
  const historique = nettoyerHistorique(req.body?.messages);
  // Position partagée par l'app (facultative), utilisée seulement pour chercher des lieux proches.
  const pos = req.body?.position;
  const position = positionValide(pos) ? { lat: Number(pos.lat), lng: Number(pos.lng) } : null;
  if (!historique.length || historique.at(-1).role !== 'user') return res.status(400).json({ erreur: 'Message manquant.' });
  // Le mode démo ne coûte rien : pas de quota.
  if (anthropic && !(await consommerMessage(req, res))) return;

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let ferme = false;
  res.on('close', () => { ferme = true; });
  const send = (event, data) => { if (!ferme) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };

  await repondreAgent(req, { agent, fiche, historique, position, send });
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
if (WHATSAPP.actif) {
  WHATSAPP.canal = creerCanalWhatsApp({
    store, client: creerClientWhatsApp(WHATSAPP.config), urlApp: URL_APP, nettoyerHistorique, quotaMessageAtteint, iaActive: () => Boolean(anthropic),
    repondreAgent: (req, opts) => repondreAgent(req, opts),
    voix: { active: voixIAActive, transcrire, synthetiser }
  });
}
notifications = await initNotifications(store, { autresCanaux: WHATSAPP.canal ? (r) => WHATSAPP.canal.rappel(r) : null });

// Offres payées : rappel de renouvellement 3 jours avant la fin (notification, et WhatsApp si demandé).
async function rappelerRenouvellements(maintenant = Date.now()) {
  if (!PAIEMENT.actif) return 0;
  let n = 0;
  for (const u of await store.listUsers()) {
    const fin = u.data?.offreSource === 'chariow' && u.data?.offreJusquau ? new Date(u.data.offreJusquau).getTime() : 0;
    if (!fin || fin < maintenant || fin - maintenant > 3 * 86_400_000 || u.data.rappelRenouvellement === u.data.offreJusquau) continue;
    const jours = Math.max(1, Math.ceil((fin - maintenant) / 86_400_000));
    const texte = `Ton offre ${NOMS_OFFRES_SERVEUR[u.offre] || u.offre} se termine dans ${jours} jour${jours > 1 ? 's' : ''}. Renouvelle-la dans Réglages › Mon compte pour garder tes avantages.`;
    await notifications.envoyerA(u.id, { titre: 'Tehis', corps: texte, url: '/?panneau=reglages' }).catch(() => {});
    if (WHATSAPP.canal && u.data?.rappelsWhatsApp) await WHATSAPP.canal.rappel({ user_id: u.id, texte }).catch(() => {});
    await store.updateUser(u.id, { data: { rappelRenouvellement: u.data.offreJusquau } });
    n++;
  }
  return n;
}
setInterval(() => rappelerRenouvellements().catch((e) => console.warn('Renouvellements :', e.message)), 3_600_000).unref();
app.listen(PORT, () => {
  console.log(`Tehis prototype sur le port ${PORT} · ${anthropic ? `modèles ${MODELE_FORT} / ${MODELE_LEGER}` : 'MODE DÉMO (pas de clé API)'} · nouveaux comptes : offre ${OFFRE_DEFAUT} · stockage ${store.kind} · voix ${voixIAActive() ? 'OpenAI' : 'du téléphone'} · WhatsApp ${WHATSAPP.actif ? 'actif' : 'non configuré'} · paiement ${PAIEMENT.actif ? `Chariow${PAIEMENT.config.secretPulse ? '' : ' (sans Pulse : CHARIOW_PULSE_SECRET manquant)'}` : 'non configuré'}${CODE_INVITATION ? '' : " · ATTENTION : inscription ouverte à tous (pas de CODE_INVITATION)"}${ADMIN_TELEPHONE ? '' : ' · ADMIN_TELEPHONE absent : le premier compte créé sera administrateur'}`);
});

export { TYPES_DOCUMENTS };
