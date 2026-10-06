// Voix du compagnon : voix naturelle (serveur, OpenAI) quand elle est configurée,
// sinon synthèse vocale du navigateur (gratuite, voix françaises du téléphone).
// Chaque espèce a sa voix (ou sa hauteur et son débit). Sur iPhone, le son doit être « débloqué » par un geste.

const synth = window.speechSynthesis;
const synthDisponible = Boolean(synth && window.SpeechSynthesisUtterance);
export let voixDisponible = synthDisponible;

/* ---------- Voix naturelle (serveur) ---------- */
let obtenirAudio = null; // (texte, espece) => Promise<Blob>
let lecteur = null;
let ctxAudio = null;
/** Active la voix naturelle : fn(texte, espece) renvoie le mp3 (Blob). */
export function configurerVoixIA(fn) {
  obtenirAudio = typeof fn === 'function' ? fn : null;
  voixDisponible = synthDisponible || Boolean(obtenirAudio && window.Audio);
}
export const voixNaturelle = () => Boolean(obtenirAudio);

const PROFILS = {
  chat: { pitch: 1.25, rate: 1.05 },
  elephant: { pitch: 0.7, rate: 0.92 },
  perroquet: { pitch: 1.5, rate: 1.12 },
  tortue: { pitch: 0.9, rate: 0.85 }
};

let voixFr = null;
function choisirVoix() {
  const toutes = synth.getVoices().filter((v) => /^fr(-|_|$)/i.test(v.lang));
  // Préférence : voix locales de qualité, français de France puis autres variantes.
  const score = (v) => (v.localService ? 2 : 0) + (/fr[-_]FR/i.test(v.lang) ? 2 : 0) + (/premium|enhanced|amélioré|natural|google/i.test(v.name) ? 3 : 0);
  voixFr = toutes.sort((a, b) => score(b) - score(a))[0] || null;
}
if (voixDisponible) {
  choisirVoix();
  synth.addEventListener?.('voiceschanged', choisirVoix);
}

// Fichier WAV de 10 ms de silence (8 kHz, 8 bits), construit ici plutôt que copié.
const SILENCE = (() => {
  const n = 80, b = new Uint8Array(44 + n), v = new DataView(b.buffer);
  const ecrire = (o, t) => [...t].forEach((c, i) => { b[o + i] = c.charCodeAt(0); });
  ecrire(0, 'RIFF'); v.setUint32(4, 36 + n, true); ecrire(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true);
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); ecrire(36, 'data'); v.setUint32(40, n, true); b.fill(128, 44);
  let bin = ''; b.forEach((x) => { bin += String.fromCharCode(x); });
  return `data:audio/wav;base64,${btoa(bin)}`;
})();

/** À appeler pendant un geste de l'utilisateur (toucher) : autorise la voix sur iPhone. */
let debloquee = false;
export function debloquer() {
  if (debloquee) return;
  if (synthDisponible) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    synth.speak(u);
  }
  if (window.Audio) {
    try {
      lecteur = lecteur || new Audio();
      lecteur.setAttribute('playsinline', '');
      // Un son vide joué pendant le geste autorise les lectures suivantes sur iPhone.
      lecteur.src = SILENCE;
      lecteur.play().catch(() => {});
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC && !ctxAudio) ctxAudio = new AC();
      ctxAudio?.resume?.().catch(() => {});
    } catch { /* lecture non autorisée : la voix du téléphone servira */ }
  }
  debloquee = true;
}

/** Transforme une réponse Markdown en texte agréable à écouter. */
export function texteParle(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, ' (voir le code à l\'écran) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' le lien ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-•*]\s+/gm, '')
    .replace(/\*\*|__|[*_]/g, '')
    .replace(/(\d)\s(?=\d{3}\b)/g, '$1')      // 25 000 -> 25000, lu « vingt-cinq mille »
    .replace(/\bFCFA\b/g, 'francs CFA')
    .replace(/\bM\.(?=\s|$)/g, 'monsieur')
    .replace(/\bMme(?=\s|$)/g, 'madame')
    .replace(/\bMlle(?=\s|$)/g, 'mademoiselle')
    .replace(/\bDr(?=\s|$)/g, 'docteur')
    .replace(/\bPr(?=\s|$)/g, 'professeur')
    .replace(/\bSt(?=\s|$)/g, 'saint')
    .replace(/\bSte(?=\s|$)/g, 'sainte')
    .replace(/\bSVP\b/gi, "s'il vous plaît")
    .replace(/\bRDV\b/gi, 'rendez-vous')
    .replace(/n°\s*/gi, 'numéro ')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

// Découpe en phrases : les longues lectures s'arrêtent parfois sur iPhone.
function phrases(t) {
  return t.split(/(?<=[.!?…:;])\s+|\n+/).map((x) => x.trim()).filter(Boolean)
    .flatMap((p) => (p.length > 220 ? decouperLong(p) : [p]));
}

// Découpe un long passage en morceaux : on coupe de préférence après une
// virgule ou un point-virgule pour des pauses naturelles, puis on regroupe.
function decouperLong(p, max = 200) {
  const morceaux = [];
  let courant = '';
  const pousser = () => { const c = courant.trim(); if (c) morceaux.push(c); courant = ''; };
  const emietter = (s) => {
    for (const m of s.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) || []) {
      const c = m.trim(); if (c) morceaux.push(c);
    }
  };
  for (const segment of p.split(/(?<=[,;])\s+/).map((x) => x.trim()).filter(Boolean)) {
    if (segment.length > max) { pousser(); emietter(segment); }
    else if ((courant + ' ' + segment).trim().length > max) { pousser(); courant = segment; }
    else courant = `${courant} ${segment}`.trim();
  }
  pousser();
  return morceaux.length ? morceaux : [p];
}

