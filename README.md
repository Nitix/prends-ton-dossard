# Prends ton dossard

« Prends ton dossard » est un site privé, pensé d'abord pour le mobile, où un groupe d'amis note les courses et les trails que chacun prévoit de faire. Le serveur est un programme Go (PocketBase utilisé comme bibliothèque) qui embarque le front React compilé : un seul binaire, un seul conteneur.

La spécification est dans [`docs/superpowers/specs/2026-10-31-courses-design.md`](docs/superpowers/specs/2026-10-31-courses-design.md).

```
server/   programme Go : API, règles, migrations, commandes (bootstrap-admin, seed)
web/      front React 19 + Vite, compilé dans server/webdist/dist puis embarqué
```

## Prérequis

- **Go 1.27** ;
- **Node 26** ou plus (voir `.nvmrc`) ;
- **pnpm 12** (la version exacte est dans `packageManager`, dans `package.json`) ;
- pour la production : **Docker** avec Compose, et **Caddy** sur la machine ;
- pour les visiteurs : **iOS 17+ / Safari 17+** sur iPhone et iPad, ou un navigateur récent ailleurs. Le site s'appuie sur des fonctions que Safari n'a qu'à partir de la version 17 (l'API Popover des menus, entre autres) : sur un iPhone plus ancien, les menus ne s'ouvrent pas et des pages restent blanches.

## Développement local

Installer les dépendances du front, une fois :

```sh
pnpm install
```

Puis lancer le serveur et le front, chacun dans son terminal :

```sh
go run ./server serve     # API et tableau de bord PocketBase : http://127.0.0.1:8090
pnpm --dir web dev        # le site : http://localhost:5173
```

- Le site s'ouvre sur **`http://localhost:5173`** (pas `127.0.0.1`) : sans `APP_URL`, le serveur prend cette adresse pour origine WebAuthn. Vite refuse de démarrer si le port 5173 est pris, car un autre port casserait les passkeys.
- Vite transmet les appels `/api` et `/mcp` (le serveur MCP, voir « Assistant IA (MCP) ») au serveur sur le port 8090.
- Les données sont dans `pb_data/`, à la racine du dépôt (ignoré par Git). Pour repartir de zéro : arrêter le serveur, supprimer ce dossier.

Remplir une base vide avec des données de démonstration :

```sh
go run ./server seed
```

La commande crée trois comptes (`admin@example.test`, `alice@example.test` et `bob@example.test`, mot de passe `courses-dev-password`, ou celui de `--password` ou de `SEED_PASSWORD`), des coureurs, des événements et des participations. Elle refuse de s'exécuter si des comptes existent déjà, et si `APP_URL` n'est pas une adresse locale (`localhost` ou `127.0.0.1`) : le binaire de production contient aussi la commande, et ce mot de passe est public. `--force` passe outre ce second refus.

Les courses du `seed` ont de quoi essayer chaque nouveauté de la v7 : voir « Environnement de dev ». Pour le faire tourner sur le port 8090, avec ses données ailleurs que dans `pb_data/`, ajouter `--dir "$D"` aux commandes `seed` et `serve`.

Pour tester le tableau de bord de PocketBase (`http://127.0.0.1:8090/_/`), créer un super-admin : `go run ./server superuser upsert <email> <mot de passe>`.

## Tests

```sh
go test ./...                    # serveur
go vet ./...
gofmt -l server tools            # ne doit rien afficher

pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web fmt:check
pnpm --dir web test              # Vitest : tests unitaires et tests navigateur
```

Les tests navigateur de Vitest tournent dans un navigateur sans fenêtre, Chromium par défaut. Il faut l'installer une fois sur chaque machine :

```sh
pnpm --dir web exec playwright install chromium
```

Pour la suite sur un autre moteur, ou sur un téléphone émulé, deux variables d'environnement : `VITEST_BROWSER` (`chromium`, `firefox` ou `webkit`) et `VITEST_DEVICE` (un nom d'appareil de Playwright, par exemple `iPhone 15` ou `Pixel 7`). Une valeur inconnue est une erreur, et Firefox ne sait pas émuler un téléphone.

```sh
pnpm --dir web exec playwright install firefox webkit
VITEST_BROWSER=firefox pnpm --dir web test --project browser
VITEST_BROWSER=webkit VITEST_DEVICE="iPhone 15" pnpm --dir web test --project browser
```

**Les téléphones sont émulés** : Playwright prend la taille d'écran, le toucher et l'identité (user agent) de l'appareil, dans le moteur du bureau. Ce n'est pas un vrai iPhone ni un vrai Android : les polices, le clavier, la barre d'adresse, les notifications et l'app installée ne sont pas testés. Vérifier sur un vrai téléphone reste à faire à la main. Sur Windows, le WebKit de Playwright est une version plus pauvre que Safari (pas de `OffscreenCanvas`, ni de champ date) : quelques tests sautent alors, et la même suite peut y différer de celle de GitHub (Linux).

`pnpm --dir web build` compile le front dans `server/webdist/dist`, le dossier que le programme Go embarque.

GitHub Actions lance tout cela à chaque push (`.github/workflows/ci.yml`) : les tests Go et `govulncheck`, les contrôles du web (types, lint, format, tests unitaires, build), puis les tests navigateur sur cinq cibles : Chrome, Firefox et Safari (WebKit) sur ordinateur, Safari émulé en iPhone 15 et Chrome émulé en Pixel 7. Chrome, Firefox et Safari bloquent ; l'iPhone et le Pixel émulés tournent et annotent sans bloquer. En CI, un test qui échoue est retenté deux fois, et chaque test qui n'a réussi qu'à un nouvel essai est signalé par un avertissement : un test instable se voit, il n'est pas relancé jusqu'au vert en silence.

## Mise en service

À faire une fois, sur la machine qui héberge le site.

> **Choisis le domaine définitivement avant d'inviter qui que ce soit.** Les passkeys sont liées au domaine : si tu en changes, elles ne fonctionnent plus, et les liens d'invitation déjà envoyés pointent vers l'ancien domaine.

Il faut un nom de domaine dont l'enregistrement DNS pointe vers la machine (pas une adresse IP : WebAuthn la refuse), et les ports 80 et 443 ouverts vers Internet pour Caddy.

