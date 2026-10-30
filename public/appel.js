// Appel vocal conversationnel avec le compagnon.
// Boucle : Parler (micro) → transcription → envoi au compagnon → réponse parlée → Parler…
// Réutilise /api/voix/transcrire, envoyer() et parler() existants, avec les quotas voix par offre.
// V1 : tour par tour explicite (pas de full-duplex temps réel).
import { envoyer, infosAppel } from './app.js';
import { parler, arreter, debloquer, voixDisponible } from './voix.js';
import { toast } from './shared/ui.js';

const $ = (s) => document.querySelector(s);
const EMOJIS = { chat: '🐱', elephant: '🐘', perroquet: '🦜', tortue: '🐢' };
const DUREE_MAX_MS = 60_000;

let enCours = false;
let phase = 'repos'; // repos | pret | ecoute | transcription | reflexion | parole
let stream = null;
let rec = null;
let chunks = [];
let t0 = 0;
let chronoId = null;
let minuteurEnvoi = null;
let muet = false;
let legendes = true;

export function appelDisponible() {
  return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && voixDisponible);
}

function setPhase(p, statut) {
  phase = p;
  const o = $('#appel');
  if (o) o.dataset.phase = p;
  const st = $('#appel-statut');
  if (st && statut) st.textContent = statut;
  const b = $('#appel-parler');
  if (b) {
    const actif = p === 'pret' || p === 'ecoute';
    b.disabled = !actif || muet;
    b.classList.toggle('en-ecoute', p === 'ecoute');
    b.innerHTML = p === 'ecoute'
      ? '<span aria-hidden="true">⏹</span> Envoyer'
      : '<span aria-hidden="true">🎙</span> Parler';
  }
}

function log(role, texte) {
  if (!legendes) return;
  const z = $('#appel-st');
  if (!z) return;
  z.hidden = false;
  const p = document.createElement('p');
  p.className = `appel-msg ${role}`;
  p.textContent = texte;
  z.appendChild(p);
  z.scrollTop = z.scrollHeight;
}

function chrono() {
  const s = Math.floor((Date.now() - t0) / 1000);
  const el = $('#appel-chrono');
  if (el) el.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export async function demarrerAppel() {
  if (enCours) return;
  if (!appelDisponible()) { toast('Appel vocal indisponible sur cet appareil.'); return; }
  let s;
  try {
    s = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast('Micro inaccessible : autorise l’accès au micro pour appeler.');
    return;
  }
  stream = s;
  enCours = true;
  muet = false;
  window.__appelEnCours = true;
  debloquer();
  const { espece } = infosAppel();
  const av = $('#appel-avatar');
  if (av) av.textContent = EMOJIS[espece] || '🦜';
  $('#appel').hidden = false;
  document.body.classList.add('en-appel');
  $('#appel-muet')?.setAttribute('aria-pressed', 'false');
  t0 = Date.now();
  chrono();
  chronoId = setInterval(chrono, 1000);
  setPhase('pret', 'À toi — touche « Parler ».');
}

export function raccrocher() {
  if (!enCours) return;
  enCours = false;
  window.__appelEnCours = false;
  arreter();
  stopRec();
  clearTimeout(minuteurEnvoi);
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  clearInterval(chronoId);
  $('#appel').hidden = true;
  document.body.classList.remove('en-appel');
  setPhase('repos');
  const z = $('#appel-st');
  if (z) { z.innerHTML = ''; z.hidden = true; }
}

function stopRec() {
  clearTimeout(minuteurEnvoi);
  if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch {} }
  rec = null;
  chunks = [];
}

function demarrerEcoute() {
  if (!enCours || muet || phase !== 'pret' || !stream) return;
  chunks = [];
  const mime = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : undefined;
  try {
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  } catch {
    toast('Enregistrement impossible sur cet appareil.');
    return;
  }
  rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
  rec.onstop = traiterAudio;
  rec.start(250);
  setPhase('ecoute', 'Écoute… — touche « Envoyer » quand tu as fini.');
  minuteurEnvoi = setTimeout(() => { if (phase === 'ecoute') traiterAudio(); }, DUREE_MAX_MS);
}

async function traiterAudio() {
  if (phase !== 'ecoute') return;
  clearTimeout(minuteurEnvoi);
  const blob = new Blob(chunks, { type: rec?.mimeType || 'audio/mp4' });
  chunks = [];
  rec = null;
  if (!blob.size) { setPhase('pret', 'À toi — touche « Parler ».'); return; }
  setPhase('transcription', 'Transcription…');
  let texte = '';
  try {
    const r = await fetch('/api/voix/transcrire', {
      method: 'POST',
      headers: { 'Content-Type': blob.type },
      credentials: 'same-origin',
      body: blob,
    });
    if (r.status === 404) throw Object.assign(new Error('Transcription vocale non activée.'), { code: 404 });
    if (r.status === 429) throw Object.assign(new Error('Transcriptions épuisées pour aujourd’hui.'), { code: 429 });
    if (!r.ok) throw new Error(`Transcription impossible (erreur ${r.status}).`);
    texte = String((await r.json()).texte || '').trim();
  } catch (e) {
    toast(e.message || 'Transcription impossible.');
    if (enCours) setPhase('pret', 'À toi — touche « Parler ».');
    return;
  }
  if (!texte) {
    if (enCours) setPhase('pret', 'Je n’ai rien entendu — touche « Parler » pour réessayer.');
    return;
  }
  log('moi', texte);
  setPhase('reflexion', 'Tehis réfléchit…');
  let reponse = '';
  try {
    reponse = await envoyer(texte);
  } catch {
    reponse = '';
  }
  if (!enCours) return;
  reponse = String(reponse || '').trim();
  if (!reponse) { setPhase('pret', 'À toi — touche « Parler ».'); return; }
  log('tehis', reponse);
  setPhase('parole', 'Tehis parle…');
  const { espece } = infosAppel();
  try {
    await parler(reponse, espece, { fin: () => {} });
  } catch {}
  if (!enCours) return;
  if (muet) setPhase('pret', 'En pause — réactive le micro pour continuer.');
  else setPhase('pret', 'À toi — touche « Parler ».');
}

function basculerMuet() {
  muet = !muet;
  $('#appel-muet')?.setAttribute('aria-pressed', String(muet));
  if (muet) {
    stopRec();
    arreter();
    if (enCours) setPhase('pret', 'En pause.');
  } else if (enCours) {
    setPhase('pret', 'À toi — touche « Parler ».');
  }
}

function basculerLegendes() {
  legendes = !legendes;
  $('#appel-legende')?.setAttribute('aria-pressed', String(legendes));
  const z = $('#appel-st');
  if (z) z.hidden = !legendes;
}

/** Branche le bouton et l'overlay. À appeler au démarrage. */
export function initAppel() {
  const btn = $('#btn-appel');
  if (btn) {
    if (appelDisponible()) {
      btn.hidden = false;
      btn.addEventListener('click', demarrerAppel);
    }
    const micro = $('#btn-micro');
    if (micro && !micro.hidden) btn.hidden = false;
  }
  $('#appel-parler')?.addEventListener('click', () => {
    if (phase === 'pret') demarrerEcoute();
    else if (phase === 'ecoute') traiterAudio();
  });
  $('#appel-fin')?.addEventListener('click', raccrocher);
  $('#appel-muet')?.addEventListener('click', basculerMuet);
  $('#appel-legende')?.addEventListener('click', basculerLegendes);

}

// Auto-init quand le DOM est prêt (module chargé séparément d'app.js).
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAppel);
else initAppel();
