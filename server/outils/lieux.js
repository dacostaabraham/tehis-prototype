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
const TTL = 2 * 60 * 60_000; // les lieux bougent peu : 2 h de cache
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
  const resultat = r ? { lat: Number(r.lat), lng: Number(r.lon), libelle: r.display_name.split(',').slice(0, 3).join(',').trim() } : null;
  console.log(`[lieux] géocodage « ${q} » → ${resultat ? resultat.libelle : 'introuvable'}`);
  return enCache(cle, resultat);
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

const DELAI_PHASE = 15_000; // par miroir et par phase : les succès mesurés prennent 1 à 8 s ; au-delà, la phase suivante réessaie
const PHASES_RAYON = [800, 2000, 5000]; // mètres : du plus rapide au plus large
const SEUIL_PHASE = 4; // assez de résultats → inutile d'élargir

/** Interroge les miroirs Overpass en parallèle : le premier succès gagne, sans attendre les retardataires.
 *  Résout { elements, serveur, dureeMs } ; en cas d'échec total, l'erreur porte le détail par miroir. */
function interrogerOverpass(corps, fetchImpl, delai = DELAI_PHASE) {
  const options = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(corps)}` };
  const nomServeur = (u) => { try { return new URL(u).host; } catch { return u; } };
  return new Promise((resolve, reject) => {
    let echecs = 0;
    const details = [];
    for (const serveur of OVERPASS) {
      const t0 = Date.now();
      appel(serveur, options, fetchImpl, delai).then(
        (res) => resolve({ elements: Array.isArray(res.elements) ? res.elements : [], serveur: nomServeur(serveur), dureeMs: Date.now() - t0 }),
        (e) => {
          echecs += 1;
          details.push(`${nomServeur(serveur)}: ${e?.name === 'AbortError' ? 'timeout' : (e?.message || e?.name || '?')}`);
          if (echecs >= OVERPASS.length) {
            const err = new Error(`Overpass indisponible (${details.join(' ; ')})`);
            err.cause = e;
            reject(err);
          }
        }
      );
    }
  });
}

/** Message d'erreur lisible pour l'utilisateur : jamais de jargon technique. */
function erreurReseau(e) {
  const texte = [e?.message, e?.cause?.message].filter(Boolean).join(' ');
  const surcharge = /abort|timeout|50[34]|429|too busy/i.test(texte) || e?.name === 'AbortError' || e?.cause?.name === 'AbortError';
  if (surcharge) {
    return 'La recherche a pris trop de temps (serveurs très sollicités). Réessaie dans un instant.';
  }
  return 'La carte des lieux est indisponible pour le moment. Vérifie ta connexion puis réessaie.';
}

  const cle = `lieux|${input.categorie}|${centre.lat.toFixed(3)}|${centre.lng.toFixed(3)}|${rayon}`;
  let elements = enCache(cle);
  if (elements === undefined) {
    // Recherche par phases : une petite zone répond en quelques secondes même quand les
    // serveurs sont chargés (une grande zone dense se fait rejeter en 504). On élargit
    // uniquement si la phase précédente a rapporté trop peu de résultats.
    const rayonMax = Math.round(rayon * 1000);
    const phases = [...new Set([800, 2000, 5000, rayonMax].filter((m) => m <= rayonMax))].sort((a, b) => a - b);
    let derniereErreur = null;
    elements = [];
    for (const m of phases) {
      const corps = `[out:json][timeout:20];(${cat.filtres.map((f) => `nwr${f}(around:${m},${centre.lat},${centre.lng});`).join('')});out center tags 80;`;
      try {
        const { elements: frais, serveur, dureeMs } = await interrogerOverpass(corps, fetchImpl);
        elements = frais;
        derniereErreur = null;
        console.log(`[lieux] ${input.categorie} ${m}m → ${frais.length} éléments via ${serveur} en ${(dureeMs / 1000).toFixed(1)}s`);
        // Seuil sur les lieux utilisables (nommés, dédupliqués), pas sur les éléments bruts.
        if (versLieux(elements, centre).length >= SEUIL_PHASE || m === phases[phases.length - 1]) break;
      } catch (e) {
        console.warn(`[lieux] ${input.categorie} ${m}m → échec : ${e.message}`);
        derniereErreur = e; // on tente la phase suivante : une saturation passagère peut se résorber
      }
    }
    if (derniereErreur && !elements.length) {
      console.warn(`[lieux] ${input.categorie} → abandon : ${derniereErreur.message}`);
      return { erreur: erreurReseau(derniereErreur) };
    }
    console.log(`[lieux] ${input.categorie} @${centre.lat.toFixed(3)},${centre.lng.toFixed(3)} → ${versLieux(elements, centre).length} lieux`);
    enCache(cle, elements);
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
