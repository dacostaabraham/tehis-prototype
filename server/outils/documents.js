// Outils « creer_document » / « modifier_document » / « lister_documents » :
// un texte prêt à copier, partager ou télécharger en PDF. Chaque création
// ou réécriture conserve l'ancien contenu dans l'historique des versions :
// rien n'est jamais écrasé, la restauration crée une nouvelle version.
// Le partage par lien est en lecture seule, avec un jeton non devinable.

export const TYPES_DOCUMENTS = {
  lettre: 'Lettre', courrier: 'Courrier', message: 'Message', cv: 'CV', motivation: 'Lettre de motivation',
  fiche_produit: 'Fiche produit', post: 'Publication', fiche_revision: 'Fiche de révision', planning: 'Planning', autre: 'Document'
};

const MAX_CONTENU = 20000;

function validerContenu(contenu) {
  const texte = String(contenu || '').trim();
  if (texte.length < 5) return { erreur: 'Le document est vide.' };
  if (texte.length > MAX_CONTENU) return { erreur: 'Le document est trop long (20 000 caractères au plus).' };
  return texte;
}

/** Entrée dans le journal d'activité (visible dans « Mes affaires » › Activité). */
async function journal(store, outil, input, resume, resultat = null) {
  return store.addAction({ outil, input, resume, statut: 'executee', resultat });
}

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

export const SCHEMA_MODIFIER_DOCUMENT = {
  name: 'modifier_document',
  description: "Réécrit un document existant (lettre, CV, fiche produit…) : le contenu actuel est conservé dans l'historique des versions et la nouvelle version devient la version courante. À utiliser quand l'utilisateur demande de modifier, corriger ou mettre à jour un document déjà créé — jamais pour un document nouveau (utilise creer_document). L'identifiant du document s'obtient avec lister_documents.",
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Identifiant du document à modifier (obtenu avec lister_documents)' },
      titre: { type: 'string', description: 'Nouveau titre (facultatif : garde le titre actuel sinon)' },
      contenu: { type: 'string', description: 'Texte complet du document, en Markdown simple' }
    },
    required: ['id', 'contenu']
  }
};

export const SCHEMA_LISTER_DOCUMENTS = {
  name: 'lister_documents',
  description: "Liste les documents enregistrés (identifiant, type, titre, date) pour retrouver celui que l'utilisateur veut modifier ou partager. Ne renvoie pas le contenu complet.",
  input_schema: { type: 'object', properties: {} }
};

export async function creerDocument(store, input, agent) {
  const type = TYPES_DOCUMENTS[input?.type] ? input.type : 'autre';
  const titre = String(input?.titre || TYPES_DOCUMENTS[type]).trim().slice(0, 120);
  const contenu = validerContenu(input?.contenu);
  if (contenu.erreur) return contenu;
  const doc = await store.addDocument({ type, titre, contenu, agent });
  await store.addDocumentVersion({ document_id: doc.id, titre, contenu, origine: 'agent' });
  await journal(store, 'document_cree', { document_id: doc.id }, `📄 Document créé : ${titre}`, { document_id: doc.id, titre });
  return { type: 'document', id: doc.id, typeDocument: type, libelleType: TYPES_DOCUMENTS[type], titre, contenu, numero: 1, enregistre: true };
}

export async function listerDocuments(store) {
  const docs = await store.listDocuments();
  return { type: 'documents', documents: docs.map((d) => ({ id: d.id, type: d.type, titre: d.titre, agent: d.agent || null, created_at: d.created_at })) };
}

export async function modifierDocument(store, input, agent) {
  const doc = await store.getDocument(String(input?.id || ''));
  if (!doc) return { erreur: 'Document introuvable.' };
  const contenu = validerContenu(input?.contenu);
  if (contenu.erreur) return contenu;
  const titre = String(input?.titre || doc.titre).trim().slice(0, 120) || doc.titre;
  if (contenu === doc.contenu && titre === doc.titre) {
    return { type: 'document', id: doc.id, typeDocument: doc.type, libelleType: TYPES_DOCUMENTS[doc.type] || 'Document', titre: doc.titre, contenu: doc.contenu, inchange: true, enregistre: true };
  }
  const version = await store.addDocumentVersion({ document_id: doc.id, titre, contenu, origine: 'agent' });
  await store.updateDocument(doc.id, { titre, contenu });
  await journal(store, 'document_modifie', { document_id: doc.id }, `✏️ Document modifié : ${titre} (version ${version.numero})`, { document_id: doc.id, titre, numero: version.numero });
  return { type: 'document', id: doc.id, typeDocument: doc.type, libelleType: TYPES_DOCUMENTS[doc.type] || 'Document', titre, contenu, numero: version.numero, enregistre: true };
}

/**
 * Restaure une ancienne version : elle devient la version courante en
 * créant une nouvelle version (la version remplacée reste dans l'historique).
 */
export async function restaurerVersion(store, documentId, numero) {
  const version = await store.getDocumentVersion(documentId, Number(numero));
  if (!version) return { erreur: 'Version introuvable.' };
  const doc = await store.getDocument(documentId);
  if (!doc) return { erreur: 'Document introuvable.' };
  const nouvelle = await store.addDocumentVersion({ document_id: doc.id, titre: version.titre, contenu: version.contenu, origine: 'utilisateur' });
  await store.updateDocument(doc.id, { titre: version.titre, contenu: version.contenu });
  await journal(store, 'document_restaure', { document_id: doc.id }, `↩️ Version ${version.numero} restaurée : ${version.titre} (nouvelle version ${nouvelle.numero})`, { document_id: doc.id, titre: version.titre, numero: nouvelle.numero, restauree: version.numero });
  return { type: 'document', id: doc.id, typeDocument: doc.type, libelleType: TYPES_DOCUMENTS[doc.type] || 'Document', titre: version.titre, contenu: version.contenu, numero: nouvelle.numero, restauree: version.numero, enregistre: true };
}

/** Lien de partage (lecture seule) d'un document : un seul lien actif par document, réutilisé s'il existe déjà. */
export async function partagerDocument(store, documentId, baseUrl = '') {
  const doc = await store.getDocument(documentId);
  if (!doc) return { erreur: 'Document introuvable.' };
  const existant = await store.getPartage(documentId);
  if (existant) return { url: `${baseUrl}/partage/${existant.jeton}`, jeton: existant.jeton, titre: doc.titre, nouveau: false };
  const p = await store.creerPartage(documentId);
  await journal(store, 'document_partage', { document_id: doc.id }, `🔗 Lien de partage créé : ${doc.titre}`, { document_id: doc.id, titre: doc.titre });
  return { url: `${baseUrl}/partage/${p.jeton}`, jeton: p.jeton, titre: doc.titre, nouveau: true };
}

/** Révoque le lien de partage d'un document : le lien ne donne plus accès à rien. */
export async function revoquerPartageDocument(store, documentId) {
  const doc = await store.getDocument(documentId);
  if (!doc) return { erreur: 'Document introuvable.' };
  const p = await store.revoquerPartage(documentId);
  if (!p) return { erreur: 'Aucun lien de partage actif pour ce document.' };
  await journal(store, 'document_partage_revoque', { document_id: doc.id }, `🔒 Lien de partage révoqué : ${doc.titre}`, { document_id: doc.id, titre: doc.titre });
  return { ok: true };
}
