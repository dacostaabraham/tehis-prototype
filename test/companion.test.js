// Compagnon 3D : exports purs (public/companion.js). Aucun DOM requis à l'import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESPECES, HUMEURS } from '../public/companion.js';

test('quatre espèces avec id et nom', () => {
  assert.deepEqual(ESPECES.map((e) => e.id), ['chat', 'elephant', 'perroquet', 'tortue']);
  for (const e of ESPECES) assert.ok(e.nom, `nom manquant pour ${e.id}`);
});

test('humeurs connues du compagnon', () => {
  for (const h of ['repos', 'ecoute', 'reflechit', 'travaille', 'fete', 'parle']) {
    assert.ok(HUMEURS[h], `humeur manquante : ${h}`);
  }
});
