// Outils de l'agent « Organisation et rappels » : rappels datés et listes.
import { randomUUID } from 'node:crypto';
import { nomListe } from '../store.js';

// Abidjan est en UTC+0 toute l'année : une heure sans fuseau est lue comme heure d'Abidjan.
export function lireDate(v) {
  if (typeof v !== 'string' || !v.trim()) return null;
  const s = v.trim();
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length === 10 ? `${s}T09:00` : s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function prochaineOccurrence(quand, repetition) {
  const d = new Date(quand);
  if (repetition === 'quotidien') d.setUTCDate(d.getUTCDate() + 1);
  else if (repetition === 'hebdomadaire') d.setUTCDate(d.getUTCDate() + 7);
  else if (repetition === 'mensuel') d.setUTCMonth(d.getUTCMonth() + 1);
  else return null;
  return d.toISOString();
}

export const SCHEMAS_ORGANISATION = [
  {
    name: 'creer_rappel',
    description: "Programme un rappel : l'utilisateur reçoit une notification à l'heure dite (si les notifications sont activées) et le rappel apparaît dans « Mes affaires ». Calcule la date à partir de la date et l'heure actuelles données dans le contexte. Sans heure précisée, utilise 09:00.",
    input_schema: {
      type: 'object',
      properties: {
        texte: { type: 'string', description: 'Ce qu\'il faut rappeler, court et clair (ex. « Payer le loyer »)' },
        quand: { type: 'string', description: 'Date et heure à Abidjan au format AAAA-MM-JJTHH:MM (ex. 2026-10-05T09:00)' },
        repetition: { type: 'string', enum: ['aucune', 'quotidien', 'hebdomadaire', 'mensuel'] }
      },
      required: ['texte', 'quand']
    }
  },
  {
    name: 'lister_rappels',
    description: 'Liste les rappels à venir de l\'utilisateur.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'supprimer_rappel',
    description: 'Supprime un rappel à partir de son identifiant (obtenu avec lister_rappels).',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }
  },
  {
    name: 'gerer_liste',
    description: "Crée ou modifie une liste (courses, tâches, invités…) : ajoute des éléments, en retire, en coche. La liste est créée si elle n'existe pas. Renvoie la liste à jour.",
    input_schema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom de la liste, ex. « Courses », « Tâches de la semaine »' },
        ajouter: { type: 'array', items: { type: 'string' } },
        retirer: { type: 'array', items: { type: 'string' }, description: 'Textes des éléments à retirer' },
        cocher: { type: 'array', items: { type: 'string' }, description: 'Textes des éléments faits' }
      },
      required: ['nom']
    }
  },
  {
    name: 'lister_listes',
    description: 'Renvoie toutes les listes de l\'utilisateur avec leurs éléments.',
    input_schema: { type: 'object', properties: {} }
  }
];

const meme = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function executerOrganisation(store, nom, input = {}, maintenant = new Date()) {
  if (nom === 'creer_rappel') {
    const texte = String(input.texte || '').trim().slice(0, 200);
    const d = lireDate(input.quand);
    if (!texte) return { erreur: 'Le texte du rappel est vide.' };
    if (!d) return { erreur: `Date illisible : ${input.quand}. Format attendu : AAAA-MM-JJTHH:MM.` };
    if (d.getTime() < maintenant.getTime() - 60_000) return { erreur: 'Cette date est déjà passée. Demande une date future.' };
    const repetition = ['quotidien', 'hebdomadaire', 'mensuel'].includes(input.repetition) ? input.repetition : 'aucune';
    const r = await store.addReminder({ texte, quand: d.toISOString(), repetition });
    return { type: 'rappel', id: r.id, texte, quand: r.quand, repetition };
  }
  if (nom === 'lister_rappels') {
    const liste = await store.listReminders({ aVenir: true });
    return { type: 'rappels', rappels: liste.map(({ id, texte, quand, repetition }) => ({ id, texte, quand, repetition })) };
  }
  if (nom === 'supprimer_rappel') {
    const ok = await store.deleteReminder(String(input.id || ''));
    return ok ? { supprime: true } : { erreur: 'Rappel introuvable.' };
  }
  if (nom === 'gerer_liste') {
    const titre = String(input.nom || '').trim().slice(0, 60);
    if (!titre) return { erreur: 'Donne un nom à la liste.' };
    const liste = (await store.getList(titre)) || { id: randomUUID(), nom: nomListe(titre), titre, items: [] };
    for (const t of (input.ajouter || []).map(String).filter((x) => x.trim()).slice(0, 50)) {
      if (!liste.items.some((it) => meme(it.texte, t))) liste.items.push({ id: randomUUID(), texte: t.trim().slice(0, 120), fait: false });
    }
    for (const t of (input.retirer || []).map(String)) liste.items = liste.items.filter((it) => !meme(it.texte, t));
    for (const t of (input.cocher || []).map(String)) liste.items.forEach((it) => { if (meme(it.texte, t)) it.fait = true; });
    if (liste.items.length > 200) return { erreur: 'Une liste ne peut pas dépasser 200 éléments.' };
    await store.saveList(liste);
    return { type: 'liste', id: liste.id, titre: liste.titre, items: liste.items };
  }
  if (nom === 'lister_listes') {
    const listes = await store.listLists();
    return { type: 'listes', listes: listes.map((l) => ({ id: l.id, titre: l.titre, items: l.items })) };
  }
  return { erreur: `Outil inconnu : ${nom}` };
}
