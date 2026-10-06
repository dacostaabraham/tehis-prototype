// Lieux à proximité dans l'app : position, carte (Leaflet + OpenStreetMap), liste avec Y aller, Appeler, Partager.
// Et boutons de réponse rapide (« poser_choix »).
import { echapper } from './shared/markdown.js';

/* ---------- Position ---------- */
let derniere = null; // { lat, lng, precision, t }
const FRAICHEUR = 5 * 60_000;

export const positionConnue = () => (derniere && Date.now() - derniere.t < FRAICHEUR ? { lat: derniere.lat, lng: derniere.lng } : null);

/** Demande la position (une seule fois par 5 minutes). Rejette avec un message clair. */
export function obtenirPosition() {
  const connue = positionConnue();
  if (connue) return Promise.resolve(connue);
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error("Ton téléphone ne permet pas de partager la position ici. Écris plutôt ton quartier."));
    navigator.geolocation.getCurrentPosition(
      (p) => { derniere = { lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy, t: Date.now() }; resolve(positionConnue()); },
      (e) => reject(new Error(e.code === 1
        ? "Position refusée. Pour l'autoriser : Réglages du téléphone › Safari (ou Chrome) › Localisation. Tu peux aussi écrire ton quartier."
        : "Position introuvable pour le moment. Réessaie à l'extérieur, ou écris ton quartier.")),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 }
    );
  });
}

/* ---------- Leaflet, chargé seulement quand une carte s'affiche ---------- */
let leaflet = null;
function chargerLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leaflet) return leaflet;
  leaflet = new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leaflet = null; reject(new Error('carte')); };
    document.head.appendChild(js);
  });
  return leaflet;
}

const distanceTexte = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`);
const minutesAPied = (m) => Math.max(1, Math.round(m / 75)); // ~4,5 km/h
const itineraire = (l, mode) => `https://www.google.com/maps/dir/?api=1&destination=${l.lat},${l.lng}&travelmode=${mode}`;
const lienCarte = (l) => `https://www.google.com/maps/search/?api=1&query=${l.lat},${l.lng}`;

const itineraireTexte = (l, mode) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${l.nom}, ${l.commune || ''}, Côte d'Ivoire`)}&travelmode=${mode}`;
/** « du 3 octobre au 9 octobre 2026 » → « du 3 au 9 octobre ». */
const periodeCourte = (t) => {
  const m = /du (\d+) (\p{L}+) au (\d+) (\p{L}+)/u.exec(t || '');
  if (!m) return 'cette semaine';
  return m[2] === m[4] ? `du ${m[1]} au ${m[3]} ${m[4]}` : `du ${m[1]} ${m[2]} au ${m[3]} ${m[4]}`;
};
const aPosition = (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng);
const allerVers = (l, mode) => (aPosition(l) ? itineraire(l, mode) : itineraireTexte(l, mode));