Depuis la v7, la machine fait aussi des appels **sortants** : elle doit pouvoir joindre en HTTPS direct (port 443, sans proxy HTTP : le programme n'en utilise aucun) les quatre services de notification (`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`) et Open-Meteo (`api.open-meteo.com`, `geocoding-api.open-meteo.com`).

1. **Récupérer le code et régler `APP_URL`.**

   ```sh
   git clone <adresse du dépôt> courses && cd courses
   cp .env.example .env
   ```

   Dans `.env`, remplacer la valeur de `APP_URL` par l'adresse publique du site : `https://` et le domaine, sans chemin (par exemple `https://courses.example.fr`). Si le port 8090 de la machine est déjà pris par un autre service, changer aussi `HOST_PORT` (le conteneur écoute toujours sur 8090 ; `HOST_PORT` est le port que la machine lui donne, sur `127.0.0.1`).

2. **Construire et démarrer le conteneur.**

   ```sh
   docker compose up -d --build
   docker compose ps          # "healthy" au bout de quelques secondes
   ```

   Le conteneur n'écoute que sur `127.0.0.1:8090` (ou `127.0.0.1:<HOST_PORT>`) : il n'est pas joignable de l'extérieur tant que Caddy ne le publie pas. Les données vivent dans le volume Docker `pb_data` (`docker volume ls` donne son nom complet, préfixé par celui du dossier).

3. **Brancher Caddy.** Copier le bloc de `Caddyfile.example` dans `/etc/caddy/Caddyfile`, avec le domaine de `APP_URL` et le port de `HOST_PORT` (8090 par défaut), puis recharger :

   ```
   courses.example.fr {
   	encode zstd gzip

   	@pbadmin path /_/* /api/collections/_superusers/* /api/collections/pbc_3142635823/*
   	respond @pbadmin 404

   	reverse_proxy 127.0.0.1:8090
   }
   ```

   ```sh
   sudo systemctl reload caddy
   curl -s https://courses.example.fr/api/health                               # {"message":"API is healthy."…}
   curl -s -o /dev/null -w '%{http_code}\n' https://courses.example.fr/_/       # 404
   ```

   Caddy obtient et renouvelle seul le certificat HTTPS. Le bloc compresse les réponses (le programme règle lui-même le `Cache-Control` d'un an des fichiers de `/assets/`, dont le nom change à chaque version, et seulement quand le fichier existe : une règle Caddy sur ce chemin s'appliquerait aussi au 404 d'un fichier absent), et **cache d'Internet le tableau de bord de PocketBase et la connexion de ses super-admins** : ils répondent 404 sur le domaine public, et s'ouvrent par un tunnel SSH (voir « Tableau de bord PocketBase », plus bas). `pbc_3142635823` est l'identifiant de la collection `_superusers` : l'API accepte l'identifiant d'une collection à la place de son nom, il faut donc bloquer les deux (un test du serveur vérifie cet identifiant).

   Le programme se fie à l'en-tête `X-Forwarded-For` (une migration le règle) pour reconnaître chaque visiteur : c'est ce qui donne à chacun sa propre limite de requêtes sur la connexion et les invitations, au lieu d'une limite partagée par tout le groupe. C'est sûr parce que le port du conteneur n'est publié que sur `127.0.0.1` et que Caddy remplace cet en-tête. **Ne jamais publier ce port sur une interface publique** (garder `127.0.0.1` dans `compose.yaml`) : n'importe qui pourrait alors choisir l'adresse qu'il présente, et contourner les limites.

4. **Créer le super-admin PocketBase.** C'est le compte du tableau de bord, qui sert à configurer les sauvegardes et à restaurer ; le tableau de bord s'ouvre par un tunnel SSH (voir « Tableau de bord PocketBase », plus bas). Ce compte peut tout lire et tout changer : lui donner un mot de passe long, propre à ce site. Pour que ce mot de passe ne reste pas dans l'historique du shell, le lire avec `read -s` (bash) au lieu de l'écrire dans la commande :

   ```sh
   read -rs PB_PASSWORD     # taper le mot de passe (rien ne s'affiche), puis Entrée
   docker compose exec courses /app/courses superuser upsert <email> "$PB_PASSWORD"
   unset PB_PASSWORD
   ```

   La même commande change le mot de passe plus tard ; on peut aussi le changer dans le tableau de bord, par le tunnel (collection `_superusers`).

   Au premier démarrage, `docker compose logs courses` affiche un lien d'installation du tableau de bord (`/_/#/pbinstall/…`) : ne pas l'utiliser. Le compte d'installation qu'il suppose est supprimé dès qu'un super-admin existe.

5. **Créer le premier admin du site.**

   ```sh
   docker compose exec courses /app/courses bootstrap-admin "<Prénom>"
   ```

   La commande affiche une seule ligne : `Invitation URL: https://courses.example.fr/invitation#…`. Ouvrir ce lien (valable 7 jours) pour choisir un mot de passe : le coureur créé devient l'admin. La commande refuse de s'exécuter si un admin existe déjà (`--force` pour en inviter un autre). Les autres membres sont ensuite invités depuis l'écran d'administration du site.

6. **Configurer les sauvegardes hors de la machine** (voir plus bas), puis **tester la restauration une fois**, avant d'ouvrir le site au groupe.

7. **Faire la recette sur iPhone** (voir plus bas).

## Tableau de bord PocketBase

Le tableau de bord de PocketBase (`/_/`) sert à configurer les sauvegardes, à restaurer, et au besoin à corriger une donnée à la main. Son super-admin peut tout lire et tout changer, sans second facteur (le site n'envoie pas d'email) : Caddy le cache donc d'Internet, et on l'ouvre par un tunnel SSH, depuis son ordinateur :

```sh
ssh -L 8090:127.0.0.1:<HOST_PORT> root@<serveur>
```

Tant que cette session SSH reste ouverte, le tableau de bord est sur **`http://localhost:8090/_/`**, dans le navigateur de l'ordinateur. `<HOST_PORT>` est celui de `.env` (8090 par défaut). Si le port 8090 de l'ordinateur est déjà pris (par le serveur de développement, par exemple), en prendre un autre à gauche : `ssh -L 18090:127.0.0.1:<HOST_PORT> …`, puis `http://localhost:18090/_/`.

## Mise à jour

```sh
git pull && docker compose up -d --build
```

Les migrations de la base s'appliquent au démarrage. Le volume n'est pas touché. Avant une mise à jour qui ajoute une migration, créer une sauvegarde depuis le tableau de bord, par le tunnel SSH (Settings, puis Backups).

## Démo

Une instance à part du vrai site (son domaine, son dossier, son volume, son `.env`) peut laisser des curieux entrer sans compte : la page de connexion y montre un bouton « Entrer dans la démo », qui ouvre le compte d'Alice sans rien taper. Ce que les visiteurs y font reste : on ne remet jamais la démo à zéro (voir plus bas pour le faire quand même). **Le vrai site ne définit jamais `DEMO_LOGIN_EMAIL`** : n'importe qui entrerait dans ce compte.

1. **Installer l'instance** comme le vrai site (« Mise en service »), dans son propre dossier **au nom différent** de celui du vrai site (par exemple `/opt/ptd-demo`) : Docker Compose nomme le projet et le volume d'après le nom du dossier, et deux dossiers du même nom partageraient la base. Avec son propre `APP_URL` (par exemple `https://demo-prends-ton-dossard.ketra.fr`). Pas de `bootstrap-admin` : la base vient du `seed`.

2. **La remplir des données de test.** Le programme de production refuse `seed` hors de `localhost` sans `--force`. Les comptes ont tous le même mot de passe, qui est public s'il n'est pas donné : en choisir un au hasard, que personne n'a besoin de connaître (le bouton ne le demande pas), garde fermés les comptes Admin et Bob. Il garde aussi le compte d'Alice hors de portée par son email et son mot de passe : les réglages demandent le mot de passe actuel pour changer l'un ou l'autre, et aucun visiteur ne le connaît, donc personne ne peut s'approprier le compte partagé.

   ```sh
   docker compose exec -e SEED_PASSWORD="$(openssl rand -base64 24)" courses /app/courses seed --force
   ```

3. **Activer le bouton.** Dans le `.env` de l'instance, ajouter `DEMO_LOGIN_EMAIL=alice@example.test`, puis `docker compose up -d`. La variable doit nommer **un membre** : un admin est refusé, comme un compte absent, désactivé ou sans coureur. La variable ouvre `GET` et `POST /api/app/demo` ; sans elle, ces routes n'existent pas (404). Avec un compte qui ne convient pas, elles répondent 404 aussi : le bouton est alors caché.

**Remettre la démo à zéro** (on ne le fait pas, mais on le peut), dans le dossier de l'instance de démo et nulle part ailleurs : `-v` supprime le volume du dossier où l'on se trouve, sans sauvegarde, et ce serait celui du vrai site dans son dossier.

```sh
docker compose down -v
docker compose up -d
docker compose exec -e SEED_PASSWORD="$(openssl rand -base64 24)" courses /app/courses seed --force
```

## Rappels et notifications

Chacun choisit, dans Profil, Réglages, « Rappels », d'être prévenu **1 jour avant**, **1 heure avant**, les deux, ou jamais (c'est « Jamais » tant qu'on n'a rien choisi), quand les inscriptions d'une course où il est « Intéressé » ou « Inscrit » ouvrent. L'ouverture se saisit dans le formulaire de la course : un jour, et une heure facultative (sans heure, le site compte 9 h, heure de Paris). Le même choix commande deux canaux :

- **les alarmes du flux d'agenda personnel** (une alarme de l'événement d'ouverture) ;
- **les notifications** (Web Push) sur chaque appareil activé avec « Activer sur cet appareil ». Un bouton « Envoyer un essai » en envoie une tout de suite.

Un planificateur du programme passe chaque minute (`ptd-reminders`). Il envoie un rappel **au plus une fois** : un arrêt du programme pendant un envoi perd ce rappel plutôt que d'en envoyer deux, et un arrêt attend, 5 secondes au plus, la fin du passage en cours. Le rappel « 1 jour » est dû la veille **à la même heure de Paris** (23 h ou 25 h avant les deux nuits du changement d'heure). Il n'y a ni rappel ni notification sur la démo.

