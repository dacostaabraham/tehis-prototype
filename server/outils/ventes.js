// Outils de l'agent « Vendeur en ligne » (V1 « Vendeur qui agit ») :
// suivi de vente, et proposition d'envoi d'un message à un client.
// L'envoi lui-même n'est JAMAIS fait ici : il attend la validation de
// l'utilisateur sur une carte (même circuit que le mode développeur),
// puis s'ouvre dans le WhatsApp du vendeur (lien wa.me pré-rempli).
// Tehis n'envoie aucun message directement depuis son propre numéro.
import { normaliserTelephone } from '../comptes.js';

export const STATUTS_VENTE = ['interesse', 'reserve', 'paye', 'livre'];
export const LIBELLES_STATUT = { interesse: 'Intéressé', reserve: 'Réservé', paye: 'Payé', livre: 'Livré' };

/** Montant en FCFA, avec des espaces entre les milliers (25 000 FCFA). */
export function formaterPrix(prix) {
  return `${Number(prix).toLocaleString('fr-FR')} FCFA`;
}

/** Lien WhatsApp du vendeur, message déjà rempli. Renvoie null si le numéro est invalide. */
export function lienWhatsApp(telephone, message) {
  const tel = normaliserTelephone(telephone);
  if (!tel) return null;
  return `https://wa.me/${tel.replace('+', '')}?text=${encodeURIComponent(message)}`;
}

/** Relance à J+2 à 9 h (heure d'Abidjan, UTC+0). Renvoie une date ISO. */
export function dateRelanceJ2(maintenant = new Date()) {
  const d = new Date(maintenant);
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString();
}

/** Prochain récap matinal : demain à 8 h, heure d'Abidjan (= UTC). */
export function dateRecapMatinal(maintenant = new Date()) {
  const d = new Date(maintenant);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(8, 0, 0, 0);
  return d;
}

/**
 * Programme la relance J+2 d'une vente (une seule : pas de doublon si elle
 * existe déjà). La relance devient une tâche planifiée : à J+2 à 9 h, Tehis
 * prépare le message et le met en carte de validation.
 */
export async function assurerRappelRelance(store, vente, maintenant = new Date()) {
  const existants = (await store.listReminders({ aVenir: true })).filter((r) => !r.envoye && r.type_action === 'relance_vente' && r.action_input?.vente_id === vente.id);
  if (existants.length) return existants[0];
  return store.addReminder({
    texte: `Relance J+2 : ${vente.client_nom} — ${vente.produit}`,
    quand: dateRelanceJ2(maintenant), repetition: 'aucune',
    type_action: 'relance_vente', action_input: { vente_id: vente.id }
  });
}

/** Annule les relances J+2 en attente d'une vente (payée, livrée, envoyée, supprimée). */
export async function annulerRappelsRelance(store, venteId) { return store.supprimerRappelsAction('relance_vente', venteId); }

/**
 * Programme le récap matinal quotidien (une seule fois : pas de doublon).
 * Il se répète ensuite tout seul, chaque matin à 8 h.
 */
export async function assurerRecapMatinal(store, maintenant = new Date()) {
  const existants = (await store.listReminders({ aVenir: true })).filter((r) => !r.envoye && r.type_action === 'recap_matinal');
  if (existants.length) return existants[0];
  return store.addReminder({
    texte: 'Récap du matin : ventes en attente et pharmacies de garde',
    quand: dateRecapMatinal(maintenant).toISOString(), repetition: 'quotidien',
    type_action: 'recap_matinal', action_input: {}
  });
}

/** Après un changement de statut : relance à programmer ou à annuler. */
async function apresChangementStatut(store, avant, apres, maintenant) {
  if (!apres) return;
  if (apres.statut === 'paye' || apres.statut === 'livre') await annulerRappelsRelance(store, apres.id);
  else if (['interesse', 'reserve'].includes(apres.statut) && (!avant || !['interesse', 'reserve'].includes(avant.statut))) {
    await assurerRappelRelance(store, apres, maintenant);
  }
}

function validerClient(input = {}) {
  const nom = String(input.client_nom || '').trim().slice(0, 60);
  if (!nom) return { erreur: 'Indique le nom du client.' };
  const telephone = normaliserTelephone(input.client_telephone);
  if (!telephone) return { erreur: 'Numéro de client invalide. Exemple : 07 07 12 34 56.' };
  return { nom, telephone };
}

