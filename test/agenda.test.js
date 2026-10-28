// Connecteur agenda + contacts (item n°6 du backlog REA) : OAuth Google,
// jetons chiffrés, lecture des événements du jour, création d'événements,
// outils des agents, événements dans le digest. Les appels Google sont
// simulés (fetcher injecté) : jamais de vrais identifiants, jamais de réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../server/store.js';
import { creerCoffre } from '../server/coffre.js';
import {
  configAgenda, urlAutorisation, emailIdToken, echangerCode, rafraichirJeton,
  lireJetons, sauverJetons, supprimerJetons, jetonValide,
  listerEvenementsJour, creerEvenement, executerAgenda, presenterEvenement
} from '../server/outils/agenda.js';
import { presenterDigest, digestDuJour } from '../server/outils/digest.js';

const UID = '00000000-0000-4000-8000-000000000006';
const brut = () => createStore();
const vue = (b) => b.pour(UID);
const coffre = creerCoffre('secret-de-test');
const CONFIG = { clientId: 'id-test.apps.googleusercontent.com', clientSecret: 'secret-test', configure: true };
const REDIRECT = 'https://tehis-test.onrender.com/api/agenda/google/retour';

const jetonId = (email) => {
  const charge = Buffer.from(JSON.stringify({ email })).toString('base64url');
  return `eyJhbGciOiJSUzI1NiJ9.${charge}.signature`;
};
// Faux fetcher : une fonction (url, options) => réponse, par URL.
const fauxFetch = (parUrl) => async (url, options = {}) => {
  const cle = Object.keys(parUrl).find((k) => String(url).includes(k));
  if (!cle) throw new Error(`URL inattendue : ${url}`);
  const r = parUrl[cle];
  return typeof r === 'function' ? r(url, options) : r;
};
const reponseJson = (objet, statut = 200) => ({ ok: statut >= 200 && statut < 300, status: statut, json: async () => objet });
const jetonsStockes = (surcharge = {}) => ({
  access_token: 'ya29.acces-test', refresh_token: '1//refresh-test',
  expires_at: Date.now() + 3600_000, email: 'abraham@example.com', ...surcharge
});

test('configAgenda : inactif sans identifiants, actif avec les deux', () => {
  assert.equal(configAgenda({}).configure, false);
  assert.equal(configAgenda({ GOOGLE_CLIENT_ID: 'id' }).configure, false);
  assert.equal(configAgenda({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }).configure, true);
});

test('urlAutorisation : code + consentement + offline, portée agenda', () => {
  const u = new URL(urlAutorisation(CONFIG, REDIRECT, 'etat-123'));
  assert.equal(u.hostname, 'accounts.google.com');
  assert.equal(u.searchParams.get('client_id'), CONFIG.clientId);
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('state'), 'etat-123');
  assert.match(u.searchParams.get('scope'), /calendar\.events/);
});

test('emailIdToken : lit l’e-mail, null sinon', () => {
  assert.equal(emailIdToken(jetonId('abraham@example.com')), 'abraham@example.com');
  assert.equal(emailIdToken('pas-un-jwt'), null);
  assert.equal(emailIdToken(null), null);
});

test('echangerCode : jetons + e-mail depuis l’id_token ; invalid_grant signalé', async () => {
  const fetcher = fauxFetch({
    'oauth2.googleapis.com/token': reponseJson({
      access_token: 'ya29.nouveau', refresh_token: '1//nouveau', expires_in: 3600,
      id_token: jetonId('abraham@example.com')
    })
  });
  const r = await echangerCode({ code: 'code-abc', config: CONFIG, redirectUri: REDIRECT, fetcher });
  assert.equal(r.jetons.access_token, 'ya29.nouveau');
  assert.equal(r.jetons.refresh_token, '1//nouveau');
  assert.equal(r.jetons.email, 'abraham@example.com');
  assert.ok(r.jetons.expires_at > Date.now());

  const refuse = fauxFetch({ 'oauth2.googleapis.com/token': reponseJson({ error: 'invalid_grant' }, 400) });
  const e = await echangerCode({ code: 'code-mauvais', config: CONFIG, redirectUri: REDIRECT, fetcher: refuse });
  assert.ok(e.erreur);
  assert.equal(e.revoque, true);
});

