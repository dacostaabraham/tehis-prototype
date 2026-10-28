// Tâches planifiées qui agissent (P0 du rapport REA).
//
// La boucle de rappels (server/notifications.js, vérification toutes les 30 s)
// ne se contente plus de notifier : un rappel qui porte un `type_action` est
// transformé en action préparée et présentée en carte de validation — le même
// pattern que la V1 « Vendeur qui agit » : Tehis prépare, l'utilisateur valide
// avant tout envoi externe. Aucun envoi automatique, aucun numéro/prix inventé.
//
// Cas concrets :
// - `relance_vente` : relance vendeur à J+2, préparée automatiquement quand une
//   vente suivie est encore intéressée ou réservée (sinon ignorée : vente payée,
//   livrée, déjà envoyée ou supprimée).
// - `recap_matinal` : chaque matin à 8 h, un récap (ventes en attente, rappels
//   du jour, pharmacies de garde) enregistré directement dans le journal
//   d'activité, sans rien à valider (c'est une information, pas un envoi).
import { preparerEnvoiClient, formaterPrix, dateRecapMatinal } from './ventes.js';
import { preparerCheckinObjectif } from './objectifs.js';
import { gardesDeLaSemaine } from './garde.js';

export const TYPES_ACTION = ['relance_vente', 'recap_matinal', 'checkin_objectif'];
export { dateRecapMatinal };

/** Message de relance, construit uniquement à partir des données réelles de la vente. */
export function messageRelance(vente) {
  const prix = vente.prix != null ? ` (${formaterPrix(vente.prix)})` : '';
  if (vente.statut === 'reserve') return `Bonjour ${vente.client_nom}, je reviens vers toi : ta réservation « ${vente.produit} »${prix} est toujours là. Tu confirmes que tu la prends ? Merci !`;
  return `Bonjour ${vente.client_nom}, je reviens vers toi pour « ${vente.produit} »${prix}. C'est toujours d'actualité pour toi ? Dis-moi, je te le garde. Merci !`;
}

/**
 * Prépare la relance d'une vente : crée l'action `vendeur_envoyer_message`
 * en attente de validation (même forme que l'envoi proposé dans le chat).
 * Retourne { action } ou { ignore: true, raison } quand il n'y a rien à relancer.
 */
export async function preparerRelanceVente(store, rappel) {
  const venteId = rappel.action_input?.vente_id;
  const vente = venteId ? await store.getVente(rappel.user_id, venteId) : null;
  if (!vente) return { ignore: true, raison: 'vente introuvable' };
  if (vente.envoye) return { ignore: true, raison: 'vente déjà envoyée' };
  if (!['interesse', 'reserve'].includes(vente.statut)) return { ignore: true, raison: `vente ${vente.statut}` };
  const preparation = preparerEnvoiClient({
    client_nom: vente.client_nom, client_telephone: vente.client_telephone,
    produit: vente.produit, prix: vente.prix, message: messageRelance(vente)
  });
  if (preparation.erreur) return { ignore: true, raison: preparation.erreur };
  // Même forme d'input que l'envoi proposé dans le chat : le circuit de
  // validation (POST /api/actions/:id) la traite à l'identique.
  const action = await store.addAction(rappel.user_id, {
    outil: 'vendeur_envoyer_message',
    input: {
      client_nom: preparation.client_nom, client_telephone: preparation.client_telephone,
      produit: preparation.produit, prix: preparation.prix, message: preparation.message,
      vente_id: vente.id
    },
    resume: preparation.resume
  });
  return { action };
}

/**
 * Prépare le récap matinal : ventes en attente, rappels du jour, pharmacies
 * de garde. L'action est créée directement au statut `executee` : c'est une
 * information, rien n'est envoyé à l'extérieur. Si la liste des pharmacies
 * n'est pas lisible, la section est simplement absente (jamais de données
 * inventées). `lireGardes` est injectable pour les tests.
 */
