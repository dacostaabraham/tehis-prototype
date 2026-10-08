// Catalogue des agents de Tehis, partagé par le serveur (accès, modèle) et l'app (affichage).
// offre : offre minimale pour l'utiliser. modele : 'leger' (rapide, économique) ou 'fort'.

export const OFFRES = ['gratuit', 'plus', 'pro'];
export const NOMS_OFFRES = { gratuit: 'Gratuit', plus: 'Plus', pro: 'Pro Entrepreneur' };

// Quotas par jour et par compte, tous agents confondus (les agents perso ont en plus leur propre limite).
// modeleFort : les agents marqués « fort » utilisent le modèle fort ; sinon tout passe par le modèle léger.
export const QUOTAS = {
  gratuit: { messages: 20, recherches: 2, modeleFort: false },
  plus: { messages: 100, recherches: 10, modeleFort: true },
  pro: { messages: 300, recherches: 40, modeleFort: true }
};

// Prix mensuels affichés dans l'app (le montant payé est celui du produit Chariow : garder les deux identiques).
export const PRIX = { gratuit: 0, plus: 2500, pro: 10000 };

export const GROUPES = [
  { id: 'base', nom: 'Ton compagnon' },
  { id: 'travail', nom: 'Travail et argent' },
  { id: 'quotidien', nom: 'Vie quotidienne' },
  { id: 'dev', nom: 'Développeur' }
];

