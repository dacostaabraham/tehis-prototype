// Application Tehis (prototype) : connexion, compagnon, agents, chat, calculs, mes affaires, réglages.
import { mountCompanion, ESPECES, HUMEURS } from './companion.js';
import { cascadeRentabilite, pointMort, fixerPrix, projection12Mois, estimationBFR, EXEMPLES_COURS } from './shared/finance.js';
import { budgetMensuel, planEpargne, tontine, EXEMPLES_BUDGET } from './shared/budget.js';
import { AGENTS, GROUPES, NOMS_OFFRES, accesAgent as accesCatalogue, estPerso } from './shared/agents.js';
import { initPerso, ouvrirCreation, ouvrirEdition } from './perso.js';
import { voixDisponible, parler, arreter, debloquer } from './voix.js';
import { markdown, echapper } from './shared/markdown.js';
import { carteResultat, carteDocument, carteSuggestion, carteOffreDev, carteValidation, noteActivite, blocSources, blocListe, brancherListes, actionsDocument, dateFr } from './cards.js';
import { toast } from './shared/ui.js';

const $ = (s) => document.querySelector(s);
const etat = { agent: 'compagnon', profil: {}, statut: {}, compagnon: null, envoi: false, photo: null, persos: { agents: [], limites: { agents: 1 }, offre: 'gratuit' } };

/* Agents de Tehis et agents créés par l'utilisateur (« perso:<id> »). */
const fichePerso = (id) => etat.persos.agents.find((a) => `perso:${a.id}` === id);
function accesAgent(id, profil) {
  if (!estPerso(id)) return accesCatalogue(id, profil);
  const f = fichePerso(id);
  if (!f) return { ok: false, raison: 'Agent introuvable.' };
  return f.verrouille ? { ok: false, raison: 'Agent verrouillé avec ton offre actuelle.' } : { ok: true };
}
function metaAgent(id) {
  if (!estPerso(id)) return AGENTS[id];
  const f = fichePerso(id);
  return { nom: f.nom, icone: f.icone, resume: f.resume, intro: `Je suis ${f.nom}. ${f.resume}`, suggestions: f.suggestions.length ? f.suggestions : ['Présente-toi', 'Que peux-tu faire pour moi ?'] };
}
async function chargerPersos() {
  try { etat.persos = await api('/api/persos'); } catch { /* garde l'état précédent */ }
}

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage plein ou indisponible */ } };

async function api(path, options = {}) {
  let r;
  try {
    r = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, credentials: 'same-origin' });
  } catch (e) {
    throw new Error('Pas de connexion : vérifie ton réseau puis réessaie.');
  }
  if (r.status === 401 && path !== '/api/login') { montrer('bienvenue'); throw new Error('Connexion requise'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erreur || `Erreur ${r.status}`);
  return data;
}

function montrer(vue) {
  for (const v of ['bienvenue', 'setup', 'app']) $(`#view-${v}`).hidden = v !== vue;
}

/* ---------- Bienvenue ---------- */
function afficherBienvenue() {
  const beta = etat.statut.motDePasseRequis && !etat.statut.authentifie;
  $('#bienvenue-go').hidden = beta;
  $('#login-form').hidden = !beta;
  montrer('bienvenue');
}
$('#bienvenue-go').addEventListener('click', async () => {
  lsSet('tehis_bienvenue', true);
  await demarrer();
});
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error'); err.hidden = true;
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    lsSet('tehis_bienvenue', true);
    await demarrer();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

/* ---------- Choix du compagnon ---------- */
let especeChoisie = 'chat';
function afficherSetup() {
  const grille = $('#species-grid');
  grille.innerHTML = '';
  especeChoisie = etat.profil.espece || 'chat';
  for (const e of ESPECES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'species'; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(e.id === especeChoisie));
    b.innerHTML = `<img alt="" src="/pets/${e.id}.jpg"><span>${e.nom}</span>`;
    b.addEventListener('click', () => {
      especeChoisie = e.id;
      grille.querySelectorAll('.species').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    });
    grille.appendChild(b);
  }
  $('#pet-name').value = etat.profil.nomCompagnon || 'Kiki';
  $('#first-name').value = etat.profil.prenom || '';
  montrer('setup');
}
$('#setup-done').addEventListener('click', async () => {
  etat.profil = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ espece: especeChoisie, nomCompagnon: $('#pet-name').value.trim() || 'Kiki', prenom: $('#first-name').value.trim() }) });
  await ouvrirApp();
});

/* ---------- Application ---------- */
async function ouvrirApp() {
  montrer('app');
  $('#demo-badge').hidden = !etat.statut.modeDemo;
  majBoutonVoix();
  if (!etat.compagnon) {
    etat.compagnon = await mountCompanion($('#stage'), etat.profil.espece || 'chat');
    $('#stage').addEventListener('mood', (e) => humeur(e.detail));
  } else {
    await etat.compagnon.setSpecies(etat.profil.espece || 'chat');
  }
  await chargerPersos();
  const memorise = lsGet('tehis_agent', 'compagnon');
  choisirAgent(accesAgent(memorise, etat.profil).ok ? memorise : 'compagnon');
  const panneau = new URLSearchParams(location.search).get('panneau');
  ouvrirPanneau(['affaires', 'calc', 'reglages'].includes(panneau) ? panneau : 'chat');
}

function humeur(m) {
  etat.compagnon?.setMood(m);
  $('#mood-label').textContent = HUMEURS[m] || HUMEURS.repos;
}

