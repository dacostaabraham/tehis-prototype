// Calculs du budget du foyer : budget mensuel, plan d'épargne, tontine.
// Module partagé : outils de l'agent « Budget et tontine » côté serveur, calculateurs côté PWA.
// Toutes les sommes sont en francs CFA.

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const f = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n))} FCFA`;

function num(v, nom, { min = -Infinity, requis = true, entier = false } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requis) throw new Error(`Valeur manquante : ${nom}`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Valeur invalide pour ${nom} : ${v}`);
  if (n < min) throw new Error(`${nom} doit être supérieur ou égal à ${min}`);
  if (entier && !Number.isInteger(n)) throw new Error(`${nom} doit être un nombre entier`);
  return n;
}

export const NATURES = {
  besoin: 'Besoins essentiels',
  famille: 'Soutien à la famille',
  envie: 'Envies et loisirs',
  dette: 'Remboursements de dettes',
  epargne: 'Épargne et tontine'
};

// Repère indicatif inspiré de la règle 50/30/20, adapté : le soutien familial compte avec les besoins.
const REPERES = { essentiel: 0.6, envie: 0.2, epargne: 0.2 };

/**
 * Budget mensuel : revenus et dépenses classées par nature.
 * depenses : [{ libelle, montant, nature: besoin | famille | envie | dette | epargne }]
 */
export function budgetMensuel(p) {
  const revenus = num(p.revenus, 'revenus du mois', { min: 0 });
  if (!Array.isArray(p.depenses) || !p.depenses.length) throw new Error('Ajoute au moins une dépense.');
  const lignes = p.depenses.map((d, i) => {
    const nature = NATURES[d.nature] ? d.nature : 'besoin';
    return { libelle: String(d.libelle || `Dépense ${i + 1}`).slice(0, 60), montant: num(d.montant, d.libelle || `dépense ${i + 1}`, { min: 0 }), nature };
  });
  const parNature = Object.fromEntries(Object.keys(NATURES).map((k) => [k, 0]));
  for (const l of lignes) parNature[l.nature] += l.montant;
  const totalDepenses = lignes.reduce((s, l) => s + l.montant, 0);
  const reste = revenus - totalDepenses;
  const part = (x) => (revenus > 0 ? x / revenus : null);

  const essentiel = parNature.besoin + parNature.famille + parNature.dette;
  const epargneTotale = parNature.epargne + Math.max(reste, 0);
  const repartition = [
    { groupe: 'essentiel', libelle: 'Besoins, famille et dettes', montant: essentiel, part: part(essentiel), repere: REPERES.essentiel },
    { groupe: 'envie', libelle: 'Envies et loisirs', montant: parNature.envie, part: part(parNature.envie), repere: REPERES.envie },
    { groupe: 'epargne', libelle: 'Épargne et reste du mois', montant: epargneTotale, part: part(epargneTotale), repere: REPERES.epargne }
  ];

  const alertes = [];
  if (reste < 0) alertes.push(`Tu dépenses ${f(-reste)} de plus que tes revenus : il faut réduire ou trouver un revenu en plus.`);
  if (revenus > 0 && parNature.dette / revenus > 0.33) alertes.push('Les remboursements dépassent le tiers de tes revenus : évite tout nouveau crédit.');
  if (revenus > 0 && epargneTotale / revenus < 0.1 && reste >= 0) alertes.push("Moins de 10 % de tes revenus sont mis de côté : vise d'abord un petit montant fixe chaque mois.");

  const plusGrosse = [...lignes].sort((a, b) => b.montant - a.montant)[0];
  return {
    type: 'budget',
    revenus, totalDepenses, reste,
    tauxEpargne: part(epargneTotale),
    parNature, repartition, lignes,
    alertes,
    lecture: reste >= 0
      ? `Il te reste ${f(reste)} à la fin du mois. Ta plus grosse dépense est « ${plusGrosse.libelle} » (${f(plusGrosse.montant)}).`
      : `Ton mois est en déficit de ${f(-reste)}. Ta plus grosse dépense est « ${plusGrosse.libelle} » (${f(plusGrosse.montant)}).`,
    rappel: 'Le repère 60 / 20 / 20 est indicatif : chaque famille a ses priorités.'
  };
}

/**
 * Plan d'épargne : combien de mois pour un objectif, ou combien mettre de côté chaque mois.
 * Donner epargneMensuelle OU dureeMois.
 */
