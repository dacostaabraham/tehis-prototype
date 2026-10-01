// Mode démo : réponses préparées quand aucune clé ANTHROPIC_API_KEY n'est configurée.
// Chaque agent montre ce qu'il sait faire avec un exemple, sans appeler l'IA.
import { pointMort, fixerPrix, projection12Mois, cascadeRentabilite, estimationBFR, EXEMPLES_COURS } from '../public/shared/finance.js';
import { budgetMensuel, planEpargne, tontine, EXEMPLES_BUDGET } from '../public/shared/budget.js';
import { creerDocument } from './outils/documents.js';
import { executerOrganisation } from './outils/organisation.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const DOCS_DEMO = {
  vendeur: { type: 'fiche_produit', titre: 'Robe en wax « Soleil d\'Assinie »', contenu: '**Robe en wax « Soleil d\'Assinie »** 🌞\n\nCoupe évasée, tissu wax 100 % coton, doublure légère : parfaite pour les mariages et les sorties du dimanche.\n\n- Tailles : S, M, L, XL\n- Prix : 18 000 FCFA\n- Livraison à Abidjan : 1 000 FCFA (24 h)\n- Paiement : Mobile Money ou à la livraison\n\n👉 Écris « JE VEUX » en message privé pour réserver ta taille.\n\n#wax #modeivoirienne #abidjan' },
  redaction: { type: 'lettre', titre: 'Demande de congé', contenu: 'Kouadio Awa\nService comptabilité\n\nÀ l\'attention de M. le Directeur des ressources humaines\n\nAbidjan, le 1er octobre 2026\n\n**Objet : demande de congé annuel**\n\nMonsieur le Directeur,\n\nJ\'ai l\'honneur de solliciter un congé annuel de dix jours ouvrables, du lundi 2 au vendredi 13 novembre 2026 inclus.\n\nLes dossiers en cours seront à jour avant mon départ et Mme Traoré a accepté d\'assurer le suivi des urgences pendant mon absence.\n\nDans l\'attente de votre réponse, je vous prie d\'agréer, Monsieur le Directeur, l\'expression de mes salutations distinguées.\n\nKouadio Awa' },
  emploi: { type: 'cv', titre: 'CV — Assistante commerciale', contenu: '# Kouadio Awa\nAssistante commerciale · Abidjan, Cocody · 07 00 00 00 00 · awa.kouadio@email.ci\n\n## Profil\nTrois ans d\'expérience en relation client et suivi des ventes. Rigoureuse, à l\'aise avec Excel et WhatsApp Business.\n\n## Expériences\n**Assistante commerciale**, Société Exemple, Abidjan — 2023 à aujourd\'hui\n- Suivi de 120 clients professionnels ; relances qui ont réduit les impayés de 30 %\n- Préparation des devis et des factures\n\n## Formation\nBTS Action commerciale — 2022\n\n## Compétences\nExcel, CRM, rédaction commerciale, négociation\n\n## Langues\nFrançais (courant), anglais (intermédiaire)' },
  repetiteur: { type: 'fiche_revision', titre: 'Fiche : les fractions', contenu: '# Les fractions\n\n## À retenir\n- Une fraction a/b : a est le numérateur, b le dénominateur (b ≠ 0).\n- Additionner : même dénominateur d\'abord. 1/4 + 2/4 = 3/4.\n- Multiplier : numérateurs ensemble, dénominateurs ensemble. 2/3 × 4/5 = 8/15.\n- Diviser : multiplier par l\'inverse. 2/3 ÷ 4/5 = 2/3 × 5/4 = 10/12 = 5/6.\n\n## Exercice\nCalcule 1/2 + 1/3 (indice : dénominateur commun 6).' }
};

const INTROS = {
  vendeur: "Mode démo : voici le genre de fiche produit que je prépare à partir d'une photo, prête à publier sur WhatsApp ou Facebook.",
  redaction: 'Mode démo : exemple de lettre officielle prête à envoyer.',
  emploi: 'Mode démo : exemple de CV clair, d\'une page.',
  repetiteur: 'Mode démo : exemple de fiche de révision. Avec la clé API, je t\'explique pas à pas et je lis les photos de tes exercices.',
  demarches: "Mode démo : sans la clé API, je ne peux pas chercher sur internet. Avec elle, je vérifie les étapes, les pièces, les coûts et les délais sur les sites officiels, et je te donne mes sources.",
  dev: "Mode démo : le mode développeur a besoin de la clé API, puis de tes clés GitHub et Render dans les réglages. Il écrit le code, l'envoie sur ton dépôt et déploie sur Render, toujours après ta validation."
};