/* ---------- Agents ---------- */
function fermerDialogues() { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); }
document.querySelectorAll('dialog [data-fermer]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

$('#agent-btn').addEventListener('click', () => {
  const zone = $('#agents-liste');
  zone.innerHTML = '';
  for (const g of GROUPES) {
    const ids = Object.keys(AGENTS).filter((id) => AGENTS[id].groupe === g.id);
    zone.insertAdjacentHTML('beforeend', `<div class="groupe">${echapper(g.nom)}</div>`);
    for (const id of ids) {
      const a = AGENTS[id];
      const acces = accesAgent(id, etat.profil);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `agent-ligne${id === etat.agent ? ' actif' : ''}`;
      b.innerHTML = `<span class="agent-icone" aria-hidden="true">${a.icone}</span><span class="agent-texte"><strong>${echapper(a.nom)}</strong><span class="small muted">${echapper(a.resume)}</span></span>${acces.ok ? '' : `<span class="badge">${a.developpeur && !etat.profil.developpeur && acces.raison.includes('mode') ? 'Activer' : echapper(NOMS_OFFRES[a.offre])}</span>`}`;
      b.addEventListener('click', () => {
        if (acces.ok) { fermerDialogues(); choisirAgent(id); ouvrirPanneau('chat'); return; }
        if (a.developpeur && acces.raison.includes('mode')) { fermerDialogues(); ouvrirDialogueDev(); return; }
        b.querySelector('.agent-texte .small').textContent = acces.raison;
      });
      zone.appendChild(b);
    }
    if (g.id === 'base') ajouterMesAgents(zone);
  }
  $('#sheet-agents').showModal();
});

function ajouterMesAgents(zone) {
  const { agents, limites } = etat.persos;
  zone.insertAdjacentHTML('beforeend', `<div class="groupe">Mes agents <span class="muted">· ${agents.length}/${limites.agents}</span></div>`);
  for (const f of agents) {
    const id = `perso:${f.id}`;
    const ligne = document.createElement('div');
    ligne.className = `agent-ligne perso${id === etat.agent ? ' actif' : ''}${f.verrouille ? ' verrou' : ''}`;
    ligne.innerHTML = `<button type="button" class="agent-ouvrir"><span class="agent-icone" aria-hidden="true">${echapper(f.icone)}</span><span class="agent-texte"><strong>${echapper(f.nom)}</strong><span class="small muted">${echapper(f.verrouille ? 'Verrouillé avec ton offre actuelle' : f.resume)}</span></span></button><button type="button" class="agent-modifier" aria-label="Modifier ${echapper(f.nom)}">Modifier</button>`;
    ligne.querySelector('.agent-ouvrir').onclick = () => { if (f.verrouille) return; fermerDialogues(); choisirAgent(id); ouvrirPanneau('chat'); };
    ligne.querySelector('.agent-modifier').onclick = () => { fermerDialogues(); ouvrirEdition(f, etat.persos); };
    zone.appendChild(ligne);
  }
  const creer = document.createElement('button');
  creer.type = 'button';
  creer.className = 'agent-ligne creer';
  creer.innerHTML = `<span class="agent-icone" aria-hidden="true">＋</span><span class="agent-texte"><strong>Crée ton agent</strong><span class="small muted">Décris ton besoin, Tehis prépare l'agent</span></span>`;
  creer.onclick = () => { fermerDialogues(); ouvrirCreation(etat.persos); };
  zone.appendChild(creer);
}

initPerso({
  api,
  async apres(agent) {
    await chargerPersos();
    if (agent) { choisirAgent(`perso:${agent.id}`); ouvrirPanneau('chat'); }
    else if (!accesAgent(etat.agent, etat.profil).ok) choisirAgent('compagnon');
  }
});

function choisirAgent(agent) {
  etat.agent = agent;
  lsSet('tehis_agent', agent);
  const a = metaAgent(agent);
  $('#agent-icone').textContent = a.icone;
  $('#agent-nom').textContent = agent === 'compagnon' ? (etat.profil.nomCompagnon || 'Compagnon') : a.nom;
  $('#input').placeholder = agent === 'compagnon' ? `Écris à ${etat.profil.nomCompagnon || 'ton compagnon'}…` : 'Ton message…';
  afficherHistorique();
}

/* ---------- Panneaux ---------- */
document.querySelectorAll('.bottomnav button').forEach((b) => b.addEventListener('click', () => ouvrirPanneau(b.dataset.panel)));
$('#btn-settings').addEventListener('click', () => ouvrirPanneau('reglages'));
function ouvrirPanneau(p) {
  document.querySelectorAll('.bottomnav button').forEach((b) => (b.dataset.panel === p ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  for (const id of ['chat', 'calc', 'affaires', 'reglages']) $(`#panel-${id}`).hidden = id !== p;
  $('#view-app').classList.toggle('compact', p !== 'chat');
  if (p === 'calc') afficherCalcul(calculCourant);
  if (p === 'affaires') afficherAffaires();
  if (p === 'reglages') afficherReglages();
}

/* ---------- Chat ---------- */
const cleHisto = (agent = etat.agent) => `tehis_chat_${agent}`;
const ctxCartes = {
  api,
  choisirAgent: (id) => { if (accesAgent(id, etat.profil).ok) choisirAgent(id); else ouvrirDialogueDev(); },
  ouvrirDialogueDev: () => ouvrirDialogueDev()
};

function rendreItem(it, items) {
  const zone = $('#messages');
  if (it.type === 'tool') zone.appendChild(carteResultat(it.result, ctxCartes));
  else if (it.type === 'document') zone.appendChild(carteDocument(it.doc));
  else if (it.type === 'suggestion') zone.appendChild(carteSuggestion(it.data, ctxCartes));
  else if (it.type === 'devoffer') zone.appendChild(carteOffreDev(ctxCartes));
  else if (it.type === 'approval') zone.appendChild(carteValidation(it, { ...ctxCartes, sauver: () => lsSet(cleHisto('dev'), items), apresDecision: suiteValidation }));
  else if (it.type === 'activite') zone.appendChild(noteActivite(it.texte));
  else if (it.type === 'sources') zone.appendChild(blocSources(it.sources));
  else if (it.type === 'memory') { const n = noteActivite(`Retenu : ${it.fait}`); zone.appendChild(n); }
  else if (it.masque) return;
  else if (it.auto) zone.appendChild(noteActivite(it.content.split('\n')[0]));
  else ajouterBulle(it.role === 'user' ? 'user' : 'bot', it.content, it.photo);
}

/* Grille de découverte des agents, visible tant que l'utilisateur n'a rien essayé. */
function grilleDecouverte() {
  const cont = document.createElement('div');
  cont.className = 'decouverte';
  const titre = document.createElement('p');
  titre.className = 'decouverte-titre';
  titre.textContent = 'Découvre mes agents';
  cont.appendChild(titre);
  const g = document.createElement('div');
  g.className = 'decouverte-grille';
  for (const [id, a] of Object.entries(AGENTS)) {
    if (id === 'compagnon' || id === 'dev') continue;
    const acces = accesAgent(id, etat.profil);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'decouverte-carte';
    b.innerHTML = `<span class="agent-icone" aria-hidden="true">${a.icone}</span><span>${echapper(a.nom)}</span>${acces.ok ? '' : `<span class="badge mini">${echapper(NOMS_OFFRES[a.offre])}</span>`}`;
    b.setAttribute('aria-label', `${a.nom} : ${a.resume}${acces.ok ? '' : ` (${acces.raison})`}`);
    b.addEventListener('click', () => {
      if (!acces.ok) { toast(acces.raison); return; }
      choisirAgent(id);
    });
    g.appendChild(b);
  }
  cont.appendChild(g);
  return cont;
}

function afficherHistorique() {
  const zone = $('#messages');
  zone.innerHTML = '';
  const brut = lsGet(cleHisto(), []);
  // Retire les messages restés sans réponse et renvoyés à l'identique (anciennes versions).
  const items = brut.filter((it, i) => {
    if (it.role !== 'user') return true;
    const suivant = brut.slice(i + 1).find((x) => x.role);
    return !(suivant?.role === 'user' && suivant.content === it.content);
  });
  if (items.length !== brut.length) lsSet(cleHisto(), items);
  const a = metaAgent(etat.agent);
  if (!items.length) {
    ajouterBulle('bot', etat.agent === 'compagnon'
      ? `Salut${etat.profil.prenom ? ` ${etat.profil.prenom}` : ''} ! Moi c'est ${etat.profil.nomCompagnon || 'Kiki'}. De quoi veux-tu parler ?`
      : a.intro);
    if (etat.agent === 'compagnon') zone.appendChild(grilleDecouverte());
  }
  for (const it of items) rendreItem(it, items);
  const sug = $('#suggestions');
  sug.innerHTML = '';
  for (const s of a.suggestions) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = s;
    b.addEventListener('click', () => { debloquer(); envoyer(s); });
    sug.appendChild(b);
  }
  zone.scrollTop = zone.scrollHeight;
}

/* ---------- Voix ---------- */
let lectureAuto = lsGet('tehis_voix', true);
function majBoutonVoix() {
  const b = $('#btn-voix');
  b.hidden = !voixDisponible;
  b.setAttribute('aria-pressed', String(lectureAuto));
  b.setAttribute('aria-label', lectureAuto ? 'Lecture à voix haute activée' : 'Lecture à voix haute coupée');
}
$('#btn-voix').addEventListener('click', () => {
  debloquer();
  lectureAuto = !lectureAuto;
  lsSet('tehis_voix', lectureAuto);
  if (!lectureAuto) { arreter(); humeur('repos'); document.querySelectorAll('.ecouter.actif').forEach((x) => x.classList.remove('actif')); }
  majBoutonVoix();
});
function lire(texte, bouton) {
  debloquer();
  document.querySelectorAll('.ecouter.actif').forEach((x) => x.classList.remove('actif'));
  bouton?.classList.add('actif');
  return parler(texte, etat.profil.espece, {
    debut: () => humeur('parle'),
    mot: () => etat.compagnon?.impulsion?.(),
    fin: () => { bouton?.classList.remove('actif'); humeur('repos'); }
  });
}
function boutonEcoute(bulle, texte) {
  if (!voixDisponible || !texte?.trim() || bulle.querySelector('.ecouter')) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'ecouter'; b.setAttribute('aria-label', 'Écouter cette réponse');
  b.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"></path><path d="M16 9a4 4 0 0 1 0 6"></path></svg>Écouter';
  b.onclick = () => { if (b.classList.contains('actif')) { arreter(); b.classList.remove('actif'); humeur('repos'); } else lire(texte, b); };
  bulle.appendChild(b);
}

function ajouterBulle(qui, texte, photo) {
  const b = document.createElement('div');
  b.className = `msg ${qui}`;
  if (qui === 'bot') { b.innerHTML = markdown(texte); boutonEcoute(b, texte); }
  else { b.textContent = texte; if (photo) b.insertAdjacentHTML('afterbegin', '<span class="photo-tag">📷 photo</span> '); }
  $('#messages').appendChild(b);
  return b;
}

const input = $('#input');
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; });
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); $('#composer').requestSubmit(); } });
$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  debloquer();
  const t = input.value.trim();
  if (!t && !etat.photo) return;
  input.value = ''; input.style.height = 'auto';
  envoyer(t || 'Voici une photo.');
});