export function planEpargne(p) {
  const objectif = num(p.objectif, 'objectif', { min: 1 });
  const deja = num(p.dejaEpargne ?? 0, 'déjà épargné', { min: 0 });
  const mensuelle = num(p.epargneMensuelle, 'épargne mensuelle', { min: 0, requis: false });
  const duree = num(p.dureeMois, 'durée en mois', { min: 1, requis: false, entier: true });
  if (mensuelle === undefined && duree === undefined) throw new Error('Donne le montant que tu peux mettre de côté par mois, ou le nombre de mois que tu te donnes.');
  const restant = Math.max(objectif - deja, 0);
  const moisDebut = num(p.moisDebut ?? new Date().getMonth() + 1, 'mois de départ', { min: 1 });
  const libelleMois = (k) => MOIS[(moisDebut - 1 + k) % 12];

  const r = { type: 'epargne', objectif, dejaEpargne: deja, restant };
  if (restant === 0) return { ...r, moisNecessaires: 0, lecture: 'Objectif déjà atteint.' };

  if (duree !== undefined) {
    // Arrondi aux 500 FCFA supérieurs : un montant facile à verser.
    r.mensualiteNecessaire = Math.ceil(restant / duree / 500) * 500;
    r.dureeMois = duree;
  }
  if (mensuelle !== undefined) {
    r.epargneMensuelle = mensuelle;
    r.moisNecessaires = mensuelle > 0 ? Math.ceil(restant / mensuelle) : null;
    r.atteintEn = r.moisNecessaires ? libelleMois(r.moisNecessaires - 1) : null;
  }
  r.lecture = r.mensualiteNecessaire !== undefined
    ? `Pour réunir ${f(restant)} en ${duree} mois, mets de côté ${f(r.mensualiteNecessaire)} par mois.`
    : r.moisNecessaires
      ? `À ${f(mensuelle)} par mois, il te faut ${r.moisNecessaires} mois (objectif atteint fin ${r.atteintEn} si tu commences ce mois-ci).`
      : 'Sans épargne mensuelle, l’objectif ne sera pas atteint.';
  return r;
}

/**
 * Tontine tournante : chaque membre cotise à chaque tour, un membre reçoit la cagnotte.
 * position : ton tour de passage (1 = premier à recevoir).
 */
export function tontine(p) {
  const membres = num(p.membres, 'nombre de membres', { min: 2, entier: true });
  const cotisation = num(p.cotisation, 'cotisation par tour', { min: 1 });
  const position = num(p.position ?? 1, 'ta position', { min: 1, entier: true });
  if (position > membres) throw new Error('Ta position ne peut pas dépasser le nombre de membres.');
  const frequence = ['semaine', 'mois', 'quinzaine', 'jour'].includes(p.frequence) ? p.frequence : 'mois';
  const fraisParTour = num(p.fraisParTour ?? 0, 'frais par tour', { min: 0 });
  const unite = { jour: 'jour', semaine: 'semaine', quinzaine: 'quinzaine', mois: 'mois' }[frequence];

  const cagnotte = membres * cotisation - fraisParTour;
  const totalVerse = membres * cotisation;
  const versesAvantDeRecevoir = position * cotisation; // y compris le tour où tu reçois
  const avance = cagnotte - versesAvantDeRecevoir; // positif : la tontine te prête ; négatif : tu épargnes pour les autres
  const tours = Array.from({ length: membres }, (_, i) => ({ tour: i + 1, beneficiaire: i + 1 === position ? 'toi' : `membre ${i + 1}`, cumulVerse: (i + 1) * cotisation }));

  const role = position === 1 ? 'premier' : position === membres ? 'dernier' : 'milieu';
  const lecture = avance > 0
    ? `Tu reçois ${f(cagnotte)} au tour ${position} après avoir versé ${f(versesAvantDeRecevoir)} : la tontine t'avance ${f(avance)}, que tu rembourses par tes cotisations suivantes, sans intérêt.`
    : avance < 0
      ? `Tu reçois ${f(cagnotte)} au tour ${position}, après avoir versé ${f(versesAvantDeRecevoir)} : c'est une épargne forcée, et tu as avancé ${f(-avance)} aux autres membres.`
      : `Tu reçois ${f(cagnotte)} au tour ${position}, exactement ce que tu as versé jusque-là.`;
  return {
    type: 'tontine',
    membres, cotisation, frequence, position,
    cagnotte, totalVerse, fraisParTour,
    dureeCycle: `${membres} ${unite}${unite === 'mois' ? '' : 's'}`,
    versesAvantDeRecevoir, avance, role, tours,
    lecture,
    risque: role === 'dernier'
      ? 'En dernière position, tu prends le plus de risque si un membre arrête de cotiser : choisis un groupe de confiance avec un responsable reconnu.'
      : "Le risque principal d'une tontine est qu'un membre arrête de cotiser après avoir reçu. Garde une trace écrite des versements."
  };
}

