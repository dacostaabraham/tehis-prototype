# Tehis — prototype

Compagnon IA en 3D avec des **agents du quotidien** pour la Côte d'Ivoire, et un **mode développeur** pour ceux qui codent.

## Ce que fait le prototype

- **PWA installable** sur Android et iPhone, protégée par un mot de passe de test.
- **Compagnon 3D** au choix (chat, éléphant, perroquet, tortue) : on le fait tourner au doigt, il réagit quand il réfléchit, cherche, calcule ou termine.
- **Agents** (bouton en haut à droite de l'écran) :

| Agent | Ce qu'il fait | Offre | Modèle |
| --- | --- | --- | --- |
| Compagnon | Discuter, orienter vers le bon agent, proposer le mode développeur | Gratuit | léger |
| Vendeur en ligne | Fiches produits (photo à l'appui), légendes, réponses clients, relances, prix | Plus | léger |
| Rédaction et courriers | Lettres officielles, réclamations, messages, corrections | Gratuit | léger |
| Emploi et CV | CV, lettre de motivation, entraînement à l'entretien | Plus | léger |
| Budget et tontine | Budget du mois, plan d'épargne, tontine (calculs exacts) | Plus | léger |
| Finance entreprise | Point mort, prix, prévisionnel, BFR (Module 5, calculs exacts) | Pro | fort |
| Démarches administratives | Étapes, pièces, coûts, délais, **avec recherche web et sources** | Plus | fort |
| Répétiteur scolaire | Devoirs et révisions du collège au BTS, photo d'exercice | Gratuit | fort |
| Organisation et rappels | Rappels avec notification, listes, planning | Gratuit | léger |
| Mode développeur | Code, GitHub, Render, **avec validation à chaque action** | Pro + « je suis développeur » | fort |

- **Documents** : lettres, CV, fiches produits et fiches de révision s'affichent dans une carte avec *Copier*, *WhatsApp* et *PDF*, et restent dans « Mes affaires ».
- **Photo** jointe à un message (produit, exercice, document) et **dictée vocale** (si le navigateur la propose).
- **Calculs** sans IA : *Mon foyer* (budget, épargne, tontine) et *Mon entreprise* (point mort, prix, prévisionnel, BFR, cascade).
- **Mes affaires** : rappels, listes à cocher, documents, et ce que le compagnon retient (bouton « Oublier »).
- **Mode démo** automatique tant qu'aucune clé API n'est configurée : chaque agent montre un exemple.

## Mode développeur (allégé)

1. Réglages › Mode développeur › *Activer*, puis confirmer « Je suis développeur ».
2. Ajouter une clé GitHub *fine-grained* (droits **Contents** et **Administration** en lecture/écriture sur les dépôts voulus) et une clé API Render (*Account Settings › API Keys*). Les clés sont vérifiées, chiffrées (AES-256-GCM, à partir de `SESSION_SECRET`) et jamais envoyées à l'IA.
3. L'agent lit les dépôts librement. Créer un dépôt, écrire des fichiers (un commit), créer un service Render, définir des variables et déployer passent par une **carte de validation** : rien ne se fait sans *Valider*.
4. Aucun code n'est exécuté sur le serveur Tehis. Les fichiers contenant une clé secrète, un chemin `..` ou `.git/` sont refusés.

## Déployer sur Render (15 minutes)

1. Crée un dépôt GitHub vide, par exemple `tehis-prototype`, puis envoie ce dossier :
   ```bash
   git init && git add . && git commit -m "Prototype Tehis"
   git branch -M main
   git remote add origin https://github.com/<ton-compte>/tehis-prototype.git
   git push -u origin main
   ```
2. Sur [dashboard.render.com](https://dashboard.render.com) : **New › Blueprint**, choisis le dépôt. Render lit `render.yaml` et crée le service web et la base PostgreSQL.
3. Render demande deux valeurs :
   - `APP_PASSWORD` : le mot de passe de test de ton choix ;
   - `ANTHROPIC_API_KEY` : ta clé de [console.anthropic.com](https://console.anthropic.com). **Laisse vide pour le mode démo.**
4. Ouvre l'adresse `https://tehis-prototype-xxxx.onrender.com` sur ton téléphone, entre le mot de passe.
5. Pour l'installer : Chrome Android, menu **⋮ › Installer l'application** ; iPhone, Safari **Partager › Sur l'écran d'accueil** (nécessaire pour les notifications sur iPhone).
6. Dans l'app : Réglages › Notifications › *Activer* pour recevoir les rappels.

## Réglages

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `APP_PASSWORD` | Mot de passe d'accès | aucun (accès libre) |
| `ANTHROPIC_API_KEY` | Clé de l'API Claude | vide = mode démo |
| `ANTHROPIC_MODEL` | Modèle « fort » (finance, démarches, répétiteur, dev) | `claude-sonnet-5-5` |
| `ANTHROPIC_MODEL_LEGER` | Modèle « léger » (compagnon, rédaction, vendeur, emploi, budget, organisation) | `claude-haiku-4-5-20251001` |
| `OFFRE_TEST` | Offre du testeur : `gratuit`, `plus` ou `pro` | `pro` |
| `DATABASE_URL` | PostgreSQL (fourni par Render) | vide = mémoire vive |
| `SESSION_SECRET` | Cookie et chiffrement des clés (généré par Render) | aléatoire |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Clés des notifications | générées et gardées en base |

## Lancer en local

```bash
npm install
APP_PASSWORD=test npm start          # mode démo sur http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-... npm start
npm test                             # 31 tests : finance, budget, tontine, outils, mode dev simulé
```

Tester la boucle d'outils sans clé ni réseau, avec un faux serveur Anthropic :

```bash
node test/faux-anthropic.mjs 4999 &
ANTHROPIC_API_KEY=faux ANTHROPIC_BASE_URL=http://localhost:4999 npm start
```

## À savoir

- **Recherche web** (agent Démarches) : facturée par Anthropic en plus des jetons (environ 10 $ pour 1 000 recherches) et à activer pour ton organisation dans la console si elle ne l'est pas. Sans elle, l'agent répond en le signalant.
- **Rappels** : le serveur vérifie les rappels toutes les 30 secondes. Sur l'offre gratuite de Render, le service s'endort après une période d'inactivité ; un rappel peut alors arriver en retard. Pour des rappels fiables, passe le service sur une offre payante ou programme un ping régulier.
- **Dictée vocale** : elle dépend du navigateur (Chrome Android, Safari récent). Sinon, le clavier du téléphone a souvent un micro.
- La 3D charge Three.js depuis internet (jsDelivr). Sans réseau ou sans WebGL, l'app affiche l'image de l'animal.
- Les agents ne sont ni expert-comptable, ni conseiller fiscal, ni avocat : ils le rappellent quand c'est nécessaire.
- Un seul utilisateur (prototype) : les comptes, Google, la passkey et le paiement Chariow viendront avec la V1. L'offre se règle avec `OFFRE_TEST`.
- Les appels GitHub et Render sont testés avec des réponses simulées : fais un premier essai sur un dépôt de test.

## Structure

```
server/index.js              API, mot de passe, chat Claude en flux, boucle d'outils, validations
server/agents.js             instructions des 10 agents et leurs outils
server/outils/               documents, rappels et listes, mode développeur (GitHub, Render)
server/notifications.js      notifications push et vérification des rappels
server/coffre.js             chiffrement des clés GitHub et Render
server/knowledge/finance.md  base de connaissances tirée du Module 5
server/demo.js               réponses du mode démo
server/store.js              PostgreSQL ou mémoire vive
public/shared/               catalogue des agents, moteurs finance et budget, rendu Markdown (serveur + app)
public/app.js, cards.js      interface et cartes
public/companion.js          compagnon 3D
test/                        tests et faux serveur Anthropic
```