/** Carte d'un résultat « lieux ». Pour les pharmacies : onglets « De garde » et « Toutes ». */
export function carteLieux(r) {
  const el = document.createElement('div');
  el.className = 'result lieux';
  let mode = 'driving';
  const gardes = r.garde?.pharmacies || [];
  const onglets = gardes.length ? [
    { id: 'garde', titre: `🌙 De garde (${gardes.length})`, lieux: gardes.map((g) => ({ ...g, garde: true })) },
    { id: 'toutes', titre: `Toutes (${r.lieux.length})`, lieux: r.lieux }
  ] : [{ id: 'toutes', lieux: r.lieux }];
  let actif = onglets.find((o) => o.id === (r.gardeDAbord ? 'garde' : 'toutes')) || onglets[0];

  el.innerHTML = `<div class="result-head"><span class="result-title">${echapper(r.icone || '📍')} ${echapper(r.libelle)}</span><span class="muted small" data-compte></span></div>
    <p class="small muted">Autour de ${echapper(r.centre.libelle)}</p>
    ${onglets.length > 1 ? `<div class="seg onglets-lieux" role="tablist" aria-label="Quelles pharmacies">${onglets.map((o) => `<button type="button" role="tab" data-onglet="${o.id}">${echapper(o.titre)}</button>`).join('')}</div>` : ''}
    <div class="carte-lieux" role="img" aria-label="Carte des ${echapper(r.libelle.toLowerCase())} proches"></div>
    <div class="seg mode" role="radiogroup" aria-label="Moyen de déplacement">
      <button type="button" role="radio" aria-checked="true" data-mode="driving">🚗 Voiture</button>
      <button type="button" role="radio" aria-checked="false" data-mode="walking">🚶 À pied</button>
      <button type="button" role="radio" aria-checked="false" data-mode="transit">🚌 Transport</button>
    </div>
    <ol class="liste-lieux"></ol>
    ${r.note ? `<div class="alert">${echapper(r.note)}</div>` : ''}
    <p class="small muted source-carte">Carte © contributeurs OpenStreetMap${r.garde ? ` · Garde : <a href="${echapper(r.garde.source)}" target="_blank" rel="noopener">abidjan.net</a>` : ''}. Horaires et numéros à vérifier.</p>`;

  const liste = el.querySelector('.liste-lieux');
  const zone = el.querySelector('.carte-lieux');
  let carte = null, L = null, calque = null, marqueurs = [];

  function rendreListe() {
    const lieux = actif.lieux;
    el.querySelector('[data-compte]').textContent = actif.id === 'garde' ? periodeCourte(r.garde.periode) : `${r.total} à moins de ${r.rayonKm} km`;
    el.querySelectorAll('[data-onglet]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.onglet === actif.id)));
    liste.innerHTML = lieux.map((l, i) => {
      const loin = l.distance === null || l.distance === undefined;
      const infos = loin ? `${l.commune ? `${echapper(l.commune)} · ` : ''}distance inconnue` : `${distanceTexte(l.distance)} · ${minutesAPied(l.distance)} min à pied${l.commune && actif.id === 'garde' ? ` · ${echapper(l.commune)}` : ''}`;
      return `<li data-i="${i}">
      <button type="button" class="lieu-tete" data-voir="${i}"${aPosition(l) ? '' : ' disabled'}><span class="rang">${i + 1}</span><span class="lieu-texte"><strong>${echapper(l.nom)}</strong>${l.garde ? ' <span class="badge-garde">De garde</span>' : ''}
        <span class="small muted">${infos}</span>
        ${l.adresse ? `<span class="small muted">${echapper(l.adresse)}</span>` : ''}
        ${l.horaires ? `<span class="small muted">Horaires : ${echapper(l.horaires)}</span>` : ''}</span></button>
      <div class="lieu-actions">
        <a class="btn small accent" data-aller="${i}" href="${allerVers(l, mode)}" target="_blank" rel="noopener">Y aller</a>
        ${l.telephone ? `<a class="btn small" href="tel:${echapper(l.telephone.replace(/[^\d+]/g, ''))}">Appeler</a>` : ''}
        <a class="btn small" href="https://wa.me/?text=${encodeURIComponent(`${l.nom}${l.garde ? ' (de garde)' : ''}${l.telephone ? ` · ${l.telephone}` : ''} : ${aPosition(l) ? lienCarte(l) : allerVers(l, 'driving')}`)}" target="_blank" rel="noopener">Partager</a>
      </div></li>`;
    }).join('') || '<li class="muted small">Rien trouvé dans ce rayon. Essaie un autre quartier.</li>';
    liste.querySelectorAll('[data-voir]').forEach((b) => b.addEventListener('click', () => {
      const m = marqueurs[Number(b.dataset.voir)];
      if (carte && m) { carte.flyTo(m.getLatLng(), 17, { duration: 0.6 }); m.openPopup(); zone.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }));
    rendreMarqueurs();
  }

  function rendreMarqueurs() {
    if (!carte) return;
    calque.clearLayers();
    marqueurs = actif.lieux.map((l, i) => (aPosition(l)
      ? L.marker([l.lat, l.lng], { icon: L.divIcon({ className: `pin-lieu${l.garde ? ' garde' : ''}`, html: `<span><b>${i + 1}</b></span>`, iconSize: [28, 28], iconAnchor: [14, 28] }) })
        .addTo(calque).bindPopup(`<strong>${echapper(l.nom)}</strong><br>${l.distance != null ? distanceTexte(l.distance) : echapper(l.commune || '')}`)
      : null));
    const points = [[r.centre.lat, r.centre.lng], ...actif.lieux.filter(aPosition).slice(0, 5).map((l) => [l.lat, l.lng])];
    carte.fitBounds(points, { padding: [28, 28], maxZoom: 16 });
  }

  el.querySelectorAll('[data-onglet]').forEach((b) => b.addEventListener('click', () => {
    actif = onglets.find((o) => o.id === b.dataset.onglet);
    rendreListe();
  }));
  el.querySelectorAll('.mode button').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode;
    el.querySelectorAll('.mode button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    el.querySelectorAll('[data-aller]').forEach((a) => { a.href = allerVers(actif.lieux[Number(a.dataset.aller)], mode); });
  }));

  // Carte : la position (ou le quartier) au centre, chaque lieu numéroté.
  chargerLeaflet().then((Lf) => {
    if (!zone.isConnected && !document.body.contains(el)) { /* rendu hors écran : on dessine quand même */ }
    L = Lf;
    carte = L.map(zone, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, tap: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(carte);
    L.circleMarker([r.centre.lat, r.centre.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563EB', fillOpacity: 1 }).addTo(carte).bindTooltip(r.origine === 'position' ? 'Toi' : r.centre.libelle);
    calque = L.layerGroup().addTo(carte);
    rendreMarqueurs();
    new ResizeObserver(() => carte.invalidateSize()).observe(zone);
  }).catch(() => { zone.innerHTML = '<p class="small muted">La carte n\'a pas pu se charger. La liste ci-dessous reste utilisable.</p>'; zone.classList.add('sans-carte'); });

  rendreListe();
  return el;
}

/** Carte qui demande la position (ou un quartier). ctx.parPosition() et ctx.parQuartier(q) relancent la recherche. */
export function cartePosition(data, ctx) {
  const el = document.createElement('div');
  el.className = 'result demande-position';
  el.innerHTML = `<div class="result-head"><span class="result-title">📍 ${echapper(data.libelle || 'Lieux')} autour de toi</span></div>
    <p class="small">Partage ta position une fois : elle sert seulement à cette recherche et n'est pas enregistrée.</p>
    <button type="button" class="btn accent" data-pos>Partager ma position</button>
    <form class="quartier"><label class="sr-only" for="q-${data.categorie}">Quartier</label><input id="q-${data.categorie}" type="text" placeholder="ou ton quartier : Yopougon Selmer…" maxlength="80"><button class="btn small" type="submit">Chercher</button></form>
    <p class="small erreur-pos" role="alert" hidden></p>`;
  const erreur = el.querySelector('.erreur-pos');
  el.querySelector('[data-pos]').addEventListener('click', async (e) => {
    erreur.hidden = true;
    e.target.disabled = true; e.target.textContent = 'Localisation…';
    try {
      await obtenirPosition();
      e.target.textContent = 'Position partagée ✓';
      ctx.parPosition(data);
    } catch (ex) {
      erreur.textContent = ex.message; erreur.hidden = false;
      e.target.disabled = false; e.target.textContent = 'Réessayer';
    }
  });
  el.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = e.target.querySelector('input').value.trim();
    if (q.length >= 3) ctx.parQuartier(data, q);
  });
  return el;
}

/** Boutons de réponse rapide. item.reponse est rempli après le choix (pour l'historique). */
export function carteChoix(item, ctx) {
  const c = item.data;
  const el = document.createElement('div');
  el.className = 'choix';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', c.question);
  const fige = () => { el.querySelectorAll('button, input').forEach((b) => { b.disabled = true; }); };
  if (c.multiple) {
    el.innerHTML = `${c.options.map((o, i) => `<label class="choix-case"><input type="checkbox" value="${i}"><span>${echapper(o)}</span></label>`).join('')}<button type="button" class="btn small accent" data-valider>Valider</button>`;
    el.querySelector('[data-valider]').addEventListener('click', () => {
      const pris = [...el.querySelectorAll('input:checked')].map((x) => c.options[Number(x.value)]);
      if (!pris.length) return;
      item.reponse = pris.join(', '); fige(); ctx.sauver?.(); ctx.envoyer(item.reponse);
    });
  } else {
    el.innerHTML = c.options.map((o, i) => `<button type="button" class="choix-btn" data-i="${i}">${echapper(o)}</button>`).join('')
      + '<button type="button" class="choix-btn autre" data-autre>Autre…</button>';
    el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => {
      item.reponse = c.options[Number(b.dataset.i)]; b.classList.add('pris'); fige(); ctx.sauver?.(); ctx.envoyer(item.reponse);
    }));
    el.querySelector('[data-autre]').addEventListener('click', () => ctx.ecrire());
  }
  if (item.reponse) { fige(); el.querySelectorAll('[data-i]').forEach((b) => { if (c.options[Number(b.dataset.i)] === item.reponse) b.classList.add('pris'); }); }
  return el;
}

/** Barre « Autour de moi » pour les agents qui ont des actions de proximité. */
export function barreProximite(actions, ctx) {
  const el = document.createElement('div');
  el.className = 'proximite';
  el.innerHTML = `<span class="small muted">📍 Autour de moi</span>${actions.map((a, i) => `<button type="button" data-a="${i}">${echapper(a.libelle)}</button>`).join('')}`;
  el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => ctx.chercher(actions[Number(b.dataset.a)])));
  return el;
}
