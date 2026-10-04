// Site de prélancement : compagnon 3D, agents, démo tontine, exemples d'agents, inscription.
import { AGENTS, NOMS_OFFRES } from '/shared/agents.js';
import { tontine } from '/shared/budget.js';
import { vignetteAgent, logoTehis } from '/shared/identite.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fcfa = (n) => `${new Intl.NumberFormat('fr-FR').format(Math.round(n))} FCFA`;
const reduit = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Marque : logo partagé avec l'app ---------- */
const marque = $('.marque');
if (marque) marque.innerHTML = `${logoTehis(30)}<span>Tehis<span>.</span></span>`;

/* ---------- Agents (catalogue partagé avec l'app) ---------- */
const ordre = ['vendeur', 'finance', 'budget', 'redaction', 'emploi', 'demarches', 'repetiteur', 'organisation'];
$('#grille-agents').innerHTML = ordre.map((id) => {
  const a = AGENTS[id];
  return `<article class="agent">${vignetteAgent(id)}<h3>${esc(a.nom)}</h3><p>${esc(a.resume)}</p><span class="offre-min">${a.offre === 'gratuit' ? 'Inclus gratuitement' : `Offre ${esc(NOMS_OFFRES[a.offre])}`}</span></article>`;
}).join('');

/* ---------- Démo tontine ---------- */
const formT = $('#calcul-tontine');
function calculerTontine() {
  const d = Object.fromEntries(new FormData(formT));
  const zone = $('#resultat-tontine');
  try {
    const r = tontine({ membres: Number(d.membres), cotisation: Number(d.cotisation), position: Number(d.position), frequence: d.frequence });
    zone.innerHTML = `<p class="gros">${fcfa(r.cagnotte)}<small>reçus au tour ${r.position}</small></p>
      <div class="tours" aria-hidden="true">${r.tours.slice(0, 30).map((t) => `<span class="${t.beneficiaire === 'toi' ? 'toi' : t.tour < r.position ? 'avant' : ''}">${t.tour}</span>`).join('')}</div>
      <p class="lecture">${esc(r.lecture)}</p><p class="alerte">${esc(r.risque)}</p>
      <p class="pont"><a class="btn secondaire" href="#rejoindre">Faire mon vrai budget dans l'app →</a></p>`;
  } catch (e) {
    zone.innerHTML = `<p class="alerte">${esc(e.message)}</p>`;
  }
}
formT.addEventListener('input', calculerTontine);
formT.addEventListener('submit', (e) => e.preventDefault());
calculerTontine();

/* ---------- Exemples « Crée ton agent » ---------- */
const EXEMPLES = [
  { icone: '💇🏾‍♀️', nom: 'Coiffure Awa', resume: 'Conseille les clientes et prépare les rappels de rendez-vous', outils: ['Documents', 'Rappels', 'Mes tarifs'], q: 'Combien pour des tresses ce samedi ?', r: 'Les tresses sont à 5 000 FCFA. Samedi, il reste 10 h et 15 h. Je te prépare le message de confirmation pour ta cliente ?' },
  { icone: '🍲', nom: 'Maquis Chez Tanti', resume: 'Menu du jour, prix des plats et liste du marché', outils: ['Documents', 'Calculs', 'Listes'], q: 'Fais le menu du jour pour mon statut WhatsApp', r: '🍲 Menu du jour : garba 1 000 FCFA, alloco-poisson 1 500 FCFA, foutou sauce graine 2 000 FCFA. Livraison à Cocody dès 11 h !' },
  { icone: '🧵', nom: 'Atelier Couture', resume: 'Mesures des clientes, devis et messages quand la tenue est prête', outils: ['Documents', 'Rappels', 'Listes'], q: 'La robe de Mme Koné est prête', r: 'Voici le message : « Bonjour Mme Koné, votre robe est prête. Vous pouvez passer à l\'atelier dès demain 9 h. Reste à payer : 7 000 FCFA. »' },
  { icone: '🚗', nom: 'Coach Permis', resume: 'Questions sur le code de la route et explication des erreurs', outils: ['Fiches de révision'], q: 'Pose-moi une question', r: 'À un carrefour sans panneau ni feu, qui a la priorité ? A) Le véhicule de gauche  B) Le véhicule de droite  C) Le plus rapide' }
];
function montrerExemple(i) {
  const e = EXEMPLES[i];
  document.querySelectorAll('#exemples button').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.i) === i)));
  $('#fiche').innerHTML = `<div class="tete"><span aria-hidden="true">${e.icone}</span><div><strong>${esc(e.nom)}</strong><small>${esc(e.resume)}</small></div></div>
    <div class="puces">${e.outils.map((o) => `<span>${esc(o)}</span>`).join('')}</div>
    <p class="msg">${esc(e.q)}</p><p class="rep">${esc(e.r)}</p>`;
}
document.querySelectorAll('#exemples button').forEach((b) => b.addEventListener('click', () => montrerExemple(Number(b.dataset.i))));
montrerExemple(0);