/* Photo jointe : redimensionnée sur le téléphone avant l'envoi (1 280 px, JPEG). */
$('#btn-photo').addEventListener('click', () => $('#photo-input').click());
$('#photo-input').addEventListener('change', async (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    etat.photo = await reduireImage(f);
    $('#piece-img').src = etat.photo;
    $('#piece-jointe').hidden = false;
  } catch { toast("Cette image n'a pas pu être lue."); }
});
$('#piece-retirer').addEventListener('click', retirerPhoto);
function retirerPhoto() { etat.photo = null; $('#piece-jointe').hidden = true; $('#piece-img').removeAttribute('src'); }
function reduireImage(fichier, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

/* Dictée vocale (navigateur) : Chrome Android et Safari récents. */
const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Reconnaissance) {
  const micro = $('#btn-micro');
  micro.hidden = false;
  let rec = null;
  micro.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new Reconnaissance();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    const base = input.value ? `${input.value.trim()} ` : '';
    rec.onresult = (ev) => { input.value = base + [...ev.results].map((r) => r[0].transcript).join(''); input.dispatchEvent(new Event('input')); };
    rec.onend = () => { rec = null; micro.classList.remove('actif'); micro.setAttribute('aria-label', 'Dicter un message'); };
    rec.onerror = (ev) => {
      rec?.stop();
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        const ph = input.placeholder;
        input.placeholder = 'Micro refusé : autorise-le dans le navigateur pour dicter';
        setTimeout(() => { input.placeholder = ph; }, 4000);
      }
    };
    micro.classList.add('actif'); micro.setAttribute('aria-label', 'Arrêter la dictée');
    rec.start();
  });
}