function validerPrix(input = {}) {
  if (input.prix === undefined || input.prix === null || input.prix === '') return null;
  const prix = Number(input.prix);
  if (!Number.isFinite(prix) || prix < 0 || !Number.isInteger(prix)) return { erreur: 'Le prix doit être un nombre entier de FCFA, 0 ou plus.' };
  return prix;
}

function validerStatut(input = {}) {
  const statut = String(input.statut || 'interesse');
  if (!STATUTS_VENTE.includes(statut)) return { erreur: `Statut inconnu : ${STATUTS_VENTE.map((s) => LIBELLES_STATUT[s].toLowerCase()).join(', ')}.` };
  return statut;
}

/**
 * Vérifie une proposition d'envoi et prépare ce que montrera la carte de
 * validation : le résumé, les détails (message exact, destinataire) et le
 * lien wa.me qui ne s'ouvrira qu'après validation. Ne crée ni n'envoie rien.
 */
export function preparerEnvoiClient(input = {}) {
  const client = validerClient(input);
  if (client.erreur) return client;
  const message = String(input.message || '').trim();
  if (message.length < 5) return { erreur: 'Le message à envoyer est vide ou trop court.' };
  if (message.length > 3500) return { erreur: 'Le message est trop long pour WhatsApp (3 500 caractères au plus).' };
  const prix = validerPrix(input);
  if (prix?.erreur) return prix;
  const produit = String(input.produit || '').trim().slice(0, 120);
  const details = [`À : ${client.nom} (${client.telephone})`];
  if (produit) details.push(`Produit : ${produit}${prix !== null ? ` — ${formaterPrix(prix)}` : ''}`);
  details.push(`Message : ${message}`);
  return {
    resume: `Envoyer un message WhatsApp à ${client.nom} (${client.telephone})`,
    details,
    lien: lienWhatsApp(client.telephone, message),
    client_nom: client.nom,
    client_telephone: client.telephone,
    produit: produit || null,
    prix,
    message
  };
}

export const SCHEMAS_VENTES = [
  {
    name: 'suivre_vente',
    description: "Enregistre une vente à suivre dans « Mes affaires » : client (nom et numéro), produit, prix en FCFA, statut. Avec un identifiant de vente existant, met à jour la vente. N'invente jamais un numéro, un prix ou un statut : demande-les s'ils manquent.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de la vente à mettre à jour (obtenu avec lister_ventes)' },
        client_nom: { type: 'string', description: 'Nom du client, tel que donné par l’utilisateur' },
        client_telephone: { type: 'string', description: 'Numéro WhatsApp du client, ex. 07 07 12 34 56' },
        produit: { type: 'string', description: 'Nom du produit vendu' },
        prix: { type: 'number', description: 'Prix en FCFA (nombre entier, 0 ou plus)' },
        statut: { type: 'string', enum: STATUTS_VENTE, description: 'interesse, reserve, paye ou livre' }
      },
      required: ['client_nom', 'client_telephone', 'produit']
    }
  },
  {
    name: 'lister_ventes',
    description: 'Liste les ventes suivies, avec leur statut (intéressé, réservé, payé, livré) et si un message a déjà été envoyé au client.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'changer_statut_vente',
    description: "Change le statut d'une vente suivie (intéressé, réservé, payé, livré) à partir de son identifiant.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de la vente (obtenu avec lister_ventes)' },
        statut: { type: 'string', enum: STATUTS_VENTE }
      },
      required: ['id', 'statut']
    }
  },
  {
    name: 'proposer_envoi_client',
    description: "Propose d'envoyer un message WhatsApp à un client. Ne l'envoie PAS : l'utilisateur doit d'abord valider la carte (message exact + destinataire) dans l'app. Après validation, le lien WhatsApp s'ouvre avec le message déjà rempli, depuis le WhatsApp du vendeur. Ne l'utilise que si le nom et le numéro du client sont connus.",
    input_schema: {
      type: 'object',
      properties: {
        client_nom: { type: 'string', description: 'Nom du client, tel que donné par l’utilisateur' },
        client_telephone: { type: 'string', description: 'Numéro WhatsApp du client, ex. 07 07 12 34 56' },
        message: { type: 'string', description: 'Message exact à envoyer, en français' },
        produit: { type: 'string', description: 'Produit concerné, si la vente est déjà suivie' },
        prix: { type: 'number', description: 'Prix en FCFA (nombre entier, 0 ou plus)' },
        vente_id: { type: 'string', description: 'Identifiant de la vente suivie, pour marquer le message comme envoyé après validation' }
      },
      required: ['client_nom', 'client_telephone', 'message']
    }
  }
];