- **Les clés VAPID** (l'identité du site auprès des services de notification) sont dans **`pb_data/push_vapid.json`**, créé au premier démarrage de `serve`. Ce fichier n'est **jamais dans le dépôt** (`pb_data/` est ignoré par Git et par Docker) et ne passe par aucune variable d'environnement. Il est **sauvegardé avec le volume `pb_data`** (et avec les sauvegardes de PocketBase) : une restauration rend les clés *et* les abonnements qui vont avec. Le fichier est publié par un lien dur : le volume doit en accepter (ext4 et overlay le font). Le programme ne régénère jamais les clés de lui-même : un fichier illisible n'est pas remplacé (il couperait tous les appareils sans le dire), les notifications sont alors indisponibles et le journal le dit.
- **Changer les clés** (une fuite, par exemple) : arrêter le conteneur, supprimer `pb_data/push_vapid.json`, le redémarrer. De nouvelles clés sont faites, et chaque appareil se réabonne de lui-même à la prochaine ouverture du site. Chaque instance (production, dev, démo) a les siennes, dans son volume.
- **`PUSH_CONTACT`** (facultatif, dans `.env`) : un `mailto:` ou une adresse `https:` que les services de notification peuvent joindre au sujet du site. Sans lui, `APP_URL` est utilisée quand elle est en `https`. Le programme refuse de démarrer si la valeur n'est ni l'un ni l'autre.
- **Les services** : seuls Google (`fcm.googleapis.com`), Mozilla, Apple et Microsoft sont acceptés, en `https` et avec des noms de domaine ASCII. Le message est chiffré (RFC 8291) : le service ne le lit pas. Dix appareils par compte au plus (le plus ancien est remplacé) ; se déconnecter retire l'appareil ; un compte désactivé perd les siens.
- **`POST /api/app/push/renew`** s'utilise sans session : le navigateur la rappelle quand son abonnement change, et elle ne répond que si l'on donne le secret de l'ancien. Elle n'a pas de règle à elle : c'est la limite de requêtes de PocketBase pour `/api/` qui la protège, comme les autres routes.
- **Essayer en local.** Le service worker n'est enregistré que dans un build de production, et il faut `localhost` (un contexte sûr). `pnpm --dir web build`, puis, avec un `seed` (voir « Développement local »), `APP_URL=http://localhost:8090 go run ./server serve --http=localhost:8090 --dir "$D"`, et ouvrir `http://localhost:8090`. Choisir « 1 heure avant », puis « Activer sur cet appareil » et « Envoyer un essai » : l'envoi part vraiment chez le service du navigateur (Google, Mozilla…), l'ordinateur doit donc avoir Internet. Le rappel d'une heure se voit en mettant, sur une course où l'on est « Intéressé », une ouverture dans 70 minutes.
- **iPhone et iPad.** Les notifications ne marchent que dans **l'appli installée** (Partager, « Sur l'écran d'accueil »), avec **iOS 16.4 ou plus** ; la permission se demande par un geste (le bouton « Activer sur cet appareil »). Le site le dit sur la page des Réglages.
- **Les alarmes d'un calendrier abonné** ne sont pas garanties : Apple Calendrier (sur Mac) retire par défaut les alertes d'un abonnement (décocher « Supprimer les alertes » dans les réglages du calendrier), et Google Agenda et Outlook les ignorent d'après des utilisateurs. Les notifications sont le canal sûr.

## Météo

La fiche d'une course montre la **« Météo prévue »** de ses jours, **de J-7 au dernier jour** (une course dont seul le mois est connu n'en a pas). Les données sont celles d'[Open-Meteo](https://open-meteo.com/) (licence CC BY 4.0, lieux GeoNames pour le géocodage). Son API gratuite est réservée à un **usage non commercial** : un site privé entre amis, sans abonnement ni publicité, en fait partie.

