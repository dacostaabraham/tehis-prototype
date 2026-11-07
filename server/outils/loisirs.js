// Agent « Loisirs et cinéma » : catalogue et réservation Majestic via le
// microservice tehis-cine-elysia (voir docs du microservice).
// Le microservice est la seule source de vérité pour les films, les séances
// et les prix : on n'invente jamais un film, une heure ou un tarif.
// « L'agent prépare, l'utilisateur paie » : la réservation s'arrête à
// l'URL CentralBill, que l'utilisateur ouvre sur son téléphone (facture
// valable 15 min). Aucun paiement côté serveur, aucun siège (placement libre).

// URL remplaçable par variable d'environnement (Render : CINE_ELYSIA_URL,
// sync: false). Par défaut : le service déployé.
export const URL_DEFAUT = 'https://tehis-cine-elysia.onrender.com';
export function urlService() {
  return (process.env.CINE_ELYSIA_URL || URL_DEFAUT).replace(/\/$/, '');
}

const DELAI_MS = 15_000;

/** Date du jour à Abidjan (UTC+0), au format YYYY-MM-DD. */
export function dateAujourdhui(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

const JOUR_FR = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', weekday: 'long', day: 'numeric', month: 'long' });
const HEURE_FR = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', hour: '2-digit', minute: '2-digit', hour12: false });

/** « 2026-11-07T18:40:00+00:00 » → « samedi 7 novembre à 18:40 ». */
export function libelleSeance(debut) {
  const d = new Date(debut);
  if (Number.isNaN(d.getTime())) return String(debut || '');
  return `${JOUR_FR.format(d)} à ${HEURE_FR.format(d)}`;
}

export function heureSeance(debut) {
  const d = new Date(debut);
  return Number.isNaN(d.getTime()) ? '' : HEURE_FR.format(d);
}

/** Message d'erreur lisible pour l'utilisateur : jamais de jargon technique. */
function erreurService(e) {
  const texte = [e?.message, e?.cause?.message].filter(Boolean).join(' ');
  if (e?.name === 'AbortError' || /abort|timeout/i.test(texte)) {
    return 'Le cinéma met trop de temps à répondre. Réessaie dans un instant.';
  }
  return 'Le cinéma est indisponible pour le moment. Réessaie dans quelques minutes.';
}

async function appel(chemin, { methode = 'GET', corps = null, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetchImpl(`${urlService()}${chemin}`, {
      method: methode,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(corps ? { 'Content-Type': 'application/json' } : {}) },
      ...(corps ? { body: JSON.stringify(corps) } : {})
    });
    const donnees = await r.json().catch(() => ({}));
    return { statut: r.status, donnees };
  } finally { clearTimeout(minuterie); }
}

/** Une séance du catalogue, compacte pour le modèle (prix, heure, identifiants). */
export function formaterSeance(s) {
  return {
    film: s.film?.titre || null,
    cinema: s.cinema?.nom || null,
    quartier: s.cinema?.quartier || null,
    jour_heure: s.debut ? libelleSeance(s.debut) : null,
    duree_min: s.film?.duree_min ?? null,
    note: s.film?.note_tmdb ?? null,
    adulte_fcfa: s.prix_plein ?? null,
    junior_fcfa: s.prix_reduit ?? null,
    // Identifiants renvoyés par le catalogue (nécessaires pour réserver).
    // Absents tant que le microservice ne les expose pas dans ses réponses.
    film_id: s.film_id ?? s.film?.id ?? null,
    cinema_id: s.cinema_id ?? s.cinema?.id ?? null,
    seance_id: s.seance_id ?? s.id ?? null
  };
}

export async function chercherSeances(input = {}, fetchImpl = fetch) {
  const date = (input.date || dateAujourdhui()).slice(0, 10);
  const params = new URLSearchParams({ date });
  if (input.cinema) params.set('cinema', String(input.cinema));
  if (input.moment) params.set('moment', String(input.moment));
  let r;
  try { r = await appel(`/v1/catalog/browse?${params}`, { fetchImpl }); }
  catch (e) { return { erreur: erreurService(e) }; }
  if (r.statut !== 200) return { erreur: r.donnees?.error ? 'Le catalogue des séances est indisponible pour le moment.' : 'Le catalogue des séances est indisponible pour le moment.' };
  const seances = (r.donnees.sessions || []).map(formaterSeance);
  return { date: r.donnees.date, cinema: r.donnees.cinema, total: seances.length, seances, consigne: seances.length ? 'Propose 2 ou 3 séances, avec le cinéma, le jour, l\u2019heure et les prix adulte / junior.' : 'Aucune séance ce jour-là : propose un autre jour ou un autre cinéma.' };
}

