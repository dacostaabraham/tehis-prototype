// Voix du compagnon : synthèse vocale du navigateur (gratuite, voix françaises du téléphone).
// Chaque espèce a sa hauteur et son débit. Sur iPhone, la voix doit être « débloquée » par un geste.

const synth = window.speechSynthesis;
export const voixDisponible = Boolean(synth && window.SpeechSynthesisUtterance);

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

/** À appeler pendant un geste de l'utilisateur (toucher) : autorise la voix sur iPhone. */
let debloquee = false;
export function debloquer() {
  if (!voixDisponible || debloquee) return;
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  synth.speak(u);
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
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+\n/g, '\n')
    .trim();
}

// Découpe en phrases : les longues lectures s'arrêtent parfois sur iPhone.
function phrases(t) {
  return t.split(/(?<=[.!?…:;])\s+|\n+/).map((x) => x.trim()).filter(Boolean)
    .flatMap((p) => (p.length > 220 ? p.match(/.{1,200}(\s|$)/g) : [p]));
}

let session = 0;
/**
 * Lit le texte. ev = { debut(), mot(), fin() }.
 * Renvoie une promesse résolue à la fin (ou à l'arrêt).
 */
export function parler(md, espece = 'chat', ev = {}) {
  if (!voixDisponible) return Promise.resolve();
  arreter();
  const id = ++session;
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
  if (!voixDisponible) return;
  session++;
  synth.cancel();
}

export const parleEnCeMoment = () => voixDisponible && (synth.speaking || synth.pending);
