// Digest quotidien personnalisé (item n°4 du backlog REA) : le « briefing Tehis ».
//
// Chaque matin, une carte unique — dans l'app et en notification — qui montre
// les rappels du jour, les ventes en attente, la pharmacie de garde la plus
// proche et une astuce. Le digest s'appuie sur le récap matinal de la PR #16
// (mêmes données, même génération) : ce n'est pas un second système parallèle,
// c'est sa présentation « écran d'accueil ». Une section sans données est
// simplement absente, jamais inventée. Le digest ne fait aucun envoi externe
// et ne modifie aucune donnée : il ne fait que lire (ou générer, une fois par
// jour) le récap.
import { preparerRecapMatinal } from './planifiees.js';
import { jourAbidjan } from '../quotas.js';

/** Astuces du jour : conseils courts et utiles, en rotation. Aucun chiffre, aucune promesse. */
export const ASTUCES = [
  'Quand un client dit « je reviens », note sa commande tout de suite : Tehis te rappellera de le relancer.',
  'Note chaque dépense du jour, même petite : c’est en fin de mois qu’on voit où part l’argent.',
  'Fixe le jour de ta tontine comme un rendez-vous : Tehis peut te le rappeler chaque semaine.',
  'Pour une démarche, prépare tes pièces à l’avance : une demande complète va toujours plus vite.',
  'Le soir, écris les trois choses à faire demain : tu commences la journée sans chercher.',
  'Garde le numéro de la pharmacie de garde la plus proche dans tes contacts.',
  'Un client qui a déjà acheté est le plus facile à convaincre : propose-lui une nouveauté.',
  'Mets à jour ton CV dès que tu termines une mission : les détails sont encore frais.',
  'Avant de visiter un logement, prépare tes questions : eau, électricité, transport, bruit le soir.',
  'Pour un courrier important, relis-le à voix haute : on entend les phrases qui accrochent.',
  'Sépare l’argent des dépenses fixes dès que tu es payé : ce qui reste est vraiment à toi.',
  'Un rappel vaut mieux qu’une bonne mémoire : confie tes échéances à Tehis.'
];

/** Astuce d’un jour donné : rotation déterministe sur le jour de l’année. */
export function astuceDuJour(date = new Date()) {
  const debutAnnee = Date.UTC(date.getUTCFullYear(), 0, 0);
  const jourAnnee = Math.floor((date.getTime() - debutAnnee) / 86400000);
  return ASTUCES[jourAnnee % ASTUCES.length];
}

/** Contenu d'un récap matinal, que `resultat` soit un objet (mémoire) ou une chaîne JSON (PostgreSQL). */
function contenuRecap(action) {
  const r = action?.resultat;
  if (!r) return { ventes: [], rappels: [], pharmacies: [] };
  try {
    const o = typeof r === 'string' ? JSON.parse(r) : r;
    return { ventes: o.ventes || [], rappels: o.rappels || [], pharmacies: o.pharmacies || [] };
  } catch { return { ventes: [], rappels: [], pharmacies: [] }; }
}

/** Présente une action `recap_matinal` comme digest du jour (avec l'astuce). */
export function presenterDigest(action, maintenant = new Date()) {
  const r = contenuRecap(action);
  return {
    date: jourAbidjan(maintenant),
    resume: action.resume,
    ventes: r.ventes,
    rappels: r.rappels,
    pharmacies: r.pharmacies,
    astuce: astuceDuJour(maintenant)
  };
}

/**
 * Le digest du jour : le récap matinal du jour, s'il existe déjà ; sinon, il
 * est généré une fois (après 8 h — avant, le digest n'existe pas encore et la
 * fonction renvoie null, la carte reste absente). `lireGardes` est injectable
 * pour les tests.
 */
export async function digestDuJour(store, uid, maintenant = new Date(), { lireGardes } = {}) {
  const jour = jourAbidjan(maintenant);
  const actions = await store.listActions(uid, { limite: 100 });
  const existant = actions.find((a) => a.outil === 'recap_matinal' && String(a.created_at || '').slice(0, 10) === jour);
  if (existant) return presenterDigest(existant, maintenant);
  if (maintenant.getUTCHours() < 8) return null;
  const { action } = await preparerRecapMatinal(store, uid, maintenant, { lireGardes });
  return presenterDigest(action, maintenant);
}
