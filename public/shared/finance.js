// Moteur de calcul financier de Tehis.
// Fondé sur le Module 5 (leçons 1 à 4) : cascade de rentabilité, BFR et trésorerie,
// projections bottom-up sur 12 mois, point mort, fixation des prix.
// Module partagé : utilisé par le serveur (outils de l'agent) et par la PWA (calculateurs).
// Toutes les sommes sont en francs CFA.

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function num(v, nom, { min = -Infinity, requis = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (requis) throw new Error(`Valeur manquante : ${nom}`);
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Valeur invalide pour ${nom} : ${v}`);
  if (n < min) throw new Error(`${nom} doit être supérieur ou égal à ${min}`);
  return n;
}

// Un taux peut arriver en pourcentage (40) ou en fraction (0,4).
function taux(v, nom, requis = true) {
  const n = num(v, nom, { min: 0, requis });
  if (n === undefined) return undefined;
  const t = n > 1 ? n / 100 : n;
  if (t > 1) throw new Error(`${nom} doit être compris entre 0 et 100 %`);
  return t;
}

const arrondi = (n) => Math.round(n);
const f = (n) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n))} FCFA`;

/**
 * Leçon 1 — Cascade de rentabilité.
 * CA → marge brute (− coûts variables) → EBITDA (− charges fixes) → marge nette (− impôts, intérêts, amortissements).
 */
export function cascadeRentabilite(p) {
  const ca = num(p.ca, "chiffre d'affaires", { min: 0 });
  const coutsVariables = num(p.coutsVariables, 'coûts variables', { min: 0 });
  const chargesFixes = num(p.chargesFixes, 'charges fixes', { min: 0 });
  const autresCharges = num(p.impotsInteretsAmortissements ?? 0, 'impôts, intérêts et amortissements', { min: 0 });
  const margeBrute = ca - coutsVariables;
  const ebitda = margeBrute - chargesFixes;
  const margeNette = ebitda - autresCharges;
  const part = (x) => (ca > 0 ? x / ca : null);
  return {
    type: 'cascade',
    etapes: [
      { libelle: "Chiffre d'affaires", montant: ca, partDuCA: 1 },
      { libelle: 'Coûts variables', montant: -coutsVariables, partDuCA: part(coutsVariables) },
      { libelle: 'Marge brute', montant: margeBrute, partDuCA: part(margeBrute) },
      { libelle: 'Charges fixes', montant: -chargesFixes, partDuCA: part(chargesFixes) },
      { libelle: 'EBITDA', montant: ebitda, partDuCA: part(ebitda) },
      { libelle: 'Impôts, intérêts, amortissements', montant: -autresCharges, partDuCA: part(autresCharges) },
      { libelle: 'Marge nette', montant: margeNette, partDuCA: part(margeNette) }
    ],
    margeBrute, ebitda, margeNette,
    alerte: margeNette > 0
      ? 'Un résultat positif ne garantit pas la trésorerie : vérifiez les délais de paiement (BFR).'
      : 'Marge nette négative : les coûts dépassent les ventes sur la période.'
  };
}

/**
 * Leçon 3 — Point mort en trois étapes.
 * 1. coût variable unitaire ; 2. marge de contribution = prix − coût variable ;
 * 3. point mort = charges fixes ÷ marge de contribution, arrondi à l'unité supérieure.
 */
export function pointMort(p) {
  const prix = num(p.prix, 'prix de vente unitaire', { min: 0 });
  const chargesFixes = num(p.chargesFixes, 'charges fixes', { min: 0 });
  let cvu = num(p.coutVariableUnitaire, 'coût variable unitaire', { min: 0, requis: false });
  if (cvu === undefined) {
    const t = taux(p.tauxCoutsVariables, 'taux de coûts variables');
    cvu = prix * t;
  }
  const margeContribution = prix - cvu;
  if (margeContribution <= 0) {
    return {
      type: 'point_mort', prix, coutVariableUnitaire: cvu, margeContribution, chargesFixes, unites: null,
      alerte: 'Chaque vente coûte plus qu\'elle ne rapporte : le point mort ne peut jamais être atteint. Il faut augmenter le prix ou baisser le coût variable.'
    };
  }
  const exact = chargesFixes / margeContribution;
  const unites = Math.ceil(exact - 1e-9);
  const max = Math.max(4, Math.ceil(unites * 1.6));
  const pas = Math.max(1, Math.round(max / 24));
  const courbe = [];
  for (let n = 0; n <= max; n += pas) {
    courbe.push({ unites: n, revenus: n * prix, coutsTotaux: chargesFixes + n * cvu });
  }
  return {
    type: 'point_mort',
    prix, coutVariableUnitaire: cvu, margeContribution, chargesFixes,
    pointMortExact: Math.round(exact * 100) / 100,
    unites,
    chiffreAffairesPointMort: unites * prix,
    courbe,
    lecture: `Il faut vendre au moins ${unites} unités par période pour couvrir ${f(chargesFixes)} de charges fixes (arrondi au supérieur : avec ${unites - 1}, l'équilibre n'est pas atteint).`
  };
}

/**
 * Leçon 4 — Fixer son prix : plancher (coût plus), plafond (valeur perçue),
 * alignement marché (espace blanc) et facteur négociation (5 à 15 %).
 */
export function fixerPrix(p) {
  const cvu = num(p.coutVariableUnitaire, 'coût variable unitaire', { min: 0 });
  const margeCible = taux(p.margeBruteCible ?? 60, 'marge brute souhaitée');
  if (margeCible >= 1) throw new Error('La marge brute souhaitée doit être inférieure à 100 %');
  const heures = num(p.heuresDirigeant ?? 0, 'heures du dirigeant', { min: 0 });
  const tauxHoraire = num(p.tauxHoraireDirigeant ?? 0, 'valeur horaire du dirigeant', { min: 0 });
  const autres = num(p.autresCoutsDirects ?? 0, 'autres coûts directs', { min: 0 });
  const valeurMin = num(p.valeurPercueMin, 'valeur perçue minimale', { min: 0, requis: false });
  const valeurMax = num(p.valeurPercueMax, 'valeur perçue maximale', { min: 0, requis: false });
  const marcheBas = num(p.prixMarcheBas, 'prix bas du marché', { min: 0, requis: false });
  const marcheHaut = num(p.prixMarcheHaut, 'prix haut du marché', { min: 0, requis: false });
  const negociation = taux(p.margeNegociation ?? 0, 'marge de négociation');

  const tempsDirigeant = heures * tauxHoraire;
  const coutComplet = cvu + tempsDirigeant + autres;
  const plancher = arrondi(coutComplet / (1 - margeCible));
  const plancherSansTemps = arrondi((cvu + autres) / (1 - margeCible));
  const plafond = valeurMax ?? null;

  const bas = Math.max(plancher, marcheBas ?? 0);
  const haut = Math.min(plafond ?? Infinity, marcheHaut ?? Infinity);
  let fourchette = null;
  let alerte = null;
  if (plafond !== null && plancher > plafond) {
    alerte = 'Le plancher dépasse la valeur perçue : l\'offre n\'est pas viable en l\'état. Réduire les coûts ou augmenter la valeur apportée.';
  } else if (Number.isFinite(haut) && bas > haut) {
    alerte = 'Le plancher dépasse le haut du marché : il faut justifier un positionnement premium ou revoir les coûts.';
  } else {
    fourchette = { min: bas, max: Number.isFinite(haut) ? haut : null };
  }
  const prixCible = fourchette && fourchette.max !== null ? arrondi((fourchette.min + fourchette.max) / 2) : (fourchette ? fourchette.min : null);
  const prixAffiche = prixCible !== null && negociation > 0 ? arrondi(prixCible * (1 + negociation)) : prixCible;

  return {
    type: 'prix',
    coutVariableUnitaire: cvu, tempsDirigeant, autresCoutsDirects: autres, coutComplet,
    margeBruteCible: margeCible,
    plancher, plancherSansTempsDirigeant: plancherSansTemps,
    plafond, valeurPercue: valeurMin !== undefined || valeurMax !== undefined ? { min: valeurMin ?? null, max: valeurMax ?? null } : null,
    marche: marcheBas !== undefined || marcheHaut !== undefined ? { bas: marcheBas ?? null, haut: marcheHaut ?? null } : null,
    fourchetteRecommandee: fourchette,
    prixCible,
    margeNegociation: negociation,
    prixAffiche,
    alerte,
    rappel: 'Le prix retenu doit se situer entre le plancher (coûts) et le plafond (valeur perçue). Trop bas dans un métier de confiance, il fait douter de la qualité.'
  };
}

/**
 * Leçon 2 — Projection sur 12 mois, méthode bottom-up :
 * hypothèses → compte de résultat prévisionnel → trésorerie (décalage des encaissements).
 */
export function projection12Mois(p) {
  const mois = Math.min(36, Math.max(1, Math.round(num(p.mois ?? 12, 'nombre de mois', { min: 1 }))));
  const moisDebut = Math.min(12, Math.max(1, Math.round(num(p.moisDebut ?? 1, 'mois de départ', { min: 1 }))));
  const clientsInitiaux = num(p.clientsInitiaux ?? 0, 'clients au départ', { min: 0 });
  const acquisitionsInitiales = num(p.nouveauxClientsParMois, 'nouveaux clients le premier mois', { min: 0 });
  const croissance = taux(p.croissanceAcquisition ?? 0, 'croissance mensuelle des acquisitions');
  const retention = taux(p.retention ?? 100, 'taux de rétention mensuel');
  const prix = num(p.prixMoyen, 'prix moyen par client et par mois', { min: 0 });
  const tauxVar = taux(p.tauxCoutsVariables, 'taux de coûts variables');
  const fixes = num(p.chargesFixesMensuelles, 'charges fixes mensuelles', { min: 0 });
  const delai = num(p.delaiPaiementJours ?? 0, 'délai de paiement clients (jours)', { min: 0 });
  const decalage = p.decalageEncaissementMois !== undefined
    ? Math.round(num(p.decalageEncaissementMois, 'décalage d\'encaissement', { min: 0 }))
    : Math.ceil(delai / 30);
  const tresoInit = num(p.tresorerieInitiale ?? 0, 'trésorerie de départ');
  let saison = Array.isArray(p.saisonnalite) && p.saisonnalite.length === 12 ? p.saisonnalite.map(Number) : Array(12).fill(1);
  if (saison.some((s) => !Number.isFinite(s) || s < 0)) saison = Array(12).fill(1);

  const lignes = [];
  let clients = clientsInitiaux;
  let treso = tresoInit;
  let cumul = 0;
  const ventes = [];
  for (let i = 0; i < mois; i++) {
    const indexMois = (moisDebut - 1 + i) % 12;
    const acquisitions = acquisitionsInitiales * Math.pow(1 + croissance, i);
    clients = clients * retention + acquisitions;
    const clientsArrondis = Math.round(clients);
    const ca = arrondi(clientsArrondis * prix * saison[indexMois]);
    ventes.push(ca);
    const coutsVar = arrondi(ca * tauxVar);
    const resultat = ca - coutsVar - fixes;
    cumul += resultat;
    const encaissements = i - decalage >= 0 ? ventes[i - decalage] : 0;
    treso = treso + encaissements - coutsVar - fixes;
    lignes.push({
      mois: i + 1, libelle: MOIS[indexMois], saisonnalite: saison[indexMois],
      clients: clientsArrondis, chiffreAffaires: ca, coutsVariables: coutsVar, chargesFixes: fixes,
      resultat, resultatCumule: cumul, encaissements, tresorerie: treso
    });
  }
  const pointBas = lignes.reduce((a, b) => (b.tresorerie < a.tresorerie ? b : a));
  const pireCumul = lignes.reduce((a, b) => (b.resultatCumule < a.resultatCumule ? b : a));
  const premierMoisRentable = lignes.find((l) => l.resultat >= 0);
  return {
    type: 'projection',
    hypotheses: { clientsInitiaux, nouveauxClientsParMois: acquisitionsInitiales, croissanceAcquisition: croissance, retention, prixMoyen: prix, tauxCoutsVariables: tauxVar, chargesFixesMensuelles: fixes, delaiPaiementJours: delai, decalageEncaissementMois: decalage, tresorerieInitiale: tresoInit, saisonnalite: saison },
    lignes,
    pointBasTresorerie: { mois: pointBas.mois, libelle: pointBas.libelle, montant: pointBas.tresorerie },
    perteCumuleeMaximale: Math.min(0, pireCumul.resultatCumule),
    besoinFinancement: Math.max(0, -pointBas.tresorerie),
    premierMoisRentable: premierMoisRentable ? { mois: premierMoisRentable.mois, libelle: premierMoisRentable.libelle } : null,
    lecture: pointBas.tresorerie < 0
      ? `La trésorerie descend à ${f(pointBas.tresorerie)} en ${pointBas.libelle} (mois ${pointBas.mois}) : c'est le montant minimal à financer avant de lancer.`
      : 'La trésorerie reste positive sur toute la période avec ces hypothèses.'
  };
}

/**
 * Leçon 1 — Besoin en fonds de roulement : l'argent immobilisé entre les sorties et les rentrées.
 * Estimation classique : créances clients + stock − dettes fournisseurs.
 */
export function estimationBFR(p) {
  const caMensuel = num(p.caMensuel, "chiffre d'affaires mensuel", { min: 0 });
  const delaiClients = num(p.delaiClientsJours, 'délai de paiement des clients (jours)', { min: 0 });
  const achats = num(p.achatsMensuels ?? 0, 'achats mensuels', { min: 0 });
  const delaiFourn = num(p.delaiFournisseursJours ?? 0, 'délai de paiement des fournisseurs (jours)', { min: 0 });
  const stock = num(p.stockMoyen ?? 0, 'stock moyen', { min: 0 });
  const creances = arrondi((caMensuel / 30) * delaiClients);
  const dettes = arrondi((achats / 30) * delaiFourn);
  const bfr = creances + stock - dettes;
  return {
    type: 'bfr',
    creancesClients: creances, stock, dettesFournisseurs: dettes, bfr,
    lecture: bfr > 0
      ? `Il faut avoir environ ${f(bfr)} de côté pour tenir le décalage entre ce que vous payez et ce que vos clients vous versent.`
      : 'Vos fournisseurs financent votre cycle : les rentrées arrivent avant les sorties.',
    question: 'Pourrez-vous payer vos employés ce vendredi ?'
  };
}

export const OUTILS_FINANCE = {
  calcul_cascade_rentabilite: cascadeRentabilite,
  calcul_point_mort: pointMort,
  calcul_prix: fixerPrix,
  projection_12_mois: projection12Mois,
  estimation_bfr: estimationBFR
};

export const SCHEMAS_OUTILS_FINANCE = [
  {
    name: 'calcul_cascade_rentabilite',
    description: "Calcule la cascade de rentabilité : chiffre d'affaires, marge brute, EBITDA, marge nette et leur part du CA. Montants en FCFA sur la même période.",
    input_schema: {
      type: 'object',
      properties: {
        ca: { type: 'number', description: "Chiffre d'affaires total (FCFA)" },
        coutsVariables: { type: 'number', description: 'Coûts variables totaux (FCFA)' },
        chargesFixes: { type: 'number', description: 'Charges fixes totales (FCFA)' },
        impotsInteretsAmortissements: { type: 'number', description: 'Impôts, intérêts et amortissements (FCFA), 0 si inconnu' }
      },
      required: ['ca', 'coutsVariables', 'chargesFixes']
    }
  },
  {
    name: 'calcul_point_mort',
    description: "Calcule le point mort (seuil de rentabilité) en nombre d'unités, avec la courbe revenus / coûts totaux. Donner soit coutVariableUnitaire, soit tauxCoutsVariables.",
    input_schema: {
      type: 'object',
      properties: {
        prix: { type: 'number', description: 'Prix de vente unitaire (FCFA)' },
        coutVariableUnitaire: { type: 'number', description: 'Coût variable par unité (FCFA)' },
        tauxCoutsVariables: { type: 'number', description: 'Coûts variables en % du prix (ex. 40)' },
        chargesFixes: { type: 'number', description: 'Charges fixes de la période (FCFA)' }
      },
      required: ['prix', 'chargesFixes']
    }
  },
  {
    name: 'calcul_prix',
    description: 'Aide à fixer un prix : plancher (coût plus, temps du dirigeant inclus), plafond (valeur perçue), espace de marché et marge de négociation.',
    input_schema: {
      type: 'object',
      properties: {
        coutVariableUnitaire: { type: 'number', description: 'Coût variable par unité vendue (FCFA)' },
        margeBruteCible: { type: 'number', description: 'Marge brute souhaitée en % (par défaut 60)' },
        heuresDirigeant: { type: 'number', description: 'Heures du dirigeant par unité vendue' },
        tauxHoraireDirigeant: { type: 'number', description: "Valeur d'une heure du dirigeant (FCFA)" },
        autresCoutsDirects: { type: 'number', description: 'Autres coûts directs par unité (FCFA)' },
        valeurPercueMin: { type: 'number', description: 'Valeur perçue par le client, bas de la fourchette (FCFA)' },
        valeurPercueMax: { type: 'number', description: 'Valeur perçue par le client, haut de la fourchette (FCFA) : le plafond' },
        prixMarcheBas: { type: 'number', description: 'Prix de l\'offre bas de gamme ou informelle (FCFA)' },
        prixMarcheHaut: { type: 'number', description: 'Prix des acteurs haut de gamme (FCFA)' },
        margeNegociation: { type: 'number', description: 'Marge de négociation à intégrer au prix affiché, en % (5 à 15)' }
      },
      required: ['coutVariableUnitaire']
    }
  },
  {
    name: 'projection_12_mois',
    description: 'Projection financière bottom-up mois par mois : clients, CA, coûts, résultat, encaissements décalés et trésorerie, avec point bas de trésorerie et besoin de financement.',
    input_schema: {
      type: 'object',
      properties: {
        moisDebut: { type: 'number', description: 'Mois de départ (1 = janvier)' },
        mois: { type: 'number', description: 'Nombre de mois à projeter (12 par défaut)' },
        clientsInitiaux: { type: 'number', description: 'Clients actifs au départ' },
        nouveauxClientsParMois: { type: 'number', description: 'Nouveaux clients gagnés le premier mois grâce à une action précise' },
        croissanceAcquisition: { type: 'number', description: 'Croissance mensuelle des nouveaux clients en %' },
        retention: { type: 'number', description: 'Part des clients qui restent chaque mois, en % (100 = aucun départ)' },
        prixMoyen: { type: 'number', description: 'Prix moyen par client et par mois (FCFA)' },
        tauxCoutsVariables: { type: 'number', description: 'Coûts variables en % du CA' },
        chargesFixesMensuelles: { type: 'number', description: 'Charges fixes par mois (FCFA)' },
        delaiPaiementJours: { type: 'number', description: 'Délai de paiement des clients en jours' },
        decalageEncaissementMois: { type: 'number', description: 'Optionnel : décalage en mois entre la vente et l\'encaissement, si connu' },
        tresorerieInitiale: { type: 'number', description: 'Trésorerie disponible au départ (FCFA)' },
        saisonnalite: { type: 'array', items: { type: 'number' }, description: '12 coefficients de janvier à décembre (1 = mois normal, 0,8 = mois faible)' }
      },
      required: ['nouveauxClientsParMois', 'prixMoyen', 'tauxCoutsVariables', 'chargesFixesMensuelles']
    }
  },
  {
    name: 'estimation_bfr',
    description: 'Estime le besoin en fonds de roulement : créances clients + stock − dettes fournisseurs.',
    input_schema: {
      type: 'object',
      properties: {
        caMensuel: { type: 'number', description: "Chiffre d'affaires mensuel (FCFA)" },
        delaiClientsJours: { type: 'number', description: 'Délai moyen de paiement des clients (jours)' },
        achatsMensuels: { type: 'number', description: 'Achats mensuels auprès des fournisseurs (FCFA)' },
        delaiFournisseursJours: { type: 'number', description: 'Délai accordé par les fournisseurs (jours, 0 si paiement comptant)' },
        stockMoyen: { type: 'number', description: 'Valeur moyenne du stock (FCFA)' }
      },
      required: ['caMensuel', 'delaiClientsJours']
    }
  }
];

export const EXEMPLES_COURS = {
  cascade: { ca: 36000000, coutsVariables: 14400000, chargesFixes: 10000000, impotsInteretsAmortissements: 2000000 },
  point_mort: { prix: 50000, tauxCoutsVariables: 40, chargesFixes: 800000 },
  prix: { coutVariableUnitaire: 20000, margeBruteCible: 60, heuresDirigeant: 5, tauxHoraireDirigeant: 10000, valeurPercueMin: 60000, valeurPercueMax: 80000, prixMarcheBas: 15000, prixMarcheHaut: 150000, margeNegociation: 10 },
  projection: { moisDebut: 1, clientsInitiaux: 2, nouveauxClientsParMois: 2, croissanceAcquisition: 30, retention: 90, prixMoyen: 50000, tauxCoutsVariables: 40, chargesFixesMensuelles: 800000, delaiPaiementJours: 30, tresorerieInitiale: 0, saisonnalite: [0.8, 0.9, 1, 1, 1, 1, 0.9, 0.85, 1, 1, 1, 0.75] },
  bfr: { caMensuel: 3000000, delaiClientsJours: 45, achatsMensuels: 1500000, delaiFournisseursJours: 0, stockMoyen: 0 }
};
