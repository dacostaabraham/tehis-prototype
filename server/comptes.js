// Comptes : numéro de téléphone + code PIN, jeton de session signé, limite des essais.
import { createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/** Numéro au format international. Les numéros ivoiriens à 10 chiffres (07…, 05…, 01…, 27…) reçoivent +225. */
export function normaliserTelephone(t) {
  let s = String(t || '').replace(/[\s.\-()/]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^\d{10}$/.test(s)) s = `+225${s}`;
  if (/^225\d{10}$/.test(s)) s = `+${s}`;
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

/** Numéro masqué pour l'affichage : +225 07 •• •• 45 67 */
export function masquerTelephone(t) {
  const m = /^\+225(\d{2})\d{4}(\d{2})(\d{2})$/.exec(t || '');
  return m ? `+225 ${m[1]} •• •• ${m[2]} ${m[3]}` : String(t || '').replace(/\d(?=\d{4})/g, '•');
}

const TROP_SIMPLES = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '1212', '2580', '000000', '123456', '111111', '654321']);
export function pinValide(pin) {
  const p = String(pin || '');
  if (!/^\d{4,6}$/.test(p)) return 'Le code doit avoir 4 à 6 chiffres.';
  if (TROP_SIMPLES.has(p)) return 'Ce code est trop facile à deviner. Choisis-en un autre.';
  return null;
}

export function hacherPin(pin) {
  const sel = randomBytes(16).toString('hex');
  return `scrypt$${sel}$${scryptSync(String(pin), sel, 32).toString('hex')}`;
}
export function verifierPin(pin, hache) {
  const [algo, sel, attendu] = String(hache || '').split('$');
  if (algo !== 'scrypt' || !sel || !attendu) return false;
  const calcule = scryptSync(String(pin), sel, 32);
  const ref = Buffer.from(attendu, 'hex');
  return ref.length === calcule.length && timingSafeEqual(ref, calcule);
}
export const pinProvisoire = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Jeton de session : compte, date, version (changer le code déconnecte les autres appareils), signature. */
export function creerJetons(secret) {
  const signer = (v) => createHmac('sha256', secret).update(v).digest('hex');
  return {
    creer(uid, version = 0) {
      const t = Date.now().toString(36);
      return `${uid}.${t}.${signer(`${uid}.${t}.${version}`)}`;
    },
    /** Renvoie { uid, t } si la signature est bonne pour la version donnée par lireVersion(uid). */
    async lire(jeton, lireVersion) {
      const [uid, t, sig] = String(jeton || '').split('.');
      if (!uid || !t || !sig || !/^[0-9a-f-]{36}$/.test(uid)) return null;
      const version = await lireVersion(uid);
      if (version === null) return null;
      const attendu = signer(`${uid}.${t}.${version}`);
      if (sig.length !== attendu.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(attendu))) return null;
      return { uid, t };
    }
  };
}

/** Essais de connexion : 5 échecs en 15 minutes bloquent le numéro (et l'adresse) 15 minutes. */
export function creerGardien({ max = 5, fenetre = 15 * 60_000 } = {}) {
  const echecs = new Map();
  const recents = (cle, now) => (echecs.get(cle) || []).filter((t) => now - t < fenetre);
  return {
    bloque(cles, now = Date.now()) { return cles.some((c) => recents(c, now).length >= max); },
    echec(cles, now = Date.now()) { for (const c of cles) echecs.set(c, [...recents(c, now), now]); },
    reussite(cles) { for (const c of cles) echecs.delete(c); }
  };
}

export function egalTempsConstant(a, b) {
  const x = createHmac('sha256', 'cmp').update(String(a)).digest();
  const y = createHmac('sha256', 'cmp').update(String(b)).digest();
  return timingSafeEqual(x, y);
}
