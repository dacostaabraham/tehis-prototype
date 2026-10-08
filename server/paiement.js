// Paiement des offres Plus et Pro par Chariow (Mobile Money, carte…).
// Chaque offre est un produit Chariow de type « Licence » (rachetable chaque mois).
// Un paiement réussi ouvre 30 jours d'offre ; un nouveau paiement les prolonge.
// Confirmation : Pulse signé (webhook) + vérification directe de la vente au retour dans l'app.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function configPaiement(env = process.env) {
  return {
    cle: env.CHARIOW_API_KEY || '',
    secretPulse: env.CHARIOW_PULSE_SECRET || '',
    api: (env.CHARIOW_API_URL || 'https://api.chariow.com/v1').replace(/\/$/, ''),
    produits: { plus: env.CHARIOW_PRODUIT_PLUS || '', pro: env.CHARIOW_PRODUIT_PRO || '' },
    dureeJours: Number(env.DUREE_OFFRE_JOURS) || 30
  };
}
export const paiementActif = (c = configPaiement()) => Boolean(c.cle && (c.produits.plus || c.produits.pro));

/** Signature Chariow : « sha256= » + HMAC-SHA256 du corps brut avec le secret du Pulse (whsec_…). */
export function signaturePulseValide(corpsBrut, entete, secret) {
  if (!secret || !entete || !Buffer.isBuffer(corpsBrut) || !String(entete).startsWith('sha256=')) return false;
  const attendu = `sha256=${createHmac('sha256', secret).update(corpsBrut).digest('hex')}`;
  return attendu.length === entete.length && timingSafeEqual(Buffer.from(attendu), Buffer.from(entete));
}

const offreDuProduit = (c, idProduit) => Object.entries(c.produits).find(([, id]) => id && id === idProduit)?.[0] || null;

/** Offre réellement active : une offre payée expire à sa date de fin. */
export function offreEffective(compte, maintenant = Date.now()) {
  const d = compte?.data || {};
  if (compte?.role === 'admin') return compte.offre;
  if (d.offreSource === 'chariow' && d.offreJusquau && new Date(d.offreJusquau).getTime() < maintenant) return 'gratuit';
  return compte?.offre || 'gratuit';
}

