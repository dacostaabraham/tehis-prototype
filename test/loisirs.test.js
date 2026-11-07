// Agent « Loisirs et cinéma » : catalogue et réservation via le microservice
// tehis-cine-elysia (réponses simulées, aucun appel réseau réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, accesAgent, offreSuffit } from '../public/shared/agents.js';
import { COULEURS_AGENTS, ICONES_SVG } from '../public/shared/identite.js';
import { instructionsStatiques, outils } from '../server/agents.js';
import {
  urlService, URL_DEFAUT, libelleSeance, formaterSeance,
  chercherSeances, chercherFilmsGenre, recommanderFilm, detailFilm,
  preparerReservation, suivreReservation, executerLoisirs,
  offrePeutReserver, SCHEMAS_LOISIRS
} from '../server/outils/loisirs.js';

// ---------- Faux microservice ----------

const SEANCE = {
  film: { titre: 'Ebinto', tmdb_id: 1800276, duree_min: 115, note_tmdb: 8, affiche_url: 'https://image.tmdb.org/t/p/w500/x.jpg' },
  cinema: { nom: 'Majestic Ivoire', quartier: 'Cocody' },
  debut: '2026-11-07T18:40:00+00:00',
  prix_plein: 5000, prix_reduit: 3000,
  seance_id: 'seance-1', film_id: 'film-1', cinema_id: 'cine-1'
};
// Forme renvoyée aujourd'hui par le service déployé : mêmes champs, SANS
// identifiants (le catalogue ne les expose pas encore — voir README du test).
const SEANCE_SANS_IDS = {
  film: { titre: 'Ebinto', tmdb_id: 1800276, duree_min: 115, note_tmdb: 8, affiche_url: 'https://image.tmdb.org/t/p/w500/x.jpg' },
  cinema: { nom: 'Majestic Ivoire', quartier: 'Cocody' },
  debut: '2026-11-07T18:40:00+00:00',
  prix_plein: 5000, prix_reduit: 3000
};

