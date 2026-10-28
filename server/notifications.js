// Notifications push (rappels) : clés VAPID, abonnements, et vérification des rappels toutes les 30 secondes.
// Sur l'offre gratuite de Render, le serveur s'endort sans visite : un rappel peut alors arriver en retard.
import webpush from 'web-push';
import { prochaineOccurrence } from './outils/organisation.js';
import { traiterRappelPlanifie } from './outils/planifiees.js';

export async function initNotifications(store, { envoyerPush = null, autresCanaux = null } = {}) {
  let publique = process.env.VAPID_PUBLIC_KEY;
  let privee = process.env.VAPID_PRIVATE_KEY;
  if (!publique || !privee) {
    const stockees = await store.getSecretServeur('vapid');
    if (stockees) ({ publique, privee } = JSON.parse(stockees));
    else {
      const k = webpush.generateVAPIDKeys();
      publique = k.publicKey; privee = k.privateKey;
      await store.setSecretServeur('vapid', JSON.stringify({ publique, privee }));
    }
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@tehis.app', publique, privee);

  /** Envoie une notification à tous les appareils d'un compte. */
  async function envoyerA(uid, charge) {
    const abonnements = await store.listSubscriptions(uid);
    const notifier = envoyerPush || ((abonnement, c) => webpush.sendNotification(abonnement, JSON.stringify(c), { TTL: 3600 }));
    let envoyes = 0;
    for (const sub of abonnements) {
      try { await notifier(sub, charge); envoyes++; } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await store.deleteSubscription(sub.endpoint);
        else console.warn('Push refusé :', e.statusCode, e.body);
      }
    }
    return envoyes;
  }

  async function verifierRappels(maintenant = new Date()) {
    const dus = await store.dueReminders(maintenant.toISOString());
    for (const r of dus) {
      if (r.type_action) {
        // Tâche planifiée : Tehis prépare l'action au lieu de seulement notifier.
        // La carte de validation apparaît dans « Mes affaires » › Activité ; la
        // notification push y renvoie. Pas de relais WhatsApp : la carte de
        // validation vit dans l'app. Si la tâche n'a plus lieu d'être (vente
        // payée, livrée ou déjà envoyée), elle est consommée sans bruit.
        const traite = await traiterRappelPlanifie(store, r, { notifier: (uid, charge) => envoyerA(uid, charge), maintenant }).catch((e) => ({ ignore: true, raison: e.message }));
        if (traite.ignore) console.log(`[PLANIFIEE] ${r.id} ignorée : ${traite.raison}`);
      } else {
        await envoyerA(r.user_id, { titre: 'Rappel', corps: r.texte, tag: r.id, url: '/?panneau=affaires' });
        // WhatsApp (si le compte l'a demandé) : une panne ne bloque pas les autres rappels.
        if (autresCanaux) await Promise.resolve(autresCanaux(r)).catch((e) => console.warn('Rappel WhatsApp :', e.message));
      }
      const suivant = prochaineOccurrence(r.quand, r.repetition);
      await store.updateReminderGlobal(r.id, suivant ? { quand: suivant } : { envoye: true });
    }
    return dus.length;
  }

  const minuterie = setInterval(() => verifierRappels().catch((e) => console.warn('Rappels :', e.message)), 30_000);
  minuterie.unref();
  return { clePublique: publique, envoyerA, verifierRappels };
}
