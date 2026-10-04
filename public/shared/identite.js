// Identité visuelle de Tehis : couleurs par agent, icônes SVG, vignettes, logo.
// Les icônes sont dessinées en stroke (24x24, currentColor) dans l'esprit des icônes existantes de l'app.

export const COULEURS_AGENTS = {
  compagnon: '#0E7C86',
  vendeur: '#EA580C',
  redaction: '#7C3AED',
  emploi: '#2563EB',
  budget: '#CA8A04',
  finance: '#059669',
  demarches: '#64748B',
  repetiteur: '#DB2777',
  organisation: '#0284C7',
  sante: '#DC2626',
  logement: '#92400E',
  dev: '#334155'
};

const svg = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONES_SVG = {
  compagnon: svg('<circle cx="8.5" cy="9" r="1.6"/><circle cx="12" cy="7.2" r="1.6"/><circle cx="15.5" cy="9" r="1.6"/><path d="M12 11.5c-2.8 0-5.5 2.2-5.5 4.6 0 1.5 1.2 2.4 2.7 2.4 1 0 1.8-.5 2.8-.5s1.8.5 2.8.5c1.5 0 2.7-.9 2.7-2.4 0-2.4-2.7-4.6-5.5-4.6z"/>'),
  vendeur: svg('<path d="M5.5 8h13l-1 12.5h-11z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
  redaction: svg('<path d="M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19z"/><path d="M14.5 6l3.5 3.5"/>'),
  emploi: svg('<rect x="3.5" y="8" width="17" height="12" rx="2.5"/><path d="M9 8V6.5A2.5 2.5 0 0 1 11.5 4h1A2.5 2.5 0 0 1 15 6.5V8"/><path d="M3.5 13h17"/>'),
  budget: svg('<ellipse cx="12" cy="5.5" rx="7" ry="2.8"/><path d="M5 5.5v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/><path d="M5 11.5v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>'),
  finance: svg('<path d="M4 4v16h16"/><path d="M7 15l4-4 3 3 5-6"/><path d="M16 8h3v3"/>'),
  demarches: svg('<path d="M3.5 9.5L12 4l8.5 5.5"/><path d="M6 10v8M10 10v8M14 10v8M18 10v8"/><path d="M4 20.5h16"/>'),
  repetiteur: svg('<path d="M2.5 9L12 4.5 21.5 9 12 13.5z"/><path d="M6.5 10.8v4.4c0 1.6 2.5 2.8 5.5 2.8s5.5-1.2 5.5-2.8v-4.4"/><path d="M21.5 9v5"/>'),
  organisation: svg('<rect x="4" y="5.5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/><path d="M9 14.5l2 2 4-4.5"/>'),
  sante: svg('<path d="M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.5c0 5.8-7.5 10.4-7.5 10.4z"/><path d="M7 12h3l1.5-2.5L13 13l1-1.5H17"/>'),
  logement: svg('<path d="M4 11.5L12 4.5l8 7"/><path d="M6 10.5V20h12v-9.5"/>'),
  dev: svg('<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5"/>')
};

/** Vignette colorée d'un agent : <span class="vignette" style="--vc:...">svg</span>. */
export function vignetteAgent(id, extra = '') {
  const c = COULEURS_AGENTS[id] || COULEURS_AGENTS.compagnon;
  const icone = ICONES_SVG[id] || ICONES_SVG.compagnon;
  return `<span class="vignette${extra ? ` ${extra}` : ''}" style="--vc:${c}">${icone}</span>`;
}

/** Couleur d'un agent (repli : lagune). */
export const couleurAgent = (id) => COULEURS_AGENTS[id] || COULEURS_AGENTS.compagnon;

/** État vide illustré : icône douce + titre + texte. */
export function etatVide(icone, titre, texte) {
  return `<div class="etat-vide"><span class="etat-vide-illu">${icone}</span><strong>${titre}</strong><p class="muted small">${texte}</p></div>`;
}

/** Logo Tehis : tête de chat stylisée dans un médaillon lagune. */
export function logoTehis(taille = 40) {
  return `<span class="logo-tehis" style="width:${taille}px;height:${taille}px" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect width="48" height="48" rx="14" fill="#0E7C86"/><path d="M14 20l-2.5-7L19 16.5c2-1.2 4-1.8 5-1.8s3 .6 5 1.8l7.5-3.5L34 20c1.2 1.8 2 3.9 2 6a10 10 0 1 1-20 0c0-2.1.8-4.2 2-6z" fill="#fff"/><circle cx="19.5" cy="25" r="1.6" fill="#0E7C86"/><circle cx="28.5" cy="25" r="1.6" fill="#0E7C86"/><path d="M21 30.5c1.2 1 2.2 1.5 3 1.5s1.8-.5 3-1.5" stroke="#0E7C86" stroke-width="1.8" stroke-linecap="round"/></svg></span>`;
}
