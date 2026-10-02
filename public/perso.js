// « Crée ton agent » : description → fiche proposée par l'IA → outils et connaissances → enregistrement.
import { OUTILS_PERSO, LIMITES_PERSO, TONS_PERSO, MAX_CONNAISSANCES, NOMS_OFFRES, offreSuffit } from './shared/agents.js';
import { echapper } from './shared/markdown.js';
import { toast } from './shared/ui.js';

const $ = (s) => document.querySelector(s);
const EXEMPLES = [
  ['💇🏾‍♀️ Salon de coiffure', 'Je tiens un salon de coiffure à Yopougon. Je veux un agent qui conseille mes clientes sur les coiffures, donne mes tarifs (tresses 5 000 FCFA, nattes 3 000 FCFA) et prépare les messages de rappel de rendez-vous.'],
  ['🍲 Maquis', "J'ai un maquis à Cocody. Je veux un agent qui prépare le menu du jour à publier sur WhatsApp, calcule le prix de mes plats et m'aide à gérer mes achats au marché."],
  ['🚗 Permis de conduire', "Je prépare l'examen du permis de conduire en Côte d'Ivoire. Je veux un agent qui me pose des questions sur le code de la route et m'explique mes erreurs."],
  ['🧵 Atelier de couture', "Je suis couturière. Je veux un agent qui note les mesures de mes clientes, prépare les devis et rédige les messages quand une tenue est prête."]
];

let ctx;          // { api, apres(agent) }
let etat = null;  // { offre, limites }
let edition = null;
let connaissances = [];

export function initPerso(contexte) {
  ctx = contexte;
  const zone = $('#perso-exemples');
  for (const [libelle, texte] of EXEMPLES) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = libelle;
    b.onclick = () => { $('#perso-desc').value = texte; };
    zone.appendChild(b);
  }
  $('#perso-ton').innerHTML = Object.entries(TONS_PERSO).map(([k, v]) => `<option value="${k}">${echapper(v)}</option>`).join('');
  document.querySelectorAll('#dlg-perso [data-aller]').forEach((b) => b.addEventListener('click', () => etape(Number(b.dataset.aller))));
  $('#perso-proposer').addEventListener('click', proposer);
  $('#perso-manuel').addEventListener('click', () => { remplir({ mission: $('#perso-desc').value.trim() }); etape(2); });
  $('#perso-suivant').addEventListener('click', () => {
    const err = $('#perso-err2');
    err.hidden = true;
    if ($('#perso-nom').value.trim().length < 2) { err.textContent = 'Donne un nom à ton agent.'; err.hidden = false; return; }
    if ($('#perso-mission').value.trim().length < 20) { err.textContent = 'Décris sa mission en quelques phrases.'; err.hidden = false; return; }
    etape(3);
  });
  $('#perso-enregistrer').addEventListener('click', enregistrer);
  $('#perso-supprimer').addEventListener('click', supprimer);
}

