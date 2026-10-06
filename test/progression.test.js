// Le compagnon qui grandit : points, plafonds, série, niveaux, accessoires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appliquer, niveauPour, resume, accessoiresDebloques } from '../public/shared/progression.js';

const jour = (j, h = 10) => new Date(`2026-10-${String(j).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`);

test('Premier message : visite du jour + message, pas de bonus pour le premier agent', () => {
  const r = appliquer(null, [{ type: 'message', agent: 'compagnon' }], jour(6));
  assert.deepEqual(r.gains.map((g) => [g.type, g.points]), [['jour', 5], ['message', 2]]);
  assert.equal(r.progression.points, 7);
  assert.equal(r.progression.serie, 1);
});

test('Nouvel agent essayé : bonus une seule fois ; plafond des messages par jour', () => {
  let p = appliquer(null, [{ type: 'message', agent: 'compagnon' }], jour(6)).progression;
  let r = appliquer(p, [{ type: 'message', agent: 'sante' }], jour(6, 11));
  assert.deepEqual(r.gains.map((g) => g.type), ['nouvel_agent', 'message']);
  p = r.progression;
  for (let i = 0; i < 20; i++) p = appliquer(p, [{ type: 'message', agent: 'sante' }], jour(6, 12)).progression;
  assert.equal(p.jour.compteurs.message, 20, 'au plus 20 points de messages par jour');
  r = appliquer(p, [{ type: 'message', agent: 'sante' }], jour(6, 13));
  assert.equal(r.gains.length, 0);
});

test('Série : jours consécutifs, bonus à 3 jours, remise à 1 après un trou', () => {
  let p = null;
  for (const j of [1, 2, 3]) p = appliquer(p, [], jour(j)).progression;
  assert.equal(p.serie, 3);
  const r = appliquer(p, [], jour(4));
  assert.equal(r.progression.serie, 4);
  const trou = appliquer(r.progression, [], jour(6));
  assert.equal(trou.progression.serie, 1);
  assert.equal(trou.progression.meilleureSerie, 4);
  const avecBonus = appliquer(appliquer(appliquer(null, [], jour(1)).progression, [], jour(2)).progression, [], jour(3));
  assert.ok(avecBonus.gains.some((g) => g.type === 'serie' && g.points === 10));
});

test('Niveaux et accessoires débloqués portés d\'office', () => {
  assert.equal(niveauPour(0).niveau, 1);
  assert.equal(niveauPour(40).nom, 'Curieux');
  assert.equal(niveauPour(1200).suivant, null);
  const r = appliquer({ points: 38, serie: 1, dernierJour: '2026-10-06', agents: ['compagnon'], jour: { date: '2026-10-06', compteurs: {} }, portes: [] }, [{ type: 'document' }], jour(6));
  assert.equal(r.niveauGagne, 2);
  assert.deepEqual(r.debloques, ['foulard']);
  assert.deepEqual(resume(r.progression).portes, ['foulard']);
  assert.deepEqual(accessoiresDebloques(4), ['foulard', 'chapeau', 'lunettes']);
});

test('Résumé : accessoires portés mais non débloqués ignorés', () => {
  const s = resume({ points: 10, portes: ['couronne', 'inconnu'] });
  assert.deepEqual(s.portes, []);
  assert.equal(s.niveau, 1);
  assert.equal(s.suivant.nom, 'Curieux');
});
