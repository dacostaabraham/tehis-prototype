// Chiffre les clés des services (GitHub, Render) avant de les stocker, avec AES-256-GCM.
// La clé de chiffrement dérive de SESSION_SECRET : la changer rend les clés stockées illisibles.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function creerCoffre(secret) {
  const cle = createHash('sha256').update(`tehis-coffre:${secret}`).digest();
  return {
    chiffrer(texte) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', cle, iv);
      const corps = Buffer.concat([c.update(String(texte), 'utf8'), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), corps]).toString('base64');
    },
    dechiffrer(paquet) {
      if (!paquet) return null;
      try {
        const b = Buffer.from(paquet, 'base64');
        const d = createDecipheriv('aes-256-gcm', cle, b.subarray(0, 12));
        d.setAuthTag(b.subarray(12, 28));
        return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
      } catch { return null; }
    }
  };
}
