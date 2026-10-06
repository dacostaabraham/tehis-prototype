// Application Tehis (prototype) : connexion, compagnon, agents, chat, calculs, mes affaires, réglages.
import { mountCompanion, ESPECES, HUMEURS } from './companion.js';
import { cascadeRentabilite, pointMort, fixerPrix, projection12Mois, estimationBFR, EXEMPLES_COURS } from './shared/finance.js';
import { budgetMensuel, planEpargne, tontine, EXEMPLES_BUDGET } from './shared/budget.js';
import { AGENTS, GROUPES, NOMS_OFFRES, accesAgent as accesCatalogue, estPerso } from './shared/agents.js';
import { initPerso, ouvrirCreation, ouvrirEdition } from './perso.js';
import { voixDisponible, parler, arreter, debloquer, configurerVoixIA, voixNaturelle } from './voix.js';
import { markdown, echapper } from './shared/markdown.js';
import { carteResultat, carteDocument, carteSuggestion, carteOffreDev, carteValidation, noteActivite, blocSources, blocListe, brancherListes, actionsDocument, dateFr } from './cards.js';
import { toast } from './shared/ui.js';
import { ACCESSOIRES, GAINS } from './shared/progression.js';
import { carteLieux, cartePosition, carteChoix, barreProximite, obtenirPosition, positionConnue } from './lieux.js';
import { vignetteAgent, etatVide, ICONES_SVG } from './shared/identite.js';

const $ = (s) => document.querySelector(s);
const etat = { uid: null, quota: null, progression: null, agent: 'compagnon', profil: {}, statut: {}, compagnon: null, envoi: false, photo: null, persos: { agents: [], limites: { agents: 1 }, offre: 'gratuit' } };

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
  if (r.status === 401 && !['/api/connexion', '/api/inscription', '/api/compte/pin', '/api/compte'].includes(path)) { afficherBienvenue('connexion'); throw new Error('Connexion requise'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.erreur || `Erreur ${r.status}`);
  return data;
}

function montrer(vue) {
  for (const v of ['bienvenue', 'setup', 'app']) $(`#view-${v}`).hidden = v !== vue;
}

/* ---------- Bienvenue : inscription et connexion ---------- */
function ongletCompte(quel) {
  const ins = quel !== 'connexion';
  $('#tab-inscription').setAttribute('aria-selected', String(ins));
  $('#tab-connexion').setAttribute('aria-selected', String(!ins));
  $('#form-inscription').hidden = !ins;
  $('#form-connexion').hidden = ins;
}
function afficherBienvenue(onglet) {
  $('#ins-invitation-zone').hidden = !etat.statut.invitationRequise;
  $('#oubli-btn').hidden = !etat.statut.whatsapp;
  $('#oubli-texte').hidden = Boolean(etat.statut.whatsapp);
  $('#form-oubli').hidden = true;
  ongletCompte(onglet || (lsGet('tehis_a_un_compte', false) ? 'connexion' : 'inscription'));
  montrer('bienvenue');
}
$('#tab-inscription').addEventListener('click', () => ongletCompte('inscription'));
/* Code secret oublié : un code arrive sur WhatsApp. */
$('#oubli-btn').addEventListener('click', () => {
  $('#form-connexion').hidden = true; $('#form-oubli').hidden = false;
  $('#oubli-tel').value = $('#cnx-tel').value; $('#oubli-suite').hidden = true; $('#oubli-erreur').hidden = true;
});
$('#oubli-retour').addEventListener('click', () => { $('#form-oubli').hidden = true; ongletCompte('connexion'); });
$('#oubli-envoyer').addEventListener('click', async (e) => {
  const err = $('#oubli-erreur'); err.hidden = true; e.target.disabled = true;
  try {
    await api('/api/code-oublie', { method: 'POST', body: JSON.stringify({ telephone: $('#oubli-tel').value }) });
    $('#oubli-suite').hidden = false; e.target.textContent = 'Renvoyer le code'; $('#oubli-code').focus();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { e.target.disabled = false; }
});
$('#form-oubli').addEventListener('submit', (e) => soumettreCompte(e, '/api/code-oublie/valider', {
  telephone: $('#oubli-tel').value, code: $('#oubli-code').value, nouveau: $('#oubli-pin').value
}, '#oubli-erreur'));
$('#tab-connexion').addEventListener('click', () => ongletCompte('connexion'));

async function soumettreCompte(e, chemin, corps, zoneErreur) {
  e.preventDefault();
  const err = $(zoneErreur); err.hidden = true;
  const bouton = e.target.querySelector('button[type=submit]');
  bouton.disabled = true;
  try {
    await api(chemin, { method: 'POST', body: JSON.stringify(corps) });
    lsSet('tehis_a_un_compte', true);
    e.target.reset();
    await demarrer();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { bouton.disabled = false; }
}
$('#form-inscription').addEventListener('submit', (e) => soumettreCompte(e, '/api/inscription', {
  prenom: $('#ins-prenom').value, telephone: $('#ins-tel').value, pin: $('#ins-pin').value, invitation: $('#ins-invitation').value
}, '#ins-erreur'));
$('#form-connexion').addEventListener('submit', (e) => soumettreCompte(e, '/api/connexion', {
  telephone: $('#cnx-tel').value, pin: $('#cnx-pin').value
}, '#cnx-erreur'));

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
    // Une tape sur le compagnon (sans glisser) = petite fête.
    let tapX = 0, tapY = 0;
    $('#stage').addEventListener('pointerdown', (e) => { tapX = e.clientX; tapY = e.clientY; });
    $('#stage').addEventListener('pointerup', (e) => {
      if (e.target.closest('button')) return; // pas sur les boutons (voix…)
      if (Math.hypot(e.clientX - tapX, e.clientY - tapY) < 12) etat.compagnon.setMood('fete');
    });
  } else {
    await etat.compagnon.setSpecies(etat.profil.espece || 'chat');
  }
  if (etat.progression) etat.compagnon.setAccessoires?.(etat.progression.portes);
  await chargerPersos();
  api('/api/progression/visite', { method: 'POST' }).then((p) => majProgression(p)).catch(() => {});
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

function ouvrirFeuilleAgents() {
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
      b.innerHTML = `${vignetteAgent(id, 'petite')}<span class="agent-texte"><strong>${echapper(a.nom)}</strong><span class="small muted">${echapper(a.resume)}</span></span>${acces.ok ? '' : `<span class="badge">${a.developpeur && !etat.profil.developpeur && acces.raison.includes('mode') ? 'Activer' : echapper(NOMS_OFFRES[a.offre])}</span>`}`;
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
}
$('#agent-header-changer').addEventListener('click', ouvrirFeuilleAgents);

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
  const nom = agent === 'compagnon' ? (etat.profil.nomCompagnon || 'Compagnon') : a.nom;
  $('#agent-header-vignette').innerHTML = estPerso(agent)
    ? `<span class="vignette petite" aria-hidden="true"><span style="font-size:20px;line-height:1">${echapper(a.icone)}</span></span>`
    : vignetteAgent(agent, 'petite');
  $('#agent-header-nom').textContent = nom;
  $('#agent-header-resume').textContent = a.resume || '';
  $('#input').placeholder = agent === 'compagnon' ? `Écris à ${etat.profil.nomCompagnon || 'ton compagnon'}…` : 'Ton message…';
  afficherHistorique();
  synchroniser(agent);
}

