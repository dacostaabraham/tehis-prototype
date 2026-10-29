// Connecteur agenda + contacts (item n°6 du backlog REA).
//
// Google Agenda d'abord : connexion du compte Google de l'utilisateur (flux
// OAuth authorization code), création d'événements depuis un rappel Tehis ou
// sur demande de l'agent, lecture des événements du jour (digest, « Mes
// affaires »). La synchronisation reste simple et robuste : création +
// lecture du jour, pas de synchronisation bidirectionnelle complète.
//
// Identifiants OAuth : ils viennent des variables d'environnement
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (créés par Abraham dans Google
// Cloud Console, voir README) — jamais générés, jamais inventés, jamais mis
// en dur. Sans eux, le connecteur est inactif : la section Agenda affiche un
// état vide propre et les rappels Tehis continuent de fonctionner seuls.
// Les jetons OAuth sont chiffrés (coffre AES-256-GCM, comme les clés
// GitHub/Render) et stockés par compte ; ils ne sont jamais exposés côté
// client ni journalisés. `fetcher` est injectable pour les tests.
import { lireDate } from './organisation.js';

export const SCOPES_AGENDA = 'openid email https://www.googleapis.com/auth/calendar.events';
const URL_AUTORISATION = 'https://accounts.google.com/o/oauth2/v2/auth';
const URL_JETON = 'https://oauth2.googleapis.com/token';
const URL_API = 'https://www.googleapis.com/calendar/v3';
const SECRET_JETONS = 'google_agenda';
// Marge avant expiration : on rafraîchit le jeton d'accès 60 s avant sa fin.
const MARGE_EXPIRATION_MS = 60_000;

/** Configuration OAuth lue dans l'environnement. `configure` = prête à l'emploi. */
export function configAgenda(env = process.env) {
  const clientId = String(env.GOOGLE_CLIENT_ID || '').trim();
  const clientSecret = String(env.GOOGLE_CLIENT_SECRET || '').trim();
  return { clientId, clientSecret, configure: Boolean(clientId && clientSecret) };
}

/** URL d'autorisation Google (access_type=offline : on obtient un refresh_token). */
export function urlAutorisation(config, redirectUri, state) {
  const u = new URL(URL_AUTORISATION);
  u.searchParams.set('client_id', config.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES_AGENDA);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('state', state);
  return u.toString();
}

/** Décode le payload d'un id_token (JWT) : on n'y lit que l'adresse e-mail, pour l'affichage. */
export function emailIdToken(idToken) {
  try {
    const partie = String(idToken || '').split('.')[1];
    if (!partie) return null;
    const json = JSON.parse(Buffer.from(partie.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return typeof json.email === 'string' ? json.email : null;
  } catch { return null; }
}

async function appelerJeton(corps, { fetcher = fetch } = {}) {
  let r;
  try {
    r = await fetcher(URL_JETON, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(corps).toString()
    });
  } catch { return { erreur: 'Impossible de joindre Google pour le moment.' }; }
  let donnees = {};
  try { donnees = await r.json(); } catch { /* corps illisible */ }
  if (!r.ok) {
    if (donnees.error === 'invalid_grant') return { erreur: 'Autorisation Google expirée ou révoquée. Reconnecte ton agenda.', revoque: true };
    return { erreur: `Google refuse l'autorisation (${r.status}).` };
  }
  return { donnees };
}

/** Échange le code d'autorisation contre des jetons. Renvoie { jetons } ou { erreur }. */
export async function echangerCode({ code, config, redirectUri, fetcher = fetch } = {}) {
  if (!code) return { erreur: 'Code d’autorisation manquant.' };
  const r = await appelerJeton({
    code, client_id: config.clientId, client_secret: config.clientSecret,
    redirect_uri: redirectUri, grant_type: 'authorization_code'
  }, { fetcher });
  if (r.erreur) return r;
  const d = r.donnees;
  if (!d.access_token) return { erreur: 'Google n’a pas renvoyé de jeton d’accès.' };
  return {
    jetons: {
      access_token: d.access_token,
      refresh_token: d.refresh_token || null,
      expires_at: Date.now() + Number(d.expires_in || 3600) * 1000,
      email: emailIdToken(d.id_token)
    }
  };
}

/** Rafraîchit un jeton d'accès avec le refresh_token. Renvoie { jetons } ou { erreur }. */
export async function rafraichirJeton({ refreshToken, config, fetcher = fetch } = {}) {
  if (!refreshToken) return { erreur: 'Aucun jeton de rafraîchissement : reconnecte ton agenda.', revoque: true };
  const r = await appelerJeton({
    refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret,
    grant_type: 'refresh_token'
  }, { fetcher });
  if (r.erreur) return r;
  const d = r.donnees;
  if (!d.access_token) return { erreur: 'Google n’a pas renvoyé de jeton d’accès.' };
  return {
    jetons: {
      access_token: d.access_token,
      // Google ne renvoie pas toujours un nouveau refresh_token : on garde l'ancien.
      refresh_token: d.refresh_token || refreshToken,
      expires_at: Date.now() + Number(d.expires_in || 3600) * 1000
    }
  };
}

/* ---------- Jetons stockés (chiffrés, par compte) ---------- */

export async function lireJetons(store, coffre) {
  try {
    const chiffre = await store.getSecret(SECRET_JETONS);
    if (!chiffre) return null;
    const clair = coffre.dechiffrer(chiffre);
    if (!clair) return null;
    const j = JSON.parse(clair);
    return j && typeof j.access_token === 'string' ? j : null;
  } catch { return null; }
}

export async function sauverJetons(store, coffre, jetons) {
  await store.setSecret(SECRET_JETONS, coffre.chiffrer(JSON.stringify(jetons)));
}

export async function supprimerJetons(store) {
  await store.setSecret(SECRET_JETONS, null);
}

/**
 * Jeton d'accès valide pour ce compte (rafraîchi si besoin). Renvoie
 * { jetons } ou { nonConnecte: true } ou { erreur }. Un refresh refusé
 * (autorisation révoquée) efface les jetons stockés.
 */
export async function jetonValide(store, coffre, config, { fetcher = fetch } = {}) {
  const jetons = await lireJetons(store, coffre);
  if (!jetons) return { nonConnecte: true };
  if (jetons.expires_at && jetons.expires_at - Date.now() > MARGE_EXPIRATION_MS) return { jetons };
  const r = await rafraichirJeton({ refreshToken: jetons.refresh_token, config, fetcher });
  if (r.erreur) {
    if (r.revoque) await supprimerJetons(store);
    return r.revoque ? { nonConnecte: true } : r;
  }
  const maj = { ...jetons, ...r.jetons, email: jetons.email || r.jetons.email || null };
  await sauverJetons(store, coffre, maj);
  return { jetons: maj };
}

/* ---------- API Google Calendar ---------- */

async function appelerAgenda(jetons, chemin, { methode = 'GET', corps = null, fetcher = fetch } = {}) {
  let r;
  try {
    r = await fetcher(`${URL_API}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jetons.access_token}`, ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      ...(corps ? { body: JSON.stringify(corps) } : {})
    });
  } catch { return { erreur: 'Impossible de joindre Google Agenda pour le moment.' }; }
  let donnees = {};
  try { donnees = await r.json(); } catch { /* corps illisible */ }
  if (!r.ok) return { erreur: `Google Agenda refuse la demande (${r.status}).` };
  return { donnees };
}

/** Un événement Google → la forme présentée dans Tehis (heures d'Abidjan, UTC+0). */
export function presenterEvenement(ev) {
  const debut = ev.start?.dateTime || null;
  const fin = ev.end?.dateTime || null;
  const touteJournee = Boolean(ev.start?.date && !debut);
  return {
    id: ev.id || null,
    titre: ev.summary || '(sans titre)',
    debut: debut || ev.start?.date || null,
    fin: fin || ev.end?.date || null,
    touteJournee,
    lieu: ev.location || null
  };
}

/**
 * Événements du jour donné (AAAA-MM-JJ, heure d'Abidjan = UTC+0). Renvoie
 * { evenements } ou { nonConnecte: true } ou { erreur }.
 */
export async function listerEvenementsJour(store, coffre, config, jour, { fetcher = fetch } = {}) {
  const v = await jetonValide(store, coffre, config, { fetcher });
  if (v.nonConnecte || v.erreur) return v;
  const r = await appelerAgenda(v.jetons, `/calendars/primary/events?timeMin=${encodeURIComponent(`${jour}T00:00:00.000Z`)}&timeMax=${encodeURIComponent(`${jour}T23:59:59.999Z`)}&singleEvents=true&orderBy=startTime&maxResults=50`, { fetcher });
  if (r.erreur) return r;
  return { evenements: (r.donnees.items || []).map(presenterEvenement) };
}

/**
 * Crée un événement dans Google Agenda, depuis des champs explicites ou
 * depuis un rappel Tehis (rappel_id : titre et heure du rappel, fin +60 min).
 * Renvoie { evenement } ou { erreur }. La création est consignée dans le
 * journal d'activité : c'est une action explicite de l'utilisateur.
 */
export async function creerEvenement(store, coffre, config, input = {}, { fetcher = fetch } = {}) {
  let titre = String(input.titre || '').trim().slice(0, 200);
  let debut = input.debut ? lireDate(input.debut) : null;
  let fin = input.fin ? lireDate(input.fin) : null;
  const description = String(input.description || '').trim().slice(0, 500);
  const lieu = String(input.lieu || '').trim().slice(0, 200);
  if (input.rappel_id) {
    const rappel = (await store.listReminders({ aVenir: false })).find((r) => r.id === String(input.rappel_id));
    if (!rappel) return { erreur: 'Rappel introuvable.' };
    titre = titre || rappel.texte;
    debut = debut || new Date(rappel.quand);
    fin = fin || new Date(new Date(rappel.quand).getTime() + 60 * 60_000);
  }
  if (!titre) return { erreur: 'Donne un titre à l’événement.' };
  if (!debut || Number.isNaN(debut.getTime())) return { erreur: 'Date illisible. Format attendu : AAAA-MM-JJTHH:MM.' };
  if (!fin || Number.isNaN(fin.getTime())) fin = new Date(debut.getTime() + 60 * 60_000);
  if (fin <= debut) return { erreur: 'La fin doit être après le début.' };
  const v = await jetonValide(store, coffre, config, { fetcher });
  if (v.nonConnecte) return { erreur: 'Agenda Google non connecté. Connecte-le dans « Mes affaires » › Agenda Google.' };
  if (v.erreur) return v;
  const r = await appelerAgenda(v.jetons, '/calendars/primary/events', {
    methode: 'POST',
    fetcher,
    corps: {
      summary: titre,
      ...(description ? { description } : {}),
      ...(lieu ? { location: lieu } : {}),
      start: { dateTime: debut.toISOString(), timeZone: 'Africa/Abidjan' },
      end: { dateTime: fin.toISOString(), timeZone: 'Africa/Abidjan' }
    }
  });
  if (r.erreur) return r;
  const evenement = presenterEvenement(r.donnees);
  await store.addAction({
    outil: 'agenda_creer_evenement',
    input: { titre, debut: debut.toISOString() },
    resume: `Événement ajouté à Google Agenda : ${titre} — ${debut.toISOString().slice(0, 10)} à ${debut.toISOString().slice(11, 16)}`,
    statut: 'executee',
    resultat: { evenement }
  });
  return { evenement };
}

/* ---------- Outils des agents ---------- */

export const SCHEMAS_AGENDA = [
  {
    name: 'creer_evenement_agenda',
    description: "Crée un événement dans l'agenda Google de l'utilisateur (calendrier principal). À utiliser seulement quand il le demande explicitement (ex. « Mets ce rendez-vous dans mon agenda ») ou quand un rappel doit aussi y figurer. Si l'agenda n'est pas connecté, dis-lui de le connecter dans « Mes affaires » › Agenda Google.",
    input_schema: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: 'Titre de l’événement, ex. « Rendez-vous chez le fournisseur »' },
        quand: { type: 'string', description: 'Date et heure à Abidjan au format AAAA-MM-JJTHH:MM (ex. 2026-10-30T14:00)' },
        duree_minutes: { type: 'number', description: 'Durée en minutes (60 par défaut)' },
        description: { type: 'string', description: 'Détails utiles (facultatif)' },
        lieu: { type: 'string', description: 'Lieu (facultatif)' }
      },
      required: ['titre', 'quand']
    }
  },
  {
    name: 'lister_evenements_agenda',
    description: "Liste les rendez-vous de l'agenda Google de l'utilisateur pour un jour donné (aujourd'hui par défaut). Si l'agenda n'est pas connecté, dis-lui de le connecter dans « Mes affaires » › Agenda Google.",
    input_schema: {
      type: 'object',
      properties: {
        jour: { type: 'string', description: 'Jour au format AAAA-MM-JJ (aujourd’hui par défaut)' }
      }
    }
  }
];