export async function chercherFilmsGenre(input = {}, fetchImpl = fetch) {
  if (!input.genre) return { erreur: 'Dis-moi quel genre tu veux (action, comédie, drame, animation…).' };
  const date = (input.date || dateAujourdhui()).slice(0, 10);
  const params = new URLSearchParams({ genre: String(input.genre), date, sort: input.sort || 'prix_asc' });
  let r;
  try { r = await appel(`/v1/catalog/search?${params}`, { fetchImpl }); }
  catch (e) { return { erreur: erreurService(e) }; }
  if (r.statut !== 200) return { erreur: 'La recherche par genre est indisponible pour le moment.' };
  const films = (r.donnees.results || []).map((x) => ({
    film: x.film?.titre || null,
    film_id: x.film?.id ?? null,
    duree_min: x.film?.duree_min ?? null,
    note: x.film?.note_tmdb ?? null,
    synopsis: x.film?.synopsis || null,
    prix_min_fcfa: x.prix_min ?? null,
    seances_du_jour: x.sessions_count ?? 0
  }));
  return { date: r.donnees.date, genre: r.donnees.genre, total: films.length, films, consigne: films.length ? 'Propose les films avec leur prix le plus bas et le nombre de séances du jour.' : 'Aucun film de ce genre aujourd\u2019hui : propose un autre genre ou un autre jour.' };
}

export async function recommanderFilm(input = {}, fetchImpl = fetch) {
  if (!input.genre) return { erreur: 'Dis-moi quel genre tu veux (action, comédie, drame, animation…).' };
  const budget = Number(input.budget_max);
  if (!Number.isFinite(budget) || budget <= 0) return { erreur: 'Donne-moi ton budget maximum en FCFA (par exemple 10 000).' };
  const date = (input.date || dateAujourdhui()).slice(0, 10);
  const params = new URLSearchParams({ genre: String(input.genre), budget_max: String(budget), date });
  let r;
  try { r = await appel(`/v1/catalog/recommend?${params}`, { fetchImpl }); }
  catch (e) { return { erreur: erreurService(e) }; }
  if (r.statut !== 200) return { erreur: 'Les recommandations sont indisponibles pour le moment.' };
  const films = (r.donnees.results || []).map((x) => ({
    film: x.film?.titre || null,
    film_id: x.film?.id ?? null,
    duree_min: x.film?.duree_min ?? null,
    note: x.film?.note_tmdb ?? null,
    synopsis: x.film?.synopsis || null,
    prix_min_fcfa: x.prix_min ?? null,
    seances: (x.sessions || []).map((s) => ({ jour_heure: s.debut ? libelleSeance(s.debut) : null, adulte_fcfa: s.prix_plein ?? null, junior_fcfa: s.prix_reduit ?? null, seance_id: s.seance_id ?? s.id ?? null, cinema_id: s.cinema_id ?? null }))
  }));
  return { date: r.donnees.date, genre: r.donnees.genre, budget_max_fcfa: budget, total: films.length, films, consigne: films.length ? 'Recommande le mieux noté dans le budget, avec ses séances et leurs prix.' : 'Aucun film de ce genre dans ce budget aujourd\u2019hui : propose d\u2019augmenter le budget ou de changer de genre.' };
}