/* ---------- Panneaux ---------- */
document.querySelectorAll('.bottomnav button').forEach((b) => b.addEventListener('click', () => ouvrirPanneau(b.dataset.panel)));
$('#btn-settings').addEventListener('click', () => ouvrirPanneau('reglages'));
function ouvrirPanneau(p) {
  document.querySelectorAll('.bottomnav button').forEach((b) => (b.dataset.panel === p ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  for (const id of ['chat', 'agents', 'calc', 'affaires', 'reglages']) $(`#panel-${id}`).hidden = id !== p;
  $('#view-app').classList.toggle('compact', p !== 'chat');
  if (p === 'calc') afficherCalcul(calculCourant);
  if (p === 'agents') afficherPanneauAgents();
  if (p === 'affaires') afficherAffaires();
  if (p === 'reglages') afficherReglages();
}

/* ---------- Onglet Agents ---------- */
function carteFicheAgent(id, a, acces) {
  const el = document.createElement('article');
  el.className = `fiche-agent${acces.ok ? '' : ' verrouillee'}`;
  const exemples = (a.suggestions || []).slice(0, 2).map((s) => `<li>${echapper(s)}</li>`).join('');
  el.innerHTML = `${vignetteAgent(id)}
    <div class="fiche-agent-corps">
      <div class="fiche-agent-tete"><strong>${echapper(a.nom)}</strong>${acces.ok ? (id === etat.agent ? '<span class="badge mini actif">En cours</span>' : '') : `<span class="badge mini">${echapper(NOMS_OFFRES[a.offre])}</span>`}</div>
      <p class="small muted">${echapper(a.resume)}</p>
      ${exemples ? `<ul class="fiche-agent-exemples">${exemples}</ul>` : ''}
    </div>
    <button class="btn ${acces.ok ? 'accent' : ''} small" type="button">${acces.ok ? 'Essayer' : NOMS_OFFRES[a.offre]}</button>`;
  el.querySelector('button').addEventListener('click', () => {
    if (!acces.ok) {
      if (a.developpeur && !etat.profil.developpeur && acces.raison.includes('mode')) { ouvrirDialogueDev(); return; }
      toast(acces.raison);
      return;
    }
    choisirAgent(id);
    ouvrirPanneau('chat');
  });
  return el;
}

function afficherPanneauAgents() {
  const zone = $('#agents-panneau');
  zone.innerHTML = '';
  for (const g of GROUPES) {
    const ids = Object.keys(AGENTS).filter((id) => AGENTS[id].groupe === g.id);
    if (!ids.length) continue;
    zone.insertAdjacentHTML('beforeend', `<h3 class="sec">${echapper(g.nom)}</h3>`);
    const grille = document.createElement('div');
    grille.className = 'fiches-agents';
    for (const id of ids) grille.appendChild(carteFicheAgent(id, AGENTS[id], accesAgent(id, etat.profil)));
    zone.appendChild(grille);
  }
  // Agents personnels
  const { agents, limites } = etat.persos;
  zone.insertAdjacentHTML('beforeend', `<h3 class="sec">Mes agents <span class="muted">· ${agents.length}/${limites.agents}</span></h3>`);
  const grille = document.createElement('div');
  grille.className = 'fiches-agents';
  for (const f of agents) {
    const id = `perso:${f.id}`;
    const el = document.createElement('article');
    el.className = 'fiche-agent';
    el.innerHTML = `<span class="vignette" aria-hidden="true"><span style="font-size:22px;line-height:1">${echapper(f.icone)}</span></span>
      <div class="fiche-agent-corps">
        <div class="fiche-agent-tete"><strong>${echapper(f.nom)}</strong>${f.verrouille ? '<span class="badge mini">Verrouillé</span>' : ''}</div>
        <p class="small muted">${echapper(f.resume)}</p>
      </div>
      <button class="btn accent small" type="button">Essayer</button>`;
    el.querySelector('button').addEventListener('click', () => {
      if (f.verrouille) { toast('Verrouillé avec ton offre actuelle.'); return; }
      choisirAgent(id);
      ouvrirPanneau('chat');
    });
    grille.appendChild(el);
  }
  const creer = document.createElement('button');
  creer.type = 'button';
  creer.className = 'fiche-agent creer';
  creer.innerHTML = `<span class="vignette" aria-hidden="true"><span style="font-size:22px;line-height:1;color:var(--accent)">＋</span></span>
    <div class="fiche-agent-corps"><strong>Crée ton agent</strong><p class="small muted">Décris ton besoin, Tehis prépare l'agent.</p></div>`;
  creer.addEventListener('click', () => ouvrirCreation(etat.persos));
  grille.appendChild(creer);
  zone.appendChild(grille);
}

/* ---------- Chat ---------- */
const cleHisto = (agent = etat.agent) => `tehis_chat_${etat.uid}_${agent}`;
const cleMaj = (agent) => `tehis_maj_${etat.uid}_${agent}`;
/* Conversations : affichées tout de suite depuis le téléphone, enregistrées sur le serveur
   (retrouvées sur un autre appareil ou après avoir vidé le navigateur). */
const envoisEnAttente = {};
function sauverHisto(agent, items) {
  const its = items.slice(-80);
  lsSet(cleHisto(agent), its);
  clearTimeout(envoisEnAttente[agent]);
  envoisEnAttente[agent] = setTimeout(async () => {
    try {
      const r = await api(`/api/conversations/${encodeURIComponent(agent)}`, { method: 'PUT', body: JSON.stringify({ items: its }) });
      lsSet(cleMaj(agent), r.updated_at);
    } catch { /* hors ligne : renvoyé au prochain message */ }
    delete envoisEnAttente[agent];
  }, 800);
}
async function synchroniser(agent) {
  try {
    const r = await api(`/api/conversations/${encodeURIComponent(agent)}`);
    if (envoisEnAttente[agent] || etat.envoi) return;
    const locaux = lsGet(cleHisto(agent), []);
    if (!r.updated_at) { if (locaux.length) sauverHisto(agent, locaux); return; }
    if (r.updated_at === lsGet(cleMaj(agent), null)) return;
    lsSet(cleHisto(agent), r.items); lsSet(cleMaj(agent), r.updated_at);
    if (etat.agent === agent) afficherHistorique();
  } catch { /* hors ligne : on garde la version du téléphone */ }
}
/* Discussions d'avant les comptes, restées sur ce téléphone : reprises par le premier compte connecté ici. */
function reprendreAnciennesDiscussions() {
  try {
    for (const k of Object.keys(localStorage)) {
      const m = /^tehis_chat_((?:perso:[0-9a-f-]{36})|[a-z]+)$/.exec(k);
      if (!m) continue;
      if (!localStorage.getItem(cleHisto(m[1]))) localStorage.setItem(cleHisto(m[1]), localStorage.getItem(k));
      localStorage.removeItem(k);
    }
  } catch { /* stockage indisponible */ }
}
/* ---------- Lieux à proximité ---------- */
// Recherche directe (boutons « Autour de moi ») : sans IA, gratuite, marche aussi en mode démo.
async function chercherDirect(demande, quartier = '') {
  debloquer();
  const cle = cleHisto();
  const items = lsGet(cle, []);
  const agentCourant = etat.agent;
  const ajouterItem = (it) => { items.push(it); sauverHisto(agentCourant, items); rendreItem(it, items); $('#messages').scrollTop = $('#messages').scrollHeight; };
  let pos = null;
  if (!quartier) {
    try { pos = await obtenirPosition(); } catch (e) {
      toast(e.message, 5000);
      return ajouterItem({ type: 'position', data: { ...demande, direct: true } });
    }
  }
  humeur('cherche');
  const n = noteActivite(`Recherche : ${demande.libelle.toLowerCase()}${quartier ? ` près de ${quartier}` : ' autour de toi'}…`);
  $('#messages').appendChild(n);
  try {
    const qs = new URLSearchParams({ categorie: demande.categorie, ...(demande.garde ? { garde: '1' } : {}), ...(quartier ? { pres_de: quartier } : { lat: pos.lat, lng: pos.lng }) });
    const r = await api(`/api/lieux?${qs}`);
    n.remove();
    const { progression, ...resultat } = r;
    ajouterItem({ type: 'tool', result: resultat });
    humeur('fete');
    if (progression) majProgression(progression);
  } catch (e) {
    n.remove(); humeur('repos');
    toast(e.message, 5000);
  }
}
const ctxPosition = {
  parPosition: (d) => (d.direct ? chercherDirect(d) : envoyer(`Voici ma position : cherche les ${String(d.libelle || 'lieux').toLowerCase()} les plus proches.`)),
  parQuartier: (d, q) => (d.direct ? chercherDirect(d, q) : envoyer(`Cherche les ${String(d.libelle || 'lieux').toLowerCase()} près de ${q}.`))
};

const ctxCartes = {
  api,
  choisirAgent: (id) => { if (accesAgent(id, etat.profil).ok) choisirAgent(id); else ouvrirDialogueDev(); },
  ouvrirDialogueDev: () => ouvrirDialogueDev()
};

function rendreItem(it, items) {
  const zone = $('#messages');
  if (it.type === 'tool' && it.result?.type === 'lieux') zone.appendChild(carteLieux(it.result));
  else if (it.type === 'tool') zone.appendChild(carteResultat(it.result, ctxCartes));
  else if (it.type === 'position') zone.appendChild(cartePosition(it.data, ctxPosition));
  else if (it.type === 'choix') zone.appendChild(carteChoix(it, { envoyer: (t) => envoyer(t), ecrire: () => $('#input').focus(), sauver: () => sauverHisto(etat.agent, items) }));
  else if (it.type === 'document') zone.appendChild(carteDocument(it.doc));
  else if (it.type === 'suggestion') zone.appendChild(carteSuggestion(it.data, ctxCartes));
  else if (it.type === 'devoffer') zone.appendChild(carteOffreDev(ctxCartes));
  else if (it.type === 'approval') zone.appendChild(carteValidation(it, { ...ctxCartes, sauver: () => sauverHisto('dev', items), apresDecision: suiteValidation }));
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
    b.innerHTML = `${vignetteAgent(id, 'petite')}<span>${echapper(a.nom)}</span>${acces.ok ? '' : `<span class="badge mini">${echapper(NOMS_OFFRES[a.offre])}</span>`}`;
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
  if (items.length !== brut.length) sauverHisto(etat.agent, items);
  const a = metaAgent(etat.agent);
  if (!items.length) {
    ajouterBulle('bot', etat.agent === 'compagnon'
      ? `Salut${etat.profil.prenom ? ` ${etat.profil.prenom}` : ''} ! Moi c'est ${etat.profil.nomCompagnon || 'Kiki'}. De quoi veux-tu parler ?`
      : a.intro);
    if (etat.agent === 'compagnon') zone.appendChild(grilleDecouverte());
  }
  for (const it of items) rendreItem(it, items);
  $('#proximite')?.remove();
  if (a.actions?.length) {
    const barre = barreProximite(a.actions, { chercher: (act) => chercherDirect({ categorie: act.categorie, libelle: act.garde ? 'Pharmacies de garde' : act.libelle, garde: Boolean(act.garde) }) });
    barre.id = 'proximite';
    $('#suggestions').before(barre);
  }
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

/* Dictée : enregistrement transcrit par le serveur (voix naturelle activée), sinon dictée du navigateur. */
const Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
const micro = $('#btn-micro');
let dicteeInitialisee = false;
function initDictee() {
  if (dicteeInitialisee) return;
  dicteeInitialisee = true;
  const enregistrement = etat.statut.voixIA && window.MediaRecorder && navigator.mediaDevices?.getUserMedia;
  if (!enregistrement && !Reconnaissance) return;
  micro.hidden = false;
  let rec = null;
  const remettre = () => { micro.classList.remove('actif', 'attente'); micro.setAttribute('aria-label', 'Dicter un message'); };
  const avertir = (texte) => { const ph = input.placeholder; input.placeholder = texte; setTimeout(() => { input.placeholder = ph; }, 4000); };

  micro.addEventListener('click', async () => {
    debloquer();
    if (rec) { rec.stop(); return; }
    if (enregistrement) {
      let flux;
      try { flux = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { avertir('Micro refusé : autorise-le dans les réglages du téléphone'); return; }
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || '';
      const morceaux = [];
      rec = new MediaRecorder(flux, type ? { mimeType: type } : undefined);
      const limite = setTimeout(() => rec?.state === 'recording' && rec.stop(), 120_000);
      rec.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data); };
      rec.onstop = async () => {
        clearTimeout(limite);
        flux.getTracks().forEach((t) => t.stop());
        rec = null;
        micro.classList.remove('actif'); micro.classList.add('attente');
        micro.setAttribute('aria-label', 'Transcription en cours');
        humeur('ecoute');
        try {
          const blob = new Blob(morceaux, { type: (morceaux[0]?.type || type || 'audio/webm').split(';')[0] });
          if (blob.size < 1500) throw new Error('Je n\'ai rien entendu. Maintiens le micro et parle.');
          const r = await fetch('/api/voix/transcrire', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob, credentials: 'same-origin' });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.erreur || 'Transcription impossible.');
          if (d.texte) { input.value = `${input.value.trim() ? `${input.value.trim()} ` : ''}${d.texte}`; input.dispatchEvent(new Event('input')); input.focus(); }
        } catch (e) { toast(e.message, 4500); }
        humeur('repos');
        remettre();
      };
      rec.start();
      micro.classList.add('actif'); micro.setAttribute('aria-label', 'Arrêter et transcrire');
      humeur('ecoute');
      return;
    }
    rec = new Reconnaissance();
    rec.lang = 'fr-FR'; rec.interimResults = true; rec.continuous = false;
    const base = input.value ? `${input.value.trim()} ` : '';
    rec.onresult = (ev) => { input.value = base + [...ev.results].map((r) => r[0].transcript).join(''); input.dispatchEvent(new Event('input')); };
    rec.onend = () => { rec = null; remettre(); };
    rec.onerror = (ev) => {
      rec?.stop();
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') avertir('Micro refusé : autorise-le dans le navigateur pour dicter');
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
  clearTimeout(envoisEnAttente[agent]); envoisEnAttente[agent] = 'envoi';
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
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ agent, messages: conversation, position: positionConnue() }) });
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
        else if (['tool', 'document', 'suggestion', 'devoffer', 'approval', 'activite', 'sources', 'memory', 'choix', 'position'].includes(evt)) {
          coupure();
          if (evt === 'tool') ajouter({ type: 'tool', result: data.result });
          if (evt === 'document') ajouter({ type: 'document', doc: data });
          if (evt === 'suggestion') ajouter({ type: 'suggestion', data });
          if (evt === 'devoffer') ajouter({ type: 'devoffer' });
          if (evt === 'approval') ajouter({ type: 'approval', action: data, statut: 'en_attente', resultat: null });
          if (evt === 'activite') ajouter({ type: 'activite', texte: data.texte });
          if (evt === 'sources') ajouter({ type: 'sources', sources: data.sources });
          if (evt === 'memory') ajouter({ type: 'memory', fait: data.fait });
          if (evt === 'choix') ajouter({ type: 'choix', data, reponse: null });
          if (evt === 'position') ajouter({ type: 'position', data });
          nouvelleBulle();
        } else if (evt === 'error') erreur = data.message;
        else if (evt === 'done' && data.quota) majQuota(data.quota, true);
        else if (evt === 'progression') majProgression(data);
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
    // L'historique garde au plus 80 éléments par agent.
    delete envoisEnAttente[agent];
    sauverHisto(agent, items);
    if (lectureAuto && visible && aLire.trim() && !auto) {
      const derniere = [...zone.querySelectorAll('.msg.bot .ecouter')].at(-1);
      lire(aLire, derniere);
    }
    zone.scrollTop = zone.scrollHeight;
  } catch (ex) {
    // Rien n'a été répondu : le message n'est pas gardé, on propose de le renvoyer.
    bulle.remove();
    if (items.length === indexUser + 1) { items.splice(indexUser, 1); lsSet(cle, items); bulleUser?.remove(); }
    if (envoisEnAttente[agent] === 'envoi') delete envoisEnAttente[agent];
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
  form.onsubmit = (e) => { e.preventDefault(); calculer(); api('/api/progression/calcul', { method: 'POST' }).then(majProgression).catch(() => {}); };
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

/* ---------- Le compagnon qui grandit ---------- */
const nomCompagnon = () => etat.profil.nomCompagnon || 'Kiki';
function majProgression(p) {
  if (!p || p.niveau === undefined) return;
  const avant = etat.progression;
  etat.progression = p;
  const b = $('#niveau-btn');
  b.hidden = false;
  $('#niveau-num').textContent = p.niveau;
  $('#niveau-nom').textContent = p.nom;
  $('#niveau-serie').textContent = p.serie > 1 ? `🔥 ${p.serie} jours` : `${p.points} pts`;
  $('#niveau-arc').style.strokeDashoffset = String(97.4 * (1 - Math.max(0.02, p.avance)));
  b.setAttribute('aria-label', `${nomCompagnon()} : niveau ${p.niveau}, ${p.nom}, ${p.points} points${p.serie > 1 ? `, ${p.serie} jours de suite` : ''}. Voir sa progression.`);
  if (!avant || String(avant.portes) !== String(p.portes)) etat.compagnon?.setAccessoires?.(p.portes);
  // Petits « +5 » au-dessus du compagnon.
  const zone = $('#gains');
  (p.gains || []).filter((g) => g.points > 0).slice(0, 3).forEach((g, i) => setTimeout(() => {
    const el = document.createElement('span');
    el.className = 'gain'; el.textContent = `+${g.points} ${g.type === 'serie' ? `🔥 ${g.texte}` : ''}`.trim();
    zone.appendChild(el); setTimeout(() => el.remove(), 2400);
  }, i * 450));
  if (p.niveauGagne) {
    humeur('fete');
    const nouveaux = (p.nouveaux || []).map((id) => `${ACCESSOIRES[id].icone} ${ACCESSOIRES[id].nom}`);
    $('#prog-fete').innerHTML = `<strong>Niveau ${p.niveau} : ${echapper(p.nom)} !</strong><span>${echapper(nomCompagnon())} grandit avec toi.${nouveaux.length ? ` Nouveau : ${echapper(nouveaux.join(', '))}, déjà porté.` : ''}</span>`;
    $('#prog-fete').hidden = false;
    setTimeout(() => ouvrirProgression(true), 2600);
  }
  if ($('#dlg-progression').open) remplirProgression();
}
function remplirProgression() {
  const p = etat.progression;
  if (!p) return;
  $('#prog-titre').textContent = `${nomCompagnon()} grandit avec toi`;
  $('#prog-niveau').textContent = `Niveau ${p.niveau} · ${p.nom}`;
  $('#prog-points').textContent = `${p.points} points`;
  $('#prog-barre i').style.width = `${Math.round(p.avance * 100)}%`;
  $('#prog-barre').setAttribute('aria-valuenow', String(Math.round(p.avance * 100)));
  $('#prog-suivant').textContent = p.suivant ? `Encore ${p.suivant.points - p.points} points pour le niveau ${p.suivant.niveau} (${p.suivant.nom}).` : 'Niveau maximum atteint. Bravo !';
  $('#prog-serie').textContent = p.serie;
  $('#prog-serie').nextElementSibling.textContent = `${p.serie > 1 ? 'jours' : 'jour'} de suite 🔥`;
  $('#prog-record').textContent = p.meilleureSerie;
  $('#prog-agents').textContent = p.agents;
  const zone = $('#prog-accessoires');
  zone.innerHTML = '';
  for (const [id, a] of Object.entries(ACCESSOIRES)) {
    const ok = p.debloques.includes(id);
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'accessoire'; b.disabled = !ok;
    b.setAttribute('aria-pressed', String(p.portes.includes(id)));
    b.innerHTML = `<span class="ico" aria-hidden="true">${a.icone}</span><span>${echapper(a.nom)}</span>${ok ? '' : `<span class="verrou">🔒 Niveau ${a.niveau}</span>`}`;
    b.onclick = async () => {
      const portes = p.portes.includes(id) ? p.portes.filter((x) => x !== id) : [...p.portes, id];
      try { majProgression(await api('/api/progression/portes', { method: 'PUT', body: JSON.stringify({ portes }) })); } catch (e) { toast(e.message); }
    };
    zone.appendChild(b);
  }
  $('#prog-regles').innerHTML = [
    ['Écrire à un agent', `+${GAINS.message.points}`], ['Essayer un nouvel agent', `+${GAINS.nouvel_agent.points}`],
    ['Créer un document', `+${GAINS.document.points}`], ['Programmer un rappel', `+${GAINS.rappel.points}`],
    ['Chercher autour de toi', `+${GAINS.lieux.points}`], ['Faire un calcul', `+${GAINS.calcul.points}`],
    ['Revenir chaque jour', `+${GAINS.jour.points}`], ['3, 7, 14 ou 30 jours de suite', 'bonus']
  ].map(([t, pts]) => `<li><span>${t}</span><strong>${pts}</strong></li>`).join('');
}
function ouvrirProgression(fete = false) {
  if (!fete) $('#prog-fete').hidden = true;
  remplirProgression();
  if (!$('#dlg-progression').open) $('#dlg-progression').showModal();
}
$('#niveau-btn').addEventListener('click', () => ouvrirProgression());
$('#dlg-progression').addEventListener('close', () => { $('#prog-fete').hidden = true; });

/* ---------- Mes affaires ---------- */
async function afficherAffaires() {
  const charge = '<li class="muted">Chargement…</li>';
  $('#rappels-list').innerHTML = charge; $('#docs-list').innerHTML = charge; $('#memory-list').innerHTML = charge; $('#listes-zone').innerHTML = '';
  const [rappels, listes, docs, memoire] = await Promise.all(['/api/reminders', '/api/lists', '/api/documents', '/api/memories'].map((u) => api(u).catch(() => [])));

  const ul = $('#rappels-list');
  ul.innerHTML = rappels.length ? '' : `<li class="vide">${etatVide(ICONES_SVG.organisation, 'Aucun rappel', 'Demande à l\u2019agent Organisation : « Rappelle-moi de payer le loyer le 5 à 9 h ».')}</li>`;
  for (const r of rappels) {
    const li = document.createElement('li');
    li.innerHTML = `<div><div>🔔 ${echapper(r.texte)}</div><div class="muted small">${echapper(dateFr(r.quand))}</div></div><button type="button" class="suppr">Supprimer</button>`;
    li.querySelector('button').onclick = async () => { await api(`/api/reminders/${r.id}`, { method: 'DELETE' }); li.remove(); };
    ul.appendChild(li);
  }

  const zl = $('#listes-zone');
  zl.innerHTML = listes.length ? listes.map((l) => `<div class="result">${blocListe({ ...l, type: undefined })}</div>`).join('') : etatVide(ICONES_SVG.redaction, 'Aucune liste', 'Exemple : « Ajoute riz et huile à ma liste de courses ».');
  brancherListes(zl, ctxCartes);

  const ud = $('#docs-list');
  ud.innerHTML = docs.length ? '' : `<li class="vide">${etatVide(ICONES_SVG.redaction, 'Aucun document', 'Les lettres, CV et fiches créés par tes agents apparaîtront ici.')}</li>`;
  for (const d of docs) {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="doc-ouvrir"><div>${echapper(d.titre)}</div><div class="muted small">${new Date(d.created_at).toLocaleDateString('fr-FR')}</div></button><button type="button" class="suppr">Supprimer</button>`;
    li.querySelector('.doc-ouvrir').onclick = () => ouvrirDocument(d.id);
    li.querySelector('.suppr').onclick = async () => { await api(`/api/documents/${d.id}`, { method: 'DELETE' }); li.remove(); };
    ud.appendChild(li);
  }

  const um = $('#memory-list');
  um.innerHTML = memoire.length ? '' : `<li class="vide">${etatVide(ICONES_SVG.compagnon, 'Rien retenu pour l\u2019instant', 'Parle de toi ou de ton activité et ton compagnon retiendra l\u2019essentiel.')}</li>`;
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
  $('#reg-voix').textContent = voixNaturelle() ? `Voix naturelle : chaque animal a la sienne. Si elle n'est pas disponible, la voix du téléphone prend le relais.` : 'Lit les réponses à voix haute avec la voix française du téléphone.';
  const esp = ESPECES.find((e) => e.id === etat.profil.espece)?.nom || 'Chat';
  $('#reg-compagnon').textContent = `${etat.profil.nomCompagnon || 'Kiki'}, ${esp.toLowerCase()}`;
  $('#reg-offre').textContent = `${NOMS_OFFRES[etat.profil.offre] || 'Gratuit'}${etat.profil.role === 'admin' ? ' · administrateur' : ''}`;
  api('/api/compte').then((c) => { $('#reg-tel').textContent = c.telephone; majQuota(c.quota); }).catch(() => {});
  const wa = etat.statut.whatsapp;
  $('#reg-whatsapp').hidden = !wa;
  if (wa) {
    const chiffres = String(wa.numero || '').replace(/\D/g, '');
    $('#reg-wa-lien').hidden = !chiffres;
    $('#reg-wa-lien').href = `https://wa.me/${chiffres}?text=${encodeURIComponent('Bonjour Tehis !')}`;
    $('#reg-wa-texte').textContent = `Écris à ${etat.profil.nomCompagnon || 'ton compagnon'} sur WhatsApp${wa.numero ? ` (${wa.numero})` : ''} depuis le numéro de ton compte : texte, vocaux, photos, position.`;
    $('#reg-wa-rappels').checked = Boolean(etat.profil.rappelsWhatsApp);
  }
  $('#reg-admin').hidden = etat.profil.role !== 'admin';
  if (etat.profil.role === 'admin') afficherTesteurs();
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
$('#reg-wa-rappels').addEventListener('change', async (e) => {
  try {
    etat.profil = { ...etat.profil, ...(await api('/api/profile', { method: 'PUT', body: JSON.stringify({ rappelsWhatsApp: e.target.checked }) })) };
    toast(e.target.checked ? 'Tes rappels arriveront aussi sur WhatsApp.' : 'Rappels WhatsApp désactivés.');
  } catch (ex) { e.target.checked = !e.target.checked; toast(ex.message); }
});
$('#reg-voix-test').addEventListener('click', () => {
  if (!voixDisponible) { $('#reg-voix').textContent = "Ce navigateur ne sait pas lire à voix haute."; return; }
  $('#reg-voix').textContent = `${voixNaturelle() ? 'Voix naturelle. ' : ''}Si tu n'entends rien sur iPhone, vérifie le volume et que le bouton silencieux n'est pas activé.`;
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
$('#reg-effacer').addEventListener('click', async () => {
  if (!confirm('Effacer toutes tes discussions, sur tous tes appareils ?')) return;
  try { await api('/api/conversations', { method: 'DELETE' }); } catch (e) { toast(e.message); return; }
  oublierDiscussionsLocales();
  afficherHistorique();
  toast('Discussions effacées.');
});

/* ---------- Mon compte ---------- */
function oublierDiscussionsLocales() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(`tehis_chat_${etat.uid}_`) || k.startsWith(`tehis_maj_${etat.uid}_`)) localStorage.removeItem(k); } catch { /* rien */ }
}
function majQuota(q, apresMessage = false) {
  if (!q?.messages) return;
  etat.quota = q;
  const m = q.messages;
  const zone = $('#reg-quota');
  if (m.max === null) zone.innerHTML = `<span class="small muted">Aujourd'hui : ${m.utilises} message${m.utilises > 1 ? 's' : ''} · sans limite</span>`;
  else {
    const pct = Math.min(100, Math.round((m.utilises / m.max) * 100));
    zone.innerHTML = `<span class="small">Aujourd'hui : <strong>${m.utilises} / ${m.max}</strong> messages${q.recherches?.max ? ` · recherches web : ${q.recherches.utilises} / ${q.recherches.max}` : ''}</span><div class="barre${m.restants <= 3 ? ' bas' : ''}" role="progressbar" aria-valuemin="0" aria-valuemax="${m.max}" aria-valuenow="${m.utilises}"><i style="width:${pct}%"></i></div><span class="small muted">Le compteur repart à zéro chaque jour à minuit.</span>`;
  }
  if (apresMessage && m.restants !== null && m.restants <= 3) toast(m.restants ? `Il te reste ${m.restants} message${m.restants > 1 ? 's' : ''} aujourd'hui.` : "C'était ton dernier message du jour. Les calculs et « Autour de moi » restent disponibles.", 5000);
}
$('#reg-deconnexion').addEventListener('click', async () => {
  if (!confirm('Te déconnecter de ce téléphone ?')) return;
  await api('/api/deconnexion', { method: 'POST' }).catch(() => {});
  oublierDiscussionsLocales();
  etat.uid = null; etat.profil = {};
  afficherBienvenue('connexion');
});
$('#form-pin').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('#pin-msg');
  try {
    await api('/api/compte/pin', { method: 'PUT', body: JSON.stringify({ ancien: $('#pin-ancien').value, nouveau: $('#pin-nouveau').value }) });
    e.target.reset();
    msg.textContent = 'Code changé. Tes autres appareils devront se reconnecter.';
  } catch (ex) { msg.textContent = ex.message; }
});
$('#reg-supprimer').addEventListener('click', async () => {
  const pin = prompt('Pour supprimer définitivement ton compte et toutes tes données, entre ton code secret :');
  if (!pin) return;
  try {
    await api('/api/compte', { method: 'DELETE', body: JSON.stringify({ pin }) });
    oublierDiscussionsLocales();
    try { localStorage.removeItem('tehis_a_un_compte'); } catch { /* rien */ }
    etat.uid = null; etat.profil = {};
    afficherBienvenue('inscription');
    toast('Ton compte a été supprimé.');
  } catch (ex) { toast(ex.message, 5000); }
});

