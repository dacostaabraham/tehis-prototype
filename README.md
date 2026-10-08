# Tehis — prototype

Compagnon IA en 3D avec des **agents du quotidien** pour la Côte d'Ivoire, et un **mode développeur** pour ceux qui codent.

## Ce que fait le prototype

- **PWA installable** sur Android et iPhone.
- **Comptes** : numéro WhatsApp + code secret (4 à 6 chiffres), code d'invitation pour la bêta privée. Chaque compte a ses propres discussions, documents, rappels, listes, souvenirs, agents et clés. Les discussions sont enregistrées sur le serveur et se retrouvent sur un autre téléphone.
- **Quotas du jour** par offre (messages, recherches web), et modèle léger pour l'offre Gratuit.
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

- **Crée ton agent** : l'utilisateur décrit son besoin, Tehis propose une fiche (nom, icône, mission, ton, règles, premières demandes), il choisit les outils et ajoute ses connaissances (texte, fichier .txt ou PDF avec du texte). Ses agents apparaissent dans « Mes agents ».
- **Documents** : lettres, CV, fiches produits et fiches de révision s'affichent dans une carte avec *Copier*, *WhatsApp* et *PDF*, et restent dans « Mes affaires ».
- **Voix du compagnon** : il lit ses réponses à voix haute (voix française du téléphone, hauteur et débit selon l'espèce) et s'anime pendant qu'il parle (humeur « Je parle »). Bouton haut-parleur sur la scène pour couper ou remettre, bouton « Écouter » sous chaque réponse, test dans Réglages.
- **Photo** jointe à un message (produit, exercice, document) et **dictée vocale** (si le navigateur la propose).
- **Paiement des offres** (Chariow) : Plus 2 500 FCFA et Pro 10 000 FCFA par mois, par Mobile Money ou carte. 30 jours par paiement, prolongeables ; confirmation par Pulse signé et par vérification directe ; retour automatique en Gratuit à l'échéance, rappel 3 jours avant. Mise en place : [docs/PAIEMENT.md](docs/PAIEMENT.md).
- **Lieux hors ligne** : un extrait OpenStreetMap de la Côte d'Ivoire (`data/lieux-ci.json.gz`, 200 Ko : pharmacies, santé, marchés, écoles, banques, stations, mairies, police, poste, transfert d'argent, quartiers) répond sans réseau ; les serveurs Overpass et Nominatim ne servent plus que de secours. Mise à jour mensuelle : `node scripts/maj-lieux-ci.mjs` puis commit.
- **Autour de moi** (Santé, Démarches, Logement, Compagnon, agents perso) : pharmacies, centres de santé, hôpitaux, mairies, marchés… sur une carte (OpenStreetMap) avec distance, *Y aller* (voiture, à pied, transport), *Appeler* et *Partager*. Position partagée à la demande, ou quartier écrit. Fonctionne sans clé API.
- **Pharmacies de garde** : la liste officielle de la semaine (abidjan.net, Abidjan et villes de l'intérieur) est lue toutes les 6 heures et croisée avec la carte : onglet « 🌙 De garde » avec distance, téléphone et itinéraire, affiché en premier la nuit et le week-end. Les positions incohérentes de la source sont écartées (la pharmacie reste listée dans sa commune).
- **Le compagnon grandit** : points (discussions, nouveaux agents, documents, rappels, recherches, calculs, visite du jour), 8 niveaux de « Petit » à « Légende », série de jours avec bonus, et accessoires 3D débloqués (foulard en pagne, bob, lunettes, médaille, couronne).
- **Voix naturelle** (avec `OPENAI_API_KEY`) : chaque animal a sa voix (OpenAI), le compagnon s'anime au rythme du son, réécoute gratuite (cache). La dictée enregistre et transcrit avec le vocabulaire ivoirien. Sans clé, voix et dictée du téléphone.
- **Tehis sur WhatsApp** : texte, vocaux, photos, position ; menu des agents, boutons de réponse, pharmacies de garde avec épingle, rappels et code oublié sur WhatsApp. Mise en place : [docs/WHATSAPP.md](docs/WHATSAPP.md).
- **Boutons de réponse rapide** : les agents proposent des choix à toucher (quiz du répétiteur, budget, quartier…), avec « Autre… » pour écrire.
- **Calculs** sans IA : *Mon foyer* (budget, épargne, tontine) et *Mon entreprise* (point mort, prix, prévisionnel, BFR, cascade).
- **Mes affaires** : rappels, listes à cocher, documents, et ce que le compagnon retient (bouton « Oublier »).
- **Mode démo** automatique tant qu'aucune clé API n'est configurée : chaque agent montre un exemple.

## Agents personnalisés (« Crée ton agent »)

| Offre | Agents | Messages par jour (tous agents perso) | Connaissances | Outils |
| --- | --- | --- | --- | --- |
| Gratuit | 1 | 20 | non | documents, rappels et listes, calculs budget |
| Plus | 3 | 100 | oui, 50 000 caractères par agent | + calculs entreprise |
| Pro | 10 | 300 | oui | + recherche sur internet, réponses « modèle fort » |

- La fiche proposée par l'IA est générée avec le modèle léger ; elle peut refuser un agent destiné à tromper, usurper, harceler ou produire de faux documents.
- La mission de l'utilisateur est encadrée : les règles de Tehis passent avant, et les connaissances sont traitées comme des données, jamais comme des instructions.
- Si l'offre baisse, les agents au-delà de la limite sont verrouillés, pas supprimés.
- Limites réglées dans `public/shared/agents.js` (`LIMITES_PERSO`, `OUTILS_PERSO`).

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
3. Render demande ces valeurs :
   - `CODE_INVITATION` : le code à donner à tes testeurs ;
   - `ADMIN_TELEPHONE` : ton numéro ;
   - `ANTHROPIC_API_KEY` : ta clé de [console.anthropic.com](https://console.anthropic.com). **Laisse vide pour le mode démo.**
4. Ouvre l'adresse `https://tehis-prototype-xxxx.onrender.com` sur ton téléphone et crée ton compte avec ton numéro (`ADMIN_TELEPHONE`).
5. Pour l'installer : Chrome Android, menu **⋮ › Installer l'application** ; iPhone, Safari **Partager › Sur l'écran d'accueil** (nécessaire pour les notifications sur iPhone).
6. Dans l'app : Réglages › Notifications › *Activer* pour recevoir les rappels.

## Réglages

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `CODE_INVITATION` | Code demandé à l'inscription (`APP_PASSWORD` est encore accepté) | vide = inscription ouverte |
| `ADMIN_TELEPHONE` | Numéro de l'administrateur : son compte gère les testeurs et récupère les données de l'ancien prototype | vide = premier compte créé |
| `OFFRE_DEFAUT` | Offre des nouveaux comptes | `gratuit` |
| `ANTHROPIC_API_KEY` | Clé de l'API Claude | vide = mode démo |
| `ANTHROPIC_MODEL` | Modèle « fort » (finance, démarches, répétiteur, dev) | `claude-sonnet-5-5` |
| `ANTHROPIC_MODEL_LEGER` | Modèle « léger » (compagnon, rédaction, vendeur, emploi, budget, organisation) | `claude-haiku-4-5-20251001` |
| `DATABASE_URL` | PostgreSQL (fourni par Render) | vide = mémoire vive |
| `SESSION_SECRET` | Cookie et chiffrement des clés (généré par Render) | aléatoire |
| `OVERPASS_URL`, `NOMINATIM_URL` | Serveurs OpenStreetMap (lieux, quartiers) | serveurs publics |
| `OPENAI_API_KEY` | Voix naturelle et transcription | vide = voix du téléphone |
| `OPENAI_TTS_MODEL`, `OPENAI_STT_MODEL` | Modèles de voix et de transcription | `gpt-4o-mini-tts`, `gpt-4o-mini-transcribe` |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_NUMERO` | WhatsApp Cloud API (voir docs/WHATSAPP.md) | vide = WhatsApp désactivé |
| `WHATSAPP_MODELE_RAPPEL`, `WHATSAPP_MODELE_CODE` | Modèles approuvés : rappels hors 24 h, code oublié | vide |
| `CHARIOW_API_KEY`, `CHARIOW_PULSE_SECRET`, `CHARIOW_PRODUIT_PLUS`, `CHARIOW_PRODUIT_PRO` | Paiement des offres (voir docs/PAIEMENT.md) | vide = paiement fermé |
| `APP_URL` | Adresse publique de l'app (retour après paiement, liens WhatsApp) | adresse Render |
| `DUREE_OFFRE_JOURS` | Durée d'un paiement | `30` |
| `GARDE_URL` | Page de la liste des pharmacies de garde | business.abidjan.net |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Clés des notifications | générées et gardées en base |

## Lancer en local

```bash
npm install
CODE_INVITATION=test npm start       # mode démo sur http://localhost:3000
ANTHROPIC_API_KEY=sk-ant-... npm start
npm test                             # tests : comptes et isolation, quotas, finance, budget, tontine, outils, lieux, mode dev simulé, agents perso
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
- Comptes et offres : chacun paie son offre par Chariow ; l'administrateur peut aussi donner une offre (sans date de fin) et créer un code provisoire dans Réglages › Testeurs.

## Quotas par jour

| Offre | Messages | Recherches web | Modèle des agents « forts » |
| --- | --- | --- | --- |
| Gratuit | 20 | 2 | léger |
| Plus | 100 | 10 | fort |
| Pro | 300 | 40 | fort |

Réglés dans `public/shared/agents.js` (`QUOTAS`). L'administrateur n'a pas de limite. Le mode démo n'est pas décompté.
- Les appels GitHub et Render sont testés avec des réponses simulées : fais un premier essai sur un dépôt de test.

## Structure

```
server/index.js              API, mot de passe, chat Claude en flux, boucle d'outils, validations
server/agents.js             instructions des 10 agents et leurs outils
server/perso.js              agents personnalisés : fiche, cadre, outils, brouillon
public/perso.js              écran « Crée ton agent »
server/outils/               documents, rappels et listes, mode développeur (GitHub, Render)
server/notifications.js      notifications push et vérification des rappels
server/coffre.js             chiffrement des clés GitHub et Render
server/knowledge/finance.md  base de connaissances tirée du Module 5
server/demo.js               réponses du mode démo
server/store.js              PostgreSQL ou mémoire vive, données séparées par compte
server/comptes.js            numéro, code secret, sessions, essais limités
server/quotas.js             quotas du jour et choix du modèle
server/outils/garde.js       pharmacies de garde de la semaine
server/voix-ia.js            voix naturelle et transcription (OpenAI)
server/paiement.js           paiement Chariow : page de paiement, Pulse, prolongation, expiration
server/outils/lieux-local.js lieux et quartiers de Côte d'Ivoire sans réseau
scripts/maj-lieux-ci.mjs     mise à jour de l'extrait OpenStreetMap
server/whatsapp.js           WhatsApp Cloud API : envoi, webhook, signature
server/canal-whatsapp.js     conversations, rappels et codes sur WhatsApp
public/shared/progression.js points, niveaux, série, accessoires
public/shared/               catalogue des agents, moteurs finance et budget, rendu Markdown (serveur + app)
public/app.js, cards.js      interface et cartes
public/companion.js          compagnon 3D
test/                        tests et faux serveur Anthropic
```

## Site de prélancement (`site/`)

Page publique avec le compagnon 3D, les agents, un calcul de tontine, les tarifs, une FAQ et la **liste d'attente** (prénom, WhatsApp, activité, ville, envie de tester, parrainage par lien `?ref=CODE`).

- Déployé par le même `render.yaml` comme second service, **tehis-site**, qui partage la base PostgreSQL (table `waitlist`).
- **Admin** : `https://<site>/admin` (identifiant libre, mot de passe `ADMIN_PASSWORD`), avec export CSV pour Excel.
- `CONTACT_EMAIL` (facultatif) : adresse affichée dans la page Confidentialité.
- En local : `ADMIN_PASSWORD=test node site/server.js` puis http://localhost:3100.

## Quotas de voix par jour

| Offre | Voix naturelle (caractères lus) | Dictées |
| --- | --- | --- |
| Gratuit | 3 000 | 10 |
| Plus | 20 000 | 60 |
| Pro | 60 000 | 200 |

Au-delà, la voix du téléphone prend le relais. Réglés dans `server/voix-ia.js` (`QUOTAS_VOIX`).
