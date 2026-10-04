// Outil « chercher_lieux » : établissements proches (pharmacies, centres de santé, marchés, mairies…)
// Données OpenStreetMap (Overpass pour les lieux, Nominatim pour transformer un quartier en coordonnées).
// Gratuit, sans clé ; respecter les règles d'usage : User-Agent identifiable, cache, peu de requêtes.

// Serveurs remplaçables par variables d'environnement (instance privée, tests).
const OVERPASS = (process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const NOMINATIM = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
const UA = 'Tehis-Prototype/0.1 (assistant IA, Cote d\'Ivoire)';

// Catégorie → filtres OpenStreetMap. « libelle » sert dans l'app.
export const CATEGORIES = {
  pharmacie: { libelle: 'Pharmacies', icone: '💊', filtres: ['["amenity"="pharmacy"]'] },
  centre_sante: { libelle: 'Centres de santé', icone: '🏥', filtres: ['["amenity"="clinic"]', '["healthcare"="centre"]', '["amenity"="doctors"]'] },
  hopital: { libelle: 'Hôpitaux', icone: '🚑', filtres: ['["amenity"="hospital"]'] },
  laboratoire: { libelle: "Laboratoires d'analyses", icone: '🧪', filtres: ['["healthcare"="laboratory"]'] },
  dentiste: { libelle: 'Dentistes', icone: '🦷', filtres: ['["amenity"="dentist"]', '["healthcare"="dentist"]'] },
  marche: { libelle: 'Marchés', icone: '🧺', filtres: ['["amenity"="marketplace"]'] },
  supermarche: { libelle: 'Supermarchés', icone: '🛒', filtres: ['["shop"="supermarket"]'] },
  ecole: { libelle: 'Écoles', icone: '🏫', filtres: ['["amenity"="school"]'] },
  banque: { libelle: 'Banques', icone: '🏦', filtres: ['["amenity"="bank"]'] },
  distributeur: { libelle: 'Distributeurs de billets', icone: '💳', filtres: ['["amenity"="atm"]'] },
  transfert_argent: { libelle: "Points de transfert d'argent", icone: '📲', filtres: ['["amenity"="money_transfer"]', '["amenity"="payment_centre"]'] },
  station: { libelle: 'Stations-service', icone: '⛽', filtres: ['["amenity"="fuel"]'] },
  mairie: { libelle: 'Mairies', icone: '🏛️', filtres: ['["amenity"="townhall"]'] },
  police: { libelle: 'Commissariats et gendarmeries', icone: '👮', filtres: ['["amenity"="police"]'] },
  poste: { libelle: 'Bureaux de poste', icone: '📮', filtres: ['["amenity"="post_office"]'] }
};

export const SCHEMA_LIEUX = {
  name: 'chercher_lieux',
  description: "Trouve des établissements proches de l'utilisateur (ou d'un quartier) et les affiche sur une carte avec la distance, le bouton « Y aller » (itinéraire) et « Appeler » si le numéro est connu. Utilise la position partagée par l'utilisateur ; sinon passe « pres_de » (quartier, commune ou ville). Si aucune position n'est connue, l'outil demande à l'utilisateur de la partager : n'invente jamais d'adresse. Les données viennent d'OpenStreetMap : elles ne disent pas si une pharmacie est de garde.",
  input_schema: {
    type: 'object',
    properties: {
      categorie: { type: 'string', enum: Object.keys(CATEGORIES) },
      pres_de: { type: 'string', description: 'Quartier, commune ou ville, si l\'utilisateur l\'a donné (ex. « Cocody Angré », « Bouaké »). Laisser vide pour utiliser sa position.' },
      rayon_km: { type: 'number', description: 'Rayon de recherche, 1 à 10 km (3 par défaut)' }
    },
    required: ['categorie']
  }
};

export function distanceMetres(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

export function positionValide(p) {
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
}

function adresse(t) {
  const rue = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  return [rue, t['addr:suburb'] || t['addr:district'], t['addr:city']].filter(Boolean).join(', ') || null;
}
const telephone = (t) => (t.phone || t['contact:phone'] || t['contact:mobile'] || '').split(';')[0].trim() || null;

/** Transforme les éléments Overpass en lieux triés par distance. */
export function versLieux(elements, centre, max = 10) {
  const vus = new Set();
  return elements
    .map((e) => {
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
      const t = e.tags || {};
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        nom: t.name || t['name:fr'] || null,
        lat, lng,
        distance: distanceMetres(centre, { lat, lng }),
        adresse: adresse(t),
        telephone: telephone(t),
        horaires: t.opening_hours || null,
        osm: `https://www.openstreetmap.org/${e.type}/${e.id}`
      };
    })
    .filter((l) => l && l.nom && !vus.has(`${l.nom}|${Math.round(l.lat * 2000)}|${Math.round(l.lng * 2000)}`) && vus.add(`${l.nom}|${Math.round(l.lat * 2000)}|${Math.round(l.lng * 2000)}`))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, max);
}

