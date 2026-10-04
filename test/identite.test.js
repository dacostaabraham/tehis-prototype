// Identité visuelle : couleurs, icônes SVG, vignettes, logo, états vides (public/shared/identite.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vignetteAgent, couleurAgent, logoTehis, etatVide, ICONES_SVG, COULEURS_AGENTS } from '../public/shared/identite.js';
import { AGENTS } from '../public/shared/agents.js';

test('Identité : chaque agent a une couleur et une icône SVG', () => {
  for (const id of Object.keys(AGENTS)) {
    assert.ok(COULEURS_AGENTS[id], `couleur manquante : ${id}`);
    assert.ok(ICONES_SVG[id], `icône manquante : ${id}`);
    assert.match(COULEURS_AGENTS[id], /^#[0-9A-Fa-f]{6}$/, `couleur invalide : ${id}`);
  }
});

test('Identité : vignetteAgent produit une vignette colorée avec SVG', () => {
  const h = vignetteAgent('sante');
  assert.match(h, /--vc:#DC2626/);
  assert.match(h, /<svg/);
  assert.match(h, /class="vignette"/);
});

test('Identité : vignetteAgent inconnue retombe sur le compagnon', () => {
  assert.match(vignetteAgent('nope'), /--vc:#0E7C86/);
  assert.equal(couleurAgent('nope'), '#0E7C86');
});

test('Identité : logoTehis produit un SVG à la bonne taille', () => {
  assert.match(logoTehis(), /<svg/);
  assert.match(logoTehis(56), /width:56px/);
});

test('Identité : etatVide produit un bloc illustré', () => {
  const h = etatVide(ICONES_SVG.sante, 'Titre', 'Texte');
  assert.match(h, /etat-vide/);
  assert.ok(h.includes('Titre') && h.includes('Texte'));
});