/** Regroupe les phrases en morceaux de 450 caractères au plus : moins d'appels, première phrase vite prête. */
export function morceauxNaturels(t, max = 450) {
  const ps = phrases(t);
  const out = [];
  let courant = '';
  for (const p of ps) {
    // Le premier morceau reste court pour que la voix démarre tout de suite.
    const limite = out.length === 0 ? 160 : max;
    if (courant && (courant + ' ' + p).length > limite) { out.push(courant); courant = p; } else courant = `${courant} ${p}`.trim();
  }
  if (courant) out.push(courant);
  return out;
}

/** Enveloppe de volume (toutes les 60 ms) pour animer le compagnon au rythme de la vraie voix. */
async function enveloppe(blob) {
  try {
    if (!ctxAudio) return null;
    const donnees = await ctxAudio.decodeAudioData(await blob.arrayBuffer());
    const canal = donnees.getChannelData(0);
    const pas = Math.round(donnees.sampleRate * 0.06);
    const env = [];
    for (let i = 0; i < canal.length; i += pas) {
      let somme = 0;
      for (let j = i; j < Math.min(i + pas, canal.length); j++) somme += canal[j] * canal[j];
      env.push(Math.sqrt(somme / pas));
    }
    const max = Math.max(...env, 0.0001);
    return env.map((v) => v / max);
  } catch { return null; }
}

function parlerNaturel(md, espece, ev, id) {
  const morceaux = morceauxNaturels(texteParle(md));
  if (!morceaux.length) return Promise.resolve(true);
  lecteur = lecteur || new Audio();
  return new Promise((resolve) => {
    let i = 0;
    let suivantAudio = obtenirAudio(morceaux[0], espece);
    let anim = null;
    const fini = (ok) => { cancelAnimationFrame(anim); if (id === session && ok) ev.fin?.(); resolve(ok); };
    const jouer = async () => {
      if (id !== session) return fini(true);
      if (i >= morceaux.length) return fini(true);
      let blob;
      try { blob = await suivantAudio; } catch { return fini(false); } // échec : la voix du téléphone prend le relais
      if (id !== session) return fini(true);
      i++;
      if (i < morceaux.length) suivantAudio = obtenirAudio(morceaux[i], espece); // préchargement du morceau suivant
      const env = await enveloppe(blob);
      const url = URL.createObjectURL(blob);
      lecteur.src = url;
      lecteur.onended = () => { URL.revokeObjectURL(url); jouer(); };
      lecteur.onerror = () => { URL.revokeObjectURL(url); fini(false); };
      try { await lecteur.play(); } catch { URL.revokeObjectURL(url); return fini(false); }
      if (i === 1) ev.debut?.();
      let dernier = 0, precedent = 0;
      const boucle = () => {
        if (id !== session || lecteur.paused) return;
        const t = performance.now();
        const v = env ? env[Math.floor(lecteur.currentTime / 0.06)] || 0 : (Math.sin(t / 130) > 0.6 ? 1 : 0);
        if (v > 0.45 && v > precedent && t - dernier > 140) { ev.mot?.(); dernier = t; }
        precedent = v;
        anim = requestAnimationFrame(boucle);
      };
      anim = requestAnimationFrame(boucle);
    };
    jouer();
  });
}

let session = 0;
/**
 * Lit le texte. ev = { debut(), mot(), fin() }.
 * Voix naturelle si elle est configurée, sinon (ou en cas d'échec) voix du téléphone.
 * Renvoie une promesse résolue à la fin (ou à l'arrêt).
 */
export async function parler(md, espece = 'chat', ev = {}) {
  if (!voixDisponible) return;
  arreter();
  const id = ++session;
  if (obtenirAudio) {
    const ok = await parlerNaturel(md, espece, ev, id);
    if (ok || id !== session || !synthDisponible) { if (!ok && id === session) ev.fin?.(); return; }
  }
  return parlerTelephone(md, espece, ev, id);
}

function parlerTelephone(md, espece, ev, id) {
  const morceaux = phrases(texteParle(md));
  if (!morceaux.length) return Promise.resolve();
  const profil = PROFILS[espece] || PROFILS.chat;
  return new Promise((resolve) => {
    let i = 0;
    let rythme = null;
    const finir = () => { clearInterval(rythme); if (id === session) ev.fin?.(); resolve(); };
    const suivant = () => {
      if (id !== session) return finir();
      if (i >= morceaux.length) return finir();
      const u = new SpeechSynthesisUtterance(morceaux[i++]);
      if (voixFr) u.voice = voixFr;
      u.lang = voixFr?.lang || 'fr-FR';
      u.pitch = profil.pitch; u.rate = profil.rate;
      let bornes = false;
      u.onboundary = (e) => { if (e.name === 'word' || e.name === undefined) { bornes = true; ev.mot?.(); } };
      u.onstart = () => {
        if (i === 1) ev.debut?.();
        // Si le navigateur ne signale pas les mots, on simule un rythme de parole.
        clearInterval(rythme);
        rythme = setInterval(() => { if (!bornes) ev.mot?.(); }, 260 / profil.rate);
      };
      u.onend = () => { clearInterval(rythme); suivant(); };
      u.onerror = () => { clearInterval(rythme); suivant(); };
      synth.speak(u);
    };
    suivant();
  });
}

export function arreter() {
  session++;
  if (lecteur && !lecteur.paused) lecteur.pause();
  if (synthDisponible) synth.cancel();
}

export const parleEnCeMoment = () => (lecteur && !lecteur.paused) || (synthDisponible && (synth.speaking || synth.pending));