/* ---------- Bulle du compagnon ---------- */
const PHRASES = [
  'Ton point mort : 27 clients par mois.',
  'Rappel : cotisation de la tontine demain.',
  'Ta lettre de réclamation est prête.',
  'Prix plancher de ta prestation : 175 000 FCFA.',
  'Il te reste 15 000 FCFA à la fin du mois.',
  'Ta fiche produit est prête pour WhatsApp.'
];
let iPhrase = 0;
const bulle = $('#bulle');
if (!reduit) setInterval(() => {
  bulle.classList.add('sortie');
  setTimeout(() => { iPhrase = (iPhrase + 1) % PHRASES.length; bulle.textContent = PHRASES[iPhrase]; bulle.classList.remove('sortie'); }, 300);
}, 3600);

/* ---------- Compagnon 3D ---------- */
const scene3d = { changer: () => {} };
document.querySelectorAll('.especes button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.especes button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  scene3d.changer(b.dataset.espece);
  $('#repli').src = `/pets/${b.dataset.espece}.jpg`;
}));

async function demarrer3D() {
  const conteneur = $('#scene');
  const repli = () => { $('#repli').hidden = false; };
  let THREE, GLTFLoader;
  try {
    THREE = await import('three');
    ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
    const c = document.createElement('canvas');
    if (!c.getContext('webgl2') && !c.getContext('webgl')) throw new Error('webgl');
  } catch { return repli(); }

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  conteneur.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 1.5, 7.6); camera.lookAt(0, 1.15, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8aa39e, 2.2));
  const soleil = new THREE.DirectionalLight(0xffffff, 1.6); soleil.position.set(3, 6, 5); scene.add(soleil);
  const ombre = new THREE.Mesh(new THREE.CircleGeometry(0.9, 48), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }));
  ombre.rotation.x = -Math.PI / 2; scene.add(ombre);
  const racine = new THREE.Group(); const corps = new THREE.Group(); racine.add(corps); scene.add(racine);

  const loader = new GLTFLoader(); const cache = {}; let espece = 'chat';
  async function charger(e) {
    espece = e;
    try {
      cache[e] ||= loader.loadAsync(`/models/${e}.glb`).then((g) => g.scene);
      const src = await cache[e];
      if (espece !== e) return;
      corps.clear();
      const m = src.clone(true);
      m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.metalness = 0; o.material.roughness = 0.85; } });
      const box = new THREE.Box3().setFromObject(m);
      m.scale.setScalar(2.3 / box.getSize(new THREE.Vector3()).y);
      box.setFromObject(m);
      const centre = box.getCenter(new THREE.Vector3());
      m.position.x -= centre.x; m.position.z -= centre.z; m.position.y -= box.min.y;
      corps.add(m);
      sautJusqua = horloge.elapsedTime + 0.8;
    } catch { repli(); }
  }
  scene3d.changer = charger;

  let rotY = -0.3, vitesse = 0, glisse = false, dernierX = 0, sautJusqua = 0;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { glisse = true; dernierX = e.clientX; vitesse = 0; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', (e) => { if (!glisse) return; const dx = e.clientX - dernierX; dernierX = e.clientX; vitesse = dx * 0.012; rotY += vitesse; });
  el.addEventListener('pointerup', () => { glisse = false; });
  el.addEventListener('pointercancel', () => { glisse = false; });

  const redim = () => { const w = conteneur.clientWidth, h = conteneur.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  new ResizeObserver(redim).observe(conteneur); redim();

  // N'anime que lorsque la scène est visible (batterie).
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(conteneur);

  const horloge = new THREE.Clock();
  await charger('chat');
  (function tick() {
    requestAnimationFrame(tick);
    if (!visible) { horloge.getDelta(); return; }
    horloge.getDelta();
    const t = horloge.elapsedTime, A = reduit ? 0 : 1;
    if (!glisse) { rotY += vitesse + 0.004 * A; vitesse *= 0.93; }
    const s = 1 + 0.028 * Math.sin(t * 2.1) * A;
    corps.scale.set(1 + (s - 1) * 0.4, s, 1 + (s - 1) * 0.4);
    const saut = t < sautJusqua ? Math.abs(Math.sin((sautJusqua - t) * 8)) * 0.25 * A : 0;
    racine.position.y = saut; racine.rotation.y = rotY;
    corps.rotation.z = 0.04 * Math.sin(t * 1.3) * A;
    ombre.scale.setScalar(1 - saut * 0.6);
    renderer.render(scene, camera);
  })();
}
demarrer3D();

/* ---------- Compteur d'inscrits ---------- */
fetch('/api/stats').then((r) => r.json()).then((d) => {
  if (d.inscrits) { $('#preuve').innerHTML = `<strong>${new Intl.NumberFormat('fr-FR').format(d.inscrits)}</strong> personnes attendent déjà Tehis.`; $('#preuve').hidden = false; }
}).catch(() => {});

/* ---------- Inscription ---------- */
const parrain = new URLSearchParams(location.search).get('ref') || '';
const form = $('#formulaire');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#erreur'); err.hidden = true;
  const d = new FormData(form);
  const corps = {
    prenom: d.get('prenom'), whatsapp: d.get('whatsapp'), activite: d.get('activite'), ville: d.get('ville'),
    testeur: form.testeur.checked, consentement: form.consentement.checked, site: d.get('site'), parrain
  };
  const b = $('#envoyer'); b.disabled = true; b.textContent = 'Inscription…';
  try {
    const r = await fetch('/api/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.erreur || 'Inscription impossible pour le moment. Réessaie.');
    afficherMerci(res);
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  } finally { b.disabled = false; b.textContent = 'M\'inscrire'; }
});

