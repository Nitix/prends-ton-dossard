# Courses

Un site privé, pensé d'abord pour le mobile, où un groupe d'amis note les courses et les trails que chacun prévoit de faire. Le serveur est un programme Go (PocketBase utilisé comme bibliothèque) qui embarque le front React compilé : un seul binaire, un seul conteneur.

La spécification est dans [`docs/superpowers/specs/2026-10-31-courses-design.md`](docs/superpowers/specs/2026-10-31-courses-design.md).

```
server/   programme Go : API, règles, migrations, commandes (bootstrap-admin, seed)
web/      front React 19 + Vite, compilé dans server/webdist/dist puis embarqué
```

## Prérequis

- **Go 1.27** ;
- **Node 26** ou plus (voir `.nvmrc`) ;
- **pnpm 12** (la version exacte est dans `packageManager`, dans `package.json`) ;
- pour la production : **Docker** avec Compose, et **Caddy** sur la machine.

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

La commande crée trois comptes (`admin@example.test`, `alice@example.test` et `bob@example.test`, mot de passe `courses-dev-password`, ou celui de `--password` ou de `SEED_PASSWORD`), des coureurs, des événements et des participations. Elle refuse de s'exécuter si des comptes existent déjà.

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

   Dans `.env`, remplacer la valeur de `APP_URL` par l'adresse publique du site : `https://` et le domaine, sans chemin (par exemple `https://courses.example.fr`).

2. **Construire et démarrer le conteneur.**

   ```sh
   docker compose up -d --build
   docker compose ps          # "healthy" au bout de quelques secondes
   ```

   Le conteneur n'écoute que sur `127.0.0.1:8090` : il n'est pas joignable de l'extérieur tant que Caddy ne le publie pas. Les données vivent dans le volume Docker `pb_data` (`docker volume ls` donne son nom complet, préfixé par celui du dossier).

3. **Brancher Caddy.** Copier le bloc de `Caddyfile.example` dans `/etc/caddy/Caddyfile`, avec le domaine de `APP_URL`, puis recharger :

   ```
   courses.example.fr {
   	reverse_proxy 127.0.0.1:8090
   }
   ```

   ```sh
   sudo systemctl reload caddy
   curl -s https://courses.example.fr/api/health
   ```

   Caddy obtient et renouvelle seul le certificat HTTPS.

4. **Créer le super-admin PocketBase.** C'est le compte du tableau de bord (`https://courses.example.fr/_/`), qui sert à configurer les sauvegardes et à restaurer.

   ```sh
   docker compose exec courses /app/courses superuser upsert <email> <mot de passe>
   ```

   Au premier démarrage, `docker compose logs courses` affiche un lien d'installation du tableau de bord (`/_/#/pbinstall/…`) : ne pas l'utiliser. Le compte d'installation qu'il suppose est supprimé dès qu'un super-admin existe.

5. **Créer le premier admin du site.**

   ```sh
   docker compose exec courses /app/courses bootstrap-admin "<Prénom>"
   ```

   La commande affiche une seule ligne : `Invitation URL: https://courses.example.fr/invitation#…`. Ouvrir ce lien (valable 7 jours) pour choisir un mot de passe : le coureur créé devient l'admin. La commande refuse de s'exécuter si un admin existe déjà (`--force` pour en inviter un autre). Les autres membres sont ensuite invités depuis l'écran d'administration du site.

6. **Configurer les sauvegardes hors de la machine** (voir plus bas), puis **tester la restauration une fois**, avant d'ouvrir le site au groupe.

7. **Faire la recette sur iPhone** (voir plus bas).

## Mise à jour

```sh
git pull && docker compose up -d --build
```

Les migrations de la base s'appliquent au démarrage. Le volume n'est pas touché. Avant une mise à jour qui ajoute une migration, créer une sauvegarde depuis le tableau de bord (Settings, puis Backups).

## Sauvegardes

- **Chaque nuit à 3 h**, PocketBase crée une sauvegarde et garde les 7 dernières. Ce réglage vient d'une migration ; il se voit dans le tableau de bord, sous Settings puis Backups. Une sauvegarde est une archive `.zip` du dossier de données : `data.db` et `auxiliary.db` (copiés de façon cohérente pendant que l'application tourne) et les éventuels fichiers déposés.
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

### Depuis le tableau de bord

Quand l'application démarre encore :

1. Ouvrir le tableau de bord (`/_/`), sous Settings puis Backups.
2. Choisir la sauvegarde dans la liste (elle vient du bucket si S3 est activé), puis « Restore », et confirmer en tapant son nom.
3. PocketBase remplace les données et redémarre seul.
4. Vérifier (voir plus bas).

### À la main

Quand l'application ne démarre plus, ou que le volume est perdu :

1. **Récupérer l'archive** (`.zip`) : depuis le bucket, ou, si S3 n'était pas activé, depuis le dossier `backups` du volume (`docker compose cp courses:/pb_data/backups/<fichier>.zip ./restore/`). La poser hors du volume, par exemple dans `./restore/` à côté de `compose.yaml`.
2. **Arrêter le conteneur.**

   ```sh
   docker compose stop courses
   ```
3. **Remplacer le contenu du volume par l'archive décompressée.** La commande vide le volume (sauvegardes locales comprises), décompresse l'archive, puis rend les fichiers à l'utilisateur du programme :

   ```sh
   docker compose run --rm --no-deps --user root --entrypoint sh \
     -v "$PWD/restore:/restore:ro" courses \
     -c 'rm -rf /pb_data/* && unzip /restore/<fichier>.zip -d /pb_data && chown -R courses /pb_data'
   ```
4. **Redémarrer.**

   ```sh
   docker compose up -d
   docker compose ps          # "healthy"
   ```
5. **Vérifier** (voir ci-dessous).

### Vérifier la restauration

- `docker compose logs courses` ne montre aucune erreur ;
- `curl -s https://courses.example.fr/api/health` répond 200 ;
- se connecter au site avec un compte connu : les événements et les participations sont ceux de la sauvegarde ;
- se connecter au tableau de bord avec le super-admin ;
- créer une sauvegarde à la main : elle doit apparaître dans la liste (ou dans le bucket).

## Recette manuelle sur iPhone

À faire **avant d'ouvrir le site au groupe**, avec le téléphone d'un ami, sur le vrai domaine en HTTPS. Un compte de test dédié sert à cette recette, puis il est désactivé (depuis l'administration des membres).

Préparation : inviter un coureur de test depuis l'administration du site, et ouvrir le lien d'invitation dans Safari sur l'iPhone.

- [ ] Créer une passkey avec Face ID ou Touch ID, puis se déconnecter et se connecter avec la passkey.
- [ ] Dans Safari, parcourir l'accueil, la liste, l'agenda et la fiche d'un événement : tout s'affiche et se manipule correctement.
- [ ] Partager un lien d'invitation avec la feuille de partage de l'iPhone (Web Share).
- [ ] Désactiver le compte de test.

## Feuille de route

Les tests de bout en bout (Playwright, sur trois navigateurs) sont prévus pour la v5.
