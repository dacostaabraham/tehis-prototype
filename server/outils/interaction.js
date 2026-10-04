// Outil « poser_choix » : affiche 2 à 5 boutons de réponse rapide sous le message de l'agent.
// Sert aux questions de clarification, aux quiz du répétiteur, aux options d'un plan, etc.

export const SCHEMA_CHOIX = {
  name: 'poser_choix',
  description: "Affiche des boutons de réponse rapide sous ton message, pour que l'utilisateur réponde d'un toucher au lieu d'écrire. À utiliser pour toute question à réponses courtes et prévisibles (budget, quartier, niveau scolaire, oui/non, choix entre options, quiz). Pose la question dans ton texte, puis appelle cet outil en dernier. Un bouton « Autre… » permet toujours d'écrire librement.",
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Question courte, rappelée au-dessus des boutons' },
      options: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 5, description: 'Réponses possibles, 1 à 6 mots chacune' },
      multiple: { type: 'boolean', description: 'Vrai si plusieurs réponses peuvent être cochées' }
    },
    required: ['question', 'options']
  }
};

export function preparerChoix(input = {}) {
  const question = String(input.question || '').trim().slice(0, 160);
  const options = (Array.isArray(input.options) ? input.options : []).map((o) => String(o).trim().slice(0, 60)).filter(Boolean);
  const uniques = [...new Set(options)].slice(0, 5);
  if (!question || uniques.length < 2) return { erreur: 'Il faut une question et au moins 2 options.' };
  return { type: 'choix', question, options: uniques, multiple: input.multiple === true };
}
