// Tests frontend : synthèse vocale (public/voix.js).
// voix.js lit window.speechSynthesis au chargement : on simule le navigateur avant l'import.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

let voix;
let morceaux;

function simulerNavigateur(voixFr = [{ lang: 'fr-FR', name: 'Voix test', localService: true }]) {
  morceaux = [];
  globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
  globalThis.window = {
    speechSynthesis: {
      getVoices: () => voixFr,
      addEventListener: () => {},
      speak(u) {
        morceaux.push(u.text);
        setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 1); }, 1);
      },
      cancel() {},
      speaking: false,
      pending: false
    },
    SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance,
    matchMedia: () => ({ matches: false })
  };
}

before(async () => {
  simulerNavigateur();
  voix = await import('../public/voix.js');
});

// morceaux[] est global au fichier : on le vide avant chaque lecture testée.
function lectureNeuve() { morceaux.length = 0; }

test('voix disponible avec synthèse simulée', () => {
  assert.equal(voix.voixDisponible, true);
});

test('texteParle : nettoie le markdown', () => {
  const sorti = voix.texteParle('## Budget\nVoici **ton** budget :\n- Loyer : 150 000 FCFA\n`code` et [lien](https://x.com) https://brut.example 👍');
  assert.ok(!sorti.includes('##') && !sorti.includes('**') && !sorti.includes('`'), 'formatage retiré');
  assert.ok(!sorti.includes('https://'), 'liens retirés');
  assert.ok(!sorti.includes('👍'), 'emojis retirés');
  assert.ok(sorti.includes('25000') === false, 'pas de 25000 ici');
  assert.ok(sorti.includes('150000 francs CFA'), 'montant et FCFA : ' + sorti);
});

test('texteParle : blocs de code remplacés', () => {
  const sorti = voix.texteParle('Voici le code :\n```js\nconst a = 1;\n```\nFin.');
  assert.ok(sorti.includes("voir le code à l'écran"), sorti);
  assert.ok(!sorti.includes('const a'), 'code non lu');
});

test('texteParle : étend les abréviations', () => {
  const cas = [
    ['M. Dupont vous recevra', 'monsieur Dupont vous recevra'],
    ['Voir Dr Koné, Mme et Mlle Sylla', 'Voir docteur Koné, madame et mademoiselle Sylla'],
    ['Répondez SVP avant le RDV', "Répondez s'il vous plaît avant le rendez-vous"],
    ['le n°5 et le N° 12', 'le numéro 5 et le numéro 12'],
    ['Pr NGuessan, St Louis', 'professeur NGuessan, saint Louis']
  ];
  for (const [entree, attendu] of cas) assert.equal(voix.texteParle(entree), attendu, entree);
});

test('texteParle : ne touche pas aux nombres décimaux', () => {
  assert.equal(voix.texteParle('3.5 kg de riz'), '3.5 kg de riz');
});

test('parler : découpe les longs textes en morceaux < 220 caractères', async () => {
  lectureNeuve();
  const long = 'Première phrase. ' + 'Ceci est une phrase très longue qui dépasse largement les deux cent vingt caractères pour vérifier le découpage automatique en morceaux plus petits. '.repeat(3);
  let fin = 0;
  await voix.parler(long, 'chat', { fin: () => fin++ });
  assert.ok(morceaux.length > 1, 'plusieurs morceaux : ' + morceaux.length);
  assert.ok(morceaux.every((m) => m.length <= 220), 'tous < 220 : ' + morceaux.map((m) => m.length));
  assert.equal(fin, 1, 'événement fin appelé une fois');
});

test('parler : coupe de préférence après une virgule', async () => {
  lectureNeuve();
  const long = 'Pour visiter un studio à Cocody, vérifiez d\u2019abord l\u2019arrivée d\u2019eau, puis l\u2019installation électrique, ensuite la sécurité du quartier, et enfin l\u2019état des murs, car en saison des pluies, les infiltrations sont fréquentes dans les constructions anciennes.';
  await voix.parler(long, 'chat', {});
  const intermediaires = morceaux.slice(0, -1);
  assert.ok(intermediaires.length > 0, 'découpé');
  assert.ok(intermediaires.every((m) => /[,;]$/.test(m)), 'coupures naturelles : ' + JSON.stringify(intermediaires.map((m) => m.slice(-20))));
  assert.equal(morceaux.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' '), 'texte intact');
});

test('parler : événement debut au démarrage', async () => {
  lectureNeuve();
  let debut = 0;
  await voix.parler('Bonjour !', 'perroquet', { debut: () => debut++ });
  assert.equal(debut, 1);
  assert.equal(morceaux.length, 1);
});

test('parler : texte vide ne fait rien', async () => {
  lectureNeuve();
  const avant = morceaux.length;
  await voix.parler('   ', 'chat', {});
  assert.equal(morceaux.length, avant);
});

test('arreter() : interrompt sans bloquer', async () => {
  const v = await import('../public/voix.js?cas=interruption');
  const debut = morceaux.length;
  const p = v.parler('Phrase un. Phrase deux. Phrase trois. Phrase quatre.', 'chat', {});
  v.arreter();
  await p; // se résout, ne bloque pas
  assert.ok(morceaux.length - debut < 4, 'lecture interrompue');
});

test('sans synthèse vocale, tout se résout sans rien faire', async () => {
  delete globalThis.window.speechSynthesis;
  const v = await import('../public/voix.js?cas=sans-synthese');
  assert.equal(v.voixDisponible, false);
  await v.parler('Bonjour', 'chat', {});
  v.arreter();
  assert.equal(v.parleEnCeMoment(), false);
});