export const AGENTS = {
  compagnon: {
    nom: 'Compagnon', icone: '🐾', groupe: 'base', offre: 'gratuit', modele: 'leger',
    resume: 'Discuter, réfléchir, te guider vers le bon agent',
    suggestions: ['Présente-toi', "J'ai une idée de business", 'Quels agents peux-tu me proposer ?']
  },
  vendeur: {
    nom: 'Vendeur en ligne', icone: '🛍️', groupe: 'travail', offre: 'plus', modele: 'leger',
    resume: 'Fiches produits, légendes, réponses aux clients, relances',
    intro: "Je t'aide à vendre sur WhatsApp, Facebook, TikTok ou Instagram : fiches produits, légendes, réponses aux clients et relances. Envoie-moi la photo d'un produit pour commencer.",
    suggestions: ['Écris la fiche de mon produit', 'Un client trouve que c\'est trop cher', 'Légende TikTok pour une promo', 'Relance un client qui ne répond plus']
  },
  redaction: {
    nom: 'Rédaction et courriers', icone: '✍️', groupe: 'travail', offre: 'gratuit', modele: 'leger',
    resume: 'Lettres, demandes, réclamations, messages, posts',
    intro: 'Dis-moi ce que tu veux écrire et à qui : lettre officielle, demande, réclamation, message pro, post. Je te propose un texte prêt à envoyer, que tu peux copier ou télécharger.',
    suggestions: ['Lettre de demande de congé', 'Réclamation à mon fournisseur', 'Corrige mon texte', 'Message de remerciement à un client']
  },
  emploi: {
    nom: 'Emploi et CV', icone: '💼', groupe: 'travail', offre: 'plus', modele: 'leger',
    resume: 'CV, lettre de motivation, préparation d\'entretien',
    intro: "Je t'aide à décrocher un emploi ou un stage : CV, lettre de motivation adaptée à l'offre, et entraînement à l'entretien. Colle-moi l'offre ou parle-moi de ton parcours.",
    suggestions: ['Fais mon CV', 'Lettre de motivation pour cette offre', "Entraîne-moi pour un entretien", 'Comment présenter un trou dans mon CV ?']
  },
  budget: {
    nom: 'Budget et tontine', icone: '🪙', groupe: 'travail', offre: 'plus', modele: 'leger',
    resume: 'Budget du mois, épargne, tontine, dépenses de la famille',
    intro: "Je t'aide à tenir ton budget, à épargner pour un projet et à comprendre ta tontine. Tous mes calculs sont exacts. Donne-moi tes revenus et tes dépenses du mois.",
    suggestions: ['Fais mon budget du mois', 'Combien de temps pour économiser 300 000 FCFA ?', 'Analyse ma tontine', 'Comment réduire mes dépenses ?']
  },
  finance: {
    nom: 'Finance entreprise', icone: '📈', groupe: 'travail', offre: 'pro', modele: 'fort',
    resume: 'Point mort, prix, prévisionnel, trésorerie (Module 5)',
    intro: "Je suis l'agent financier. Je t'aide à comprendre tes marges, ton point mort, ta trésorerie et à fixer tes prix, avec des calculs exacts. Donne-moi tes chiffres en FCFA.",
    suggestions: ['Calcule mon point mort', 'Aide-moi à fixer mon prix', 'Fais mon prévisionnel sur 12 mois', "C'est quoi le BFR ?"]
  },
  demarches: {
    nom: 'Démarches administratives', icone: '🏛️', groupe: 'quotidien', offre: 'plus', modele: 'fort', recherche: true,
    resume: 'CNI, passeport, entreprise, impôts : étapes et pièces',
    intro: "Je t'explique les démarches en Côte d'Ivoire : étapes, pièces à fournir, coûts et délais. Je vérifie sur internet et je te donne mes sources, car les règles changent souvent.",
    suggestions: ['Comment créer mon entreprise ?', 'Refaire ma carte d\'identité', 'Demander un passeport', 'Déclarer mes impôts de petite entreprise']
,
    actions: [{ categorie: 'mairie', libelle: 'Mairies' }, { categorie: 'police', libelle: 'Commissariats' }, { categorie: 'poste', libelle: 'Poste' }, { categorie: 'banque', libelle: 'Banques' }]
  },
  repetiteur: {
    nom: 'Répétiteur scolaire', icone: '📚', groupe: 'quotidien', offre: 'gratuit', modele: 'fort',
    resume: 'Devoirs et révisions BEPC, BAC, BTS, pas à pas',
    intro: "Je t'aide à comprendre tes cours et à réviser, du collège au BTS. Envoie-moi la photo d'un exercice : on le résout ensemble, étape par étape.",
    suggestions: ['Explique-moi les fractions', 'Aide-moi sur cet exercice', 'Fais-moi réviser pour le BAC', 'Prépare une fiche de révision']
  },
  organisation: {
    nom: 'Organisation et rappels', icone: '🗓️', groupe: 'quotidien', offre: 'gratuit', modele: 'leger',
    resume: 'Rappels, listes, planning de la semaine',
    intro: 'Je note tes rappels, tes listes de courses ou de tâches, et je t\'aide à organiser ta semaine. Exemple : « Rappelle-moi de payer le loyer le 5 à 9 h ».',
    suggestions: ['Rappelle-moi demain à 8 h', 'Ma liste de courses', 'Organise ma semaine', 'Qu\'est-ce que j\'ai de prévu ?']
  },
  sante: {
    nom: 'Santé au quotidien', icone: '🩺', groupe: 'quotidien', offre: 'gratuit', modele: 'fort', recherche: true,
    resume: 'Infos santé pratiques, pharmacies, quand consulter',
    intro: "Je te donne des infos santé pratiques pour la vie de tous les jours : que faire en cas de fièvre, où trouver une pharmacie de garde, quand aller au centre de santé. Je ne fais pas de diagnostic, je t'oriente vers un pro.",
    suggestions: ['Pharmacie de garde près de moi ce soir', 'Que faire en cas de fièvre chez un enfant ?', 'Quand faut-il aller au centre de santé ?', 'Rappelle-moi de prendre mon traitement à 8 h'],
    actions: [{ categorie: 'pharmacie', garde: true, libelle: '🌙 De garde' }, { categorie: 'pharmacie', libelle: 'Pharmacies' }, { categorie: 'centre_sante', libelle: 'Centres de santé' }, { categorie: 'hopital', libelle: 'Hôpitaux' }, { categorie: 'laboratoire', libelle: 'Laboratoires' }]
  },
  logement: {
    nom: 'Logement et déménagement', icone: '🏠', groupe: 'quotidien', offre: 'plus', modele: 'leger',
    resume: 'Recherche, visite, bail, caution, déménagement à Abidjan',
    intro: "Je t'aide à trouver un logement à Abidjan sans te faire avoir : où chercher, que vérifier en visite, bail et caution, et organisation du déménagement.",
    suggestions: ['Checklist pour visiter un studio à Cocody', 'Que vérifier avant de payer la caution ?', 'Modèle de reçu de caution', 'Organise mon déménagement']
,
    actions: [{ categorie: 'marche', libelle: 'Marchés' }, { categorie: 'ecole', libelle: 'Écoles' }, { categorie: 'pharmacie', libelle: 'Pharmacies' }, { categorie: 'supermarche', libelle: 'Supermarchés' }, { categorie: 'transfert_argent', libelle: 'Transfert d\'argent' }]
  },
  dev: {
    nom: 'Mode développeur', icone: '⌨️', groupe: 'dev', offre: 'pro', modele: 'fort', developpeur: true,
    resume: 'Code, GitHub et déploiement Render, avec ta validation',
    intro: 'Mode développeur. Je conçois et j\'écris le code, je l\'envoie sur ton GitHub et je déploie sur Render. Chaque envoi ou déploiement attend ta validation. Décris ce que tu veux construire.',
    suggestions: ['Liste mes dépôts GitHub', 'Crée une API Node pour mes commandes', 'Déploie mon dépôt sur Render', 'Où en est mon dernier déploiement ?']
  }
};

