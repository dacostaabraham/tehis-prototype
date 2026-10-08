# Brancher le paiement Chariow (offres Plus et Pro)

Les testeurs paient leur offre par Mobile Money (Orange Money, MTN, Moov, Wave) ou par carte, sur la page sécurisée de Chariow. Un paiement ouvre **30 jours** d'offre. S'ils repaient la même offre avant la fin, les 30 jours s'ajoutent à la date de fin.

Compte 20 minutes.

## 1. Créer les deux produits (10 min)

Sur [app.chariow.com](https://app.chariow.com), boutique **Zuterion-corp** › **Produits › Nouveau produit**, crée deux produits de type **Licence**.

Le type Licence est indispensable : c'est le seul que Chariow laisse acheter plusieurs fois par la même personne. Les autres types (téléchargeable, cours) bloquent le deuxième mois avec « already purchased ».

| | Produit 1 | Produit 2 |
| --- | --- | --- |
| Nom | Tehis Plus · 1 mois | Tehis Pro Entrepreneur · 1 mois |
| Type | Licence | Licence |
| Prix | 2 500 FCFA | 10 000 FCFA |
| Réglages de licence | validité 30 jours, sans activation obligatoire | idem |
| Statut | **Publié** | **Publié** |

- Message après achat (facultatif) : « Merci ! Ton offre est active dans Tehis. Si l'app ne l'affiche pas, ouvre Réglages › Mon compte. »
- Les prix affichés dans l'app sont dans `public/shared/agents.js` (`PRIX`). Le montant réellement payé est celui du produit Chariow : garde les deux identiques.

Note les identifiants des produits (`prd_…`). Ils se trouvent dans l'adresse de la page du produit, ou demande-les-moi : je peux les lire dans ta boutique.

## 2. Clé API (2 min)

**Paramètres › Développeurs › Clés API** › *Créer une clé* (`sk_live_…`). Copie-la **directement dans Render**, jamais ailleurs.

## 3. Pulse (webhook) (5 min)

1. **Automatisations › Pulses › Ajouter un Pulse**.
2. URL : `https://tehis-prototype.onrender.com/webhook/chariow`
3. Événements : **Vente réussie**, **Vente échouée**, **Vente abandonnée**.
4. Produits : les deux produits Tehis (ou laisse vide pour tous).
5. Enregistre, puis ouvre le Pulse › **Overview › Signing secret** › *Reveal* › copie le `whsec_…`.

## 4. Variables dans Render

Render › **tehis-prototype › Environment** :

| Variable | Valeur |
| --- | --- |
| `CHARIOW_API_KEY` | la clé `sk_live_…` |
| `CHARIOW_PULSE_SECRET` | le secret `whsec_…` du Pulse |
| `CHARIOW_PRODUIT_PLUS` | l'identifiant du produit Plus (`prd_…`) |
| `CHARIOW_PRODUIT_PRO` | l'identifiant du produit Pro (`prd_…`) |
| `APP_URL` | `https://tehis-prototype.onrender.com` (retour dans l'app après paiement) |

Au démarrage, les journaux Render doivent afficher `paiement Chariow`. S'ils affichent `paiement Chariow (sans Pulse…)`, le secret du Pulse manque.

## 5. Tester

1. Dans Chariow, ouvre le Pulse et clique **Send test pulse**. Les journaux Render doivent afficher `[PAIEMENT] Pulse de test reçu et vérifié`.
2. Avec un compte testeur en Gratuit : **Réglages › Offre › Voir les offres › Passer à Plus**. Paie 2 500 FCFA avec ton propre Mobile Money.
3. De retour dans Tehis, un message confirme l'offre et sa date de fin. Les agents Plus sont débloqués.
4. Dans **Réglages › Testeurs**, tu vois le compte en Plus.

Pour un test sans payer le vrai prix, crée un code promo de 100 % dans Chariow : l'achat est alors confirmé immédiatement.

## Comment ça marche

- La page de paiement est ouverte par le serveur avec le compte Tehis dans les métadonnées de la vente.
- La confirmation arrive par deux chemins indépendants :
  - le **Pulse** signé de Chariow, dont la signature est vérifiée ;
  - la **vérification directe** de la vente quand la personne revient dans l'app.

  Une vente n'est appliquée qu'une seule fois.
- Si quelqu'un achète directement sur la boutique, sans passer par l'app, son compte est retrouvé grâce à son numéro de téléphone.
- 3 jours avant la fin de l'offre, une notification (et un message WhatsApp, si la personne l'a demandé) l'invite à renouveler.
- À la date de fin, le compte repasse en Gratuit. Rien n'est effacé : ses agents perso en trop sont verrouillés, pas supprimés.
- Une offre donnée à la main dans **Réglages › Testeurs** n'a pas de date de fin.

## En cas de souci

| Ce que tu vois dans les journaux | Que faire |
| --- | --- |
| `[ALERTE ADMIN] CLÉ CHARIOW REFUSÉE` | Vérifier `CHARIOW_API_KEY` |
| `[ALERTE ADMIN] PRODUIT CHARIOW INTROUVABLE OU NON PUBLIÉ` | Publier les produits, vérifier les `prd_…` |
| `Pulse à signature invalide` | Le secret du Pulse a changé : recopier le `whsec_…` |
| `Vente … sans compte Tehis associé` | Achat sur la boutique avec un numéro sans compte : donner l'offre à la main dans Testeurs |
