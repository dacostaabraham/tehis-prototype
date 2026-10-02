// Toast UI (public/shared/ui.js) : remplace alert() natif.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let toast;
let elements;

function fauxDocument() {
  elements = {};
  const creerElement = (tag) => ({
    tag, id: '', className: '', textContent: '', hidden: true,
    setAttribute() {},
    appendChild() {}
  });
  return {
    getElementById: (id) => elements[id] || null,
    createElement: creerElement,
    body: { appendChild: (el) => { elements[el.id] = el; } }
  };
}

before(async () => {
  globalThis.document = fauxDocument();
  ({ toast } = await import('../public/shared/ui.js'));
});

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

test('toast crée et affiche le message', () => {
  toast('Bonjour', 10000);
  const t = elements['toast'];
  assert.ok(t, 'élément créé');
  assert.equal(t.textContent, 'Bonjour');
  assert.equal(t.hidden, false);
  assert.equal(t.className, 'toast');
});

test('toast réutilise le même élément', () => {
  toast('Un', 10000);
  const premier = elements['toast'];
  toast('Deux', 10000);
  assert.equal(elements['toast'], premier, 'pas de doublon');
  assert.equal(premier.textContent, 'Deux');
});

test('toast se masque après la durée', async () => {
  toast('Éphémère', 30);
  assert.equal(elements['toast'].hidden, false);
  await attendre(80);
  assert.equal(elements['toast'].hidden, true);
});