export async function reponseDemo(agent, message, { nomCompagnon, send, store, fiche }) {
  const texte = (message || '').toLowerCase();
  const nom = nomCompagnon || 'Kiki';
  let intro = '';
  let outil = null;
  let document = null;
  let organisation = null;

  if (fiche) {
    intro = `Mode démo : je suis « ${fiche.nom} ». Ma mission : ${fiche.resume} Dès que la clé API sera active, je répondrai en suivant la mission et les règles que tu m'as données.`;
  } else if (agent === 'finance') {
    if (/point mort|seuil|rentab/.test(texte)) {
      outil = { name: 'calcul_point_mort', input: EXEMPLES_COURS.point_mort, fn: pointMort };
      intro = "Mode démo : je reprends l'exemple d'Assist Bureau (prix 50 000 FCFA, 40 % de coûts variables, 800 000 FCFA de charges fixes).";
    } else if (/prix|tarif|combien vendre/.test(texte)) {
      outil = { name: 'calcul_prix', input: EXEMPLES_COURS.prix, fn: fixerPrix };
      intro = "Mode démo : voici les trois méthodes appliquées à l'exemple du cours (coût variable 20 000 FCFA, 5 h du dirigeant à 10 000 FCFA l'heure).";
    } else if (/pr[ée]vision|projection|12 mois|tr[ée]sorerie/.test(texte)) {
      outil = { name: 'projection_12_mois', input: EXEMPLES_COURS.projection, fn: projection12Mois };
      intro = "Mode démo : projection bottom-up d'une agence type Assist Bureau, avec un délai de paiement de 30 jours.";
    } else if (/bfr|fonds de roulement|d[ée]lai/.test(texte)) {
      outil = { name: 'estimation_bfr', input: EXEMPLES_COURS.bfr, fn: estimationBFR };
      intro = "Mode démo : exemple d'une activité payée à 45 jours qui paie ses achats comptant, comme la boulangerie du cours.";
    } else if (/marge|chiffre d'affaires|ebitda|cascade/.test(texte)) {
      outil = { name: 'calcul_cascade_rentabilite', input: EXEMPLES_COURS.cascade, fn: cascadeRentabilite };
      intro = "Mode démo : cascade de rentabilité d'Assist Bureau, de 36 millions de CA à la marge nette.";
    } else {
      intro = 'Mode démo : demande-moi « point mort », « fixer mon prix », « prévisionnel 12 mois », « BFR » ou « cascade de marge » pour voir un exemple du cours.';
    }
  } else if (agent === 'budget') {
    if (/tontine/.test(texte)) { outil = { name: 'calcul_tontine', input: EXEMPLES_BUDGET.tontine, fn: tontine }; intro = 'Mode démo : tontine de 10 membres à 25 000 FCFA par mois, tu reçois au 3e tour.'; }
    else if (/[ée]conomis|[ée]pargn|objectif/.test(texte)) { outil = { name: 'calcul_plan_epargne', input: EXEMPLES_BUDGET.epargne, fn: planEpargne }; intro = 'Mode démo : objectif de 300 000 FCFA, 50 000 déjà de côté, 25 000 par mois.'; }
    else { outil = { name: 'calcul_budget_mensuel', input: EXEMPLES_BUDGET.budget, fn: budgetMensuel }; intro = 'Mode démo : budget type avec 250 000 FCFA de revenus par mois.'; }
  } else if (agent === 'organisation') {
    intro = 'Mode démo : je crée une liste de courses exemple. Avec la clé API, je comprends « rappelle-moi demain à 8 h » et je programme le rappel.';
    organisation = await executerOrganisation(store, 'gerer_liste', { nom: 'Courses', ajouter: ['Riz 5 kg', 'Huile', 'Attiéké', 'Poisson'] });
  } else if (DOCS_DEMO[agent]) {
    intro = INTROS[agent];
    document = await creerDocument(store, DOCS_DEMO[agent], agent);
  } else if (INTROS[agent]) {
    intro = INTROS[agent];
  } else if (/bonjour|salut|hello|bonsoir/.test(texte)) {
    intro = `Salut ! Moi c'est ${nom}. Je tourne en mode démo pour l'instant : je ne comprends pas encore vraiment tes messages. Dès que la clé API sera ajoutée dans Render, je pourrai discuter pour de vrai. Tu peux déjà essayer les agents : chacun montre un exemple.`;
  } else {
    intro = 'Mode démo : je ne peux pas encore réfléchir sans la clé API. En attendant, choisis un agent en haut de l\'écran pour voir un exemple de ce qu\'il fait.';
  }

  send('mood', { mood: 'reflechit' });
  await pause(500);
  for (const mot of intro.split(/(\s+)/)) { send('token', { text: mot }); await pause(16); }

  const montre = outil || document || organisation;
  if (montre) {
    send('mood', { mood: 'travaille' });
    await pause(400);
    if (outil) send('tool', { name: outil.name, input: outil.input, result: outil.fn(outil.input) });
    if (document) send('document', document);
    if (organisation) send('tool', { name: 'gerer_liste', input: {}, result: organisation });
    const suite = '\n\nAvec la clé API, je le ferai avec tes propres informations.';
    for (const mot of suite.split(/(\s+)/)) { send('token', { text: mot }); await pause(12); }
  }
  send('mood', { mood: montre ? 'fete' : 'repos' });
}