export async function detailFilm(input = {}, fetchImpl = fetch) {
  if (!input.film_id) return { erreur: 'Dis-moi quel film tu veux voir en détail.' };
  let r;
  try { r = await appel(`/v1/catalog/films/${encodeURIComponent(String(input.film_id))}`, { fetchImpl }); }
  catch (e) { return { erreur: erreurService(e) }; }
  if (r.statut === 404) return { erreur: 'Je n\u2019ai pas trouvé ce film. Vérifie le titre.' };
  if (r.statut !== 200) return { erreur: 'La fiche du film est indisponible pour le moment.' };
  const f = r.donnees.film || {};
  return {
    film: f.titre || null,
    film_id: f.id ?? null,
    duree_min: f.duree_min ?? null,
    note: f.note_tmdb ?? null,
    genres: f.genres || [],
    synopsis: f.synopsis || null,
    prochaines_seances: (r.donnees.prochaines_seances || []).map((s) => ({
      cinema: s.cinema?.nom || null,
      jour_heure: s.debut ? libelleSeance(s.debut) : null,
      adulte_fcfa: s.prix_plein ?? null,
      junior_fcfa: s.prix_reduit ?? null,
      seance_id: s.seance_id ?? s.id ?? null,
      cinema_id: s.cinema_id ?? null
    }))
  };
}

