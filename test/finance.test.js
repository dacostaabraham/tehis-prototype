// Vérifie le moteur financier sur les exemples chiffrés du Module 5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cascadeRentabilite, pointMort, fixerPrix, projection12Mois, estimationBFR } from '../public/shared/finance.js';

test('Leçon 1 : cascade Assist Bureau, 36 M → 21,6 M → 11,6 M → 9,6 M', () => {
  const r = cascadeRentabilite({ ca: 36e6, coutsVariables: 14.4e6, chargesFixes: 10e6, impotsInteretsAmortissements: 2e6 });
  assert.equal(r.margeBrute, 21.6e6);
  assert.equal(r.ebitda, 11.6e6);
  assert.equal(r.margeNette, 9.6e6);
});

test('Leçon 3 : point mort à 27 clients (800 000 / 30 000 = 26,7)', () => {
  const r = pointMort({ prix: 50000, tauxCoutsVariables: 40, chargesFixes: 800000 });
  assert.equal(r.coutVariableUnitaire, 20000);
  assert.equal(r.margeContribution, 30000);
  assert.equal(r.pointMortExact, 26.67);
  assert.equal(r.unites, 27);
});

test('Leçon 3 : 26 clients restent déficitaires, 27 passent au positif', () => {
  const cf = 800000, prix = 50000, cv = 20000;
  assert.ok(26 * prix < cf + 26 * cv);
  assert.ok(27 * prix > cf + 27 * cv);
});

test('Leçon 3 : taux accepté en fraction ou en pourcentage', () => {
  assert.equal(pointMort({ prix: 50000, tauxCoutsVariables: 0.4, chargesFixes: 800000 }).unites, 27);
});

test('Leçon 3 : marge de contribution négative signalée', () => {
  const r = pointMort({ prix: 10000, coutVariableUnitaire: 12000, chargesFixes: 100000 });
  assert.equal(r.unites, null);
  assert.ok(r.alerte);
});

test('Leçon 4 : plancher 20 000 / 0,4 = 50 000 FCFA', () => {
  assert.equal(fixerPrix({ coutVariableUnitaire: 20000, margeBruteCible: 60 }).plancher, 50000);
});

test('Leçon 4 : avec 5 h × 10 000 du dirigeant, plancher 175 000 FCFA', () => {
  const r = fixerPrix({ coutVariableUnitaire: 20000, margeBruteCible: 60, heuresDirigeant: 5, tauxHoraireDirigeant: 10000 });
  assert.equal(r.plancher, 175000);
  assert.equal(r.plancherSansTempsDirigeant, 50000);
});

test('Leçon 4 : plancher au-dessus du plafond = offre non viable', () => {
  const r = fixerPrix({ coutVariableUnitaire: 20000, margeBruteCible: 60, heuresDirigeant: 5, tauxHoraireDirigeant: 10000, valeurPercueMax: 80000 });
  assert.equal(r.fourchetteRecommandee, null);
  assert.match(r.alerte, /pas viable/);
});

test('Leçon 4 : espace blanc entre marché bas et plafond, négociation ajoutée', () => {
  const r = fixerPrix({ coutVariableUnitaire: 20000, margeBruteCible: 60, valeurPercueMax: 80000, prixMarcheBas: 15000, prixMarcheHaut: 150000, margeNegociation: 10 });
  assert.deepEqual(r.fourchetteRecommandee, { min: 50000, max: 80000 });
  assert.equal(r.prixCible, 65000);
  assert.equal(r.prixAffiche, 71500);
});

test('Leçon 2 : délai de 30 jours décale les encaissements d\'un mois', () => {
  const r = projection12Mois({ nouveauxClientsParMois: 2, prixMoyen: 50000, tauxCoutsVariables: 40, chargesFixesMensuelles: 800000, delaiPaiementJours: 30 });
  assert.equal(r.lignes[0].encaissements, 0);
  assert.equal(r.lignes[1].encaissements, r.lignes[0].chiffreAffaires);
  assert.equal(r.lignes.length, 12);
});

test('Leçon 2 : la trésorerie est plus basse que le résultat quand les clients paient en retard', () => {
  const r = projection12Mois({ nouveauxClientsParMois: 3, croissanceAcquisition: 30, retention: 90, prixMoyen: 50000, tauxCoutsVariables: 40, chargesFixesMensuelles: 800000, delaiPaiementJours: 60 });
  const l = r.lignes[3];
  assert.ok(l.tresorerie < l.resultatCumule);
  assert.ok(r.besoinFinancement > 0);
});

test('Leçon 2 : saisonnalité appliquée au CA', () => {
  const saison = Array(12).fill(1); saison[0] = 0.8;
  const r = projection12Mois({ clientsInitiaux: 10, nouveauxClientsParMois: 0, prixMoyen: 50000, tauxCoutsVariables: 40, chargesFixesMensuelles: 0, saisonnalite: saison });
  assert.equal(r.lignes[0].chiffreAffaires, 400000);
  assert.equal(r.lignes[1].chiffreAffaires, 500000);
});

test('Leçon 1 : BFR = créances + stock − dettes fournisseurs', () => {
  const r = estimationBFR({ caMensuel: 3000000, delaiClientsJours: 45, achatsMensuels: 1500000, delaiFournisseursJours: 0 });
  assert.equal(r.creancesClients, 4500000);
  assert.equal(r.bfr, 4500000);
});

test('Valeur manquante : message clair', () => {
  assert.throws(() => pointMort({ prix: 50000 }), /Valeur manquante/);
});