export async function preparerRecapMatinal(store, uid, maintenant = new Date(), { lireGardes = gardesDeLaSemaine } = {}) {
  const ventes = (await store.listVentes(uid)).filter((v) => ['interesse', 'reserve'].includes(v.statut) && !v.envoye);
  const jour = maintenant.toISOString().slice(0, 10);
  const rappels = (await store.listReminders(uid, { aVenir: true }))
    .filter((r) => new Date(r.quand).toISOString().slice(0, 10) === jour && r.type_action !== 'recap_matinal')
    .map((r) => ({ texte: r.texte, quand: r.quand }));
  let pharmacies = [];
  try {
    const gardes = await lireGardes({ maintenant });
    pharmacies = (gardes?.pharmacies || []).slice(0, 4).map((p) => ({ nom: p.nom, commune: p.commune, telephone: p.telephone }));
  } catch { pharmacies = []; }
  const pluriel = (n, singulier) => `${n} ${singulier}${n > 1 ? 's' : ''}`;
  const resume = `Récap du matin — ${pluriel(ventes.length, 'vente')} en attente, ${pluriel(rappels.length, 'rappel')} aujourd'hui${pharmacies.length ? `, ${pluriel(pharmacies.length, 'pharmacie')} de garde` : ''}`;
  const action = await store.addAction(uid, {
    outil: 'recap_matinal',
    input: { type: 'recap_matinal' },
    resume,
    statut: 'executee',
    resultat: {
      ventes: ventes.map((v) => ({ client_nom: v.client_nom, produit: v.produit, prix: v.prix, statut: v.statut })),
      rappels,
      pharmacies
    }
  });
  return { action };
}

/**
 * Traite un rappel dû qui porte un `type_action`. Retourne { action } quand
 * une action a été préparée (et notifie l'utilisateur pour qu'il la valide
 * dans « Mes affaires »), ou { ignore: true, raison } quand il n'y a rien à
 * faire. `notifier` est `(uid, charge) => …` (notifications push).
 */
export async function traiterRappelPlanifie(store, rappel, { notifier, maintenant = new Date(), lireGardes } = {}) {
  if (rappel.type_action === 'relance_vente') {
    const r = await preparerRelanceVente(store, rappel);
    if (r.ignore) return { ignore: true, raison: r.raison };
    if (notifier) await notifier(rappel.user_id, { titre: 'Relance prête à valider', corps: r.action.resume, tag: `action-${r.action.id}`, url: '/?panneau=affaires' });
    return { action: r.action };
  }
  if (rappel.type_action === 'recap_matinal') {
    const r = await preparerRecapMatinal(store, rappel.user_id, maintenant, { lireGardes });
    // La notification renvoie vers la carte du digest, sur l'écran d'accueil (chat) — le récap reste aussi visible dans « Mes affaires » › Activité.
    if (notifier) await notifier(rappel.user_id, { titre: 'Ton récap du matin est prêt', corps: r.action.resume, tag: `action-${r.action.id}`, url: '/?panneau=chat' });
    return { action: r.action };
  }
  if (rappel.type_action === 'checkin_objectif') {
    // Check-in hebdomadaire : Tehis fait le point sur l'objectif dans le
    // journal d'activité et envoie une notification qui y renvoie. Si
    // l'objectif est clôturé ou atteint entre-temps, le rappel est consommé
    // sans bruit (le check-in a déjà été annulé à la clôture).
    const r = await preparerCheckinObjectif(store.pour(rappel.user_id), rappel, maintenant);
    if (r.ignore) return { ignore: true, raison: r.raison };
    if (notifier) await notifier(rappel.user_id, { titre: 'Point sur ton objectif', corps: r.action.resume, tag: `action-${r.action.id}`, url: '/?panneau=affaires' });
    return { action: r.action };
  }
  return { ignore: true, raison: `type_action inconnu : ${rappel.type_action}` };
}
