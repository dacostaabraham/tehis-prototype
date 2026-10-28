// Objectifs suivis (item n°2 du backlog REA).
//
// Un objectif = un libellé, une cible chiffrée (FCFA ou nombre), une
// échéance, une progression visible. Le compagnon (et les agents Vendeur,
// Budget, Finance) propose d'en créer un quand l'utilisateur parle d'une
// cible chiffrée ; Tehis propose un check-in hebdomadaire (rappel + point
// dans le journal d'activité) ; la progression est mise à jour à la main,
// ou calculée toute seule depuis les ventes payées et livrées (source
// « ventes ») — jamais de chiffres inventés.
import { formaterPrix } from './ventes.js';

export const UNITES_OBJECTIF = ['FCFA', 'nombre'];
export const STATUTS_OBJECTIF = ['actif', 'atteint', 'abandonne'];
export const LIBELLES_STATUT_OBJECTIF = { actif: 'En cours', atteint: 'Atteint', abandonne: 'Abandonné' };

/** Montant affiché : « 25 000 FCFA » ou « 20 » selon l'unité. */
export function formaterMontant(valeur, unite) {
  return unite === 'FCFA' ? formaterPrix(valeur) : `${Number(valeur).toLocaleString('fr-FR')}`;
}

/** Prochain check-in hebdomadaire : dans 7 jours à 9 h (heure d'Abidjan, UTC+0). */
export function dateCheckin(maintenant = new Date()) {
  const d = new Date(maintenant);
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(9, 0, 0, 0);
  return d.toISOString();
}

function validerLibelle(input = {}) {
  const libelle = String(input.libelle || '').trim().slice(0, 120);
  if (libelle.length < 3) return { erreur: 'Donne un libellé à ton objectif (3 caractères au moins).' };
  return libelle;
}

function validerCible(input = {}) {
  const cible = Number(input.cible);
  if (!Number.isFinite(cible) || !Number.isInteger(cible) || cible <= 0) return { erreur: 'La cible doit être un nombre entier, plus grand que 0.' };
  return cible;
}

function validerProgression(input = {}) {
  const progression = Number(input.progression);
  if (!Number.isFinite(progression) || !Number.isInteger(progression) || progression < 0) return { erreur: 'La progression doit être un nombre entier, 0 ou plus.' };
  return progression;
}

function validerUnite(input = {}) {
  const unite = String(input.unite || 'FCFA');
  if (!UNITES_OBJECTIF.includes(unite)) return { erreur: `Unité inconnue : ${UNITES_OBJECTIF.join(' ou ')}.` };
  return unite;
}

function validerSource(input = {}) {
  const source = String(input.source || 'manuel');
  if (!['manuel', 'ventes'].includes(source)) return { erreur: "Source inconnue : manuel ou ventes." };
  return source;
}