test('rafraichirJeton : garde l’ancien refresh_token si Google n’en renvoie pas', async () => {
  const fetcher = fauxFetch({ 'oauth2.googleapis.com/token': reponseJson({ access_token: 'ya29.rafraichi', expires_in: 3600 }) });
  const r = await rafraichirJeton({ refreshToken: '1//ancien', config: CONFIG, fetcher });
  assert.equal(r.jetons.access_token, 'ya29.rafraichi');
  assert.equal(r.jetons.refresh_token, '1//ancien', 'refresh_token conservé');
});

test('jetonValide : non connecté sans jetons ; valide sans appel réseau ; rafraîchit si expiré', async () => {
  const b = brut(); const s = vue(b);
  assert.deepEqual(await jetonValide(s, coffre, CONFIG, { fetcher: async () => { throw new Error('ne doit pas appeler Google'); } }), { nonConnecte: true });

  await sauverJetons(s, coffre, jetonsStockes());
  const appels = [];
  const espion = async (url, options) => { appels.push(url); return reponseJson({}); };
  const ok = await jetonValide(s, coffre, CONFIG, { fetcher: espion });
  assert.equal(ok.jetons.access_token, 'ya29.acces-test');
  assert.equal(appels.length, 0, 'jeton encore valide : aucun appel réseau');

  await sauverJetons(s, coffre, jetonsStockes({ expires_at: Date.now() - 1000 }));
  const rafraichi = fauxFetch({ 'oauth2.googleapis.com/token': reponseJson({ access_token: 'ya29.rafraichi-2', expires_in: 3600 }) });
  const r = await jetonValide(s, coffre, CONFIG, { fetcher: rafraichi });
  assert.equal(r.jetons.access_token, 'ya29.rafraichi-2');
  assert.equal((await lireJetons(s, coffre)).access_token, 'ya29.rafraichi-2', 'nouveau jeton sauvegardé');
});

test('jetonValide : autorisation révoquée → jetons effacés, non connecté', async () => {
  const b = brut(); const s = vue(b);
  await sauverJetons(s, coffre, jetonsStockes({ expires_at: Date.now() - 1000 }));
  const refuse = fauxFetch({ 'oauth2.googleapis.com/token': reponseJson({ error: 'invalid_grant' }, 400) });
  assert.deepEqual(await jetonValide(s, coffre, CONFIG, { fetcher: refuse }), { nonConnecte: true });
  assert.equal(await lireJetons(s, coffre), null, 'jetons effacés');
});

test('sauver/lire/supprimer les jetons : chiffrés, par compte', async () => {
  const b = brut(); const s = vue(b);
  await sauverJetons(s, coffre, jetonsStockes());
  const brut_stocke = await s.getSecret('google_agenda');
  assert.ok(brut_stocke && !brut_stocke.includes('ya29.acces-test'), 'jeton chiffré au repos');
  assert.equal((await lireJetons(s, coffre)).email, 'abraham@example.com');
  await supprimerJetons(s);
  assert.equal(await lireJetons(s, coffre), null);
});

test('listerEvenementsJour : événements datés et journée entière, triés par Google', async () => {
  const b = brut(); const s = vue(b);
  await sauverJetons(s, coffre, jetonsStockes());
  let urlVue = '';
  const fetcher = fauxFetch({
    'www.googleapis.com/calendar/v3': async (url) => {
      urlVue = url;
      return reponseJson({ items: [
        { id: '1', summary: 'Livraison fournisseur', start: { dateTime: '2026-10-29T09:00:00Z' }, end: { dateTime: '2026-10-29T10:00:00Z' }, location: 'Adjamé' },
        { id: '2', summary: 'Marché', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } },
        { id: '3', summary: '', start: { dateTime: '2026-10-29T15:00:00Z' }, end: { dateTime: '2026-10-29T16:00:00Z' } }
      ] });
    }
  });
  const r = await listerEvenementsJour(s, coffre, CONFIG, '2026-10-29', { fetcher });
  assert.ok(urlVue.includes('timeMin=2026-10-29T00%3A00%3A00.000Z'), 'jour demandé à Google');
  assert.equal(r.evenements.length, 3);
  assert.equal(r.evenements[0].titre, 'Livraison fournisseur');
  assert.equal(r.evenements[0].lieu, 'Adjamé');
  assert.equal(r.evenements[0].touteJournee, false);
  assert.equal(r.evenements[1].touteJournee, true);
  assert.equal(r.evenements[2].titre, '(sans titre)');
});

