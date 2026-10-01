// Vérifie les calculs du budget du foyer, de l'épargne et de la tontine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetMensuel, planEpargne, tontine, EXEMPLES_BUDGET } from '../public/shared/budget.js';

test('Budget : total, reste et épargne (reste du mois compris)', () => {
  const r = budgetMensuel(EXEMPLES_BUDGET.budget);
  assert.equal(r.totalDepenses, 235000);
  assert.equal(r.reste, 15000);
  assert.equal(r.parNature.famille, 30000);
  assert.equal(r.repartition[2].montant, 40000);
  assert.equal(r.tauxEpargne, 0.16);
  assert.equal(r.alertes.length, 0);
});

test('Budget : déficit et dettes trop lourdes signalés', () => {
  const r = budgetMensuel({ revenus: 100000, depenses: [{ libelle: 'Crédit', montant: 40000, nature: 'dette' }, { libelle: 'Loyer', montant: 70000, nature: 'besoin' }] });
  assert.equal(r.reste, -10000);
  assert.equal(r.alertes.length, 2);
});

test('Épargne : nombre de mois à 25 000 FCFA par mois', () => {
  const r = planEpargne(EXEMPLES_BUDGET.epargne);
  assert.equal(r.restant, 250000);
  assert.equal(r.moisNecessaires, 10);
  assert.equal(r.atteintEn, 'juil.');
});

test('Épargne : mensualité arrondie aux 500 FCFA supérieurs', () => {
  const r = planEpargne({ objectif: 100000, dureeMois: 7 });
  assert.equal(r.mensualiteNecessaire, 14500); // 14 285,7 → 14 500
});

test('Tontine : 10 membres à 25 000, position 3 → cagnotte 250 000, avance 175 000', () => {
  const r = tontine(EXEMPLES_BUDGET.tontine);
  assert.equal(r.cagnotte, 250000);
  assert.equal(r.versesAvantDeRecevoir, 75000);
  assert.equal(r.avance, 175000);
  assert.equal(r.tours.length, 10);
  assert.equal(r.tours[2].beneficiaire, 'toi');
});

test('Tontine : dernière position = épargne forcée, frais déduits', () => {
  const r = tontine({ membres: 5, cotisation: 10000, position: 5, fraisParTour: 2000 });
  assert.equal(r.cagnotte, 48000);
  assert.equal(r.avance, -2000);
  assert.equal(r.role, 'dernier');
});

test('Tontine : position impossible refusée', () => {
  assert.throws(() => tontine({ membres: 4, cotisation: 1000, position: 6 }));
});