async function envoyer(texte, { auto = false, agent = etat.agent } = {}) {
  while (etat.envoi) await new Promise((r) => setTimeout(r, 200));
  if (!auto && !navigator.onLine) {
    afficherErreur('Tu es hors ligne : reconnecte-toi puis réessaie.', () => envoyer(texte, { agent }));
    return;
  }
  etat.envoi = true; $('#send').disabled = true;
  arreter();
  let aLire = '';
  const cle = cleHisto(agent);
  const items = lsGet(cle, []);
  const photo = auto ? null : etat.photo;
  retirerPhoto();
  items.push({ role: 'user', content: texte, ...(photo ? { photo: true } : {}), ...(auto ? { auto: true } : {}) });
  lsSet(cle, items);
  const indexUser = items.length - 1;
  const visible = agent === etat.agent;
  const zone = $('#messages');
  if (visible) rendreItem(items.at(-1), items);
  const bulleUser = visible ? zone.lastElementChild : null;
  let erreur = null;
  let bulle = visible ? ajouterBulle('bot', '') : document.createElement('div');
  bulle.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
  let courant = '';
  zone.scrollTop = zone.scrollHeight;

  const conversation = items.filter((i) => i.role).map((i) => ({ role: i.role, content: i.content }));
  if (photo) conversation.at(-1).images = [photo];
  const ajouter = (it) => { items.push(it); if (visible) rendreItem(it, items); };
  const coupure = () => {
    if (courant.trim()) {
      items.push({ role: 'assistant', content: courant.trim() });
      boutonEcoute(bulle, courant.trim());
      aLire += `${courant.trim()}\n\n`;
    } else bulle.remove();
    courant = '';
  };
  const nouvelleBulle = () => { bulle = visible ? ajouterBulle('bot', '') : document.createElement('div'); bulle.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>'; };

  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ agent, messages: conversation }) });
    if (!r.ok || !r.body) { const d = await r.json().catch(() => ({})); throw new Error(d.erreur || `Erreur ${r.status}`); }
    const lecteur = r.body.getReader();
    const dec = new TextDecoder();
    let tampon = '';
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) break;
      tampon += dec.decode(value, { stream: true });
      let fin;
      while ((fin = tampon.indexOf('\n\n')) >= 0) {
        const brut = tampon.slice(0, fin); tampon = tampon.slice(fin + 2);
        const evt = /^event: (.+)$/m.exec(brut)?.[1];
        const data = JSON.parse(/^data: (.+)$/m.exec(brut)?.[1] || '{}');
        if (evt === 'token') {
          courant += data.text;
          bulle.innerHTML = markdown(courant) || '<span class="typing"><i></i><i></i><i></i></span>';
        } else if (evt === 'mood') humeur(data.mood);
        else if (['tool', 'document', 'suggestion', 'devoffer', 'approval', 'activite', 'sources', 'memory'].includes(evt)) {
          coupure();
          if (evt === 'tool') ajouter({ type: 'tool', result: data.result });
          if (evt === 'document') ajouter({ type: 'document', doc: data });
          if (evt === 'suggestion') ajouter({ type: 'suggestion', data });
          if (evt === 'devoffer') ajouter({ type: 'devoffer' });
          if (evt === 'approval') ajouter({ type: 'approval', action: data, statut: 'en_attente', resultat: null });
          if (evt === 'activite') ajouter({ type: 'activite', texte: data.texte });
          if (evt === 'sources') ajouter({ type: 'sources', sources: data.sources });
          if (evt === 'memory') ajouter({ type: 'memory', fait: data.fait });
          nouvelleBulle();
        } else if (evt === 'error') erreur = data.message;
        zone.scrollTop = zone.scrollHeight;
      }
    }
    coupure();
    if (erreur && items.length === indexUser + 1) throw new Error(erreur);
    if (erreur) afficherErreur(erreur);
    // Si l'agent n'a répondu que par des cartes, on garde une trace pour la suite de la conversation.
    if (items.filter((i) => i.role).at(-1)?.role === 'user') {
      const cartes = items.slice(items.lastIndexOf(items.filter((i) => i.role).at(-1)) + 1).map((i) => i.type).filter(Boolean);
      items.push({ role: 'assistant', content: cartes.length ? `(J'ai affiché : ${cartes.join(', ')})` : '…', masque: true });
    }
    // L'historique garde au plus 80 éléments par agent sur le téléphone.
    lsSet(cle, items.slice(-80));
    if (lectureAuto && visible && aLire.trim() && !auto) {
      const derniere = [...zone.querySelectorAll('.msg.bot .ecouter')].at(-1);
      lire(aLire, derniere);
    }
    zone.scrollTop = zone.scrollHeight;
  } catch (ex) {
    // Rien n'a été répondu : le message n'est pas gardé, on propose de le renvoyer.
    bulle.remove();
    if (items.length === indexUser + 1) { items.splice(indexUser, 1); lsSet(cle, items); bulleUser?.remove(); }
    afficherErreur(ex.message, auto ? null : () => { input.value = texte; $('#composer').requestSubmit(); });
    humeur('repos');
  } finally {
    etat.envoi = false; $('#send').disabled = false;
  }
}

