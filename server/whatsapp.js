// WhatsApp Cloud API (Meta) : envoi de messages, lecture du webhook, vérification de signature.
// Variables : WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN
// (+ WHATSAPP_API_VERSION, WHATSAPP_GRAPH_URL pour les tests).
import { createHmac, timingSafeEqual } from 'node:crypto';

export function configWhatsApp(env = process.env) {
  return {
    token: env.WHATSAPP_TOKEN || '',
    phoneId: env.WHATSAPP_PHONE_ID || '',
    secret: env.WHATSAPP_APP_SECRET || '',
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    version: env.WHATSAPP_API_VERSION || 'v25.0',
    graph: (env.WHATSAPP_GRAPH_URL || 'https://graph.facebook.com').replace(/\/$/, ''),
    numero: env.WHATSAPP_NUMERO || '', // numéro affiché dans l'app, ex. +225 07 00 00 00 00
    modeleRappel: env.WHATSAPP_MODELE_RAPPEL || '',
    modeleCode: env.WHATSAPP_MODELE_CODE || '',
    langueModeles: env.WHATSAPP_LANGUE_MODELES || 'fr'
  };
}
export const whatsappActif = (c = configWhatsApp()) => Boolean(c.token && c.phoneId && c.secret && c.verifyToken);

/** Signature Meta : en-tête X-Hub-Signature-256 = « sha256= » + HMAC du corps brut avec le secret de l'app. */
export function signatureValide(corpsBrut, entete, secret) {
  if (!secret || !entete || !Buffer.isBuffer(corpsBrut)) return false;
  const attendu = `sha256=${createHmac('sha256', secret).update(corpsBrut).digest('hex')}`;
  return attendu.length === entete.length && timingSafeEqual(Buffer.from(attendu), Buffer.from(entete));
}

/** Messages reçus dans une notification du webhook, simplifiés. */
export function lireWebhook(corps) {
  const sortie = [];
  for (const entree of corps?.entry || []) {
    for (const ch of entree.changes || []) {
      const v = ch.value || {};
      const noms = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || '']));
      for (const m of v.messages || []) {
        const base = { id: m.id, de: m.from, nom: noms[m.from] || '', horodatage: Number(m.timestamp) * 1000 || Date.now(), type: m.type };
        if (m.type === 'text') sortie.push({ ...base, texte: m.text?.body || '' });
        else if (m.type === 'interactive') {
          const r = m.interactive?.button_reply || m.interactive?.list_reply;
          sortie.push({ ...base, type: 'reponse', reponseId: r?.id || '', texte: r?.title || '' });
        } else if (m.type === 'button') sortie.push({ ...base, type: 'reponse', reponseId: m.button?.payload || '', texte: m.button?.text || '' });
        else if (m.type === 'location') sortie.push({ ...base, position: { lat: Number(m.location?.latitude), lng: Number(m.location?.longitude) }, texte: m.location?.name || '' });
        else if (m.type === 'audio') sortie.push({ ...base, media: { id: m.audio?.id, type: m.audio?.mime_type } });
        else if (m.type === 'image') sortie.push({ ...base, media: { id: m.image?.id, type: m.image?.mime_type }, texte: m.image?.caption || '' });
        else sortie.push({ ...base, type: 'autre' });
      }
    }
  }
  return sortie;
}

