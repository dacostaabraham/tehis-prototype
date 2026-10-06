// Le compagnon qui grandit : points, niveaux, série de jours, accessoires débloqués.
// Partagé par le serveur (calcul) et l'app (affichage). Rien ici ne dépend du réseau.

export const NIVEAUX = [
  { niveau: 1, nom: 'Petit', points: 0 },
  { niveau: 2, nom: 'Curieux', points: 40 },
  { niveau: 3, nom: 'Débrouillard', points: 100 },
  { niveau: 4, nom: 'Malin', points: 200 },
  { niveau: 5, nom: 'Champion', points: 350 },
  { niveau: 6, nom: 'Grand frère', points: 550 },
  { niveau: 7, nom: 'Vieux père', points: 800 },
  { niveau: 8, nom: 'Légende', points: 1200 }
];

export const ACCESSOIRES = {
  foulard: { nom: 'Foulard en pagne', niveau: 2, icone: '🧣' },
  chapeau: { nom: 'Bob en pagne', niveau: 3, icone: '👒' },
  lunettes: { nom: 'Lunettes de soleil', niveau: 4, icone: '🕶️' },
  medaille: { nom: "Médaille d'or", niveau: 5, icone: '🏅' },
  couronne: { nom: 'Couronne', niveau: 7, icone: '👑' }
};

// Ce qui rapporte des points. plafond : points maximum par jour pour ce type.
export const GAINS = {
  message: { points: 2, plafond: 20, texte: 'Discussion' },
  nouvel_agent: { points: 15, texte: 'Nouvel agent essayé' },
  document: { points: 5, plafond: 20, texte: 'Document créé' },
  rappel: { points: 5, plafond: 15, texte: 'Rappel programmé' },
  liste: { points: 3, plafond: 9, texte: 'Liste tenue' },
  lieux: { points: 3, plafond: 9, texte: 'Recherche autour de toi' },
  calcul: { points: 3, plafond: 9, texte: 'Calcul' },
  jour: { points: 5, texte: 'Visite du jour' },
  serie: { points: 0, texte: 'Série' }
};
const BONUS_SERIE = { 3: 10, 7: 30, 14: 50, 30: 100 };

export function niveauPour(points) {
  let n = NIVEAUX[0];
  for (const x of NIVEAUX) if (points >= x.points) n = x;
  const suivant = NIVEAUX.find((x) => x.niveau === n.niveau + 1) || null;
  return { ...n, suivant, avance: suivant ? (points - n.points) / (suivant.points - n.points) : 1 };
}

export const accessoiresDebloques = (niveau) => Object.entries(ACCESSOIRES).filter(([, a]) => a.niveau <= niveau).map(([id]) => id);

export function progressionVide() {
  return { points: 0, serie: 0, meilleureSerie: 0, dernierJour: null, agents: [], jour: { date: null, compteurs: {} }, portes: [] };
}

const jourSuivant = (iso) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

/**
 * Applique des événements ({ type, agent? }) à la progression.
 * Renvoie la nouvelle progression, les gains du jour, le niveau gagné et les accessoires débloqués.
 */
export function appliquer(ancienne, evenements, maintenant = new Date()) {
  const p = structuredClone({ ...progressionVide(), ...(ancienne || {}) });
  const jour = maintenant.toISOString().slice(0, 10); // heure d'Abidjan = UTC
  const avant = niveauPour(p.points).niveau;
  const gains = [];
  const gagner = (type, points, texte) => { if (points > 0) { p.points += points; gains.push({ type, points, texte }); } };

  if (p.jour.date !== jour) p.jour = { date: jour, compteurs: {} };
  if (p.dernierJour !== jour) {
    p.serie = p.dernierJour && jourSuivant(p.dernierJour) === jour ? p.serie + 1 : 1;
    p.meilleureSerie = Math.max(p.meilleureSerie || 0, p.serie);
    p.dernierJour = jour;
    gagner('jour', GAINS.jour.points, GAINS.jour.texte);
    if (BONUS_SERIE[p.serie]) gagner('serie', BONUS_SERIE[p.serie], `${p.serie} jours de suite`);
  }

  for (const e of evenements) {
    const g = GAINS[e.type];
    if (!g || e.type === 'jour' || e.type === 'serie') continue;
    if (e.type === 'message' && e.agent && !p.agents.includes(e.agent)) {
      p.agents.push(e.agent);
      if (p.agents.length > 1) gagner('nouvel_agent', GAINS.nouvel_agent.points, GAINS.nouvel_agent.texte);
    }
    if (e.type === 'nouvel_agent') continue;
    const deja = p.jour.compteurs[e.type] || 0;
    const possible = g.plafond ? Math.max(0, Math.min(g.points, g.plafond - deja)) : g.points;
    p.jour.compteurs[e.type] = deja + possible;
    gagner(e.type, possible, g.texte);
  }

  const apres = niveauPour(p.points).niveau;
  const debloques = apres > avant ? Object.entries(ACCESSOIRES).filter(([, a]) => a.niveau > avant && a.niveau <= apres).map(([id]) => id) : [];
  // Un accessoire débloqué est porté tout de suite (l'utilisateur peut l'enlever).
  for (const id of debloques) if (!p.portes.includes(id)) p.portes.push(id);
  return { progression: p, gains, niveauGagne: apres > avant ? apres : null, debloques };
}

/** Résumé envoyé à l'app. */
export function resume(p) {
  const prog = { ...progressionVide(), ...(p || {}) };
  const n = niveauPour(prog.points);
  return {
    points: prog.points, niveau: n.niveau, nom: n.nom, avance: n.avance,
    suivant: n.suivant ? { niveau: n.suivant.niveau, nom: n.suivant.nom, points: n.suivant.points } : null,
    serie: prog.serie, meilleureSerie: prog.meilleureSerie || prog.serie, agents: prog.agents.length,
    debloques: accessoiresDebloques(n.niveau), portes: prog.portes.filter((id) => ACCESSOIRES[id] && ACCESSOIRES[id].niveau <= n.niveau)
  };
}
