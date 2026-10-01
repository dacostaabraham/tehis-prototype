// Notifications push (rappels) : clés VAPID, abonnements, et vérification des rappels toutes les 30 secondes.
// Sur l'offre gratuite de Render, le serveur s'endort sans visite : un rappel peut alors arriver en retard.
import webpush from 'web-push';
import { prochaineOccurrence } from './outils/organisation.js';

export async function initNotifications(store) {
  let publique = process.env.VAPID_PUBLIC_KEY;
  let privee = process.env.VAPID_PRIVATE_KEY;
  if (!publique || !privee) {
    const stockees = await store.getSecret('vapid');
    if (stockees) ({ publique, privee } = JSON.parse(stockees));
    else {
      const k = webpush.generateVAPIDKeys();
      publique = k.publicKey; privee = k.privateKey;
      await store.setSecret('vapid', JSON.stringify({ publique, privee }));
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@tehis.app', publique, privee);

  async function envoyerATous(charge) {
    const abonnements = await store.listSubscriptions();
    let envoyes = 0;
    for (const sub of abonnements) {
      try { await webpush.sendNotification(sub, JSON.stringify(charge), { TTL: 3600 }); envoyes++; } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await store.deleteSubscription(sub.endpoint);
        else console.warn('Push refusé :', e.statusCode, e.body);
      }
    }
    return envoyes;
  }

  async function verifierRappels(maintenant = new Date()) {
    const dus = await store.dueReminders(maintenant.toISOString());
    for (const r of dus) {
      await envoyerATous({ titre: 'Rappel', corps: r.texte, tag: r.id, url: '/?panneau=affaires' });
      const suivant = prochaineOccurrence(r.quand, r.repetition);
      await store.updateReminder(r.id, suivant ? { quand: suivant } : { envoye: true });
    }
    return dus.length;
  }

  const minuterie = setInterval(() => verifierRappels().catch((e) => console.warn('Rappels :', e.message)), 30_000);
  minuterie.unref();
  return { clePublique: publique, envoyerATous, verifierRappels };
}