function validerEcheance(input = {}) {
  if (input.echeance === undefined || input.echeance === null || input.echeance === '') return null;
  const texte = String(input.echeance).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texte);
  if (!m) return { erreur: "L'échéance doit être une date au format AAAA-MM-JJ (ex. 2026-11-30)." };
  const d = new Date(`${texte}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== texte) return { erreur: "Cette date d'échéance n'existe pas." };
  return texte;
}

function presenter(o, progression = null) {
  const prog = progression ?? o.progression ?? 0;
  return {
    type: 'objectif',
    id: o.id,
    libelle: o.libelle,
    cible: o.cible,
    unite: o.unite,
    progression: prog,
    pourcentage: o.cible > 0 ? Math.min(100, Math.round((prog / o.cible) * 100)) : 0,
    restant: Math.max(0, o.cible - prog),
    echeance: o.echeance || null,
    statut: o.statut,
    libelle_statut: LIBELLES_STATUT_OBJECTIF[o.statut] || o.statut,
    source: o.source,
    created_at: o.created_at,
    updated_at: o.updated_at
  };
}

/**
 * Progression d'un objectif « ventes » : total des prix des ventes payées
 * ou livrées, enregistrées depuis la création de l'objectif. Les ventes
 * intéressées ou réservées ne comptent pas, ni celles d'avant l'objectif.
 */
export async function progressionVentes(store, objectif) {
  const depuis = new Date(objectif.created_at).getTime();
  const ventes = await store.listVentes();
  return ventes
    .filter((v) => ['paye', 'livre'].includes(v.statut) && new Date(v.created_at).getTime() >= depuis)
    .reduce((total, v) => total + (Number(v.prix) || 0), 0);
}

/** Entrée « objectif atteint » dans le journal d'activité. */
async function journalAtteint(store, o, progression) {
  return store.addAction({
    outil: 'objectif_atteint',
    input: { objectif_id: o.id },
    resume: `🎉 Objectif atteint : ${o.libelle} (${formaterMontant(progression, o.unite)} sur ${formaterMontant(o.cible, o.unite)})`,
    statut: 'executee',
    resultat: { objectif_id: o.id, libelle: o.libelle, progression, cible: o.cible, unite: o.unite }
  });
}

/**
 * Liste présentée, avec la progression à jour : pour un objectif « ventes »,
 * elle est recalculée depuis les ventes réelles ; s'il vient de franchir sa
 * cible, il passe à « atteint » (une seule fois) et l'événement est noté
 * dans le journal d'activité.
 */
export async function synchroniserObjectifs(store) {
  const objectifs = await store.listObjectifs();
  const presentes = [];
  for (const o of objectifs) {
    let progression = o.progression ?? 0;
    if (o.source === 'ventes') progression = await progressionVentes(store, o);
    if (o.source === 'ventes' && o.statut === 'actif' && progression >= o.cible) {
      await store.updateObjectif(o.id, { statut: 'atteint' });
      await journalAtteint(store, o, progression);
      await store.supprimerRappelsAction('checkin_objectif', o.id);
      o.statut = 'atteint';
    }
    presentes.push(presenter(o, progression));
  }
  return presentes;
}

/**
 * Programme le check-in hebdomadaire d'un objectif (un seul : pas de
 * doublon s'il existe déjà). Le rappel devient une tâche planifiée : à
 * l'heure dite, Tehis fait le point dans le journal d'activité et envoie
 * une notification qui y renvoie.
 */
export async function assurerCheckinObjectif(store, objectif, maintenant = new Date()) {
  const existants = (await store.listReminders({ aVenir: true })).filter((r) => !r.envoye && r.type_action === 'checkin_objectif' && r.action_input?.objectif_id === objectif.id);
  if (existants.length) return existants[0];
  return store.addReminder({
    texte: `Check-in objectif : ${objectif.libelle}`,
    quand: dateCheckin(maintenant), repetition: 'hebdomadaire',
    type_action: 'checkin_objectif', action_input: { objectif_id: objectif.id }
  });
}

/** Annule les check-ins hebdomadaires en attente d'un objectif (clôturé ou supprimé). */
export async function annulerCheckinsObjectif(store, objectifId) { return store.supprimerRappelsAction('checkin_objectif', objectifId); }

/**
 * Prépare le check-in hebdomadaire d'un objectif : un point dans le journal
 * d'activité (progression, reste, échéance), sans rien à valider — c'est une
 * information, l'utilisateur met ensuite sa progression à jour dans
 * « Mes affaires » › Objectifs. Retourne { action } ou { ignore }.
 */
export async function preparerCheckinObjectif(store, rappel) {
  const objectifId = rappel.action_input?.objectif_id;
  const objectif = objectifId ? await store.getObjectif(objectifId) : null;
  if (!objectif) return { ignore: true, raison: 'objectif introuvable' };
  if (objectif.statut !== 'actif') return { ignore: true, raison: `objectif ${objectif.statut}` };
  const presentes = await synchroniserObjectifs(store);
  const presente = presentes.find((o) => o.id === objectif.id);
  if (!presente) return { ignore: true, raison: 'objectif introuvable' };
  if (presente.statut === 'atteint') return { ignore: true, raison: 'objectif atteint entre-temps' };
  const action = await store.addAction({
    outil: 'checkin_objectif',
    input: { objectif_id: objectif.id },
    resume: `Point sur ton objectif : ${objectif.libelle} — ${formaterMontant(presente.progression, objectif.unite)} sur ${formaterMontant(objectif.cible, objectif.unite)} (${presente.pourcentage} %)`,
    statut: 'executee',
    resultat: { objectif: presente }
  });
  return { action };
}

export const SCHEMAS_OBJECTIFS = [
  {
    name: 'creer_objectif',
    description: "Crée un objectif suivi : libellé, cible chiffrée, échéance. À utiliser quand l'utilisateur parle d'une cible à atteindre (ventes, épargne, tontine, clients…). Pour un objectif de ventes, mets source à « ventes » : la progression se calcule toute seule depuis ses ventes payées et livrées. Sinon la progression se met à jour à la main. Tehis proposera un point chaque semaine.",
    input_schema: {
      type: 'object',
      properties: {
        libelle: { type: 'string', description: 'Ce qu’il faut atteindre, ex. « 50 000 FCFA de ventes en novembre », « Épargner pour la tontine »' },
        cible: { type: 'number', description: 'La cible à atteindre, nombre entier plus grand que 0 (ex. 50000)' },
        unite: { type: 'string', enum: UNITES_OBJECTIF, description: 'FCFA pour un montant, nombre pour un comptage (clients, ventes…)' },
        echeance: { type: 'string', description: 'Date limite au format AAAA-MM-JJ (ex. 2026-11-30), si l’utilisateur en donne une' },
        source: { type: 'string', enum: ['manuel', 'ventes'], description: '« ventes » : progression calculée depuis les ventes payées et livrées ; « manuel » : progression mise à jour à la main' }
      },
      required: ['libelle', 'cible']
    }
  },
  {
    name: 'lister_objectifs',
    description: 'Liste les objectifs suivis, avec leur progression, leur pourcentage et leur échéance.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'maj_progression_objectif',
    description: "Met à jour la progression d'un objectif (manuel) : donne la progression totale à ce jour, pas ce qu'il faut ajouter. Ex. pour « 50 000 FCFA de ventes en novembre » à 18 000 FCFA, progression = 18000. L'objectif passe à « atteint » tout seul quand la cible est franchie.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de l’objectif (obtenu avec lister_objectifs)' },
        progression: { type: 'number', description: 'La progression totale à ce jour (nombre entier, 0 ou plus)' }
      },
      required: ['id', 'progression']
    }
  },
  {
    name: 'cloturer_objectif',
    description: "Clôture un objectif : « atteint » quand la cible est réalisée, « abandonne » quand l'utilisateur arrête. Le check-in hebdomadaire s'arrête.",
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant de l’objectif (obtenu avec lister_objectifs)' },
        statut: { type: 'string', enum: ['atteint', 'abandonne'] }
      },
      required: ['id', 'statut']
    }
  }
];

/** Exécute creer_objectif, lister_objectifs, maj_progression_objectif et cloturer_objectif. */
export async function executerObjectif(store, nom, input = {}, maintenant = new Date()) {
  if (nom === 'creer_objectif') {
    const libelle = validerLibelle(input);
    if (libelle.erreur) return libelle;
    const cible = validerCible(input);
    if (cible.erreur) return cible;
    const unite = validerUnite(input);
    if (unite.erreur) return unite;
    const echeance = validerEcheance(input);
    if (echeance?.erreur) return echeance;
    const source = validerSource(input);
    if (source.erreur) return source;
    const objectif = await store.addObjectif({ libelle, cible, unite, echeance, source });
    const checkin = await assurerCheckinObjectif(store, objectif, maintenant);
    return { ...presenter(objectif), prochain_checkin: checkin.quand };
  }
  if (nom === 'lister_objectifs') {
    const objectifs = await synchroniserObjectifs(store);
    return { type: 'objectifs', objectifs };
  }
  if (nom === 'maj_progression_objectif') {
    const objectif = await store.getObjectif(String(input.id || ''));
    if (!objectif) return { erreur: 'Objectif introuvable.' };
    if (objectif.statut !== 'actif') return { erreur: `Cet objectif est ${LIBELLES_STATUT_OBJECTIF[objectif.statut].toLowerCase()} : sa progression ne bouge plus.` };
    if (objectif.source === 'ventes') return { erreur: 'Cet objectif se met à jour tout seul depuis tes ventes payées et livrées : pas de saisie manuelle.' };
    const progression = validerProgression(input);
    if (progression.erreur) return progression;
    const maj = await store.updateObjectif(objectif.id, { progression });
    if (progression >= objectif.cible) {
      await store.updateObjectif(objectif.id, { statut: 'atteint' });
      await journalAtteint(store, maj, progression);
      await annulerCheckinsObjectif(store, objectif.id);
      maj.statut = 'atteint';
    }
    return presenter(maj, progression);
  }
  if (nom === 'cloturer_objectif') {
    const objectif = await store.getObjectif(String(input.id || ''));
    if (!objectif) return { erreur: 'Objectif introuvable.' };
    const statut = String(input.statut || '');
    if (!['atteint', 'abandonne'].includes(statut)) return { erreur: 'Statut inconnu : atteint ou abandonne.' };
    if (objectif.statut !== 'actif') return { erreur: `Cet objectif est déjà ${LIBELLES_STATUT_OBJECTIF[objectif.statut].toLowerCase()}.` };
    const maj = await store.updateObjectif(objectif.id, { statut });
    if (statut === 'atteint') {
      const presentes = await synchroniserObjectifs(store);
      const presente = presentes.find((o) => o.id === objectif.id);
      await journalAtteint(store, maj, presente?.progression ?? maj.progression ?? 0);
    }
    await annulerCheckinsObjectif(store, objectif.id);
    return presenter(maj);
  }
  return { erreur: `Outil inconnu : ${nom}` };
}
