// Voix naturelle (OpenAI simulé) : voix par espèce, cache, transcription, formats refusés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthetiser, transcrire, typeAudioAccepte, quotaVoix, alerteVoix } from '../server/voix-ia.js';

function fauxOpenAI() {
  const appels = [];
  const f = async (url, opts) => {
    appels.push({ url, opts });
    if (url.endsWith('/v1/audio/speech')) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    if (url.endsWith('/v1/audio/transcriptions')) return Response.json({ text: ' Bonjour Kiki, une pharmacie de garde à Yopougon ' });
    return new Response('?', { status: 404 });
  };
  f.appels = appels;
  return f;
}

test('Synthèse : voix de l\'espèce, consignes de ton, réécoute servie par le cache', async () => {
  const f = fauxOpenAI();
  const a = await synthetiser('Salut ! Le loyer fait 75 000 francs CFA.', 'elephant', f);
  assert.equal(a.audio.length, 3);
  const corps = JSON.parse(f.appels[0].opts.body);
  assert.equal(corps.voice, 'ash');
  assert.equal(corps.model, 'gpt-4o-mini-tts');
  assert.match(corps.instructions, /grave/);
  const b = await synthetiser('Salut ! Le loyer fait 75 000 francs CFA.', 'elephant', f);
  assert.equal(b.enCache, true);
  assert.equal(f.appels.length, 1);
});

test('Transcription : français, vocabulaire ivoirien, texte nettoyé', async () => {
  const f = fauxOpenAI();
  const t = await transcrire(Buffer.alloc(4000, 1), 'audio/webm;codecs=opus', f);
  assert.equal(t, 'Bonjour Kiki, une pharmacie de garde à Yopougon');
  const form = f.appels[0].opts.body;
  assert.equal(form.get('language'), 'fr');
  assert.match(form.get('prompt'), /Yopougon/);
  assert.equal(form.get('file').name, 'voix.webm');
});

test('Formats et quotas', async () => {
  assert.equal(typeAudioAccepte('audio/mp4'), 'mp4');
  assert.equal(typeAudioAccepte('video/mp4'), null);
  await assert.rejects(transcrire(Buffer.alloc(10), 'text/plain', fauxOpenAI()), /Format/);
  assert.equal(quotaVoix({ offre: 'gratuit' }).caracteres, 3000);
  assert.equal(quotaVoix({ role: 'admin' }).transcriptions, Infinity);
  assert.match(alerteVoix({ statut: 401 }), /OPENAI_API_KEY/);
});