const cache = new Map();
const TTL = 15 * 60_000;
function enCache(cle, valeur) {
  if (valeur !== undefined) { cache.set(cle, { t: Date.now(), v: valeur }); if (cache.size > 300) cache.delete(cache.keys().next().value); return valeur; }
  const c = cache.get(cle);
  return c && Date.now() - c.t < TTL ? c.v : undefined;
}

async function appel(url, options, fetchImpl, delai = 20_000) {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), delai);
  try {
    const r = await fetchImpl(url, { ...options, signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(options.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(minuterie); }
}

export async function geocoder(texte, fetchImpl = fetch) {
  const q = String(texte || '').trim().slice(0, 120);
  if (!q) return null;
  const cle = `geo|${q.toLowerCase()}`;
  const deja = enCache(cle);
  if (deja !== undefined) return deja;
  const url = `${NOMINATIM}?format=jsonv2&limit=1&countrycodes=ci&accept-language=fr&q=${encodeURIComponent(q)}`;
  const res = await appel(url, {}, fetchImpl, 12_000);
  const r = res?.[0];
  return enCache(cle, r ? { lat: Number(r.lat), lng: Number(r.lon), libelle: r.display_name.split(',').slice(0, 3).join(',').trim() } : null);
}

/**
 * Exécute l'outil. ctx = { position: {lat, lng} | null }.
 * Renvoie { type: 'lieux', ... } ou { type: 'besoin_position' } ou { erreur }.
 */
export async function chercherLieux(input = {}, ctx = {}, fetchImpl = fetch) {
  const cat = CATEGORIES[input.categorie];
  if (!cat) return { erreur: `Catégorie inconnue : ${input.categorie}` };
  const rayon = Math.min(10, Math.max(1, Number(input.rayon_km) || 3));

  let centre = null, origine = 'position';
  try {
    if (input.pres_de && String(input.pres_de).trim()) {
      centre = await geocoder(input.pres_de, fetchImpl);
      origine = 'quartier';
      if (!centre) return { erreur: `Je n'ai pas trouvé « ${input.pres_de} » en Côte d'Ivoire. Demande un nom de quartier ou de commune plus précis, ou la position.` };
    } else if (positionValide(ctx.position)) {
      centre = { lat: ctx.position.lat, lng: ctx.position.lng, libelle: 'ta position' };
    } else {
      return { type: 'besoin_position', categorie: input.categorie, libelle: cat.libelle, consigne: "Aucune position : l'app affiche un bouton pour la partager. Demande aussi le quartier en alternative." };
    }
  } catch {
    return { erreur: 'La recherche de quartier est indisponible pour le moment.' };
  }

const DELAI_OVERPASS = 60_000; // les miroirs publics répondent souvent en 15-30 s

/** Interroge les miroirs Overpass en parallèle : le premier succès gagne, sans attendre les retardataires. */
function interrogerOverpass(corps, fetchImpl) {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(corps)}` };
  return new Promise((resolve, reject) => {
    let echecs = 0;
    let derniere = null;
    for (const serveur of OVERPASS) {
      appel(serveur, options, fetchImpl, DELAI_OVERPASS).then(
        (res) => resolve(Array.isArray(res.elements) ? res.elements : []),
        (e) => { echecs += 1; derniere = e; if (echecs >= OVERPASS.length) reject(derniere); }
      );
    }
  });
}

/** Message d'erreur lisible pour l'utilisateur : jamais de jargon technique. */
function erreurReseau(e) {
  const msg = e && e.message ? String(e.message) : '';
  if ((e && e.name === 'AbortError') || /aborted/i.test(msg)) {
    return 'La recherche a pris trop de temps (serveurs très sollicités). Réessaie dans un instant.';
  }
  return 'La carte des lieux est indisponible pour le moment. Vérifie ta connexion puis réessaie.';
}

  const cle = `lieux|${input.categorie}|${centre.lat.toFixed(3)}|${centre.lng.toFixed(3)}|${rayon}`;
  let elements = enCache(cle);
  if (elements === undefined) {
    const m = Math.round(rayon * 1000);
    const corps = `[out:json][timeout:45];(${cat.filtres.map((f) => `nwr${f}(around:${m},${centre.lat},${centre.lng});`).join('')});out center tags 80;`;
    try {
      elements = enCache(cle, await interrogerOverpass(corps, fetchImpl));
    } catch (e) {
      return { erreur: erreurReseau(e) };
    }
  }

  const lieux = versLieux(elements, centre);
  return {
    type: 'lieux',
    categorie: input.categorie,
    libelle: cat.libelle,
    icone: cat.icone,
    centre: { lat: centre.lat, lng: centre.lng, libelle: centre.libelle },
    origine,
    rayonKm: rayon,
    lieux,
    total: lieux.length,
    note: input.categorie === 'pharmacie' ? 'Les pharmacies de garde changent chaque semaine : appelle avant de te déplacer la nuit ou le dimanche.' : null,
    source: 'OpenStreetMap'
  };
}