function etape(n) {
  document.querySelectorAll('#dlg-perso [data-panneau]').forEach((s) => { s.hidden = Number(s.dataset.panneau) !== n; });
  document.querySelectorAll('#dlg-perso [data-etape]').forEach((li) => {
    const k = Number(li.dataset.etape);
    li.className = k === n ? 'actif' : k < n ? 'fait' : '';
    if (k === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  $('#dlg-perso').scrollTop = 0;
  if (n === 3) afficherOutils();
}

function remplir(f = {}) {
  $('#perso-icone').value = f.icone || '✨';
  $('#perso-nom').value = f.nom || '';
  $('#perso-resume').value = f.resume || '';
  $('#perso-mission').value = f.mission || '';
  $('#perso-ton').value = TONS_PERSO[f.ton] ? f.ton : 'chaleureux';
  $('#perso-regles').value = (f.regles || []).join('\n');
  $('#perso-suggestions').value = (f.suggestions || []).join('\n');
  $('#perso-fort').checked = Boolean(f.modeleFort);
  connaissances = (f.connaissances || []).map((c) => ({ ...c }));
  ficheOutils = new Set(f.outils || ['documents']);
}
let ficheOutils = new Set(['documents']);

export async function ouvrirCreation(info) {
  etat = info;
  edition = null;
  if (info.agents.length >= info.limites.agents) {
    toast(`Ton offre ${NOMS_OFFRES[info.offre]} permet ${info.limites.agents} agent${info.limites.agents > 1 ? 's' : ''} personnalisé${info.limites.agents > 1 ? 's' : ''}. Modifie un agent existant ou passe à une offre supérieure.`);
    return;
  }
  $('#perso-titre').textContent = 'Crée ton agent';
  $('#perso-enregistrer').textContent = "Créer l'agent";
  $('#perso-supprimer').hidden = true;
  $('#perso-desc').value = '';
  $('#perso-err1').hidden = true;
  remplir({});
  etape(1);
  $('#dlg-perso').showModal();
}

export function ouvrirEdition(agent, info) {
  etat = info;
  edition = agent;
  $('#perso-titre').textContent = `Modifier ${agent.nom}`;
  $('#perso-enregistrer').textContent = 'Enregistrer';
  $('#perso-supprimer').hidden = false;
  remplir(agent);
  etape(2);
  $('#dlg-perso').showModal();
}

async function proposer() {
  const desc = $('#perso-desc').value.trim();
  const err = $('#perso-err1');
  err.hidden = true;
  if (desc.length < 15) { err.textContent = 'Décris ton besoin en une ou deux phrases.'; err.hidden = false; return; }
  const b = $('#perso-proposer');
  b.disabled = true; b.textContent = 'Je prépare la fiche…';
  try {
    const f = await ctx.api('/api/persos/brouillon', { method: 'POST', body: JSON.stringify({ description: desc }) });
    remplir(f);
    etape(2);
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  finally { b.disabled = false; b.textContent = 'Proposer une fiche'; }
}

function afficherOutils() {
  const offre = etat.offre;
  const lim = LIMITES_PERSO[offre] || LIMITES_PERSO.gratuit;
  $('#perso-outils').innerHTML = Object.entries(OUTILS_PERSO).map(([k, o]) => {
    const ok = offreSuffit(offre, o.offre);
    return `<label class="coche outil${ok ? '' : ' verrou'}"><input type="checkbox" value="${k}"${ficheOutils.has(k) && ok ? ' checked' : ''}${ok ? '' : ' disabled'}><span><strong>${echapper(o.nom)}</strong>${ok ? '' : ` <span class="badge">${echapper(NOMS_OFFRES[o.offre])}</span>`}<br><span class="small muted">${echapper(o.resume)}</span></span></label>`;
  }).join('');
  $('#perso-outils').querySelectorAll('input').forEach((cb) => { cb.onchange = () => (cb.checked ? ficheOutils.add(cb.value) : ficheOutils.delete(cb.value)); });
  $('#perso-fort-ligne').hidden = !lim.modeleFort;
  afficherSavoir(lim);
}

function afficherSavoir(lim) {
  const zone = $('#perso-savoir');
  if (!lim.connaissances) {
    zone.innerHTML = `<p class="small muted">Avec l'offre ${NOMS_OFFRES.plus}, ajoute tes tarifs, ton catalogue ou un cours : ton agent s'en servira pour répondre.</p>`;
    return;
  }
  const total = connaissances.reduce((s, c) => s + c.texte.length, 0);
  zone.innerHTML = `<p class="small muted">Tarifs, catalogue, horaires, cours… Ton agent s'en sert pour répondre. ${total.toLocaleString('fr-FR')} / ${MAX_CONNAISSANCES.toLocaleString('fr-FR')} caractères.</p>
    <ul class="item-list">${connaissances.map((c, i) => `<li><div><div>${echapper(c.titre)}</div><div class="muted small">${c.texte.length.toLocaleString('fr-FR')} caractères</div></div><button type="button" class="suppr" data-i="${i}">Retirer</button></li>`).join('')}</ul>
    <div class="savoir-ajout">
      <input id="savoir-titre" type="text" maxlength="80" placeholder="Titre (ex. Mes tarifs)">
      <textarea id="savoir-texte" rows="4" placeholder="Colle ton texte ici"></textarea>
      <div class="calc-actions"><button class="btn small" type="button" id="savoir-ajouter">Ajouter ce texte</button>
      <label class="btn small fichier-btn">Importer un fichier<input type="file" id="savoir-fichier" accept=".txt,.md,.csv,.pdf,text/plain,application/pdf" hidden></label></div>
      <p id="savoir-msg" class="small muted" role="status"></p>
    </div>`;
  zone.querySelectorAll('[data-i]').forEach((b) => { b.onclick = () => { connaissances.splice(Number(b.dataset.i), 1); afficherSavoir(lim); }; });
  $('#savoir-ajouter').onclick = () => {
    const texte = $('#savoir-texte').value.trim();
    if (!texte) return;
    ajouterSavoir($('#savoir-titre').value.trim() || 'Mes informations', texte, lim);
  };
  $('#savoir-fichier').onchange = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const msg = $('#savoir-msg');
    msg.textContent = 'Lecture du fichier…';
    try {
      const texte = /\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? await lirePdf(f) : await f.text();
      if (texte.trim().length < 20) { msg.textContent = "Je n'ai pas trouvé de texte dans ce fichier. Un PDF scanné (des images) ne peut pas être lu ici : copie le texte à la main."; return; }
      ajouterSavoir(f.name.replace(/\.[^.]+$/, ''), texte, lim);
    } catch { msg.textContent = 'Ce fichier n\'a pas pu être lu.'; }
  };
}

function ajouterSavoir(titre, texte, lim) {
  const total = connaissances.reduce((s, c) => s + c.texte.length, 0);
  const place = MAX_CONNAISSANCES - total;
  if (place <= 0) { $('#savoir-msg').textContent = 'Limite atteinte : retire un document pour en ajouter un autre.'; return; }
  connaissances.push({ titre: titre.slice(0, 80), texte: texte.slice(0, place) });
  afficherSavoir(lim);
  if (texte.length > place) $('#savoir-msg').textContent = `Texte coupé à ${place.toLocaleString('fr-FR')} caractères (limite atteinte).`;
}

// Lecture du texte d'un PDF dans le navigateur (pdf.js depuis jsDelivr).
async function lirePdf(fichier) {
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: await fichier.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(doc.numPages, 60); i++) {
    const contenu = await (await doc.getPage(i)).getTextContent();
    pages.push(contenu.items.map((it) => it.str).join(' '));
  }
  return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();
}

function lireFiche() {
  return {
    icone: $('#perso-icone').value.trim(),
    nom: $('#perso-nom').value.trim(),
    resume: $('#perso-resume').value.trim(),
    mission: $('#perso-mission').value.trim(),
    ton: $('#perso-ton').value,
    regles: $('#perso-regles').value.split('\n').map((x) => x.trim()).filter(Boolean),
    suggestions: $('#perso-suggestions').value.split('\n').map((x) => x.trim()).filter(Boolean),
    outils: [...ficheOutils],
    connaissances,
    modeleFort: $('#perso-fort').checked
  };
}

async function enregistrer() {
  const err = $('#perso-err3');
  err.hidden = true;
  const b = $('#perso-enregistrer');
  b.disabled = true;
  try {
    const agent = edition
      ? await ctx.api(`/api/persos/${edition.id}`, { method: 'PUT', body: JSON.stringify(lireFiche()) })
      : await ctx.api('/api/persos', { method: 'POST', body: JSON.stringify(lireFiche()) });
    $('#dlg-perso').close();
    await ctx.apres(agent);
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  finally { b.disabled = false; }
}

async function supprimer() {
  if (!edition || !confirm(`Supprimer « ${edition.nom} » et sa conversation ?`)) return;
  await ctx.api(`/api/persos/${edition.id}`, { method: 'DELETE' });
  try { localStorage.removeItem(`tehis_chat_perso:${edition.id}`); } catch { /* rien */ }
  $('#dlg-perso').close();
  await ctx.apres(null);
}