function presenter(vente) {
  if (!vente) return null;
  return {
    type: 'vente',
    id: vente.id,
    client_nom: vente.client_nom,
    client_telephone: vente.client_telephone,
    produit: vente.produit,
    prix: vente.prix ?? null,
    statut: vente.statut,
    libelle_statut: LIBELLES_STATUT[vente.statut] || vente.statut,
    envoye: Boolean(vente.envoye),
    envoye_le: vente.envoye_le || null,
    created_at: vente.created_at,
    updated_at: vente.updated_at
  };
}

/** Exécute suivre_vente, lister_ventes et changer_statut_vente. */
export async function executerVente(store, nom, input = {}, maintenant = new Date()) {
  if (nom === 'suivre_vente') {
    const client = validerClient(input);
    if (client.erreur) return client;
    const produit = String(input.produit || '').trim().slice(0, 120);
    if (!produit) return { erreur: 'Indique le produit vendu.' };
    const prix = validerPrix(input);
    if (prix?.erreur) return prix;
    const statut = validerStatut(input);
    if (statut?.erreur) return statut;
    if (input.id) {
      const existante = await store.getVente(String(input.id));
      if (!existante) return { erreur: 'Vente introuvable.' };
      const maj = await store.updateVente(existante.id, { client_nom: client.nom, client_telephone: client.telephone, produit, prix, statut });
      await apresChangementStatut(store, existante, maj, maintenant);
      return presenter(maj);
    }
    const nouvelle = await store.addVente({ client_nom: client.nom, client_telephone: client.telephone, produit, prix, statut });
    if (['interesse', 'reserve'].includes(nouvelle.statut)) {
      await assurerRappelRelance(store, nouvelle, maintenant);
      await assurerRecapMatinal(store, maintenant);
    }
    return presenter(nouvelle);
  }
  if (nom === 'lister_ventes') {
    const ventes = await store.listVentes();
    return { type: 'ventes', ventes: ventes.map(presenter) };
  }
  if (nom === 'changer_statut_vente') {
    const statut = validerStatut(input);
    if (statut?.erreur) return statut;
    const vente = await store.getVente(String(input.id || ''));
    if (!vente) return { erreur: 'Vente introuvable.' };
    const maj = await store.updateVente(vente.id, { statut });
    await apresChangementStatut(store, vente, maj, maintenant);
    return presenter(maj);
  }
  return { erreur: `Outil inconnu : ${nom}` };
}

/**
 * Exécute un envoi client déjà validé par l'utilisateur (action
 * « vendeur_envoyer_message »). Ne fait aucun envoi réseau : il marque la
 * vente comme envoyée (si elle est liée) et renvoie le lien WhatsApp à
 * ouvrir. L'envoi réel a lieu dans le WhatsApp du vendeur.
 */
export async function executerEnvoiValide(store, action, maintenant = new Date()) {
  const input = typeof action?.input === 'string' ? JSON.parse(action.input) : (action?.input || {});
  if (action?.outil !== 'vendeur_envoyer_message') return { erreur: 'Action inconnue : ce n’est pas un envoi client.' };
  const preparation = preparerEnvoiClient(input);
  if (preparation.erreur) return preparation;
  if (input.vente_id) {
    const vente = await store.getVente(String(input.vente_id));
    if (!vente) return { erreur: 'Vente introuvable : impossible de marquer l’envoi.' };
    await store.updateVente(vente.id, { envoye: true, envoye_le: maintenant.toISOString() });
    // Message parti : plus besoin de la relance J+2.
    await annulerRappelsRelance(store, vente.id);
  }
  return {
    url: preparation.lien,
    envoye: true,
    client_nom: preparation.client_nom,
    client_telephone: preparation.client_telephone,
    message: preparation.message,
    ...(input.vente_id ? { vente_id: input.vente_id } : {})
  };
}