/* Administration : testeurs, offres, code provisoire. */
const telLisible = (t) => String(t).replace(/^\+225(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '+225 $1 $2 $3 $4 $5');
async function afficherTesteurs() {
  const ul = $('#reg-admin-liste');
  ul.innerHTML = '<li class="muted small">Chargement…</li>';
  let comptes;
  try { comptes = await api('/api/admin/comptes'); } catch (e) { ul.innerHTML = `<li class="small">${echapper(e.message)}</li>`; return; }
  const actifs = comptes.filter((c) => c.derniereVisite && Date.now() - new Date(c.derniereVisite) < 7 * 864e5).length;
  $('#reg-admin-resume').textContent = `${comptes.length} compte${comptes.length > 1 ? 's' : ''} · ${actifs} actif${actifs > 1 ? 's' : ''} cette semaine`;
  ul.innerHTML = '';
  for (const c of comptes) {
    const li = document.createElement('li');
    const vu = c.derniereVisite ? new Date(c.derniereVisite).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '–';
    li.innerHTML = `<div><strong>${echapper(c.prenom || 'Sans prénom')}</strong>${c.role === 'admin' ? ' <span class="badge mini">admin</span>' : ''}<div class="small muted">${echapper(telLisible(c.telephone))} · vu le ${vu} · ${c.messagesAujourdhui} message${c.messagesAujourdhui > 1 ? 's' : ''} aujourd'hui</div></div>
      <div class="actions-testeur"><label class="sr-only" for="o-${c.id}">Offre</label><select id="o-${c.id}">${Object.entries(NOMS_OFFRES).map(([k, n]) => `<option value="${k}"${k === c.offre ? ' selected' : ''}>${n}</option>`).join('')}</select>
      <button type="button" class="btn small" data-pin>Code</button></div>`;
    li.querySelector('select').onchange = async (e) => {
      try { await api(`/api/admin/comptes/${c.id}`, { method: 'PUT', body: JSON.stringify({ offre: e.target.value }) }); toast(`${c.prenom || 'Compte'} : offre ${NOMS_OFFRES[e.target.value]}.`); } catch (ex) { toast(ex.message); }
    };
    li.querySelector('[data-pin]').onclick = async () => {
      if (!confirm(`Créer un code provisoire pour ${c.prenom || c.telephone} ? Son code actuel ne marchera plus.`)) return;
      try {
        const r = await api(`/api/admin/comptes/${c.id}/pin`, { method: 'POST' });
        li.querySelector('.pin-provisoire')?.remove();
        const texte = `Bonjour ${c.prenom || ''}, voici ton code provisoire Tehis : ${r.pin}. Connecte-toi puis change-le dans Réglages › Mon compte.`;
        li.insertAdjacentHTML('beforeend', `<div class="pin-provisoire">Code provisoire : <strong>${r.pin}</strong> · <a href="https://wa.me/${r.telephone.replace('+', '')}?text=${encodeURIComponent(texte)}" target="_blank" rel="noopener">l'envoyer sur WhatsApp</a></div>`);
      } catch (ex) { toast(ex.message); }
    };
    ul.appendChild(li);
  }
}
$('#reg-admin-maj').addEventListener('click', afficherTesteurs);

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
  configurerVoixIA(etat.statut.voixIA ? async (texte, espece) => {
    const r = await fetch('/api/voix/parler', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ texte, espece }) });
    if (!r.ok) throw new Error(`voix ${r.status}`);
    return r.blob();
  } : null);
  initDictee();
  majBoutonVoix();
  if (!etat.statut.authentifie) return afficherBienvenue();
  etat.profil = await api('/api/profile');
  etat.uid = etat.profil.compte;
  reprendreAnciennesDiscussions();
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