/** Exécute creer_evenement_agenda et lister_evenements_agenda. */
export async function executerAgenda(store, coffre, config, nom, input = {}, { fetcher = fetch } = {}) {
  if (!config.configure) return { erreur: 'Agenda Google non configuré sur le serveur. L’équipe doit ajouter les identifiants Google (voir README).' };
  if (nom === 'creer_evenement_agenda') {
    const dateDebut = input.quand ? lireDate(input.quand) : null;
    const duree = Number(input.duree_minutes);
    const fin = dateDebut && Number.isFinite(duree) && duree > 0 && duree <= 1440
      ? new Date(dateDebut.getTime() + duree * 60_000).toISOString()
      : undefined;
    const r = await creerEvenement(store, coffre, config, { titre: input.titre, debut: input.quand, fin, description: input.description, lieu: input.lieu }, { fetcher });
    if (r.erreur) return r;
    return { type: 'evenement', ...r };
  }
  if (nom === 'lister_evenements_agenda') {
    const jour = /^\d{4}-\d{2}-\d{2}$/.test(String(input.jour || '')) ? input.jour : new Date().toISOString().slice(0, 10);
    const r = await listerEvenementsJour(store, coffre, config, jour, { fetcher });
    if (r.erreur) return r;
    if (r.nonConnecte) return { erreur: 'Agenda Google non connecté. Connecte-le dans « Mes affaires » › Agenda Google.' };
    return { type: 'evenements', jour, evenements: r.evenements };
  }
  return { erreur: `Outil inconnu : ${nom}` };
}