test('listerEvenementsJour : non connecté sans jetons, erreur Google transmise', async () => {
  const b = brut(); const s = vue(b);
  assert.deepEqual(await listerEvenementsJour(s, coffre, CONFIG, '2026-10-29', { fetcher: async () => { throw new Error('pas d’appel'); } }), { nonConnecte: true });
  await sauverJetons(s, coffre, jetonsStockes());
  const erreur = fauxFetch({ 'www.googleapis.com/calendar/v3': reponseJson({ error: { message: 'quota' } }, 403) });
  const r = await listerEvenementsJour(s, coffre, CONFIG, '2026-10-29', { fetcher: erreur });
  assert.match(r.erreur, /403/);
});

test('presenterEvenement : journée entière et heures', () => {
  assert.deepEqual(presenterEvenement({ id: 'x', summary: 'Test', start: { date: '2026-10-29' }, end: { date: '2026-10-30' } }),
    { id: 'x', titre: 'Test', debut: '2026-10-29', fin: '2026-10-30', touteJournee: true, lieu: null });
});

test('creerEvenement : validation des champs, corps envoyé à Google, journal', async () => {
  const b = brut(); const s = vue(b);
  await sauverJetons(s, coffre, jetonsStockes());
  const corpsVus = [];
  const fetcher = fauxFetch({
    'www.googleapis.com/calendar/v3': async (url, options) => {
      corpsVus.push(JSON.parse(options.body));
      return reponseJson({ id: 'evt-1', summary: 'Rendez-vous fournisseur', start: { dateTime: '2026-10-30T14:00:00.000Z' }, end: { dateTime: '2026-10-30T15:00:00.000Z' } });
    }
  });
  const r = await creerEvenement(s, coffre, CONFIG, { titre: 'Rendez-vous fournisseur', debut: '2026-10-30T14:00', lieu: 'Treichville' }, { fetcher });
  assert.equal(r.evenement.id, 'evt-1');
  assert.equal(corpsVus[0].summary, 'Rendez-vous fournisseur');
  assert.equal(corpsVus[0].location, 'Treichville');
  assert.equal(corpsVus[0].start.timeZone, 'Africa/Abidjan');
  assert.equal(corpsVus[0].end.dateTime, '2026-10-30T15:00:00.000Z', 'fin = début + 60 min par défaut');
  const journal = await b.listActions(UID);
  assert.equal(journal[0].outil, 'agenda_creer_evenement');
  assert.match(journal[0].resume, /Rendez-vous fournisseur/);

  assert.match((await creerEvenement(s, coffre, CONFIG, { titre: ' ', debut: '2026-10-30T14:00' }, { fetcher })).erreur, /titre/);
  assert.match((await creerEvenement(s, coffre, CONFIG, { titre: 'X', debut: 'pas-une-date' }, { fetcher })).erreur, /illisible/);
  assert.match((await creerEvenement(s, coffre, CONFIG, { titre: 'X', debut: '2026-10-30T14:00', fin: '2026-10-30T13:00' }, { fetcher })).erreur, /après le début/);
  assert.equal(corpsVus.length, 1, 'aucun appel Google quand la validation échoue');
});

test('creerEvenement : non connecté sans jetons', async () => {
  const b = brut(); const s = vue(b);
  const r = await creerEvenement(s, coffre, CONFIG, { titre: 'X', debut: '2026-10-30T14:00' }, { fetcher: async () => { throw new Error('pas d’appel'); } });
  assert.match(r.erreur, /non connecté/);
});