export function offreSuffit(offreUtilisateur, offreRequise) {
  return OFFRES.indexOf(offreUtilisateur || 'gratuit') >= OFFRES.indexOf(offreRequise);
}

/** Dit si l'agent est accessible et, sinon, pourquoi. */
export function accesAgent(id, profil = {}) {
  const a = AGENTS[id];
  if (!a) return { ok: false, raison: 'Agent inconnu.' };
  if (!offreSuffit(profil.offre, a.offre)) return { ok: false, raison: `Disponible avec l'offre ${NOMS_OFFRES[a.offre]}.` };
  if (a.developpeur && !profil.developpeur) return { ok: false, raison: 'Active d\'abord le mode développeur dans les réglages.' };
  return { ok: true };
}

/* ---------- Agents personnalisés (« Crée ton agent ») ---------- */

// Outils que l'utilisateur peut donner à son agent. offre : offre minimale.
export const OUTILS_PERSO = {
  documents: { nom: 'Documents', resume: 'Lettres, fiches, messages prêts à copier, partager ou mettre en PDF', offre: 'gratuit' },
  rappels: { nom: 'Rappels et listes', resume: 'Programmer des rappels, tenir des listes', offre: 'gratuit' },
  lieux: { nom: 'Lieux à proximité', resume: 'Trouver pharmacies, marchés, banques… autour de l\'utilisateur, sur une carte', offre: 'gratuit' },
  budget: { nom: 'Calculs budget', resume: 'Budget du mois, épargne, tontine', offre: 'gratuit' },
  finance: { nom: 'Calculs entreprise', resume: 'Point mort, prix, prévisionnel, BFR', offre: 'plus' },
  recherche_web: { nom: 'Recherche sur internet', resume: 'Vérifier une information récente, avec sources', offre: 'pro' }
};

// Par offre : nombre d'agents, messages par jour (tous agents personnalisés), connaissances autorisées.
export const LIMITES_PERSO = {
  gratuit: { agents: 1, messagesParJour: 20, connaissances: false, modeleFort: false },
  plus: { agents: 3, messagesParJour: 100, connaissances: true, modeleFort: false },
  pro: { agents: 10, messagesParJour: 300, connaissances: true, modeleFort: true }
};

export const TONS_PERSO = {
  chaleureux: 'Chaleureux et encourageant',
  professionnel: 'Professionnel et courtois',
  direct: 'Direct et concis',
  ivoirien: 'Familier, à l\'ivoirienne (sans excès)'
};

export const MAX_CONNAISSANCES = 50_000; // caractères par agent
export const estPerso = (id) => typeof id === 'string' && id.startsWith('perso:');
