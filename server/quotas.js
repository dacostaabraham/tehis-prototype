// Quotas quotidiens par compte : messages, recherches web, choix du modèle selon l'offre.
import { QUOTAS } from '../public/shared/agents.js';

export const jourAbidjan = (d = new Date()) => d.toISOString().slice(0, 10); // Abidjan = UTC

export function quotaDe(compte) {
  if (compte?.role === 'admin') return { messages: Infinity, recherches: Infinity, modeleFort: true };
  return QUOTAS[compte?.offre] || QUOTAS.gratuit;
}

/** Modèle à utiliser : l'offre Gratuit passe tout par le modèle léger. */
export function choisirModele({ modeleAgent, compte, fort, leger }) {
  return modeleAgent === 'fort' && quotaDe(compte).modeleFort ? fort : leger;
}

/** État du jour pour l'app : utilisés, maximum, restants (null = illimité). */
export async function etatQuota(storeCompte, compte, jour = jourAbidjan()) {
  const q = quotaDe(compte);
  const messages = await storeCompte.getUsage(jour, 'messages');
  const recherches = await storeCompte.getUsage(jour, 'recherches');
  const fini = (n) => (Number.isFinite(n) ? n : null);
  return {
    messages: { utilises: messages, max: fini(q.messages), restants: Number.isFinite(q.messages) ? Math.max(0, q.messages - messages) : null },
    recherches: { utilises: recherches, max: fini(q.recherches), restants: Number.isFinite(q.recherches) ? Math.max(0, q.recherches - recherches) : null }
  };
}