export function creerPaiement({ store, fetchImpl = fetch, config = configPaiement(), journal = console }) {
  async function appel(chemin, options = {}) {
    const r = await fetchImpl(`${config.api}${chemin}`, {
      ...options,
      headers: { Authorization: `Bearer ${config.cle}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      signal: AbortSignal.timeout(20_000)
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.message || `Chariow ${r.status}`), { statut: r.status, details: d.errors });
    return d;
  }

  /** Ouvre une page de paiement Chariow pour ce compte. Renvoie { url, vente }. */
  async function demarrer({ compte, offre, prenom, nom, email, ip, urlRetour }) {
    const produit = config.produits[offre];
    if (!produit) throw Object.assign(new Error('Offre indisponible au paiement.'), { statut: 400 });
    const tel = String(compte.telephone || '');
    const ci = tel.startsWith('+225');
    const corps = {
      product_id: produit,
      email, first_name: prenom, last_name: nom,
      phone: { number: ci ? tel.slice(4) : tel.replace(/^\+/, ''), country_code: 'CI' },
      custom_metadata: { compte: compte.id, offre },
      ...(urlRetour ? { redirect_url: urlRetour } : {}),
      ...(ip ? { customer_ip: ip } : {})
    };
    const { data } = await appel('/checkout', { method: 'POST', body: JSON.stringify(corps) });
    const vente = data?.purchase?.id || null;
    if (vente) await store.addPaiement({ vente, user_id: compte.id, offre, montant: data.purchase.amount?.value ?? null, statut: data.step === 'completed' ? 'completed' : 'en_attente' });
    if (data.step === 'completed' && vente) await appliquerVente({ vente, statut: 'completed', compteId: compte.id, produit });
    return { url: data?.payment?.checkout_url || null, vente, etape: data.step, message: data.message || null };
  }

  /**
   * Applique une vente réussie (idempotent : une vente ne prolonge l'offre qu'une fois).
   * compteId vient des métadonnées ; à défaut, on retrouve le compte par le téléphone du client.
   */
  async function appliquerVente({ vente, statut, compteId, produit, telephoneClient, montant = null }) {
    if (!vente) return { ignore: 'vente sans identifiant' };
    const offre = offreDuProduit(config, produit);
    let paiement = await store.getPaiement(vente);
    let uid = compteId || paiement?.user_id || null;
    if (!uid && telephoneClient) {
      const t = String(telephoneClient).replace(/[^\d+]/g, '');
      const u = await store.getUserAuth(t.startsWith('+') ? t : `+${t}`);
      uid = u?.id || null;
    }
    if (!uid) { journal.warn(`[ALERTE ADMIN] Vente Chariow ${vente} sans compte Tehis associé (téléphone ${telephoneClient || 'inconnu'})`); return { ignore: 'compte introuvable' }; }
    if (!paiement) paiement = await store.addPaiement({ vente, user_id: uid, offre, montant, statut: 'en_attente' });
    if (statut !== 'completed') { await store.updatePaiement(vente, { statut }); return { statut }; }
    if (paiement.applique) return { deja: true };
    if (!offre) { journal.warn(`[ALERTE ADMIN] Vente Chariow ${vente} : produit ${produit} inconnu (vérifier CHARIOW_PRODUIT_PLUS / CHARIOW_PRODUIT_PRO)`); return { ignore: 'produit inconnu' }; }

    const compte = await store.getUser(uid);
    if (!compte) return { ignore: 'compte supprimé' };
    const maintenant = Date.now();
    const finActuelle = compte.data?.offreSource === 'chariow' && compte.offre === offre && compte.data?.offreJusquau ? new Date(compte.data.offreJusquau).getTime() : 0;
    const debut = Math.max(maintenant, finActuelle);
    const fin = new Date(debut + config.dureeJours * 86_400_000).toISOString();
    if (compte.role !== 'admin') await store.updateUser(uid, { offre, data: { offreSource: 'chariow', offreJusquau: fin, rappelRenouvellement: null } });
    await store.updatePaiement(vente, { statut: 'completed', applique: true, offre });
    journal.log(`[PAIEMENT] Vente ${vente} : compte ${uid.slice(0, 8)} en ${offre} jusqu'au ${fin.slice(0, 10)}`);
    return { offre, jusquau: fin };
  }

  /** Vérifie directement une vente (retour dans l'app, Pulse manqué). */
  async function verifier(vente) {
    const { data } = await appel(`/sales/${encodeURIComponent(vente)}`);
    return appliquerVente({ vente, statut: data?.status, compteId: data?.custom_metadata?.compte, produit: data?.product?.id, telephoneClient: data?.customer?.phone, montant: data?.amount?.value });
  }

  /** Pulse Chariow déjà vérifié : on applique les ventes réussies, on note les échecs. */
  async function pulse(evenement) {
    const s = evenement?.sale;
    if (!s?.id) return { ignore: 'pas de vente' };
    // « Send test pulse » de Chariow : fausse vente (test_sale_…, téléphone 1234567890), rien à appliquer.
    if (String(s.id).startsWith('test_') || evenement.note) return { test: true };
    const statut = evenement.event === 'successful.sale' ? 'completed' : evenement.event === 'failed.sale' ? 'failed' : evenement.event === 'abandoned.sale' ? 'abandoned' : s.status;
    return appliquerVente({ vente: s.id, statut, compteId: s.custom_metadata?.compte, produit: evenement.product?.id, telephoneClient: evenement.customer?.phone, montant: s.amount?.value });
  }

  return { demarrer, verifier, pulse, appliquerVente, config };
}