function afficherMerci(r) {
  form.hidden = true;
  const m = $('#merci'); m.hidden = false;
  $('#merci-titre').textContent = r.deja ? `Déjà inscrit, ${r.prenom} !` : `Merci ${r.prenom} !`;
  $('#merci-texte').textContent = `Tu es le n° ${new Intl.NumberFormat('fr-FR').format(r.rang)} sur la liste d'attente${r.filleuls ? `, avec ${r.filleuls} parrainage${r.filleuls > 1 ? 's' : ''}` : ''}. On te prévient sur WhatsApp dès l'ouverture.`;
  const lien = `${location.origin}/?ref=${r.code}`;
  $('#lien').value = lien;
  const message = `Je me suis inscrit pour tester Tehis, un compagnon IA qui aide à fixer ses prix, gérer son budget et sa tontine, en français et en FCFA. Inscris-toi aussi : ${lien}`;
  $('#partager-wa').href = `https://wa.me/?text=${encodeURIComponent(message)}`;
  m.focus();
}
$('#copier').addEventListener('click', async (e) => {
  try { await navigator.clipboard.writeText($('#lien').value); e.target.textContent = 'Copié'; } catch { $('#lien').select(); }
  setTimeout(() => { e.target.textContent = 'Copier'; }, 1800);
});

/* ---------- Barre d'inscription fixe (mobile, trafic social) ---------- */
(() => {
  const barre = $('#cta-fixe');
  const hero = $('.hero');
  const cible = $('#rejoindre');
  if (!barre || !hero || !cible || !('IntersectionObserver' in window)) return;
  let heroVisible = true;
  let cibleVisible = false;
  const maj = () => { barre.hidden = heroVisible || cibleVisible; };
  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; maj(); }, { threshold: 0.15 }).observe(hero);
  new IntersectionObserver(([e]) => { cibleVisible = e.isIntersecting; maj(); }, { threshold: 0.2 }).observe(cible);
})();