function fauxCine(reponses, { sansIds = false } = {}) {
  const appels = [];
  const f = async (url, opts = {}) => {
    appels.push({ url, opts });
    const methode = opts.method || 'GET';
    for (const [motif, corps, statut] of reponses) {
      const estPost = motif.startsWith('POST:');
      const cle = estPost ? motif.slice(5) : motif;
      if (url.includes(cle) && (!estPost || methode === 'POST')) {
        return new Response(JSON.stringify(corps), { status: statut || 200 });
      }
    }
    if (url.includes('/v1/catalog/browse')) {
      return new Response(JSON.stringify({ date: '2026-11-07', cinema: null, sessions: [sansIds ? SEANCE_SANS_IDS : SEANCE] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'introuvable' }), { status: 404 });
  };
  f.appels = appels;
  return f;
}

const IDENTITE = {
  film_id: 'film-1', cinema_id: 'cine-1', seance_id: 'seance-1',
  adulte: 2, junior: 0, email: 'test@example.com',
  firstName: 'Awa', lastName: 'Koné', address: 'Rue des Jardins', postalCode: '01', city: 'Abidjan'
};

// ---------- Enregistrement de l'agent ----------

test('Loisirs : inscrit au catalogue, gratuit (le catalogue est gratuit pour tous)', () => {
  assert.equal(AGENTS.loisirs.nom, 'Loisirs et cinéma');
  assert.equal(AGENTS.loisirs.offre, 'gratuit');
  assert.equal(AGENTS.loisirs.groupe, 'quotidien');
  assert.ok(AGENTS.loisirs.intro.includes('Majestic'));
  assert.ok(AGENTS.loisirs.suggestions.length >= 3);
  assert.ok(accesAgent('loisirs', { offre: 'gratuit' }).ok, 'un compte gratuit peut ouvrir l\u2019agent');
  assert.ok(COULEURS_AGENTS.loisirs, 'couleur manquante');
  assert.ok(ICONES_SVG.loisirs, 'icône manquante');
});

test('Loisirs : 6 outils, routage compagnon → loisirs possible', () => {
  const noms = outils('loisirs').map((o) => o.name);
  for (const n of ['chercher_seances', 'chercher_films_genre', 'recommander_film', 'detail_film', 'preparer_reservation', 'suivre_reservation']) {
    assert.ok(noms.includes(n), `outil manquant : ${n}`);
  }
  assert.equal(SCHEMAS_LOISIRS.length, 6);
  const suggerer = outils('compagnon').find((o) => o.name === 'suggerer_agent');
  assert.ok(suggerer.input_schema.properties.agent.enum.includes('loisirs'), 'le compagnon doit pouvoir suggérer Loisirs');
});

test('Loisirs : consignes — jamais de réservation présentée comme terminée, paiement CentralBill', () => {
  const consignes = instructionsStatiques('loisirs');
  assert.match(consignes, /CentralBill/);
  assert.match(consignes, /Ne présente JAMAIS la réservation comme terminée avant le paiement/);
  assert.match(consignes, /Plus et Pro/);
  assert.match(consignes, /placement libre/);
  assert.doesNotMatch(consignes, /bientôt disponible/i, 'l\u2019agent est disponible : pas de mention « bientôt disponible »');
});

// ---------- Catalogue ----------

test('Catalogue : séances compactes — jour, heure, prix, identifiants', async () => {
  const f = fauxCine([]);
  const r = await chercherSeances({ date: '2026-11-07' }, f);
  assert.equal(r.total, 1);
  const s = r.seances[0];
  assert.equal(s.film, 'Ebinto');
  assert.equal(s.cinema, 'Majestic Ivoire');
  assert.match(s.jour_heure, /18:40/);
  assert.match(s.jour_heure, /novembre/);
  assert.equal(s.adulte_fcfa, 5000);
  assert.equal(s.junior_fcfa, 3000);
  assert.equal(s.seance_id, 'seance-1');
  assert.equal(s.film_id, 'film-1');
  assert.equal(s.cinema_id, 'cine-1');
  assert.match(f.appels[0].url, /\/v1\/catalog\/browse\?date=2026-11-07/);
});

test('Catalogue : sans identifiants (forme actuelle du service déployé), seance_id null', async () => {
  const f = fauxCine([], { sansIds: true });
  const r = await chercherSeances({ date: '2026-11-07' }, f);
  assert.equal(r.seances[0].seance_id, null);
  assert.equal(r.seances[0].film, 'Ebinto');
});

test('Catalogue : libellés — heure d\u2019Abidjan (UTC+0), pas de décalage', () => {
  assert.match(libelleSeance('2026-11-07T18:40:00+00:00'), /samedi 7 novembre à 18:40/);
  assert.equal(formaterSeance(SEANCE).jour_heure, 'samedi 7 novembre à 18:40');
});

test('Catalogue : genre et recommandation appellent les bons endpoints', async () => {
  const f = fauxCine([
    ['/v1/catalog/search', { date: '2026-11-07', genre: 'Action', results: [{ film: { id: 'film-1', titre: 'Ebinto', duree_min: 115, note_tmdb: 8, synopsis: 'Une histoire.' }, prix_min: 3000, sessions_count: 2 }] }],
    ['/v1/catalog/recommend', { date: '2026-11-07', genre: 'Action', budget_max: 10000, results: [{ film: { id: 'film-1', titre: 'Ebinto', note_tmdb: 8 }, prix_min: 5000, sessions: [{ debut: '2026-11-07T18:40:00+00:00', prix_plein: 5000, prix_reduit: 3000, seance_id: 'seance-1', cinema_id: 'cine-1' }] }] }]
  ]);
  const g = await chercherFilmsGenre({ genre: 'Action', date: '2026-11-07' }, f);
  assert.equal(g.films[0].film, 'Ebinto');
  assert.equal(g.films[0].prix_min_fcfa, 3000);
  const reco = await recommanderFilm({ genre: 'Action', budget_max: 10000, date: '2026-11-07' }, f);
  assert.equal(reco.films[0].prix_min_fcfa, 5000);
  assert.equal(reco.films[0].seances[0].seance_id, 'seance-1');
  assert.match(f.appels[0].url, /genre=Action/);
});

test('Catalogue : détail film et fiche introuvable', async () => {
  const f = fauxCine([
    ['/v1/catalog/films/film-1', { film: { id: 'film-1', titre: 'Ebinto', duree_min: 115, note_tmdb: 8, genres: ['Drame'], synopsis: 'Une histoire.' }, prochaines_seances: [{ cinema: { nom: 'Majestic Ivoire' }, debut: '2026-11-07T18:40:00+00:00', prix_plein: 5000, prix_reduit: 3000, seance_id: 'seance-1', cinema_id: 'cine-1' }] }]
  ]);
  const d = await detailFilm({ film_id: 'film-1' }, f);
  assert.equal(d.film, 'Ebinto');
  assert.equal(d.prochaines_seances[0].seance_id, 'seance-1');
  const absent = await detailFilm({ film_id: 'nope' }, async () => new Response(JSON.stringify({ error: 'film nope introuvable' }), { status: 404 }));
  assert.match(absent.erreur, /pas trouvé ce film/);
});

test('Catalogue : service injoignable → message lisible, sans jargon', async () => {
  const f = async () => { const e = new Error('fetch failed'); throw e; };
  const r = await chercherSeances({ date: '2026-11-07' }, f);
  assert.ok(r.erreur);
  assert.doesNotMatch(r.erreur, /fetch|ECONN|500|stack/i);
});

// ---------- Réservation ----------

test('Réservation : offre Gratuite refusée, AUCUN appel au microservice', async () => {
  const f = fauxCine([]);
  const r = await preparerReservation(IDENTITE, { offre: 'gratuit', fetchImpl: f });
  assert.match(r.erreur, /Plus et Pro/);
  assert.equal(f.appels.length, 0, 'aucune requête ne doit partir pour un compte gratuit');
  assert.equal(offrePeutReserver('gratuit'), false);
  assert.equal(offrePeutReserver('plus'), true);
  assert.equal(offrePeutReserver('pro'), true);
  assert.equal(offreSuffit('gratuit', 'plus'), false);
});

test('Réservation : sans identifiants de séance, refusée avant tout appel', async () => {
  const f = fauxCine([]);
  const r = await preparerReservation({ ...IDENTITE, seance_id: '' }, { offre: 'plus', fetchImpl: f });
  assert.match(r.erreur, /séance exacte/);
  assert.equal(f.appels.length, 0);
});

test('Réservation : Plus — 202, booking_id, consigne de suivi (jamais terminée)', async () => {
  const f = fauxCine([
    ['POST:/v1/bookings', { bookingId: 'booking-1', status: 'pending', film: 'Ebinto', cinema: 'Majestic Ivoire', session_time: '2026-11-07T18:40:00+00:00', amount_fcfa: 10000 }, 202]
  ]);
  const r = await preparerReservation(IDENTITE, { offre: 'plus', fetchImpl: f });
  assert.equal(r.statut, 'preparee');
  assert.equal(r.booking_id, 'booking-1');
  assert.equal(r.montant_fcfa, 10000);
  assert.match(r.jour_heure, /18:40/);
  assert.match(r.consigne, /suivre_reservation/);
  const appel = JSON.parse(f.appels[0].opts.body);
  assert.equal(appel.email, 'test@example.com');
  assert.equal(appel.adulte, 2);
});

test('Réservation : email invalide ou places hors limites refusés', async () => {
  const f = fauxCine([]);
  assert.match((await preparerReservation({ ...IDENTITE, email: 'pas-un-email' }, { offre: 'plus', fetchImpl: f })).erreur, /email valide/);
  assert.match((await preparerReservation({ ...IDENTITE, adulte: 0, junior: 0 }, { offre: 'plus', fetchImpl: f })).erreur, /combien de places/);
  assert.equal(f.appels.length, 0);
});

test('Suivi : en attente de paiement → lien CentralBill et consigne de paiement', async () => {
  const f = fauxCine([
    ['/v1/bookings/booking-1', { booking: { id: 'booking-1', film: 'Ebinto', cinema: 'Majestic Ivoire', session_time: '2026-11-07T18:40:00+00:00', amount_fcfa: 10000, status: 'awaiting_payment', central_bill_url: 'https://pay.centralbill.app/f/abc', order_id: 'cmd-1' }, steps: [{ step: 'received', status: 'completed' }] }]
  ]);
  const r = await suivreReservation({ booking_id: 'booking-1' }, f);
  assert.equal(r.statut, 'awaiting_payment');
  assert.equal(r.lien_paiement, 'https://pay.centralbill.app/f/abc');
  assert.match(r.consigne, /15 minutes/);
});

test('Suivi : encore en préparation → patienter, puis vérifier de nouveau', async () => {
  const f = fauxCine([
    ['/v1/bookings/booking-1', { booking: { id: 'booking-1', film: 'Ebinto', cinema: 'Majestic Ivoire', session_time: '2026-11-07T18:40:00+00:00', amount_fcfa: 10000, status: 'pending', central_bill_url: null, order_id: null }, steps: [] }]
  ]);
  const r = await suivreReservation({ booking_id: 'booking-1' }, f);
  assert.equal(r.statut, 'pending');
  assert.equal(r.lien_paiement, null);
  assert.match(r.consigne, /patienter/);
});

// ---------- Exécuteur et configuration ----------

test('Exécuteur : dispatche les 6 outils, outil inconnu refusé', async () => {
  const f = fauxCine([]);
  const r = await executerLoisirs('chercher_seances', { date: '2026-11-07' }, { fetchImpl: f });
  assert.equal(r.total, 1);
  assert.match((await executerLoisirs('outil_bidon', {}, {})).erreur, /Outil inconnu/);
});

test('Configuration : URL par défaut = service déployé, surcharge par CINE_ELYSIA_URL', () => {
  const avant = process.env.CINE_ELYSIA_URL;
  try {
    delete process.env.CINE_ELYSIA_URL;
    assert.equal(urlService(), URL_DEFAUT);
    assert.equal(URL_DEFAUT, 'https://tehis-cine-elysia.onrender.com');
    process.env.CINE_ELYSIA_URL = 'https://exemple.local:3000/';
    assert.equal(urlService(), 'https://exemple.local:3000');
  } finally {
    if (avant === undefined) delete process.env.CINE_ELYSIA_URL;
    else process.env.CINE_ELYSIA_URL = avant;
  }
});