- **Ce qui est envoyé**, toujours par le serveur (jamais par le navigateur : l'adresse des membres ne va pas chez Open-Meteo) : pour une prévision, des coordonnées **arrondies à 0,01°** (environ 1 km), une altitude arrondie à 50 m quand une trace en donne une, les jours voulus et la liste des grandeurs ; pour trouver un lieu, **le texte du lieu de la course** tel qu'il est saisi. Les coordonnées sont celles du départ de la **trace GPX** de la première épreuve qui en a une, sinon celles du lieu géocodé (le lieu trouvé est montré sur la fiche, pour qu'une erreur se voie). Jamais un nom de membre, un compte, le nom de la course ni qui y va. Open-Meteo voit l'adresse IP du serveur et garde ses journaux 90 jours.
- **Le budget** : le programme fait **500 appels par heure au plus** et **2 500 par jour de Paris** (300 sur la démo), pour tous les membres ensemble. Open-Meteo limite à 10 000 appels par jour, 5 000 par heure, **par adresse IP**, et la production, la démo et le dev partagent la leur. Le journal dit quand un plafond est atteint. Au-delà, le cache (périmé s'il y en a un) ; à défaut, « La météo n'a pas pu être chargée ».
- **Le cache** est en mémoire (un redémarrage le vide : un appel de plus par course) : une prévision 15 minutes (**changé à la demande de l'utilisateur**, c'était une heure ; la fiche la redemande toutes les 15 minutes tant qu'elle est ouverte, et aussitôt après une modification de la course ; le budget ci-dessous plafonne toujours les appels), un lieu 30 jours, une seule requête à la fois par clé. Si Open-Meteo ne répond pas (8 secondes), la dernière prévision de moins de 6 heures est montrée, marquée comme ancienne ; un échec est retenu une minute avant un nouvel essai.
- **L'attribution** est sur la fiche (« Données : Open-Meteo.com », avec un lien) et dans la réponse de l'outil MCP `get_weather`.
- La route (`GET /api/app/events/{id}/weather`) existe aussi sur la démo, où le budget borne les appels.
- **L'heure de départ** (facultative, heure du lieu de la course, celle de Paris pour une course en France, jamais sur une course au mois) d'une épreuve ajoute, sous son jour, une ligne « Départ de « 42 km » à 7 h 30 : … » avec le temps de l'heure pleine du départ ; elle est demandée dans la même requête que les jours, sans appel de plus.

## Flux d'agenda du groupe

Dans Réglages, « Agenda », deux liens secrets, chacun avec « Nouveau lien » et « Supprimer le lien » :

- **« Mes courses »**, le flux personnel : mes participations et leurs alarmes ;
- **« Les courses du groupe »** : toutes les courses où au moins une personne va (supporteurs et intéressés sans épreuve compris, pas les « Non partants »), jusqu'à un an en arrière, avec **le nom et le statut de chacun par épreuve** dans la description. **Ce lien donne les noms des membres** : il n'est à donner à personne. Il n'a ni ouverture, ni date limite, ni alarme. Il n'existe pas sur la démo (404).

Un lien de chaque sorte par compte ; en renouveler un ne touche pas l'autre. Ils survivent à un changement de mot de passe ou d'email (comme le lien personnel) : seule la désactivation du compte les coupe (404). Dans Apple Calendrier : « Fichier, Nouvel abonnement à un calendrier » ; dans Google Agenda : « Autres agendas, À partir de l'URL ».

## Environnement de dev

Avant de passer une version en production, on l'essaie sur un environnement à part, **`https://dev-prends-ton-dossard.ketra.fr`**, avec ses vrais services (notifications, Open-Meteo) :

- son dossier `/opt/ptd-dev` (un nom différent de celui de la production : Docker Compose nomme le projet et le volume d'après le dossier), son volume `ptd-dev_pb_data` (ses données et ses clés VAPID) et son port `127.0.0.1:8130` ;
- un `.env` à lui : son `APP_URL`, `HOST_PORT=8130`, et **sans `DEMO_LOGIN_EMAIL`** (sinon n'importe qui y entrerait avec un compte partagé : c'est la démo) ;
- les données du `seed` (`seed --force`), avec un mot de passe au hasard gardé dans `/opt/ptd-dev-secrets/SEED_PASSWORD` (lisible par root seulement) ; comptes `alice@`, `bob@` et `admin@example.test` ;
- un site à lui dans le Caddyfile, sur le modèle de la démo : l'en-tête `X-Robots-Tag` et un `robots.txt` qui refusent les moteurs de recherche, `/_/` en 404, un journal à part.

On y redéploie depuis une archive de la version (`git archive`), pas avec `git pull` : le dossier n'a pas de `.git`. L'archive du commit est copiée sur le serveur et extraite dans `/opt/ptd-dev.new`, le `.env` est gardé, les deux dossiers sont échangés, puis `docker compose build && docker compose up -d` tourne dans `/opt/ptd-dev`. Le `seed` ne refait rien sur une base remplie. La production ne vient qu'ensuite, après la sauvegarde du volume `pb_data`.

Pour remplir une base vide de dev (une première fois, ou après `docker compose down -v` dans `/opt/ptd-dev`, et là seulement) :

```sh
docker compose exec -e SEED_PASSWORD="$(cat /opt/ptd-dev-secrets/SEED_PASSWORD)" courses /app/courses seed --force
```

**Les dates du `seed` sont relatives au jour où il tourne, et vieillissent** : dans 5 jours, « Trail des Crêtes » est passé (et sa météo avec), dans 2 jours l'ouverture du Vercors aussi. Pour des données fraîches, il faut repartir d'un volume vide (`docker compose down -v`, toujours dans `/opt/ptd-dev`) et relancer la commande ci-dessus.

Le `seed` donne de quoi essayer chaque nouveauté (les jours sont relatifs au jour où il tourne) :

- « Trail des Crêtes » **dans 5 jours** (la météo se montre), avec une ouverture passée, une date limite dans 2 jours et une **trace GPX** sur son épreuve de 42 km (`server/cmd/seed_track.gpx`) ;
- « Grand Trail du Vercors », **au mois** (dans 7 mois), à Villard-de-Lans, avec une **ouverture dans 2 jours à 10:00**, Alice et Sam intéressés et Bob inscrit ;
- « Hyrox Lyon » : une ouverture demain, **sans heure**.

## Assistant IA (MCP)

Un assistant IA (Claude Code, Claude Desktop…) peut faire sur le site ce que tu y fais, en ton nom, sans l'ouvrir : chercher une course, l'ajouter, t'y inscrire, saisir un résultat, commenter, proposer une voiture. Tout ce qu'il fait est signé de ton nom, comme si tu l'avais fait toi-même. Il te demande ton accord avant de supprimer ou d'effacer quoi que ce soit, et il ne voit jamais un mot de passe ni un email. Le serveur MCP est dans le même programme que le site, à l'adresse **`https://<domaine>/mcp`** ; chaque membre s'y connecte avec un jeton personnel. Le détail est dans [`docs/superpowers/specs/2026-11-03-courses-mcp-design.md`](docs/superpowers/specs/2026-11-03-courses-mcp-design.md).

### Créer un jeton

1. Dans le site, ouvrir Profil, Réglages, puis la section « Assistant IA (MCP) ».
2. « Nouveau jeton » : lui donner un nom qui permet de le reconnaître (« Claude sur mon PC »), puis « Créer le jeton ».
3. **Le jeton (`ptd_…`) n'est montré qu'une fois**, dans cette fenêtre, avec les commandes à copier. Le site n'en garde qu'une empreinte : un jeton perdu se révoque et se refait.

Un compte a cinq jetons au plus (un par machine ou par assistant), sans date d'expiration. Un jeton donne à l'assistant tout ce que tu peux faire toi-même (il n'y en a pas en lecture seule) : ne jamais le mettre dans un dépôt Git, dans le `.mcp.json` d'un projet, dans un message ni dans un fichier partagé.

La liste des réglages dit quand chaque jeton a servi pour la dernière fois (« Utilisé le … »). **« Révoquer » le coupe aussitôt** : la requête suivante de l'assistant est refusée (401). **Changer ton mot de passe ou ton email révoque tous tes jetons**, comme il ferme tes sessions (un lien de réinitialisation aussi) : il faut alors en refaire un dans les Réglages, et le redonner à l'assistant. Un admin qui désactive un compte supprime ses jetons de même. Au moindre doute (un téléphone perdu, un ordinateur partagé), changer de mot de passe coupe à la fois les sessions et les jetons.

### Claude Code

Coller dans un terminal la commande de la fenêtre de création (« Copier la commande ») :

```sh
claude mcp add --transport http --scope user prends-ton-dossard https://courses.example.fr/mcp --header "Authorization: Bearer ptd_…"
```

`--scope user` range le jeton dans ta configuration personnelle (`~/.claude.json`), pour tous tes projets, et jamais dans le `.mcp.json` d'un projet, que l'on commite souvent. La commande contient le jeton : il reste aussi dans l'historique du terminal.

```sh
claude mcp list                                     # prends-ton-dossard doit y être « Connected »
claude mcp remove prends-ton-dossard --scope user   # pour le retirer
```

Dans une session, `/mcp` montre le même état. Essayer ensuite : « Qui suis-je, et quelles courses arrivent ? ». Retirer le serveur de Claude Code ne révoque pas le jeton : le faire aussi dans les Réglages.

### Claude Desktop

Les connecteurs distants de Claude Desktop ne prennent pas d'en-tête fixe : ils veulent une connexion OAuth, que le site n'offre pas. Il passe donc par un pont, [`mcp-remote`](https://github.com/punkpeye/mcp-remote), que `npx` lance : il faut **Node 20.18 ou plus** (`node --version`). Dans le fichier de configuration de Claude Desktop, ouvert par Settings, Developer, « Edit Config » :

- macOS : `~/Library/Application Support/Claude/claude_desktop_config.json` ;
- Windows : `%APPDATA%\Claude\claude_desktop_config.json`.

```json
{
  "mcpServers": {
    "prends-ton-dossard": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.15.2",
        "https://courses.example.fr/mcp",
        "--header",
        "Authorization:${PTD_AUTH}"
      ],
      "env": {
        "PTD_AUTH": "Bearer ptd_…"
      }
    }
  }
}
```

- Le jeton est dans `env` et non dans `args`, que tout utilisateur de la machine peut lire dans la liste des processus. L'en-tête s'écrit `Authorization:${PTD_AUTH}`, sans espace après les deux-points : Claude Desktop sur Windows abîme les espaces des `args`, et celui de `Bearer ptd_…` est dans la variable (le conseil du pont lui-même).
- `0.15.2` date du 20 octobre 2026 : au 3 novembre, une version qui a deux semaines de recul (la `0.16.0`, la dernière à cette date, n'en avait qu'un jour). Le pont tourne avec ton jeton : ne pas le laisser changer sans que tu le saches. Le numéro n'épingle que `mcp-remote` lui-même : ses dépendances (`undici`, entre autres) sont prises par `npx`, à la première installation, dans les versions que leurs bornes permettent (puis gardées dans son cache), et peuvent donc être plus récentes que celles qui ont été essayées. Pour une version plus récente : `npm view mcp-remote version time`, lire son README, puis changer le numéro, de préférence pour une version publiée depuis au moins deux semaines.
- Quitter complètement Claude Desktop et le relancer : les outils de `prends-ton-dossard` apparaissent dans ses connecteurs. S'ils manquent, `mcp.log` et `mcp-server-prends-ton-dossard.log` disent pourquoi (macOS : `~/Library/Logs/Claude`, Windows : `%APPDATA%\Claude\logs`).
- Claude Desktop n'a pas de terminal par défaut : sans lui, la commande `curl` de `start_upload` ne se lance pas, et les fichiers passent en base64 (512 Ko au plus, voir « Les fichiers »).

### Un autre client

Tout client MCP qui sait envoyer un en-tête fixe en « streamable HTTP » convient : l'adresse `https://<domaine>/mcp` et l'en-tête `Authorization: Bearer ptd_…`. Le serveur ne garde aucune session et répond en JSON, jamais en flux SSE (`GET` et `DELETE` répondent 405, les lots JSON-RPC sont refusés). Il n'offre pas OAuth : un client qui n'accepte que lui ne se branche pas.

### Ce que l'assistant peut faire

Chaque outil se limite à ce que le site te permet : l'assistant n'a pas d'autre droit que toi, et les refus du site restent les siens (modifier la participation confirmée d'un autre, supprimer la course d'un autre auteur…). Trente-quatre outils, que l'assistant choisit seul quand tu lui parles :

| Domaine | Outils |
| --- | --- |
| Lire | `whoami` (qui suis-je, quel jour), `home` (l'accueil), `list_runners`, `get_runner`, `get_stats`, `list_race_types`, `search_events`, `get_event` |
| Courses et épreuves | `create_event`, `update_event`, `delete_event`, `add_format`, `update_format`, `delete_format` |
| Participations et résultats | `add_participation`, `update_participation`, `remove_participation`, `set_result` |
| Commentaires | `add_comment`, `update_comment`, `delete_comment` |
| Covoiturage et logement | `add_offer`, `update_offer`, `delete_offer`, `offer_place` (prendre ou libérer une place) |
| Fichiers | `start_upload`, `set_photo`, `set_track` |
| Profil et réglages | `rename_runner`, `passkeys` (lister, renommer, supprimer), `calendar_link` (le lien personnel, ou celui du groupe avec `scope`), `mcp_tokens` (lister, révoquer), `reminders` (voir ou changer le choix de rappels) |
| Météo | `get_weather` (la météo prévue des jours d'une course) |

Avec le jeton d'un **admin**, onze outils `admin_…` (quarante-cinq en tout) s'ajoutent, ceux de la partie Admin du site : les membres, leurs liens d'invitation et de réinitialisation, les rôles, la désactivation d'un compte, les types de course et la fusion des doublons. Le jeton d'un membre ne les voit pas, et le rôle est relu à chaque requête : un admin rétrogradé les perd aussitôt. Un compte se crée toujours par une invitation que la personne ouvre elle-même : `admin_create_link` donne le lien, l'assistant ne choisit jamais un mot de passe.

Ce qui n'a pas d'outil :

- **changer son email ou son mot de passe** : le site demande le mot de passe actuel, qui ne doit jamais passer par un assistant ;
- **créer une clé d'accès** : il faut l'appareil, dans le navigateur ;
- **créer un jeton** : un jeton n'en fabrique pas un autre, dont le secret passerait par l'assistant ;
- **choisir le thème, installer l'appli, se déconnecter** : ce sont des réglages de l'appareil, ou une liste de thèmes que le serveur ne connaît pas ;
- **activer un appareil pour les notifications** : il faut le navigateur de l'appareil (la permission, l'abonnement) ; `reminders` dit combien d'appareils sont activés, et que l'on s'en occupe dans les Réglages ;
- **partager une course** : c'est un geste du téléphone, et l'assistant a déjà le nom, les jours, les épreuves et l'adresse de la course ;
- **les titres des pages et le zoom** : de l'interface seulement.
- **le fichier `.ics`, la carte, le profil du D+** : le navigateur les fabrique (l'assistant a le lien d'agenda et les chiffres de la trace).

### Les confirmations

Ce qui supprime ou efface ce qu'une personne a saisi, ou touche à l'accès d'un compte, **ne se fait pas au premier appel** : supprimer une course, une épreuve, une participation, un commentaire, une offre, une clé d'accès, le lien d'agenda (le sien ou celui du groupe, aussi pour le renouveler) ou un jeton ; vider un champ rempli ; remplacer des notes, un résultat, une photo ou une trace ; raccourcir une course ou changer le jour d'une épreuve où des gens sont inscrits ; effacer l'ouverture des inscriptions ; passer au mois une course dont des épreuves ont une date (elles la perdent) ; toucher à la participation, à la photo ou à l'offre de quelqu'un d'autre ; libérer une place ; créer une course qui ressemble à une autre ; pour un admin, créer un lien d'invitation (toujours, même pour un membre) ou de réinitialisation, révoquer un lien, changer un rôle, désactiver un compte, supprimer un coureur ou un type, fusionner des doublons. Remplacer une valeur par une autre (corriger une distance, renommer une course) n'en demande pas.

Ce que les membres ont écrit (un commentaire, des notes, le nom d'une course) est cité entre « » dans ce que le serveur dit à l'assistant, et décrit comme une donnée à lire, jamais une consigne : un commentaire ne peut pas faire passer ses mots pour ceux du site.

Le premier appel répond « Rien n'a été fait » : ce qui serait perdu (une épreuve et ses inscrits, par exemple) et un jeton de confirmation (`cfm_…`). **L'assistant doit te le montrer et attendre ton accord**, puis rappeler le même outil avec les mêmes arguments et ce jeton. Le jeton vaut 10 minutes, une seule fois, pour cette demande exacte : un autre argument, un autre assistant, ou quelque chose qui a changé entre-temps (un nouvel inscrit) le fait refuser, et l'outil en redonne un qui décrit la situation d'aujourd'hui. Le serveur garantit que rien de tout cela n'est fait sans lui ; il ne peut pas savoir si l'assistant t'a vraiment posé la question, c'est la consigne qu'il reçoit. Relis ce qu'il te montre avant de dire oui.

### Les fichiers

Une photo (JPEG, PNG ou WebP, 5 Mo au plus) ou une trace GPX (10 Mo au plus) arrive de deux façons :

- `start_upload` réserve un emplacement (10 minutes, deux au plus par jeton) et donne une commande `curl` qui envoie le fichier tel quel à `https://<domaine>/api/app/mcp-uploads/<id>`. Claude Code la lance dans son terminal, puis appelle `set_photo` ou `set_track` avec l'identifiant de l'emplacement ;
- en base64 dans l'appel (`content_base64`), pour un petit fichier : 512 Ko au plus.

Les métadonnées d'une photo, sa position GPS comprise, sont retirées. Un fichier qui n'est pas une trace GPX lisible est refusé avant tout envoi ; le serveur est un peu plus strict que le site : un point dans un autre point (ce que GPX n'a jamais) est refusé, et une altitude écrite sur plus de 64 caractères est ignorée.

### Côté serveur

- **Caddy : rien à ajouter.** `/mcp` et `/api/app/mcp-uploads` passent par le `reverse_proxy` du bloc de « Mise en service » comme le reste : les réponses sont du JSON (pas de flux SSE à travers `encode`), le blocage `@pbadmin` ne les touche pas, Caddy ne limite pas la taille d'un corps (le programme le fait), et `X-Forwarded-For`, déjà réglé, donne à `/mcp` ses limites par adresse. Pour vérifier : `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://courses.example.fr/mcp` répond `401`, le refus d'une requête sans jeton.
- **`APP_URL`** doit être l'adresse publique du site (voir « Mise en service »). L'adresse et la commande de la fenêtre de création d'un jeton, l'adresse d'envoi de `start_upload` (`<APP_URL>/api/app/mcp-uploads/<id>`) et les liens que l'assistant donne (`<APP_URL>/evenements/<id>`) en viennent : avec la valeur par défaut, celle de Vite (`http://localhost:5173`), l'assistant enverrait ses fichiers au mauvais endroit. La route d'envoi n'a pas de session : l'en-tête `X-Upload-Secret` d'un emplacement ouvert par `start_upload` l'ouvre, pour un seul fichier.
- **Limites.** 300 requêtes par minute et par jeton en moyenne (un seau de 300 qui se remplit de 5 par seconde, tenu en mémoire : une rafale de 300 passe d'un coup, et un jeton au repos peut en envoyer 600 dans sa première minute) : au-delà, 429, avec un message en français et `Retry-After: 1`, sans ralentir les autres jetons. Et 10 requêtes en cours au plus par jeton (Claude Code lance jusqu'à dix lectures à la fois) : une onzième reçoit un 429 avec `Retry-After: 1`. Une trace qui attend sa place pour être lue (deux grandes à la fois) cesse d'attendre quand le client part. Pour les requêtes sans jeton valide, une règle de PocketBase limite `/mcp` à 1 500 par minute et par adresse (migration `9k`, qui crée aussi la table des jetons : une sauvegarde avant la mise à jour, comme d'habitude). Les requêtes qu'un outil fait à l'API du site comptent dans les limites du site, comme celles du navigateur : un assistant qui inscrit trente personnes d'un coup peut attendre quelques secondes. Ces limites sont comptées par adresse : l'assistant les partage avec ton navigateur (et ceux de ta maison, derrière la même box), qu'un assistant très actif peut faire refuser (429) pendant quelques secondes, 10 au plus. Un corps de requête `/mcp` fait 1 Mio au plus (413 au-delà). Les confirmations et les emplacements d'envoi sont gardés en mémoire : un redémarrage les perd, l'assistant recommence.
- **Pas de MCP sur la démo.** Avec `DEMO_LOGIN_EMAIL`, il n'y a ni `/mcp`, ni routes des jetons, ni route d'envoi (404), ni section dans les Réglages : tout le monde partage le compte de la démo, un jeton y donnerait un accès durable à chacun.
- **Journaux.** Le journal des requêtes de PocketBase (5 jours par défaut ; tableau de bord, Logs, par le tunnel SSH) garde chaque `POST /mcp`, avec dans `meta` l'identifiant du jeton (`mcpToken`), celui du compte (`mcpUser`) et les outils appelés (`mcpTools`), dont chacun dit si une confirmation a été demandée (`asked`) ou utilisée (`confirmed`) ; chaque requête qu'un outil fait à l'API du site, avec l'agent `prends-ton-dossard-mcp` ; chaque envoi de fichier ; et les erreurs du serveur MCP (`mcp: …`). **Il ne garde jamais** le jeton (la base n'en a que l'empreinte), son secret, l'en-tête `Authorization`, la session interne d'un outil, le secret d'un envoi (il voyage dans un en-tête, pas dans l'adresse), un jeton de confirmation, ni un lien d'agenda, d'invitation ou de réinitialisation. Dans le site, ce que fait un assistant porte le nom de la personne (« ajouté par … ») : il n'y a pas d'autre trace par course.

### En local

Sur le site de développement (voir « Développement local »), le serveur MCP est à **`http://localhost:5173/mcp`** (Vite transmet `/mcp`) ou, sans Vite, à `http://localhost:8090/mcp`. Créer un jeton sur le site local, comme plus haut : **jamais le même qu'en production**, qui n'a rien à faire sur un poste de développement ni dans un test. Sur le port 8090, lancer le serveur avec `APP_URL=http://localhost:8090` : sans lui, `start_upload` donne une adresse d'envoi sur le port de Vite. Une adresse IP (`APP_URL=http://127.0.0.1:8090`) ne convient pas : les clés d'accès veulent un nom de domaine, et le serveur refuse de démarrer.

#### Vérifier le serveur avec un vrai client : `mcpcheck`

`tools/mcpcheck` est un client MCP réel, fait avec le SDK officiel : il se connecte comme un assistant, liste les outils et les appelle, une ligne par étape (`ok   whoami — Alice`, ou `FAIL …` et le code de sortie 1 à la première étape qui échoue). Il n'écrit jamais un jeton, un secret d'envoi, un lien d'invitation ni un lien d'agenda.

```sh
# Sans -write, il ne fait que lire (initialize, tools/list, whoami, home, list_race_types, search_events, get_stats, reminders, get_weather) :
# il peut viser le vrai site, avec TON jeton dans PTD_MCP_TOKEN.
PTD_MCP_TOKEN=ptd_… go run ./tools/mcpcheck -url https://courses.example.fr/mcp

# Sur un serveur local seulement : -login fait un jeton d'essai (mot de passe de PTD_PASSWORD, celui du seed par défaut)
# et le révoque à la fin, même après un échec ; -write essaie aussi les outils qui écrivent, puis remet tout en place.
D="$(mktemp -d)"
go run ./server seed --dir "$D"
APP_URL=http://localhost:8090 go run ./server serve --http=127.0.0.1:8090 --dir "$D"     # dans un autre terminal
go run ./tools/mcpcheck -url http://localhost:8090/mcp -login alice@example.test -write    # un membre : 34 outils
go run ./tools/mcpcheck -url http://localhost:8090/mcp -login admin@example.test -write    # un admin : 45 outils
```

- `-write` et `-login` sont **refusés** pour toute adresse qui n'est pas `localhost` ou `127.0.0.1` : une exécution qui écrit laisserait sa trace sur un vrai site. Les données d'essai portent leurs propres noms (« Course de test MCP », « Doublon MCP », « Course au mois MCP », « Test MCP ») et sont supprimées en fin de course ; ne le lancer que sur une base à jeter (le `seed` ci-dessus).
- Il passe par les confirmations (une fausse, une servie deux fois), un envoi de trace et de photo, la révocation d'un jeton (401 aussitôt) et, pour un admin, les outils `admin_…` (lien d'invitation, doublons fusionnés). Il lit aussi `reminders`, puis demande la météo de « Trail des Crêtes » (`get_weather` : **un appel réel à Open-Meteo**, le seul des essais), et, avec `-write`, change le choix de rappels pour le remettre comme il était, crée une course « Course au mois MCP » (au mois, avec une ouverture), efface l'ouverture après confirmation et supprime la course après confirmation.
- Il laisse 400 ms entre deux appels : les limites de requêtes de PocketBase valent pour les outils comme pour le navigateur.
- Les fichiers d'essai (`tools/mcpcheck/testdata`) sont ceux des générateurs des tests du serveur ; `MCPCHECK_UPDATE=1 go test ./tools/mcpcheck/` les refait.

## Sauvegardes

Le tableau de bord dont parle cette section s'ouvre par le tunnel SSH (voir « Tableau de bord PocketBase »).

- **Chaque nuit à 3 h (heure de Paris)**, PocketBase crée une sauvegarde et garde les 7 dernières. Ce réglage vient d'une migration ; il se voit dans le tableau de bord, sous Settings puis Backups, où l'expression `0 3 * * *` s'entend à l'heure de Paris (le programme règle le fuseau de ses tâches planifiées). Une sauvegarde est une archive `.zip` du dossier de données : `data.db` et `auxiliary.db` (copiés de façon cohérente pendant que l'application tourne) et les éventuels fichiers déposés.
- **Le fichier SQLite n'est jamais copié à la main pendant que l'application tourne.** Pas de `cp` ni de `rsync` sur le volume : seules les sauvegardes de PocketBase font foi.
- **Copie hors de la machine, sur un stockage compatible S3** (Cloudflare R2 ou Backblaze B2, offres gratuites). Créer un bucket **privé** et une clé d'accès limitée à ce bucket, puis, dans le tableau de bord, sous Settings puis Backups, activer « Store backups in S3 storage » et remplir :

  | Champ | Cloudflare R2 | Backblaze B2 |
  | --- | --- | --- |
  | Endpoint | `https://<id du compte>.r2.cloudflarestorage.com` | `https://s3.<région>.backblazeb2.com` |
  | Région | `auto` | la région du bucket, par exemple `eu-central-003` |
  | Bucket | le nom du bucket | le nom du bucket |
  | Access key / Secret | la clé créée pour ce bucket | la clé créée pour ce bucket |

  Le fournisseur affiche l'endpoint exact sur la page du bucket. Tester la connexion avec le bouton prévu à cet effet, enregistrer, puis créer une sauvegarde à la main depuis la même page et vérifier que le fichier apparaît dans le bucket.
- **Une fois S3 activé, les nouvelles sauvegardes (nocturnes et manuelles) sont écrites dans le bucket, plus sur le volume**, et la rotation des 7 dernières s'applique au bucket. Les sauvegardes déjà présentes sur le volume restent dans `pb_data/backups`.
- **Aucun email n'est envoyé si une sauvegarde échoue** (le site n'envoie pas d'email). Regarder de temps en temps la liste du tableau de bord, ou `docker compose logs courses`.

## Restauration

À tester une fois, sur des données de test, avant d'ouvrir le site au groupe.

### Depuis le tableau de bord (à préférer)

Quand l'application démarre encore, c'est le chemin le plus sûr : PocketBase décompresse l'archive à part et ne remplace les données que si elle est lisible, et il ne touche pas aux sauvegardes locales.

1. Ouvrir le tableau de bord par le tunnel SSH (`http://localhost:8090/_/`, voir « Tableau de bord PocketBase »), sous Settings puis Backups.
2. Choisir la sauvegarde dans la liste (elle vient du bucket si S3 est activé), puis « Restore », et confirmer en tapant son nom. Une archive venue d'ailleurs (téléchargée du bucket, ou d'une autre machine) s'ajoute d'abord à la liste avec le bouton d'envoi de la même page.
3. PocketBase remplace les données et redémarre seul.
4. Vérifier (voir plus bas).

### À la main

Quand l'application ne démarre plus, ou que le volume est perdu. Toutes les commandes se lancent dans le dossier de `compose.yaml`. Rien n'est effacé : les sauvegardes locales restent en place, et le contenu actuel du volume est mis de côté dans le volume même, dans `/pb_data/.before-restore/`.

1. **Préparer un dossier hors du volume**, et y mettre une copie des sauvegardes locales (si le dossier `backups` existe dans le volume ; le conteneur doit exister, même arrêté) :

   ```sh
   mkdir -p restore
   docker compose cp courses:/pb_data/backups ./restore/
   ls restore/backups
   ```

2. **Poser l'archive à restaurer** (`.zip`) dans `restore/` : téléchargée depuis le bucket, ou copiée depuis `restore/backups/` si S3 n'était pas activé.

3. **Arrêter le conteneur.**

   ```sh
   docker compose stop courses
   ```

4. **Tester l'archive, sans toucher au volume.** La commande la décompresse dans le `/tmp` d'un conteneur jetable, ce qui vérifie chaque fichier (une archive tronquée ou abîmée s'arrête sur une erreur, `crc error` ou `short read` par exemple), puis liste ce qu'elle contient :

   ```sh
   docker compose run --rm --no-deps --entrypoint sh \
     -v "$PWD/restore:/restore:ro" courses \
     -c 'unzip -q /restore/<fichier>.zip -d /tmp/check && ls -l /tmp/check'
   ```

   La liste doit montrer au moins `data.db` et `auxiliary.db`. Au moindre message d'erreur, s'arrêter là et prendre une autre archive : le volume n'a pas changé.

5. **Mettre l'ancien contenu de côté et décompresser l'archive.** La commande crée `/pb_data/.before-restore/`, y déplace tout le contenu du volume sauf `backups/`, décompresse l'archive dans le volume, puis rend les fichiers à l'utilisateur du programme. Elle refuse de commencer si `.before-restore` existe déjà (reste d'une restauration précédente : le vider ou le renommer d'abord).

   ```sh
   docker compose run --rm --no-deps --user root --entrypoint sh \
     -v "$PWD/restore:/restore:ro" courses -c '
       set -e
       cd /pb_data
       mkdir .before-restore
       for f in *; do
         [ -e "$f" ] || continue
         [ "$f" = backups ] || mv "$f" .before-restore/
       done
       unzip -q /restore/<fichier>.zip -d /pb_data
       chown -R courses /pb_data'
   ```

6. **Redémarrer.**

   ```sh
   docker compose up -d
   docker compose ps          # "healthy"
   ```

7. **Vérifier** (voir ci-dessous).

8. **Faire le ménage**, une fois la restauration vérifiée. `.before-restore` est dans le volume : sans ce ménage, il entrerait dans les sauvegardes suivantes.

   ```sh
   docker compose exec courses rm -rf /pb_data/.before-restore
   ```

   Garder `restore/backups/` tant qu'une nouvelle sauvegarde n'a pas été faite. Si la restauration n'est pas bonne, l'ancien contenu est intact dans `/pb_data/.before-restore/` : arrêter le conteneur, mettre de côté le contenu restauré de la même façon (étape 5, avec un autre nom de dossier), puis remettre l'ancien avec `mv /pb_data/.before-restore/* /pb_data/`.

### Vérifier la restauration

- `docker compose logs courses` ne montre aucune erreur ;
- `curl -s https://courses.example.fr/api/health` répond 200 ;
- se connecter au site avec un compte connu : les événements et les participations sont ceux de la sauvegarde ;
- se connecter au tableau de bord avec le super-admin, par le tunnel SSH ;
- créer une sauvegarde à la main : elle doit apparaître dans la liste (ou dans le bucket).

## Mot de passe oublié

- **Un membre** : un admin crée un lien de réinitialisation depuis l'administration des membres, et le lui envoie. Les sessions ouvertes du compte sont fermées, et ses jetons d'assistant IA (MCP) supprimés, dès que le lien est utilisé.
- **Le seul admin** : personne ne peut lui créer ce lien. Deux façons d'en sortir, depuis le serveur :
  - inviter un admin de secours, **sous un autre nom** (`bootstrap-admin` refuse un coureur qui a déjà un compte, et `--force` passe outre l'admin qui existe) :

    ```sh
    docker compose exec courses /app/courses bootstrap-admin "<Prénom> (secours)" --force
    ```

    Ouvrir le lien affiché pour créer ce compte, puis, depuis l'administration des membres, créer un lien de réinitialisation pour le compte d'origine et l'utiliser. Désactiver ensuite le compte de secours ;
  - ou ouvrir le tableau de bord par le tunnel SSH (voir « Tableau de bord PocketBase »), et dans la collection `users`, donner un nouveau mot de passe au compte (10 caractères au moins). Ses sessions ouvertes sont fermées, et ses jetons d'assistant IA (MCP) supprimés.

## Recette manuelle sur iPhone

À faire **avant d'ouvrir le site au groupe**, avec le téléphone d'un ami, sur le vrai domaine en HTTPS. Un compte de test dédié sert à cette recette, puis il est désactivé (depuis l'administration des membres).

Préparation : inviter un coureur de test depuis l'administration du site, et ouvrir le lien d'invitation dans Safari sur l'iPhone.

- [ ] Vérifier que l'iPhone a **iOS 17+ / Safari 17+** (Réglages, Général, Informations), et noter sa version : en dessous, le site ne fonctionne pas.
- [ ] Créer une passkey avec Face ID ou Touch ID, puis se déconnecter et se connecter avec la passkey.
- [ ] Dans Safari, parcourir l'accueil, la liste, l'agenda et la fiche d'un événement : tout s'affiche et se manipule correctement.
- [ ] Partager un lien d'invitation avec la feuille de partage de l'iPhone (Web Share).
- [ ] Changer sa photo depuis le profil (« Changer la photo ») en **prenant une photo** avec l'appareil : elle s'affiche dans le bon sens (orientation), puis sur une carte de la liste et sur la fiche d'un événement où le coureur participe.
- [ ] Changer sa photo en la choisissant dans la **photothèque** (une photo existante, de préférence en portrait) : même vérification. Si le téléphone ne la lit pas, un message le dit et rien n'est envoyé.
- [ ] Sur un événement à plusieurs épreuves, cliquer sur « J'y vais » en laissant « Pas encore décidé » : le coureur apparaît dans « Intéressés, format à choisir ». Depuis le menu de sa participation, « Choisir l'épreuve » : choisir une épreuve et un statut, et vérifier qu'il passe dans la liste de cette épreuve.
- [ ] Mettre quelqu'un en « Non partant » depuis le menu de sa participation : il quitte les listes et apparaît dans la section repliée « Non partants » (l'ouvrir pour le voir). Le remettre dans un autre statut le fait revenir dans les listes.
- [ ] **Thèmes.** Dans Profil, Réglages, Apparence, choisir « Nuit », fermer l'appli installée (la balayer dans le sélecteur d'applications) et la rouvrir : la page s'ouvre directement en Nuit, sans un éclair de Crête.
- [ ] Se déconnecter : la page de connexion est dessinée dans le thème choisi (en Carnet, rien n'y bouge).
- [ ] En **mode avion**, choisir un thème jamais choisi sur cet iPhone : un message dit qu'il n'a pas pu être chargé, la page ne se recharge pas et garde son thème. Reprendre le réseau et choisir de nouveau le même thème : il se charge, sans relancer l'appli.
- [ ] Se connecter avec le même compte sur un **deuxième appareil** : le thème choisi sur le premier le suit.
- [ ] **Thèmes, plusieurs changements.** Changer de thème cinq ou six fois de suite (Carnet, Nuit, un autre, puis Carnet de nouveau), sans recharger : à chaque fois le fond de la page prend tout de suite la couleur du thème et, en Carnet, les points et les orbites bougent (voir `docs/TODO.md`, « Skins sur WebKit Linux »).
- [ ] Choisir « Carnet », parcourir une longue liste, la fiche d'un événement et celle d'un coureur : le fond (points qui s'effacent par plaques, orbites qui tournent, une pulsation) bouge **sans saccade** au défilement. Laisser l'accueil ouvert 2 minutes ; depuis un Mac, dans Safari (Développement, Inspecteur web, Chronologies) il n'y a pas de Mise en page ni de Peinture en continu. « Animer le fond » (Profil, Réglages, Apparence) l'arrête ; avec Réglages d'iOS, Accessibilité, Mouvement, Réduire les animations, rien ne bouge non plus.
- [ ] **MCP, brancher.** Depuis un ordinateur (pas l'iPhone), avec Claude Code et le même compte de test, sur le vrai domaine : Profil, Réglages, « Assistant IA (MCP) », « Nouveau jeton », puis la commande copiée dans un terminal. `claude mcp list` montre `prends-ton-dossard` « Connected ». Sans jeton, `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<domaine>/mcp` répond `401`.
- [ ] **MCP, lire.** Demander à Claude « Qui suis-je, et quelles courses arrivent ? » : il donne le nom du coureur de test et des courses du site. Dans Réglages (page rechargée), le jeton dit « Utilisé le » avec la date du jour.
- [ ] **MCP, écrire et confirmer.** Lui faire créer une course d'essai avec une épreuve, où le coureur de test est inscrit : elle apparaît sur l'iPhone, au nom du compte de test. Lui demander de retirer cette participation, puis de supprimer la course : à chaque fois il montre ce qui serait perdu et attend ton accord avant de rappeler l'outil.
- [ ] **MCP, révoquer.** « Révoquer » le jeton dans Réglages : `claude mcp list` ne montre plus le serveur « Connected ». Le retirer de Claude Code : `claude mcp remove prends-ton-dossard --scope user`.
- [ ] **Notifications.** Installer le site sur l'écran d'accueil (Partager, « Sur l'écran d'accueil ») et l'ouvrir **depuis l'icône** ; vérifier que l'iPhone a **iOS 16.4 ou plus**. Dans Profil, Réglages, « Rappels », choisir « 1 jour et 1 heure avant », puis « Activer sur cet appareil » : accepter la permission, puis « Envoyer un essai » : la notification arrive, un toucher ouvre le site. Dans Safari, hors de l'appli installée, le site dit que les notifications demandent l'appli.
- [ ] **Le rappel pour de vrai.** Sur une course où le coureur de test est « Intéressé », mettre une ouverture dans 70 minutes et attendre : la notification arrive une heure avant l'ouverture (« Les inscriptions ouvrent à …, dans 60 min. »), un toucher ouvre la course. En se déconnectant, l'appareil n'en reçoit plus.
- [ ] **Les alarmes d'un calendrier abonné.** Dans Réglages, « Agenda », copier le lien « Mes courses » puis, dans Réglages d'iOS, Calendrier, Comptes, « Ajouter un compte », « Autre », « Ajouter un calendrier avec abonnement », le coller. Sur un Mac, Apple Calendrier retire par défaut les alertes d'un abonnement : décocher « Supprimer les alertes ». Vérifier que l'événement d'ouverture porte son alarme. Faire de même avec le lien « Les courses du groupe » : les noms et statuts sont dans les notes des événements.
- [ ] **Partager.** Sur la fiche d'une course, « Partager » ouvre la feuille de partage de l'iPhone avec le texte (nom, jours, lieu, épreuves, ouverture, date limite, adresse) et sans aucun nom de participant. L'envoyer à soi-même dans une conversation WhatsApp : le lien demande de se connecter (il n'y a pas d'aperçu). Annuler la feuille ne fait rien.
- [ ] **Zoom.** Sur la fiche d'une course qui a une trace : un doigt fait défiler la page, **deux doigts** déplacent et zooment la carte (un message le rappelle quand un doigt seul touche la carte). Sur le profil du D+, glisser ou pincer choisit une portion, la carte la suit ; « Vue entière du profil » revient.
- [ ] **Météo.** Sur « Trail des Crêtes » (ou une course dans les 7 jours), la section « Météo prévue » montre les jours, le lieu trouvé et la source, avec un lien vers Open-Meteo qui dit s'ouvrir dans un nouvel onglet.
- [ ] Désactiver le compte de test (ses jetons MCP partent avec lui).

## Feuille de route

Les tests de bout en bout (Playwright, sur trois navigateurs) sont prévus pour la v5.

**Plus tard.** Le **matériel obligatoire d'une épreuve**, avec sa liste à cocher, est reporté à ta demande : l'idée reste dans `docs/TODO.md`.