/** Markdown de l'agent → mise en forme WhatsApp (*gras*, _italique_, listes simples). */
export function versWhatsApp(md) {
  return String(md || '')
    .replace(/```[\s\S]*?```/g, (b) => b) // le code reste tel quel
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '_$1_')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1 : $2')
    .replace(/^\s*[-•]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Coupe un long texte en messages de 4 000 caractères au plus, de préférence entre deux paragraphes. */
export function decouper(texte, max = 3900) {
  const out = [];
  let reste = String(texte || '').trim();
  while (reste.length > max) {
    let i = reste.lastIndexOf('\n\n', max);
    if (i < max * 0.5) i = reste.lastIndexOf('\n', max);
    if (i < max * 0.5) i = reste.lastIndexOf(' ', max);
    if (i <= 0) i = max;
    out.push(reste.slice(0, i).trim()); reste = reste.slice(i).trim();
  }
  if (reste) out.push(reste);
  return out;
}

const couper = (t, n) => { const s = String(t || '').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

export function creerClientWhatsApp(c = configWhatsApp(), fetchImpl = fetch) {
  const url = (chemin) => `${c.graph}/${c.version}/${chemin}`;
  async function appel(chemin, corps, { methode = 'POST', brut = false } = {}) {
    const r = await fetchImpl(url(chemin), {
      method: methode,
      headers: { Authorization: `Bearer ${c.token}`, ...(corps && !(corps instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: corps ? (corps instanceof FormData ? corps : JSON.stringify(corps)) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
    if (brut) return r;
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(`WhatsApp ${r.status} : ${d.error?.message || 'erreur'}`), { statut: r.status, code: d.error?.code });
    return d;
  }
  const envoyer = (to, contenu) => appel(`${c.phoneId}/messages`, { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...contenu });

  return {
    config: c,
    async texte(to, corps) {
      for (const morceau of decouper(corps)) await envoyer(to, { type: 'text', text: { preview_url: false, body: morceau } });
    },
    /** 1 à 3 options courtes : boutons ; jusqu'à 10 : liste. Les identifiants reviennent dans la réponse. */
    async choix(to, texte, options, { bouton = 'Choisir', titreSection = 'Réponses' } = {}) {
      const opts = options.slice(0, 10);
      if (opts.length <= 3 && opts.every((o) => o.titre.length <= 20)) {
        return envoyer(to, { type: 'interactive', interactive: { type: 'button', body: { text: couper(texte, 1024) }, action: { buttons: opts.map((o) => ({ type: 'reply', reply: { id: couper(o.id, 256), title: o.titre } })) } } });
      }
      return envoyer(to, { type: 'interactive', interactive: { type: 'list', body: { text: couper(texte, 1024) }, action: { button: couper(bouton, 20), sections: [{ title: couper(titreSection, 24), rows: opts.map((o) => ({ id: couper(o.id, 200), title: couper(o.titre, 24), ...(o.description ? { description: couper(o.description, 72) } : {}) })) }] } } });
    },
    lieu(to, l) {
      return envoyer(to, { type: 'location', location: { latitude: l.lat, longitude: l.lng, name: couper(l.nom, 100), ...(l.adresse ? { address: couper(l.adresse, 200) } : {}) } });
    },
    demanderPosition(to, texte) {
      return envoyer(to, { type: 'interactive', interactive: { type: 'location_request_message', body: { text: couper(texte, 1024) }, action: { name: 'send_location' } } });
    },
    async audio(to, mp3) {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', 'audio/mpeg');
      form.append('file', new Blob([mp3], { type: 'audio/mpeg' }), 'reponse.mp3');
      const { id } = await appel(`${c.phoneId}/media`, form);
      return envoyer(to, { type: 'audio', audio: { id } });
    },
    modele(to, nom, parametres = [], { boutonCode = null } = {}) {
      const components = [];
      if (parametres.length) components.push({ type: 'body', parameters: parametres.map((p) => ({ type: 'text', text: String(p).slice(0, 1000) })) });
      if (boutonCode) components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: boutonCode }] });
      return envoyer(to, { type: 'template', template: { name: nom, language: { code: c.langueModeles }, components } });
    },
    marquerLu(id) { return appel(`${c.phoneId}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: id }).catch(() => {}); },
    async telecharger(mediaId) {
      const info = await appel(mediaId, null, { methode: 'GET' });
      const r = await fetchImpl(info.url, { headers: { Authorization: `Bearer ${c.token}` }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) throw new Error(`Téléchargement WhatsApp ${r.status}`);
      return { donnees: Buffer.from(await r.arrayBuffer()), type: info.mime_type || r.headers.get('content-type') };
    }
  };
}

/** Numéro WhatsApp (wa_id, chiffres seuls) → numéro de compte (+225…). */
export const telephoneDeWa = (waId) => (/^\d{8,15}$/.test(String(waId || '')) ? `+${waId}` : null);
export const waDeTelephone = (t) => String(t || '').replace(/^\+/, '');