export const OUTILS_BUDGET = {
  calcul_budget_mensuel: budgetMensuel,
  calcul_plan_epargne: planEpargne,
  calcul_tontine: tontine
};

export const SCHEMAS_OUTILS_BUDGET = [
  {
    name: 'calcul_budget_mensuel',
    description: "Calcule le budget d'un mois : total des dépenses, reste à vivre, taux d'épargne, répartition par nature comparée au repère 60/20/20, alertes. À utiliser dès que l'utilisateur donne ses revenus et ses dépenses.",
    input_schema: {
      type: 'object',
      properties: {
        revenus: { type: 'number', description: 'Revenus du mois en FCFA (salaire, ventes, autres)' },
        depenses: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              libelle: { type: 'string' },
              montant: { type: 'number', description: 'Montant mensuel en FCFA' },
              nature: { type: 'string', enum: Object.keys(NATURES), description: 'besoin (loyer, nourriture, transport, école, factures), famille (soutien aux proches), envie, dette, epargne (y compris tontine)' }
            },
            required: ['libelle', 'montant', 'nature']
          }
        }
      },
      required: ['revenus', 'depenses']
    }
  },
  {
    name: 'calcul_plan_epargne',
    description: "Plan d'épargne vers un objectif : nombre de mois nécessaires avec une épargne mensuelle donnée, ou montant mensuel nécessaire pour une durée donnée.",
    input_schema: {
      type: 'object',
      properties: {
        objectif: { type: 'number', description: 'Montant visé en FCFA' },
        dejaEpargne: { type: 'number', description: 'Déjà mis de côté, en FCFA' },
        epargneMensuelle: { type: 'number', description: 'Montant que la personne peut épargner chaque mois' },
        dureeMois: { type: 'integer', description: 'Nombre de mois que la personne se donne' },
        moisDebut: { type: 'integer', description: 'Mois de départ, 1 = janvier (par défaut le mois en cours)' }
      },
      required: ['objectif']
    }
  },
  {
    name: 'calcul_tontine',
    description: "Analyse une tontine tournante : cagnotte reçue, durée du cycle, somme versée avant de recevoir, avance ou épargne forcée selon la position, risques.",
    input_schema: {
      type: 'object',
      properties: {
        membres: { type: 'integer' },
        cotisation: { type: 'number', description: 'Cotisation de chaque membre à chaque tour, en FCFA' },
        frequence: { type: 'string', enum: ['jour', 'semaine', 'quinzaine', 'mois'] },
        position: { type: 'integer', description: 'Tour où la personne reçoit la cagnotte (1 = premier)' },
        fraisParTour: { type: 'number', description: 'Frais retenus sur la cagnotte à chaque tour (organisateur, transfert)' }
      },
      required: ['membres', 'cotisation', 'position']
    }
  }
];

export const EXEMPLES_BUDGET = {
  budget: {
    revenus: 250000,
    depenses: [
      { libelle: 'Loyer', montant: 70000, nature: 'besoin' },
      { libelle: 'Nourriture', montant: 60000, nature: 'besoin' },
      { libelle: 'Transport', montant: 25000, nature: 'besoin' },
      { libelle: 'Aide aux parents', montant: 30000, nature: 'famille' },
      { libelle: 'Crédit téléphone et data', montant: 10000, nature: 'besoin' },
      { libelle: 'Sorties', montant: 15000, nature: 'envie' },
      { libelle: 'Tontine', montant: 25000, nature: 'epargne' }
    ]
  },
  epargne: { objectif: 300000, dejaEpargne: 50000, epargneMensuelle: 25000, moisDebut: 10 },
  tontine: { membres: 10, cotisation: 25000, frequence: 'mois', position: 3, fraisParTour: 0 }
};
