// Outil « creer_document » : un texte prêt à copier, partager ou télécharger en PDF.
export const TYPES_DOCUMENTS = {
  lettre: 'Lettre', courrier: 'Courrier', message: 'Message', cv: 'CV', motivation: 'Lettre de motivation',
  fiche_produit: 'Fiche produit', post: 'Publication', fiche_revision: 'Fiche de révision', planning: 'Planning', autre: 'Document'
};

export const SCHEMA_DOCUMENT = {
  name: 'creer_document',
  description: "Enregistre un texte finalisé (lettre, CV, fiche produit, publication, fiche de révision…) et l'affiche dans une carte avec les boutons Copier, Partager sur WhatsApp et Télécharger en PDF. À utiliser pour tout texte que l'utilisateur va réutiliser ou envoyer, une fois les informations nécessaires réunies. Ne répète pas le texte complet dans ta réponse : la carte l'affiche.",
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: Object.keys(TYPES_DOCUMENTS) },
      titre: { type: 'string', description: 'Titre court du document' },
      contenu: { type: 'string', description: 'Texte complet en Markdown simple (titres #, listes -, **gras**). Aucun crochet à remplir sauf si une information manque vraiment.' }
    },
    required: ['type', 'titre', 'contenu']
  }
};

export async function creerDocument(store, input, agent) {
  const type = TYPES_DOCUMENTS[input?.type] ? input.type : 'autre';
  const titre = String(input?.titre || TYPES_DOCUMENTS[type]).trim().slice(0, 120);
  const contenu = String(input?.contenu || '').trim();
  if (contenu.length < 5) return { erreur: 'Le document est vide.' };
  if (contenu.length > 20000) return { erreur: 'Le document est trop long (20 000 caractères au plus).' };
  const doc = await store.addDocument({ type, titre, contenu, agent });
  return { type: 'document', id: doc.id, typeDocument: type, libelleType: TYPES_DOCUMENTS[type], titre, contenu, enregistre: true };
}