function afficherErreur(message, reessayer) {
  const n = document.createElement('div');
  n.className = 'msg err';
  n.textContent = message;
  if (reessayer) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lien reessayer'; b.textContent = 'Réessayer';
    b.onclick = () => { n.remove(); reessayer(); };
    n.appendChild(document.createElement('br'));
    n.appendChild(b);
  }
  $('#messages').appendChild(n);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

/* Après une validation dans le mode développeur, l'agent reprend avec le résultat. */
function suiteValidation(item) {
  const a = item.action;
  if (item.statut === 'refusee') return envoyer(`[Action refusée] ${a.resume}. Ne la refais pas sans me demander.`, { auto: true, agent: 'dev' });
  const resultat = JSON.stringify(item.resultat || {}).slice(0, 3000);
  envoyer(`[Action ${item.statut === 'executee' ? 'validée' : 'en échec'}] ${a.resume}\nRésultat : ${resultat}`, { auto: true, agent: 'dev' });
}

/* ---------- Mode développeur ---------- */
function ouvrirDialogueDev() {
  if (!accesAgent('dev', { ...etat.profil, developpeur: true }).ok) {
    toast(`Le mode développeur fait partie de l'offre ${NOMS_OFFRES.pro}.`);
    return;
  }
  $('#dlg-dev').showModal();
}
$('#dlg-dev-ok').addEventListener('click', async () => {
  etat.profil = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ developpeur: true }) });
  fermerDialogues();
  choisirAgent('dev');
  ouvrirPanneau('reglages');
  $('#dev-cles').scrollIntoView({ behavior: 'smooth' });
});

