# Brancher Tehis sur WhatsApp (WhatsApp Cloud API de Meta)

Une fois branché, chaque testeur écrit au numéro WhatsApp de Tehis **depuis le numéro de son compte** et parle à ses agents. Il peut envoyer du texte, des vocaux (transcrits si `OPENAI_API_KEY` est configurée), des photos et sa position. Il reçoit ses rappels et son code de connexion s'il l'a oublié.

Compte une heure la première fois.

## 1. Créer l'app Meta (15 min)

1. Va sur [developers.facebook.com](https://developers.facebook.com), connecte-toi avec ton compte Facebook, puis **My Apps › Create App**.
2. Cas d'usage : **Other** puis type **Business**. Nom : `Tehis`. Rattache-la à ton portefeuille Meta Business (ou crée-le, par exemple `FAKODROP`).
3. Dans l'app, ajoute le produit **WhatsApp** (bouton *Set up*).
4. **WhatsApp › API Setup** : Meta te donne un **numéro de test** et un **Phone number ID**. Note le Phone number ID.
5. Toujours dans *API Setup*, section *To* : ajoute ton propre numéro WhatsApp et ceux de 4 testeurs au plus. Ils reçoivent un code de vérification. Avec le numéro de test, seuls ces numéros peuvent écrire à Tehis.

## 2. Créer un jeton permanent (10 min)

Le jeton affiché dans *API Setup* expire au bout de 24 heures. Pour un jeton permanent :

1. [business.facebook.com](https://business.facebook.com) › **Paramètres de l'entreprise › Utilisateurs › Utilisateurs système** › *Ajouter* : nom `tehis-serveur`, rôle **Admin**.
2. *Ajouter des éléments* : l'app `Tehis` (contrôle total) et ton compte WhatsApp Business.
3. **Générer un jeton** : app `Tehis`, expiration **Jamais**, autorisations `whatsapp_business_messaging` et `whatsapp_business_management`.
4. Copie le jeton **directement dans Render** (étape 4). Ne le colle nulle part ailleurs.

## 3. Récupérer la clé secrète de l'app

App Meta › **App settings › Basic** › **App secret** › *Show*. Elle sert à vérifier que les messages viennent bien de Meta.

## 4. Variables dans Render

Render › **tehis-prototype › Environment** › *Add Environment Variable* :

| Variable | Valeur |
| --- | --- |
| `WHATSAPP_TOKEN` | le jeton permanent (étape 2) |
| `WHATSAPP_PHONE_ID` | le Phone number ID (étape 1) |
| `WHATSAPP_APP_SECRET` | la clé secrète de l'app (étape 3) |
| `WHATSAPP_VERIFY_TOKEN` | un mot de ton choix, par exemple `tehis-akwaba-2026` |
| `WHATSAPP_NUMERO` | le numéro WhatsApp de Tehis, affiché dans l'app, par exemple `+1 555 000 0000` |

Enregistre : Render redéploie. Dans les **Logs**, la ligne de démarrage doit dire `WhatsApp actif`.

## 5. Brancher le webhook

1. App Meta › **WhatsApp › Configuration › Webhook** › *Edit*.
2. **Callback URL** : `https://tehis-prototype.onrender.com/webhook/whatsapp`
3. **Verify token** : le même mot que `WHATSAPP_VERIFY_TOKEN`.
4. *Verify and save*. Si Meta refuse, vérifie que le service Render est réveillé : ouvre l'app une fois, puis réessaie.
5. Dans *Webhook fields*, **abonne-toi à `messages`**.

## 6. Tester

1. Crée ton compte dans l'app avec ton numéro WhatsApp, s'il n'existe pas déjà.
2. Depuis ce numéro, écris « Bonjour » au numéro de Tehis : Kiki répond avec le mode d'emploi.
3. Essaie aussi :
   - `menu`, pour changer d'agent ;
   - « Pharmacie de garde près de moi », puis partage ta position ;
   - un vocal ;
   - la photo d'un exercice.
4. Dans l'app : **Réglages › WhatsApp › Recevoir aussi mes rappels sur WhatsApp**, puis demande un rappel dans 2 minutes.

## 7. Modèles de messages (rappels hors fenêtre de 24 h, code oublié)

WhatsApp n'autorise les messages libres que dans les **24 heures** qui suivent le dernier message de la personne. Au-delà, il faut un **modèle approuvé** par Meta.

**WhatsApp Manager › Modèles de messages › Créer** :

1. **Rappels** : catégorie *Utilitaire*, nom `rappel_tehis`, langue *Français*, corps : `🔔 Rappel Tehis : {{1}}`. Puis dans Render : `WHATSAPP_MODELE_RAPPEL=rappel_tehis`.
2. **Code oublié** : catégorie *Authentification*, nom `code_tehis`, langue *Français*, bouton *Copier le code*. Puis dans Render : `WHATSAPP_MODELE_CODE=code_tehis`.

Sans ces modèles, un rappel n'arrive sur WhatsApp que si la personne a écrit à Tehis dans les dernières 24 heures. Il arrive quand même en notification dans l'app. Pour le code oublié, la personne doit d'abord écrire « bonjour » au numéro de Tehis.

## 8. Passer au vrai numéro (lancement)

1. Achète une SIM dédiée à Tehis : un numéro qui n'a jamais eu de compte WhatsApp, ou dont le compte a été supprimé.
2. WhatsApp Manager › **Numéros de téléphone › Ajouter** : vérification par SMS, nom affiché `Tehis`.
3. Fais vérifier l'entreprise (Business Verification) pour lever les limites d'envoi.
4. Ajoute un moyen de paiement dans WhatsApp Manager. Les réponses aux messages des utilisateurs (dans les 24 h) sont gratuites ; les modèles (rappels, codes) sont facturés par Meta selon la grille de la Côte d'Ivoire.
5. Remplace `WHATSAPP_PHONE_ID` et `WHATSAPP_NUMERO` dans Render.

## Sécurité

- Les messages sans signature valide de Meta sont refusés (401).
- Un numéro sans compte Tehis reçoit au plus une invitation par jour, sans appel à l'IA.
- Les quotas du jour (messages, recherches web, vocaux) sont les mêmes que dans l'app.
- Le jeton et la clé secrète restent dans Render. Ils ne sont jamais envoyés à l'IA ni écrits dans le code.