test('creerEvenement : depuis un rappel Tehis (titre, heure, +60 min)', async () => {
  const b = brut(); const s = vue(b);
  await sauverJetons(s, coffre, jetonsStockes());
  const rappel = await s.addReminder({ texte: 'Appeler le fournisseur', quand: '2026-10-30T09:30:00.000Z', repetition: 'aucune' });
  let corps = null;
  const fetcher = fauxFetch({
    'www.googleapis.com/calendar/v3': async (url, options) => {
      corps = JSON.parse(options.body);
      return reponseJson({ id: 'evt-2', summary: 'Appeler le fournisseur', start: { dateTime: '2026-10-30T09:30:00.000Z' }, end: { dateTime: '2026-10-30T10:30:00.000Z' } });
    }
  });
  const r = await creerEvenement(s, coffre, CONFIG, { rappel_id: rappel.id }, { fetcher });
  assert.equal(r.evenement.titre, 'Appeler le fournisseur');
  assert.equal(corps.start.dateTime, '2026-10-30T09:30:00.000Z');
  assert.equal(corps.end.dateTime, '2026-10-30T10:30:00.000Z');
  assert.match((await creerEvenement(s, coffre, CONFIG, { rappel_id: 'introuvable' }, { fetcher })).erreur, /introuvable/);
});

test('executerAgenda : config absente, non connecté, liste du jour', async () => {
  const b = brut(); const s = vue(b);
  const sansConfig = await executerAgenda(s, coffre, { configure: false }, 'lister_evenements_agenda', {});
  assert.match(sansConfig.erreur, /non configuré/);
  const nonConnecte = await executerAgenda(s, coffre, CONFIG, 'lister_evenements_agenda', { jour: '2026-10-29' });
  assert.match(nonConnecte.erreur, /non connecté/);

  await sauverJetons(s, coffre, jetonsStockes());
  const fetcher = fauxFetch({
    'www.googleapis.com/calendar/v3': reponseJson({ items: [{ id: '1', summary: 'Réunion', start: { dateTime: '2026-10-29T11:00:00Z' }, end: { dateTime: '2026-10-29T12:00:00Z' } }] })
  });
  const r = await executerAgenda(s, coffre, CONFIG, 'lister_evenements_agenda', { jour: '2026-10-29' }, { fetcher });
  assert.equal(r.type, 'evenements');
  assert.equal(r.jour, '2026-10-29');
  assert.equal(r.evenements[0].titre, 'Réunion');

  const cree = fauxFetch({
    'www.googleapis.com/calendar/v3': reponseJson({ id: 'e9', summary: 'Visite', start: { dateTime: '2026-10-30T10:00:00.000Z' }, end: { dateTime: '2026-10-30T11:30:00.000Z' } })
  });
  const c = await executerAgenda(s, coffre, CONFIG, 'creer_evenement_agenda', { titre: 'Visite', quand: '2026-10-30T10:00', duree_minutes: 90 }, { fetcher: cree });
  assert.equal(c.type, 'evenement');
  assert.equal(c.evenement.id, 'e9');
  assert.equal((await executerAgenda(s, coffre, CONFIG, 'outil_inconnu', {})).erreur, 'Outil inconnu : outil_inconnu');
});

test('digest : les événements du jour apparaissent dans la carte, absents sans agenda', async () => {
  const action = { resume: 'Récap du matin', resultat: { ventes: [], rappels: [], pharmacies: [] } };
  const d = presenterDigest(action, new Date('2026-10-29T09:00:00.000Z'), { evenements: [{ id: '1', titre: 'Réunion', debut: '2026-10-29T11:00:00.000Z', fin: '2026-10-29T12:00:00.000Z', touteJournee: false, lieu: null }] });
  assert.equal(d.evenements.length, 1);
  assert.equal(d.evenements[0].titre, 'Réunion');
  assert.deepEqual(presenterDigest(action).evenements, []);

  const b = brut();
  const avec = await digestDuJour(b, UID, new Date('2026-10-29T09:00:00.000Z'), {
    lireGardes: async () => ({ pharmacies: [] }),
    lireEvenements: async (jour) => (jour === '2026-10-29' ? [{ id: '1', titre: 'Réunion', debut: '2026-10-29T11:00:00.000Z', fin: '2026-10-29T12:00:00.000Z', touteJournee: false, lieu: null }] : [])
  });
  assert.equal(avec.evenements.length, 1);
  const sans = await digestDuJour(b, UID, new Date('2026-10-29T10:00:00.000Z'), { lireGardes: async () => ({ pharmacies: [] }) });
  assert.deepEqual(sans.evenements, [], 'sans agenda connecté, la section est absente');
});