/* ---------- Calculateurs ---------- */
const nombre = (v) => (v === '' || v === undefined ? undefined : Number(String(v).replace(/\s/g, '').replace(',', '.')));
const CALCULS = {
  budget: {
    groupe: 'foyer', nom: 'Budget du mois', fn: budgetMensuel,
    intro: 'Tes revenus et tes dépenses du mois. Laisse vide ce qui ne te concerne pas.',
    champs: [['revenus', 'Revenus du mois'], ['loyer', 'Loyer'], ['nourriture', 'Nourriture'], ['transport', 'Transport'], ['ecole', 'École des enfants'], ['factures', 'Eau, électricité, crédit et data'], ['famille', 'Aide à la famille'], ['dettes', 'Remboursements'], ['envies', 'Sorties et envies'], ['epargne', 'Épargne et tontine']],
    exemple: { revenus: 250000, loyer: 70000, nourriture: 60000, transport: 25000, factures: 10000, famille: 30000, envies: 15000, epargne: 25000 },
    versParams(v) {
      const natures = { loyer: 'besoin', nourriture: 'besoin', transport: 'besoin', ecole: 'besoin', factures: 'besoin', famille: 'famille', dettes: 'dette', envies: 'envie', epargne: 'epargne' };
      return { revenus: v.revenus, depenses: Object.entries(natures).filter(([k]) => v[k]).map(([k, nature]) => ({ libelle: this.champs.find(([c]) => c === k)[1], montant: v[k], nature })) };
    }
  },
  epargne: {
    groupe: 'foyer', nom: 'Épargne', fn: planEpargne, exemple: EXEMPLES_BUDGET.epargne,
    intro: 'Combien de mois pour ton objectif ? Ou, en indiquant une durée, combien mettre de côté chaque mois.',
    champs: [['objectif', 'Objectif (FCFA)'], ['dejaEpargne', 'Déjà épargné (FCFA)'], ['epargneMensuelle', 'Je peux mettre par mois (FCFA)'], ['dureeMois', 'ou : en combien de mois ?']]
  },
  tontine: {
    groupe: 'foyer', nom: 'Tontine', fn: tontine, exemple: EXEMPLES_BUDGET.tontine,
    intro: 'Ce que tu reçois, quand, et si la tontine te fait une avance ou une épargne forcée.',
    champs: [['membres', 'Nombre de membres'], ['cotisation', 'Cotisation par tour (FCFA)'], ['frequence', 'Fréquence', ['jour', 'semaine', 'quinzaine', 'mois']], ['position', 'Ton tour (1 = premier)'], ['fraisParTour', 'Frais par tour (FCFA)']]
  },
  point_mort: {
    groupe: 'entreprise', nom: 'Point mort', fn: pointMort, exemple: EXEMPLES_COURS.point_mort,
    intro: 'Combien de ventes pour couvrir tes charges fixes ? Donne le coût variable par unité, ou son pourcentage du prix.',
    champs: [['prix', 'Prix de vente unitaire (FCFA)'], ['chargesFixes', 'Charges fixes de la période (FCFA)'], ['tauxCoutsVariables', 'Coûts variables (% du prix)'], ['coutVariableUnitaire', 'ou coût variable par unité (FCFA)']]
  },
  prix: {
    groupe: 'entreprise', nom: 'Fixer mon prix', fn: fixerPrix, exemple: EXEMPLES_COURS.prix,
    intro: 'Plancher (tes coûts, ton temps compris), plafond (valeur perçue), marché et négociation.',
    champs: [['coutVariableUnitaire', 'Coût variable par unité (FCFA)'], ['margeBruteCible', 'Marge brute souhaitée (%)'], ['heuresDirigeant', 'Tes heures par vente'], ['tauxHoraireDirigeant', 'Valeur de ton heure (FCFA)'], ['autresCoutsDirects', 'Autres coûts directs (FCFA)'], ['valeurPercueMin', 'Valeur perçue, bas (FCFA)'], ['valeurPercueMax', 'Valeur perçue, haut (FCFA)'], ['prixMarcheBas', 'Prix informel ou bas de gamme (FCFA)'], ['prixMarcheHaut', 'Prix haut de gamme (FCFA)'], ['margeNegociation', 'Marge de négociation (%)']]
  },
  projection: {
    groupe: 'entreprise', nom: 'Prévisionnel 12 mois', fn: projection12Mois, exemple: EXEMPLES_COURS.projection,
    intro: 'Méthode bottom-up : des clients gagnés par des actions précises, multipliés par ton prix réel. Les valeurs de saisonnalité proposées sont un exemple.',
    champs: [['moisDebut', 'Mois de départ (1 = janvier)'], ['clientsInitiaux', 'Clients au départ'], ['nouveauxClientsParMois', 'Nouveaux clients le 1er mois'], ['croissanceAcquisition', 'Croissance des acquisitions (%/mois)'], ['retention', 'Clients qui restent chaque mois (%)'], ['prixMoyen', 'Prix moyen par client et par mois (FCFA)'], ['tauxCoutsVariables', 'Coûts variables (% du CA)'], ['chargesFixesMensuelles', 'Charges fixes par mois (FCFA)'], ['delaiPaiementJours', 'Délai de paiement clients (jours)'], ['tresorerieInitiale', 'Trésorerie de départ (FCFA)'], ['saisonnalite', 'Saisonnalité : 12 coefficients de janvier à décembre', 'texte']]
  },
  bfr: {
    groupe: 'entreprise', nom: 'BFR', fn: estimationBFR, exemple: EXEMPLES_COURS.bfr,
    intro: "L'argent à avoir de côté pour tenir entre ce que tu paies et ce que tes clients te versent.",
    champs: [['caMensuel', "Chiffre d'affaires mensuel (FCFA)"], ['delaiClientsJours', 'Délai de paiement de tes clients (jours)'], ['achatsMensuels', 'Achats mensuels (FCFA)'], ['delaiFournisseursJours', 'Délai de tes fournisseurs (jours)'], ['stockMoyen', 'Stock moyen (FCFA)']]
  },
  cascade: {
    groupe: 'entreprise', nom: 'Cascade de marge', fn: cascadeRentabilite, exemple: EXEMPLES_COURS.cascade,
    intro: "Du chiffre d'affaires à ce qui reste vraiment. Même période pour tous les montants.",
    champs: [['ca', "Chiffre d'affaires (FCFA)"], ['coutsVariables', 'Coûts variables (FCFA)'], ['chargesFixes', 'Charges fixes (FCFA)'], ['impotsInteretsAmortissements', 'Impôts, intérêts, amortissements (FCFA)']]
  }
};
let calculCourant = lsGet('tehis_calc_courant', 'budget');
if (!CALCULS[calculCourant]) calculCourant = 'budget';
const valeursCalc = lsGet('tehis_calc', {});

document.querySelectorAll('#calc-groupes button').forEach((b) => b.addEventListener('click', () => {
  afficherCalcul(Object.keys(CALCULS).find((k) => CALCULS[k].groupe === b.dataset.groupe));
}));

