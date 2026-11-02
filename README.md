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
- Vite transmet les appels `/api` au serveur sur le port 8090.
- Les données sont dans `pb_data/`, à la racine du dépôt (ignoré par Git). Pour repartir de zéro : arrêter le serveur, supprimer ce dossier.

Remplir une base vide avec des données de démonstration :

```sh
go run ./server seed
```

La commande crée trois comptes (`admin@example.test`, `alice@example.test` et `bob@example.test`, mot de passe `courses-dev-password`, ou celui de `--password` ou de `SEED_PASSWORD`), des coureurs, des événements et des participations. Elle refuse de s'exécuter si des comptes existent déjà, et si `APP_URL` n'est pas une adresse locale (`localhost` ou `127.0.0.1`) : le binaire de production contient aussi la commande, et ce mot de passe est public. `--force` passe outre ce second refus.

Pour tester le tableau de bord de PocketBase (`http://127.0.0.1:8090/_/`), créer un super-admin : `go run ./server superuser upsert <email> <mot de passe>`.

## Tests

```sh
go test ./...                    # serveur
go vet ./...
gofmt -l server                  # ne doit rien afficher

pnpm --dir web typecheck
pnpm --dir web lint
pnpm --dir web fmt:check
pnpm --dir web test              # Vitest : tests unitaires et tests navigateur
```

Les tests navigateur de Vitest tournent dans un Chromium sans fenêtre. Il faut l'installer une fois sur chaque machine :

```sh
pnpm --dir web exec playwright install chromium
```

`pnpm --dir web build` compile le front dans `server/webdist/dist`, le dossier que le programme Go embarque.

GitHub Actions lance tout cela à chaque push (`.github/workflows/ci.yml`).

## Mise en service

À faire une fois, sur la machine qui héberge le site.

> **Choisis le domaine définitivement avant d'inviter qui que ce soit.** Les passkeys sont liées au domaine : si tu en changes, elles ne fonctionnent plus, et les liens d'invitation déjà envoyés pointent vers l'ancien domaine.

Il faut un nom de domaine dont l'enregistrement DNS pointe vers la machine (pas une adresse IP : WebAuthn la refuse), et les ports 80 et 443 ouverts vers Internet pour Caddy.

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

- **Un membre** : un admin crée un lien de réinitialisation depuis l'administration des membres, et le lui envoie. Les sessions ouvertes du compte sont fermées dès que le lien est utilisé.
- **Le seul admin** : personne ne peut lui créer ce lien. Deux façons d'en sortir, depuis le serveur :
  - inviter un admin de secours, **sous un autre nom** (`bootstrap-admin` refuse un coureur qui a déjà un compte, et `--force` passe outre l'admin qui existe) :

    ```sh
    docker compose exec courses /app/courses bootstrap-admin "<Prénom> (secours)" --force
    ```

    Ouvrir le lien affiché pour créer ce compte, puis, depuis l'administration des membres, créer un lien de réinitialisation pour le compte d'origine et l'utiliser. Désactiver ensuite le compte de secours ;
  - ou ouvrir le tableau de bord par le tunnel SSH (voir « Tableau de bord PocketBase »), et dans la collection `users`, donner un nouveau mot de passe au compte (10 caractères au moins). Ses sessions ouvertes sont fermées.

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
- [ ] Désactiver le compte de test.

## Démo

Une instance à part du vrai site (son domaine, son volume, son `.env`) peut laisser des curieux entrer sans compte : la page de connexion y montre un bouton « Entrer dans la démo », qui ouvre le compte d'Alice sans rien taper. Ce que les visiteurs y font reste : rien ne la remet à zéro. **Le vrai site ne définit jamais `DEMO_LOGIN_EMAIL`** : n'importe qui entrerait dans ce compte.

1. **Installer l'instance** comme le vrai site (« Mise en service »), avec son propre `APP_URL` (par exemple `https://demo-prends-ton-dossard.ketra.fr`). Pas de `bootstrap-admin` : la base vient du `seed`.

2. **La remplir des données de test.** Le programme de production refuse `seed` hors de `localhost` sans `--force`. Les comptes ont tous le même mot de passe, public s'il n'est pas donné : en choisir un au hasard, que personne n'a besoin de connaître (le bouton ne le demande pas), garde fermés les comptes Admin et Bob.

   ```sh
   docker compose exec -e SEED_PASSWORD="$(openssl rand -base64 24)" courses /app/courses seed --force
   ```

3. **Activer le bouton.** Dans le `.env` de l'instance, ajouter `DEMO_LOGIN_EMAIL=alice@example.test` (un membre, pas `admin@example.test`), puis `docker compose up -d`. La variable ouvre `GET` et `POST /api/app/demo` ; sans elle, ces routes n'existent pas (404). Le compte doit exister, ne pas être désactivé et avoir un coureur, sinon le bouton s'affiche, mais son clic échoue (404).

## Feuille de route

Les tests de bout en bout (Playwright, sur trois navigateurs) sont prévus pour la v5.