/** La réservation est réservée aux offres Plus et Pro (le catalogue est gratuit pour tous). */
export function offrePeutReserver(offre) {
  return offre === 'plus' || offre === 'pro';
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function preparerReservation(input = {}, ctx = {}) {
  if (!offrePeutReserver(ctx.offre)) {
    return { erreur: 'La réservation au cinéma est réservée aux offres Plus et Pro. Le catalogue, lui, est gratuit : je peux te montrer ce qui passe. Pour réserver, passe à Plus dans « Mes affaires » › Offre.' };
  }
  const manquants = ['film_id', 'cinema_id', 'seance_id'].filter((c) => !input[c]);
  if (manquants.length) {
    return { erreur: `Il me manque la séance exacte à réserver (${manquants.join(', ')}). Choisis d\u2019abord un film, un cinéma et une heure dans le catalogue, puis je prépare la réservation.` };
  }
  const total = (Number(input.adulte) || 0) + (Number(input.junior) || 0);
  if (total < 1 || total > 10) return { erreur: 'Dis-moi combien de places : 1 à 10 au total (adultes + juniors de 3 à 17 ans).' };
  if (!EMAIL_OK.test(String(input.email || ''))) return { erreur: 'Il me faut un email valide pour la réservation (c\u2019est là que part le billet).' };
  for (const c of ['firstName', 'lastName', 'address', 'postalCode', 'city']) {
    if (!String(input[c] || '').trim()) return { erreur: `Il me manque ${c === 'firstName' ? 'ton prénom' : c === 'lastName' ? 'ton nom' : c === 'address' ? 'ton adresse' : c === 'postalCode' ? 'ton code postal' : 'ta ville'} pour la réservation.` };
  }
  let r;
  try {
    r = await appel('/v1/bookings', {
      methode: 'POST',
      corps: {
        user_id: ctx.userId || undefined,
        film_id: input.film_id, cinema_id: input.cinema_id, seance_id: input.seance_id,
        adulte: Number(input.adulte) || 0, junior: Number(input.junior) || 0,
        email: String(input.email).trim(),
        firstName: String(input.firstName).trim(), lastName: String(input.lastName).trim(),
        address: String(input.address).trim(), postalCode: String(input.postalCode).trim(),
        city: String(input.city).trim(), country: input.country ? String(input.country).trim() : undefined
      },
      fetchImpl: ctx.fetchImpl || fetch
    });
  } catch (e) { return { erreur: erreurService(e) }; }
  if (r.statut === 404) return { erreur: 'Cette séance n\u2019existe plus. Choisis-en une autre dans le catalogue.' };
  if (r.statut === 400) return { erreur: 'Cette séance ne peut pas être réservée (déjà passée, ou ne correspond plus au film choisi). Choisis-en une autre.' };
  if (r.statut !== 202) return { erreur: 'La préparation de la réservation a échoué. Réessaie dans un instant.' };
  const b = r.donnees || {};
  return {
    statut: 'preparee',
    booking_id: b.bookingId || null,
    film: b.film || null,
    cinema: b.cinema || null,
    jour_heure: b.session_time ? libelleSeance(b.session_time) : null,
    montant_fcfa: b.amount_fcfa ?? null,
    consigne: 'La réservation est en cours de préparation côté cinéma. Appelle « suivre_reservation » avec ce booking_id : quand le statut devient « en attente de paiement », donne à l\u2019utilisateur le lien de paiement (central_bill_url) — il paie sur son téléphone, la facture ne dure que 15 minutes. Ne présente JAMAIS la réservation comme terminée avant le paiement.'
  };
}

export async function suivreReservation(input = {}, fetchImpl = fetch) {
  if (!input.booking_id) return { erreur: 'Donne-moi l\u2019identifiant de la réservation à suivre.' };
  let r;
  try { r = await appel(`/v1/bookings/${encodeURIComponent(String(input.booking_id))}`, { fetchImpl }); }
  catch (e) { return { erreur: erreurService(e) }; }
  if (r.statut === 404) return { erreur: 'Je n\u2019ai pas trouvé cette réservation.' };
  if (r.statut !== 200) return { erreur: 'Le suivi de la réservation est indisponible pour le moment.' };
  const b = r.donnees?.booking || {};
  const etapes = (r.donnees?.steps || []).map((s) => `${s.step}: ${s.status}`).join(', ');
  const resume = {
    booking_id: b.id || input.booking_id,
    film: b.film || null,
    cinema: b.cinema || null,
    jour_heure: b.session_time ? libelleSeance(b.session_time) : null,
    montant_fcfa: b.amount_fcfa ?? null,
    statut: b.status || null,
    lien_paiement: b.central_bill_url || null,
    numero_commande: b.order_id || null,
    etapes: etapes || null
  };
  if (b.status === 'awaiting_payment' && b.central_bill_url) {
    resume.consigne = 'Donne le lien de paiement à l\u2019utilisateur : il paie sur son téléphone (Mobile Money ou carte), la facture expire après 15 minutes. La réservation n\u2019est terminée qu\u2019après le paiement.';
  } else if (b.status === 'pending') {
    resume.consigne = 'La préparation est encore en cours côté cinéma : dis à l\u2019utilisateur de patienter une minute, puis vérifie de nouveau avec « suivre_reservation ».';
  } else if (b.status === 'paid' || b.status === 'completed') {
    resume.consigne = 'Le paiement est confirmé : la réservation est terminée, le billet arrive par email.';
  } else if (b.status === 'unavailable') {
    resume.consigne = 'La vente en ligne est indisponible pour cette séance : propose une autre séance, ou l\u2019achat en caisse au cinéma.';
  } else if (b.status === 'failed' || b.status === 'cancelled') {
    resume.consigne = 'La réservation n\u2019a pas abouti : propose de recommencer avec une autre séance.';
  }
  return resume;
}

export const SCHEMAS_LOISIRS = [
  {
    name: 'chercher_seances',
    description: 'Séances de cinéma à Abidjan pour un jour donné (aujourd\u2019hui par défaut) : films, cinémas Majestic, heures et prix adulte / junior. Utilise toujours cet outil pour répondre à « qu\u2019est-ce qui passe ce soir / ce week-end / samedi ? » : ne devine jamais un film, une heure ou un prix.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Jour au format YYYY-MM-DD (aujourd\u2019hui si absent)' },
        cinema: { type: 'string', description: 'Nom du cinéma, ex. « Majestic Ivoire », « Majestic Prima », « Majestic Sococé », « Majestic Ficgayo »' },
        moment: { type: 'string', enum: ['soir', 'apres-midi'], description: '« soir » = à partir de 18 h, « apres-midi » = 12 h à 18 h' }
      }
    }
  },
  {
    name: 'chercher_films_genre',
    description: 'Films d\u2019un genre pour un jour donné, triés par prix croissant : titre, durée, note, prix le plus bas et nombre de séances du jour. Genre en français : Action, Comédie, Drame, Animation, Horreur, Romance, Aventure…',
    input_schema: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'Genre en français, ex. « Action »' },
        date: { type: 'string', description: 'Jour au format YYYY-MM-DD (aujourd\u2019hui si absent)' },
        sort: { type: 'string', enum: ['prix_asc', 'note_desc'], description: 'Tri : prix croissant (défaut) ou meilleure note d\u2019abord' }
      },
      required: ['genre']
    }
  },
  {
    name: 'recommander_film',
    description: 'Recommande un bon film (note TMDB ≥ 7) d\u2019un genre, dans un budget maximum en FCFA, pour un jour donné : titre, note, prix le plus bas et séances avec leurs prix.',
    input_schema: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: 'Genre en français, ex. « Action »' },
        budget_max: { type: 'number', description: 'Budget maximum en FCFA pour une place adulte, ex. 10000' },
        date: { type: 'string', description: 'Jour au format YYYY-MM-DD (aujourd\u2019hui si absent)' }
      },
      required: ['genre', 'budget_max']
    }
  },
  {
    name: 'detail_film',
    description: 'Fiche d\u2019un film : durée, note, genres, synopsis et ses prochaines séances (cinéma, jour, heure, prix).',
    input_schema: {
      type: 'object',
      properties: {
        film_id: { type: 'string', description: 'Identifiant du film (celui renvoyé par les autres outils, ou identifiant TMDB)' }
      },
      required: ['film_id']
    }
  },
  {
    name: 'preparer_reservation',
    description: 'Prépare une réservation au cinéma (places adultes et juniors de 3 à 17 ans, placement libre, pas de choix de siège). Réservé aux offres Plus et Pro : l\u2019outil refuse tout seul pour l\u2019offre Gratuite. Renvoie un booking_id : appelle ensuite « suivre_reservation » pour récupérer le lien de paiement CentralBill. Ne présente JAMAIS la réservation comme terminée à ce stade.',
    input_schema: {
      type: 'object',
      properties: {
        film_id: { type: 'string', description: 'Identifiant du film (renvoyé par le catalogue)' },
        cinema_id: { type: 'string', description: 'Identifiant du cinéma (renvoyé par le catalogue)' },
        seance_id: { type: 'string', description: 'Identifiant de la séance (renvoyé par le catalogue)' },
        adulte: { type: 'integer', description: 'Nombre de places adultes (5 000 FCFA à l\u2019Ivoire, 3 000 FCFA ailleurs)' },
        junior: { type: 'integer', description: 'Nombre de places juniors de 3 à 17 ans (3 000 FCFA à l\u2019Ivoire, 2 500 FCFA ailleurs)' },
        email: { type: 'string', description: 'Email de l\u2019utilisateur (le billet part par email)' },
        firstName: { type: 'string', description: 'Prénom' },
        lastName: { type: 'string', description: 'Nom' },
        address: { type: 'string', description: 'Adresse (demandée par le cinéma)' },
        postalCode: { type: 'string', description: 'Code postal' },
        city: { type: 'string', description: 'Ville' },
        country: { type: 'string', description: 'Pays (Côte d\u2019Ivoire par défaut)' }
      },
      required: ['film_id', 'cinema_id', 'seance_id', 'adulte', 'junior', 'email', 'firstName', 'lastName', 'address', 'postalCode', 'city']
    }
  },
  {
    name: 'suivre_reservation',
    description: 'Suit une réservation : statut (en préparation, en attente de paiement, payée, indisponible, annulée), montant, numéro de commande et lien de paiement CentralBill quand il est prêt.',
    input_schema: {
      type: 'object',
      properties: {
        booking_id: { type: 'string', description: 'Identifiant de la réservation (renvoyé par « preparer_reservation »)' }
      },
      required: ['booking_id']
    }
  }
];

export const NOMS_OUTILS_LOISIRS = new Set(SCHEMAS_LOISIRS.map((s) => s.name));

/** Exécute un outil Loisirs. ctx = { offre, userId, fetchImpl }. */
export async function executerLoisirs(nom, input = {}, ctx = {}) {
  const fetchImpl = ctx.fetchImpl || fetch;
  switch (nom) {
    case 'chercher_seances': return chercherSeances(input, fetchImpl);
    case 'chercher_films_genre': return chercherFilmsGenre(input, fetchImpl);
    case 'recommander_film': return recommanderFilm(input, fetchImpl);
    case 'detail_film': return detailFilm(input, fetchImpl);
    case 'preparer_reservation': return preparerReservation(input, { offre: ctx.offre, userId: ctx.userId, fetchImpl });
    case 'suivre_reservation': return suivreReservation(input, fetchImpl);
    default: return { erreur: `Outil inconnu : ${nom}` };
  }
}