function afficherCalcul(id) {
  calculCourant = id; lsSet('tehis_calc_courant', id);
  const def = CALCULS[id];
  document.querySelectorAll('#calc-groupes button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.groupe === def.groupe)));
  const onglets = $('#calc-tabs');
  onglets.innerHTML = '';
  for (const [k, d] of Object.entries(CALCULS).filter(([, d]) => d.groupe === def.groupe)) {
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.textContent = d.nom;
    b.setAttribute('aria-selected', String(k === id));
    b.addEventListener('click', () => afficherCalcul(k));
    onglets.appendChild(b);
  }
  const vals = valeursCalc[id] || def.exemple;
  const form = $('#calc-form');
  form.innerHTML = `<p class="intro">${echapper(def.intro)}</p>` + def.champs.map(([cle, lib, opt]) => {
    const v = vals[cle];
    if (Array.isArray(opt)) return `<div class="field"><label for="c-${cle}">${echapper(lib)}</label><select id="c-${cle}" name="${cle}">${opt.map((o) => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select></div>`;
    const val = Array.isArray(v) ? v.join(' ') : (v ?? '');
    return `<div class="field${opt === 'texte' ? ' full' : ''}"><label for="c-${cle}">${echapper(lib)}</label><input id="c-${cle}" name="${cle}" type="${opt === 'texte' ? 'text' : 'number'}" inputmode="decimal" value="${echapper(String(val))}"></div>`;
  }).join('') + `<div class="calc-actions"><button class="btn accent" type="submit">Calculer</button><button class="btn small" type="button" id="calc-exemple">Exemple</button><button class="btn small" type="button" id="calc-agent">Demander conseil</button></div>`;
  form.onsubmit = (e) => { e.preventDefault(); calculer(); };
  $('#calc-exemple').onclick = () => { delete valeursCalc[id]; lsSet('tehis_calc', valeursCalc); afficherCalcul(id); };
  $('#calc-agent').onclick = () => {
    const p = lireForm();
    const lignes = def.champs.filter(([k]) => p[k] !== undefined).map(([k, lib]) => `- ${lib} : ${Array.isArray(p[k]) ? p[k].join(' ') : p[k]}`).join('\n');
    const cible = def.groupe === 'foyer' ? 'budget' : 'finance';
    if (!accesAgent(cible, etat.profil).ok) { toast(accesAgent(cible, etat.profil).raison); return; }
    choisirAgent(cible); ouvrirPanneau('chat');
    envoyer(`J'ai fait le calcul « ${def.nom} » avec ces chiffres :\n${lignes}\nQu'est-ce que tu en penses et que devrais-je changer ?`);
  };
  calculer();
}

function lireForm() {
  const p = {};
  for (const el of $('#calc-form').querySelectorAll('input, select')) {
    if (el.value.trim() === '') continue;
    if (el.tagName === 'SELECT') p[el.name] = el.value;
    else p[el.name] = el.name === 'saisonnalite' ? el.value.trim().split(/[\s;]+/).map(nombre) : nombre(el.value);
  }
  return p;
}

function calculer() {
  const def = CALCULS[calculCourant];
  const p = lireForm();
  valeursCalc[calculCourant] = p; lsSet('tehis_calc', valeursCalc);
  const zone = $('#calc-result');
  zone.innerHTML = '';
  try { zone.appendChild(carteResultat(def.fn(def.versParams ? def.versParams(p) : p), ctxCartes)); } catch (e) { zone.appendChild(carteResultat({ erreur: e.message })); }
}

/* ---------- Mes affaires ---------- */
async function afficherAffaires() {
  const charge = '<li class="muted">Chargement…</li>';
  $('#rappels-list').innerHTML = charge; $('#docs-list').innerHTML = charge; $('#memory-list').innerHTML = charge; $('#listes-zone').innerHTML = '';
  const [rappels, listes, docs, memoire] = await Promise.all(['/api/reminders', '/api/lists', '/api/documents', '/api/memories'].map((u) => api(u).catch(() => [])));

  const ul = $('#rappels-list');
  ul.innerHTML = rappels.length ? '' : '<li class="muted small">Aucun rappel. Demande à l\'agent Organisation : « Rappelle-moi de… ».</li>';
  for (const r of rappels) {
    const li = document.createElement('li');
    li.innerHTML = `<div><div>🔔 ${echapper(r.texte)}</div><div class="muted small">${echapper(dateFr(r.quand))}</div></div><button type="button" class="suppr">Supprimer</button>`;
    li.querySelector('button').onclick = async () => { await api(`/api/reminders/${r.id}`, { method: 'DELETE' }); li.remove(); };
    ul.appendChild(li);
  }

  const zl = $('#listes-zone');
  zl.innerHTML = listes.length ? listes.map((l) => `<div class="result">${blocListe({ ...l, type: undefined })}</div>`).join('') : '<p class="muted small">Aucune liste. Exemple : « Ajoute riz et huile à ma liste de courses ».</p>';
  brancherListes(zl, ctxCartes);

  const ud = $('#docs-list');
  ud.innerHTML = docs.length ? '' : '<li class="muted small">Les lettres, CV et fiches créés par tes agents apparaîtront ici.</li>';
  for (const d of docs) {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="doc-ouvrir"><div>${echapper(d.titre)}</div><div class="muted small">${new Date(d.created_at).toLocaleDateString('fr-FR')}</div></button><button type="button" class="suppr">Supprimer</button>`;
    li.querySelector('.doc-ouvrir').onclick = () => ouvrirDocument(d.id);
    li.querySelector('.suppr').onclick = async () => { await api(`/api/documents/${d.id}`, { method: 'DELETE' }); li.remove(); };
    ud.appendChild(li);
  }

  const um = $('#memory-list');
  um.innerHTML = memoire.length ? '' : '<li class="muted small">Rien pour l\'instant. Parle de toi ou de ton activité et ton compagnon retiendra l\'essentiel.</li>';
  for (const m of memoire) {
    const li = document.createElement('li');
    li.innerHTML = `<div><div class="cat">${echapper(m.categorie)}</div><div>${echapper(m.fait)}</div></div><button type="button" class="suppr">Oublier</button>`;
    li.querySelector('button').onclick = async () => { await api(`/api/memories/${m.id}`, { method: 'DELETE' }); li.remove(); };
    um.appendChild(li);
  }
}

async function ouvrirDocument(id) {
  const d = await api(`/api/documents/${id}`);
  $('#dlg-doc-titre').textContent = d.titre;
  $('#dlg-doc-corps').innerHTML = markdown(d.contenu);
  actionsDocument(d, $('#dlg-doc-actions'));
  $('#dlg-doc').showModal();
}

/* ---------- Réglages ---------- */
async function afficherReglages() {
  const esp = ESPECES.find((e) => e.id === etat.profil.espece)?.nom || 'Chat';
  $('#reg-compagnon').textContent = `${etat.profil.nomCompagnon || 'Kiki'}, ${esp.toLowerCase()}`;
  $('#reg-offre').textContent = `${NOMS_OFFRES[etat.profil.offre] || 'Gratuit'} (prototype : offre fixée sur le serveur)`;
  const s = etat.statut;
  $('#reg-version').textContent = s.modeDemo ? 'Mode démo : aucune clé API configurée.' : `Modèles : ${s.modeles?.fort} et ${s.modeles?.leger}.`;
  majNotif();
  const dev = etat.profil.developpeur;
  $('#reg-dev-btn').textContent = dev ? 'Désactiver' : 'Activer';
  $('#dev-cles').hidden = !dev;
  if (dev) {
    const c = await api('/api/dev/cles').catch(() => ({}));
    $('#reg-dev-etat').textContent = `Activé. GitHub : ${c.github ? `connecté (${c.github})` : 'non connecté'} · Render : ${c.render ? 'connecté' : 'non connecté'}.`;
  } else $('#reg-dev-etat').textContent = "Pour les développeurs : écrire du code, l'envoyer sur GitHub et déployer sur Render.";
}
$('#reg-changer').addEventListener('click', afficherSetup);
$('#reg-voix-test').addEventListener('click', () => {
  if (!voixDisponible) { $('#reg-voix').textContent = "Ce navigateur ne sait pas lire à voix haute."; return; }
  $('#reg-voix').textContent = "Si tu n'entends rien sur iPhone, vérifie le volume et que le bouton silencieux n'est pas activé.";
  lire(`Salut ${etat.profil.prenom || ''} ! Moi c'est ${etat.profil.nomCompagnon || 'Kiki'}. Voilà ma voix.`);
});
$('#reg-dev-btn').addEventListener('click', async () => {
  if (!etat.profil.developpeur) return ouvrirDialogueDev();
  etat.profil = await api('/api/profile', { method: 'PUT', body: JSON.stringify({ developpeur: false }) });
  if (etat.agent === 'dev') choisirAgent('compagnon');
  afficherReglages();
});
$('#dev-cles').addEventListener('submit', async (e) => {
  e.preventDefault();
  const corps = {};
  if ($('#cle-github').value.trim()) corps.github = $('#cle-github').value.trim();
  if ($('#cle-render').value.trim()) corps.render = $('#cle-render').value.trim();
  const msg = $('#dev-cles-msg');
  if (!Object.keys(corps).length) { msg.textContent = 'Saisis au moins une clé.'; return; }
  msg.textContent = 'Vérification…';
  try {
    await api('/api/dev/cles', { method: 'PUT', body: JSON.stringify(corps) });
    $('#cle-github').value = ''; $('#cle-render').value = '';
    msg.textContent = 'Clés vérifiées et enregistrées.';
    afficherReglages();
  } catch (ex) { msg.textContent = ex.message; }
});
$('#dev-cles-effacer').addEventListener('click', async () => {
  await api('/api/dev/cles', { method: 'PUT', body: JSON.stringify({ github: '', render: '' }) });
  $('#dev-cles-msg').textContent = 'Clés effacées.';
  afficherReglages();
});
$('#reg-effacer').addEventListener('click', () => {
  if (!confirm('Effacer toutes les discussions enregistrées sur ce téléphone ?')) return;
  [...Object.keys(AGENTS), ...etat.persos.agents.map((f) => `perso:${f.id}`)].forEach((a) => { try { localStorage.removeItem(cleHisto(a)); } catch { /* rien */ } });
  afficherHistorique();
});

/* Notifications push pour les rappels. */
const pushPossible = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function majNotif() {
  const b = $('#reg-notif-btn');
  if (!pushPossible) { b.hidden = true; $('#reg-notif').textContent = "Ce navigateur ne gère pas les notifications. Sur iPhone, installe d'abord l'app sur l'écran d'accueil."; return; }
  b.textContent = Notification.permission === 'granted' ? 'Tester' : 'Activer';
  if (Notification.permission === 'denied') $('#reg-notif').textContent = 'Notifications bloquées : autorise-les dans les réglages du navigateur.';
}
$('#reg-notif-btn').addEventListener('click', async () => {
  try {
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return majNotif();
    const { cle } = await api('/api/push/key');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub.toJSON()) });
    await api('/api/push/test', { method: 'POST' });
    $('#reg-notif').textContent = 'Notifications activées. Une notification de test vient d\'être envoyée.';
  } catch (e) { $('#reg-notif').textContent = `Activation impossible : ${e.message}`; }
  majNotif();
});

/* ---------- Démarrage ---------- */
async function demarrer() {
  etat.statut = await api('/api/status');
  if (!lsGet('tehis_bienvenue', false) || !etat.statut.authentifie) return afficherBienvenue();
  etat.profil = await api('/api/profile');
  if (!etat.profil.espece) return afficherSetup();
  await ouvrirApp();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

/* Bandeau hors-ligne : l'interface reste utilisable grâce au cache, mais l'API exige le réseau. */
const banniereHorsLigne = $('#offline-banner');
function majHorsLigne() { if (banniereHorsLigne) banniereHorsLigne.hidden = navigator.onLine; }
window.addEventListener('online', majHorsLigne);
window.addEventListener('offline', majHorsLigne);
majHorsLigne();

demarrer().catch((e) => console.error(e));
