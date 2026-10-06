// Voix du compagnon par OpenAI : synthèse (texte → mp3) et transcription (voix → texte).
// Sans OPENAI_API_KEY, l'app garde la voix du téléphone et la dictée du navigateur.
import { createHash } from 'node:crypto';

const BASE = (process.env.OPENAI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '');
const CLE = () => process.env.OPENAI_API_KEY || '';
export const voixIAActive = () => Boolean(CLE());
const MODELE_TTS = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const MODELE_STT = process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';

// Une voix et une façon de parler par espèce.
const TON_COMMUN = "Tu parles français avec chaleur et naturel, comme un ami d'Abidjan : phrases claires, débit posé, montants en francs CFA bien articulés. Pas de ton publicitaire.";
export const VOIX_ESPECES = {
  chat: { voix: 'coral', ton: 'Voix vive et espiègle, souriante.' },
  elephant: { voix: 'ash', ton: 'Voix grave, rassurante et patiente, comme un grand frère.' },
  perroquet: { voix: 'nova', ton: 'Voix enjouée et rapide, pleine d\'énergie.' },
  tortue: { voix: 'sage', ton: 'Voix calme et douce, posée, qui prend son temps.' }
};

// Caractères lus par jour (coût) et transcriptions par jour, selon l'offre.
export const QUOTAS_VOIX = {
  gratuit: { caracteres: 3000, transcriptions: 10 },
  plus: { caracteres: 20000, transcriptions: 60 },
  pro: { caracteres: 60000, transcriptions: 200 }
};
export const quotaVoix = (compte) => (compte?.role === 'admin' ? { caracteres: Infinity, transcriptions: Infinity } : QUOTAS_VOIX[compte?.offre] || QUOTAS_VOIX.gratuit);

// Petit cache : réécouter une réponse ne coûte rien.
const cache = new Map();
const MAX_CACHE = 60;

export async function synthetiser(texte, espece = 'chat', fetchImpl = fetch) {
  const t = String(texte || '').trim().slice(0, 1200);
  if (!t) throw Object.assign(new Error('Texte vide'), { statut: 400 });
  const p = VOIX_ESPECES[espece] || VOIX_ESPECES.chat;
  const cle = createHash('sha256').update(`${MODELE_TTS}|${p.voix}|${t}`).digest('hex');
  if (cache.has(cle)) { const v = cache.get(cle); cache.delete(cle); cache.set(cle, v); return { audio: v, enCache: true }; }
  const r = await fetchImpl(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CLE()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODELE_TTS, voice: p.voix, input: t, instructions: `${TON_COMMUN} ${p.ton}`, response_format: 'mp3' }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!r.ok) throw Object.assign(new Error(`OpenAI TTS ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`), { statut: r.status });
  const audio = Buffer.from(await r.arrayBuffer());
  cache.set(cle, audio);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return { audio, enCache: false };
}

const TYPES_AUDIO = { 'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
export const typeAudioAccepte = (type) => TYPES_AUDIO[String(type || '').split(';')[0].trim().toLowerCase()] || null;

export async function transcrire(audio, type, fetchImpl = fetch) {
  const ext = typeAudioAccepte(type);
  if (!ext) throw Object.assign(new Error('Format audio non pris en charge'), { statut: 415 });
  if (!audio?.length || audio.length > 8_000_000) throw Object.assign(new Error('Enregistrement vide ou trop long'), { statut: 413 });
  const form = new FormData();
  form.append('file', new Blob([audio], { type: String(type).split(';')[0] }), `voix.${ext}`);
  form.append('model', MODELE_STT);
  form.append('language', 'fr');
  form.append('prompt', "Conversation en français de Côte d'Ivoire : Abidjan, Yopougon, Cocody, Abobo, Treichville, FCFA, tontine, attiéké, garba, maquis, Mobile Money, Orange Money, Wave.");
  const r = await fetchImpl(`${BASE}/v1/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${CLE()}` }, body: form, signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw Object.assign(new Error(`OpenAI STT ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`), { statut: r.status });
  const d = await r.json();
  return String(d.text || '').trim();
}

/** Ligne de journal pour l'équipe quand OpenAI refuse (clé, crédit). */
export function alerteVoix(e) {
  const m = e?.message || '';
  if (e?.statut === 401) return 'CLÉ OPENAI REFUSÉE : vérifier OPENAI_API_KEY dans Render';
  if (e?.statut === 429 && /quota|billing|insufficient/i.test(m)) return 'CRÉDIT OPENAI ÉPUISÉ : recharger sur platform.openai.com (Billing)';
  if (e?.statut === 404) return `MODÈLE OPENAI INTROUVABLE : vérifier OPENAI_TTS_MODEL (${MODELE_TTS}) et OPENAI_STT_MODEL (${MODELE_STT})`;
  return null;
}
