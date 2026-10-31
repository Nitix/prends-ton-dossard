# Courses entre amis : design v1

- **Date** : 2026-10-31
- **Statut** : en relecture
- **Auteur** : Guillaume (avec Claude)

## 1. Objectif

Un site privé, utilisable d'abord sur mobile, où un groupe d'amis note les courses et trails que chacun prévoit de faire, seul ou à plusieurs. Le but de la v1 est de **planifier** : savoir qui fait quoi et quand, pour s'organiser ensemble.

Le site est réussi si :

- chacun voit d'un coup d'œil les prochaines courses du groupe, en liste ou en agenda ;
- on peut inscrire un ami à une course, et tout le monde voit qui l'a ajouté et si l'ami a confirmé ;
- l'admin peut faire exister quelqu'un dans le site avant que cette personne ait un compte, puis l'inviter ;
- le site tourne sur la machine perso de Guillaume, sans service tiers payant ni mise en pause pour inactivité.

## 2. Périmètre

### Dans la v1

- Comptes uniquement sur invitation (lien à partager soi-même, sans envoi d'email).
- Coureurs sans compte créés par l'admin, puis rattachés à un compte par invitation.
- Connexion par email + mot de passe, ou par passkey (facultative).
- Événements avec plusieurs épreuves (type, distance, D+, date propre facultative).
- Participations avec statut, auteur de l'ajout et confirmation.
- Vues : accueil, liste et agenda (mois), avec filtres.
- Fiche d'un événement, création et modification.
- Admin : membres, invitations, réinitialisations, rôles, désactivation, types de course, fusion des doublons.
- Interface en français et en anglais, choisie automatiquement selon la langue du navigateur.
- Déploiement Docker derrière Caddy, sauvegardes, tests.

### Hors v1

- **v2 (pistes)** : prix et date limite d'inscription avec rappel, trace GPX ou lien Strava, export iCal, commentaires, covoiturage et logement, PWA installable, carte.
- **v3** : historique (temps, classement) et statistiques par personne.
- **Écarté** : envoi d'emails, TOTP, codes de secours, plusieurs groupes.

## 3. Décisions d'architecture

| Décision | Choix | Raison |
|---|---|---|
| Hébergement | Machine perso à la maison, déjà exposée via un domaine, en HTTPS derrière Caddy | Supabase gratuit met le projet en pause après ~7 jours sans activité, ce qui ne colle pas avec un usage irrégulier. |
| Backend | PocketBase **utilisé comme bibliothèque Go** (programme sur mesure) | Base, comptes, règles d'accès et tableau de bord fournis. PocketBase ne gère pas les passkeys (vérifié sur la doc v0.41), donc on les ajoute en Go avec une bibliothèque éprouvée plutôt qu'en écrivant de la cryptographie à la main. |
| Front | SPA React servie par le même programme Go | Un seul service à déployer. |
| Emails | Aucun en v1 | Une IP de box est souvent bloquée comme spam. Les liens d'invitation et de réinitialisation se partagent à la main (WhatsApp, SMS). |
| Dates | Dates civiles `YYYY-MM-DD` stockées en texte, manipulées avec `Temporal.PlainDate` | Une date de course n'a pas de fuseau horaire. Le format ISO se trie et se filtre directement en texte. |
| Langues | Français et anglais selon `navigator.languages`, avec des dictionnaires TypeScript typés ; dates, nombres, listes et pluriels via `Intl` | Un membre du groupe utilise l'anglais. Avec deux langues et environ 150 textes, des dictionnaires typés suffisent, sans dépendance supplémentaire. |

## 4. Modèle de données

Huit tables PocketBase, définies par des migrations Go versionnées. Toutes ont les champs système `id`, `created` et `updated`.

### `users` (table de comptes)

| Champ | Type | Règles |
|---|---|---|
| `email` | email (système) | obligatoire, unique |
| `password` | mot de passe (système) | obligatoire, 10 caractères minimum |
| `role` | choix `member` \| `admin` | `member` par défaut, modifiable par un admin seulement |
| `disabled` | booléen | `false` par défaut ; un compte désactivé ne peut plus se connecter (`authRule = "disabled = false"`) |

- Pas d'inscription par l'API (`createRule = null`) : un compte n'est créé que par la route d'acceptation d'invitation.
- Lecture : soi-même ou un admin. Les emails ne sont pas visibles des autres membres.
- La connexion par mot de passe est activée ; l'OTP par email et OAuth2 sont désactivés.

### `runners` (coureurs)

| Champ | Type | Règles |
|---|---|---|
| `name` | texte | obligatoire, unique (sans tenir compte des majuscules), 1 à 50 caractères |
| `user` | relation → `users` | facultatif, unique (lien 1-1), vide tant que la personne n'a pas de compte |

### `race_types` (types de course)

| Champ | Type | Règles |
|---|---|---|
| `label` | texte | obligatoire, unique |

Données de départ : Route, Trail, Ultra-trail, Cross.

### `events` (événements)

| Champ | Type | Règles |
|---|---|---|
| `name` | texte | obligatoire, 1 à 120 caractères |
| `location` | texte | obligatoire (ville ou lieu, texte libre) |
| `start_date` | texte `YYYY-MM-DD` | obligatoire |
| `end_date` | texte `YYYY-MM-DD` | facultatif, ≥ `start_date` |
| `registration_url` | URL | facultatif (les inscriptions ne sont pas toujours ouvertes) |
| `notes` | texte multiligne | facultatif |
| `created_by` | relation → `runners` | fixé par le serveur (le coureur de l'utilisateur connecté). On pointe vers `runners` et non vers `users` parce que les comptes ne sont pas lisibles par les autres membres, alors qu'on a besoin d'afficher le nom. |

### `formats` (épreuves)

| Champ | Type | Règles |
|---|---|---|
| `event` | relation → `events` | obligatoire, suppression en cascade |
| `name` | texte | facultatif ; sinon l'affichage est généré (« Trail 42 km ») |
| `race_type` | relation → `race_types` | obligatoire, sans cascade (un type utilisé ne peut pas être supprimé) |
| `distance_km` | nombre | obligatoire, > 0, décimales permises (42,195) |
| `elevation_gain_m` | nombre entier | facultatif, ≥ 0 |
| `date` | texte `YYYY-MM-DD` | facultatif ; si renseigné : ≥ `event.start_date`, et ≤ `event.end_date` s'il existe |

**Date effective d'une épreuve** : `format.date ?? event.start_date`. C'est elle que les vues et les filtres utilisent.

### `participations`

| Champ | Type | Règles |
|---|---|---|
| `runner` | relation → `runners` | obligatoire, ne change plus après la création |
| `format` | relation → `formats` | obligatoire, suppression en cascade ; modifiable seulement vers une épreuve du même événement |
| `status` | choix `interested` \| `registered` \| `finished` \| `dnf` \| `dns` | obligatoire, `interested` par défaut |
| `added_by` | relation → `runners` | fixé par le serveur à la création (le coureur de l'utilisateur connecté), ne change plus |
| `confirmed` | booléen | calculé par le serveur (voir § 6.2) |

Index unique sur (`runner`, `format`).

Libellés (FR / EN) : Intéressé / Interested, Inscrit / Registered, Terminé / Finished, Abandon / DNF, Non partant / DNS. Les types de course sont saisis par l'admin et ne sont pas traduits.

### `invitations`

| Champ | Type | Règles |
|---|---|---|
| `runner` | relation → `runners` | obligatoire, suppression en cascade |
| `kind` | choix `invite` \| `reset` | obligatoire |
| `role` | choix `member` \| `admin` | rôle donné à l'acceptation (`invite` seulement) |
| `token_hash` | texte (caché) | SHA-256 du jeton ; le jeton en clair n'est jamais stocké |
| `expires_at` | date-heure | création + 7 jours |
| `used_at` | date-heure | facultatif |
| `created_by` | relation → `users` | facultatif (vide si créé par la ligne de commande) |

- `invite` n'est possible que pour un coureur sans compte, et `reset` que pour un coureur qui en a un.
- Créer une invitation **supprime les invitations du même type encore en attente** pour ce coureur. Régénérer revient donc à révoquer l'ancienne.
- Aucune écriture par l'API standard ; tout passe par les routes du § 5.3. Seuls les admins peuvent lister.

### `passkeys`

| Champ | Type | Règles |
|---|---|---|
| `user` | relation → `users` | obligatoire, suppression en cascade |
| `name` | texte | obligatoire (« iPhone », « PC boulot ») |
| `credential_id` | texte | unique (base64url) |
| `credential` | JSON (caché) | identifiant WebAuthn sérialisé par `go-webauthn` (clé publique, compteur, transports, indicateurs) |
| `last_used_at` | date-heure | facultatif |

- Création uniquement par la route d'enregistrement.
- Lecture et suppression : le propriétaire ou un admin.
- Renommage : le propriétaire, champ `name` seulement.

## 5. Authentification et invitations

### 5.1 Connexion

- **Email + mot de passe** : connexion standard de PocketBase. Elle est limitée en nombre de tentatives par le limiteur intégré de PocketBase.
- **Passkey** :
  - bouton « Se connecter avec une clé d'accès », plus la suggestion automatique dans le champ email (`mediation: "conditional"`) ;
  - identifiants découvrables (`residentKey: required`), vérification de l'utilisateur `preferred` ;
  - une connexion réussie renvoie le même jeton de session PocketBase qu'une connexion par mot de passe ;
  - un compte désactivé est refusé.
- **Configuration WebAuthn** : tirée de la variable `APP_URL` (par exemple `https://courses.example.fr`). L'origine est `APP_URL`, l'identifiant du site (RP ID) est son nom d'hôte. En local, c'est `http://localhost:5173`.
- **Défis WebAuthn** : gardés en mémoire avec une durée de vie de 5 minutes. Il n'y a qu'une instance, donc pas besoin de les stocker en base.

### 5.2 Parcours d'invitation

1. L'admin crée un coureur (son nom), puis clique sur **Inviter**. Le serveur génère un jeton aléatoire de 32 octets (base64url) et ne stocke que son SHA-256. Il renvoie l'URL `APP_URL/invitation/<jeton>`.
2. L'admin la partage avec le bouton **Partager** (Web Share API) ou **Copier**.
3. La personne ouvre le lien. La page affiche « Bienvenue <nom> » et demande un email et un mot de passe (deux fois).
4. Le serveur vérifie le jeton (existe, pas expiré, pas utilisé) puis, **dans une seule transaction** :
   - crée le compte avec le rôle de l'invitation ;
   - le rattache au coureur ;
   - marque l'invitation comme utilisée ;
   - renvoie une session.
5. Après la connexion, le site propose d'ajouter une passkey.

**Réinitialisation** : même mécanisme avec `kind = reset`. La page demande seulement un nouveau mot de passe. L'utiliser **invalide les sessions existantes** du compte, car PocketBase renouvelle la clé de jeton du compte quand le mot de passe change. Les passkeys sont conservées.

**Premier admin** : la commande `courses bootstrap-admin "<nom>"` :

- crée le coureur s'il n'existe pas ;
- génère une invitation `invite` avec le rôle `admin` ;
- affiche l'URL dans le terminal.

Elle refuse de s'exécuter si un admin existe déjà, sauf avec `--force`.

### 5.3 Routes sur mesure

| Méthode et chemin | Accès | Rôle |
|---|---|---|
| `POST /api/app/invitations` | admin | `{runnerId, kind, role?}` → `{url, expiresAt}` |
| `GET /api/app/invitations/{token}` | public | `{runnerName, kind}`, ou 404 si invalide ou expiré |
| `POST /api/app/invitations/{token}/accept` | public | `{email, password, passwordConfirm}` (invite) ou `{password, passwordConfirm}` (reset) → session |
| `DELETE /api/app/invitations/{id}` | admin | révoque une invitation en attente |
| `POST /api/app/me/email` | connecté | `{email, password}` → change l'email après vérification du mot de passe. PocketBase passe normalement par une confirmation par email, que la v1 n'envoie pas. |
| `POST /api/app/passkeys/register/begin` | connecté | options de création WebAuthn |
| `POST /api/app/passkeys/register/finish` | connecté | `{name, credential}` → passkey créée |
| `POST /api/app/passkeys/login/begin` | public | options de connexion et `sessionId` |
| `POST /api/app/passkeys/login/finish` | public | `{sessionId, credential}` → session |
| `POST /api/app/admin/merge-events` | admin | `{keepId, mergeId, dryRun}` → aperçu ou résultat |
| `POST /api/app/admin/merge-formats` | admin | `{keepId, mergeId, dryRun}` → aperçu ou résultat |

Les routes publiques liées aux jetons sont limitées en nombre de requêtes, avec le limiteur de PocketBase.

## 6. Permissions

### 6.1 Matrice

| Action | Membre | Admin |
|---|---|---|
| Tout voir (événements, épreuves, participants, coureurs, types) | ✓ | ✓ |
| Créer un événement ou une épreuve | ✓ | ✓ |
| Modifier un événement ou une épreuve | ✓ (tout le monde) | ✓ |
| Supprimer un événement ou une épreuve | si auteur de l'événement | ✓ |
| S'ajouter à une épreuve | ✓ (confirmé) | ✓ |
| Ajouter quelqu'un d'autre | ✓ (non confirmé) | ✓ |
| Modifier ou retirer une participation non confirmée | ✓ (tout le monde) | ✓ |
| Modifier ou retirer une participation confirmée | la sienne seulement | ✓ |
| Confirmer une participation | la sienne seulement | la sienne seulement |
| Renommer son propre coureur | ✓ | ✓ |
| Créer, renommer ou supprimer un coureur, inviter, réinitialiser, désactiver | — | ✓ |
| Changer un rôle | — | ✓ |
| Gérer les types de course | — | ✓ |
| Voir les emails des autres | — | ✓ |
| Supprimer la passkey de quelqu'un d'autre | — | ✓ |
| Fusionner des doublons | — | ✓ |

Hors invitation et réinitialisation, seuls les utilisateurs connectés peuvent lire ou écrire quoi que ce soit.

### 6.2 Règles appliquées par le serveur

- **`created_by` et `added_by`** sont fixés par un hook à la création : ils reçoivent le coureur rattaché à `@request.auth.id`. Toute valeur envoyée par le client est ignorée.
- **Désactiver un compte** renouvelle sa clé de jeton : ses sessions ouvertes cessent immédiatement de fonctionner.
- **Dernier admin** : on ne peut pas retirer le rôle admin du dernier admin actif, ni le désactiver (`last_admin`).
- **Dates d'un événement** : on ne peut pas les modifier si une épreuve a une date propre qui sortirait de la nouvelle plage (`format_date_out_of_range`).
- **`confirmed`** :
  - à la création, il vaut `true` si `runner.user = @request.auth.id`, sinon `false` ;
  - quand le coureur concerné modifie sa propre participation (statut, épreuve, ou confirmation explicite), il passe à `true` ;
  - personne d'autre ne peut le modifier ;
  - il ne repasse jamais de `true` à `false`.
- **Retirer une participation** = la supprimer. Le bouton « Retirer » de l'accueil fait cette suppression.
- **Supprimer un coureur** est refusé s'il a des participations. Il faut d'abord retirer ses participations, ou désactiver son compte s'il en a un : il reste alors visible sur les courses.
- **Supprimer un type** est refusé s'il est utilisé par une épreuve.
- **Les fusions** s'exécutent dans une transaction :
  - `merge-events` : les épreuves sont déplacées vers l'événement gardé, puis l'autre est supprimé ;
  - `merge-formats` (même événement obligatoire) : les participations sont déplacées. Si un coureur est sur les deux épreuves, on garde la participation confirmée. Si les deux sont confirmées, ou aucune des deux, on garde celle dont le statut est le plus avancé (`interested` < `registered` < `finished`/`dnf`/`dns`). En cas d'égalité, on garde celle de l'épreuve conservée.
  - `dryRun: true` renvoie l'aperçu sans rien modifier.

Les règles d'accès PocketBase traduisent la matrice. Les hooks Go appliquent ce que les règles ne peuvent pas exprimer. Le front ne fait que masquer les actions interdites ; il n'est jamais garant d'une règle.

## 7. Écrans

Le site est d'abord pensé pour le mobile et existe en français et en anglais (voir « Langues » plus bas). Une barre d'onglets en bas propose **Accueil · Liste · Agenda · Profil**, plus **Admin** pour les admins. Un bouton flottant **+** sert à créer un événement. Sur ordinateur, les onglets passent dans une barre en haut.

| Route | Écran |
|---|---|
| `/connexion` | Email + mot de passe, bouton passkey, suggestion automatique de passkey |
| `/invitation/:token` | Acceptation d'une invitation ou réinitialisation |
| `/` | Accueil |
| `/liste` | Liste |
| `/agenda` | Agenda |
| `/evenements/nouveau` | Création |
| `/evenements/:id` | Fiche d'un événement |
| `/evenements/:id/modifier` | Modification |
| `/profil` | Profil |
| `/admin/membres`, `/admin/types`, `/admin/doublons` | Admin |

- **Accueil** :
  - bloc « À confirmer » : les participations de l'utilisateur ajoutées par d'autres, avec **Confirmer** et **Retirer** ;
  - « Mes prochaines courses », avec un décompte (« dans 45 jours ») ;
  - « Bientôt dans le groupe » : les 5 prochains événements avec des participants ;
  - bandeau « Ajoute une clé d'accès » tant que l'utilisateur n'a aucune passkey (masquable).
- **Liste** :
  - événements dont au moins une épreuve est à venir, triés par date effective et regroupés par mois ;
  - carte : date, nom, lieu, épreuves (type, distance, D+), pastilles des participants avec leurs initiales (en pointillés si non confirmé) ;
  - filtres dans l'URL :
    - `personne` (moi, un coureur, tout le monde) : garde les événements où ce coureur a une participation ;
    - `type` : garde les événements qui ont au moins une épreuve de ce type ;
    - `periode` : `a-venir` par défaut (au moins une épreuve dont la date effective est aujourd'hui ou plus tard) ou `passees` (toutes les épreuves sont avant aujourd'hui), triées de la plus récente à la plus ancienne.
- **Agenda** :
  - grille mensuelle dont le premier jour dépend de la locale de formatage (`Intl.Locale#getWeekInfo` : lundi en `fr-FR` et `en-GB`, dimanche en `en-US`), avec le lundi par défaut si l'API est absente ;
  - flèches pour changer de mois, mois affiché dans l'URL ;
  - mêmes filtres que la liste ;
  - un événement sur plusieurs jours apparaît sur chacun de ses jours ;
  - **mobile** : des points de couleur par jour, et toucher un jour affiche ses courses en dessous ;
  - **ordinateur** : les noms des courses apparaissent dans les cases.
- **Fiche d'un événement** :
  - informations, avec un bouton **S'inscrire sur le site officiel** si `registration_url` est renseigné ;
  - chaque épreuve avec ses participants, leur statut et « ajouté par X · non confirmé » quand c'est le cas ;
  - actions : **J'y vais** (choix de l'épreuve et du statut), **Ajouter quelqu'un** (choix du coureur, de l'épreuve et du statut), **Modifier**, **Supprimer** (confirmation qui liste les participants concernés).
- **Créer ou modifier** :
  - un seul formulaire pour l'événement et ses épreuves (au moins une) ;
  - dès que le nom et la date sont remplis, des doublons possibles sont proposés : événements à ±30 jours dont le nom contient l'un des mots de 4 lettres ou plus du nom saisi ;
  - à la création, la case **Je participe** est cochée par défaut, avec le choix de l'épreuve.
- **Profil** :
  - nom affiché ;
  - changer d'email (route `/api/app/me/email`) ou de mot de passe (mise à jour standard avec `oldPassword`), toujours en redemandant le mot de passe actuel ;
  - « Mes clés d'accès » : ajouter, renommer, supprimer ;
  - déconnexion.
- **Admin, membres** :
  - liste des coureurs avec leur état : sans compte, invitation en attente (avec la date d'expiration), actif ou désactivé ; et leur rôle ;
  - actions : créer, renommer, supprimer (si aucune participation), inviter, régénérer ou révoquer une invitation, lien de réinitialisation, passer admin ou retirer admin, désactiver ou réactiver, voir et supprimer les passkeys.
- **Admin, types** : ajouter, renommer, supprimer (seulement si le type n'est pas utilisé).
- **Admin, doublons** : choisir deux événements, ou deux épreuves d'un même événement, puis celui à garder ; afficher l'aperçu ; confirmer.

**Langues** :

- **Détection** : on parcourt `navigator.languages` dans l'ordre et on prend la première langue gérée (`fr` ou `en`). Si aucune ne correspond, on utilise le français. Il n'y a pas de sélecteur de langue en v1.
- **Deux locales distinctes** :
  - la langue des textes, `fr` ou `en` ;
  - la locale de formatage, qui est l'étiquette complète du navigateur (`fr-FR`, `en-GB`, `en-US`…) pour que l'ordre des dates et le premier jour de la semaine respectent ses habitudes.
- **Textes** : un dictionnaire `fr.ts` sert de référence, et `en.ts` est typé avec `satisfies Messages`. Une clé manquante ou en trop fait donc échouer la compilation. Les textes avec des variables sont des fonctions (`addedBy: (name) => …`).
- **Page** : `<html lang>` est mis à jour selon la langue choisie.
- **Erreurs serveur** : les routes sur mesure renvoient des codes d'erreur (`invitation_invalid`, `email_taken`…), jamais de texte. C'est le front qui les traduit.

**Formatage** : uniquement avec `Intl`, dans la locale de formatage :

- `DateTimeFormat` pour les dates (« sam. 14 juin » / « Sat 14 Jun ») ;
- `RelativeTimeFormat` pour les décomptes (« dans 45 jours » / « in 45 days ») ;
- `NumberFormat` avec unités pour les distances et le dénivelé (« 42,2 km », « 2 400 m ») ;
- `ListFormat` pour les noms (« Alice, Paul et Julie » / « Alice, Paul and Julie ») ;
- `PluralRules` pour les accords.

**Accessibilité** :

- HTML sémantique ;
- zones tactiles d'au moins 44 px ;
- contraste AA ;
- l'état non confirmé n'est jamais signalé par la couleur seule (texte ou bordure en plus) ;
- les fenêtres utilisent `<dialog>` natif.

## 8. Stack technique

Les dernières versions stables sont vérifiées et figées (fichiers de verrouillage) au démarrage du projet.

- **Serveur** :
  - Go ;
  - PocketBase comme bibliothèque ;
  - `github.com/go-webauthn/webauthn` pour les passkeys ;
  - les migrations Go de PocketBase pour les tables, les règles et les données de départ.
- **Front** :
  - TypeScript, React 19 avec le React Compiler, Vite (bundler Rolldown), Tailwind CSS 4 ;
  - TanStack Router (routes et paramètres d'URL typés) et TanStack Query ;
  - SDK JS de PocketBase ;
  - formulaires natifs avec les actions de React 19 (`useActionState`), sans bibliothèque de formulaires.
- **API natives du navigateur** :
  - Temporal, natif partout sauf Safari. `temporal-polyfill` n'est chargé dynamiquement, avant le rendu, que si `globalThis.Temporal` est absent ;
  - Intl ;
  - `<dialog>` et l'API Popover ;
  - View Transitions pour passer de la liste à l'agenda ;
  - Web Share ;
  - WebAuthn avec `PublicKeyCredential.parseCreationOptionsFromJSON` et `parseRequestOptionsFromJSON` (avec repli sur une conversion manuelle si absentes) et `toJSON()`.
- **Langues** : dictionnaires TypeScript typés, sans bibliothèque d'i18n.
- **Outils** : Node 26 ou plus (Temporal y est natif, donc les tests Vitest n'ont pas besoin du polyfill ; version imposée par `engines` et `.nvmrc`, et utilisée en CI et dans l'image Docker), pnpm, la suite Oxc (**oxlint** pour le lint, avec les règles TypeScript qui s'appuient sur les types, et **oxfmt** pour le formatage), Vitest, Playwright (Chromium, Firefox, WebKit). Côté Go : `gofmt` et `go vet`.

## 9. Organisation du code

```
courses/
├─ server/
│  ├─ main.go                 démarrage de PocketBase, routes, hooks, front embarqué
│  ├─ migrations/             tables, règles, données de départ
│  ├─ participations/         hooks added_by / confirmed / changement d'épreuve
│  ├─ events/                 hooks created_by et validation des dates
│  ├─ invitations/            création, consultation, acceptation, révocation
│  ├─ passkeys/               enregistrement et connexion WebAuthn
│  ├─ admin/                  fusions
│  ├─ cmd/                    bootstrap-admin, seed (données de démo)
│  └─ webdist/                front compilé, embarqué avec go:embed
├─ web/
│  └─ src/
│     ├─ routes/              routes TanStack Router
│     ├─ features/            auth, events, participations, agenda, profile, admin
│     ├─ components/          composants d'interface partagés
│     ├─ i18n/                fr.ts, en.ts, détection de la langue, traduction des codes d'erreur
│     └─ lib/                 client pocketbase, dates (Temporal), formats (Intl)
├─ e2e/                       tests Playwright
├─ Dockerfile
├─ compose.yaml
├─ Caddyfile.example
└─ docs/
```

**En local** :

- `go run ./server serve` (PocketBase sur `:8090`) et `pnpm --dir web dev` (Vite sur `:5173`, avec un proxy `/api` vers `:8090`) ;
- `go run ./server seed` remplit la base de démo (coureurs, événements, participations variées).

Le programme Go sert le front compilé, avec un retour vers `index.html` pour que les routes de la SPA fonctionnent.

## 10. Déploiement et sauvegardes

- **Image** : `Dockerfile` en plusieurs étapes :
  1. build du front (Node et pnpm) ;
  2. build Go avec le front embarqué ;
  3. image finale minimale.
- **`compose.yaml`** :
  - un service `courses` ;
  - un volume `pb_data` ;
  - un port publié sur `127.0.0.1:8090` uniquement ;
  - les variables `APP_URL` et `TZ=Europe/Paris`.
- **Caddy** :
  ```
  courses.example.fr {
      reverse_proxy 127.0.0.1:8090
  }
  ```
- **Mise en service** :
  1. `docker compose up -d --build` ;
  2. création du super-admin PocketBase (`docker compose exec courses /app/courses superuser upsert <email> <mdp>`) ;
  3. `bootstrap-admin` pour créer le premier admin du site.
- **Mise à jour** : `git pull && docker compose up -d --build`. Les migrations s'appliquent au démarrage.
- **Sauvegardes** :
  - sauvegardes PocketBase intégrées, chaque nuit à 3 h, en gardant les 7 dernières ;
  - copie hors de la machine vers un stockage compatible S3 (Cloudflare R2 ou Backblaze B2, offre gratuite), configurée dans le tableau de bord ;
  - le fichier SQLite n'est jamais copié pendant que l'application tourne ;
  - procédure de restauration documentée dans le README, et testée une fois avant d'ouvrir le site au groupe.
- **Domaine** : il doit être choisi définitivement avant d'inviter qui que ce soit, car les passkeys y sont liées.

## 11. Tests

- **Serveur (`go test`, outils de test de PocketBase)** :
  - un test par ligne de la matrice du § 6.1, joué avec un membre, un admin et le propriétaire ;
  - `added_by`, `created_by` et `confirmed` : le client ne peut pas forcer ces valeurs ;
  - `confirmed` passe à `true` quand le propriétaire modifie sa participation, et ne repasse jamais à `false` ;
  - changement d'épreuve vers un autre événement refusé ;
  - unicité (`runner`, `format`) ;
  - invitations : valide, expirée, déjà utilisée, révoquée, `invite` pour un coureur qui a déjà un compte, `reset` pour un coureur qui n'en a pas, email déjà pris ;
  - la réinitialisation invalide les anciennes sessions ;
  - compte désactivé : ni mot de passe ni passkey ne permettent de se connecter ;
  - changement d'email : refusé avec un mauvais mot de passe ou un email déjà pris ;
  - fusions : aperçu sans effet, déplacement, résolution des doublons de coureurs, transaction annulée en cas d'erreur ;
  - `bootstrap-admin` : premier lancement, refus si un admin existe ;
  - validation des dates (`end_date` ≥ `start_date`, date d'épreuve dans la plage de l'événement).
- **Front (Vitest)** :
  - date effective d'une épreuve ;
  - regroupement par mois ;
  - grille de l'agenda (mois commençant n'importe quel jour, événements sur plusieurs jours, changement d'année) ;
  - séparation entre à venir et passé par rapport à « aujourd'hui » (injectable) ;
  - formats Intl ;
  - détection des doublons ;
  - nom d'épreuve généré ;
  - détection de la langue (`["en-GB", "fr"]` → `en` et `en-GB` ; `["de-DE"]` → `fr` ; `["fr-CA", "en"]` → `fr` et `fr-CA`) ;
  - premier jour de la semaine selon la locale ;
  - traduction de chaque code d'erreur serveur dans les deux langues ;
  - chargeur de Temporal : avec `globalThis.Temporal` retiré, il charge le polyfill et les fonctions de dates donnent les mêmes résultats. Ce test garantit le chemin « Safari » même si le WebKit de Playwright active Temporal avant Safari.
- **De bout en bout (Playwright)** :
  - le parcours complet tourne sur trois navigateurs :
    - **Chromium** en `fr-FR` ;
    - **Firefox** en `en-GB` : interface en anglais avec une semaine qui commence le lundi ;
    - **WebKit** en `en-US` : interface en anglais, semaine qui commence le dimanche. C'est le moteur de Safari, que Playwright fournit sous Windows et Linux : pas besoin de Mac ni de Safari. Il ne remplace pas un vrai iPhone (voir la recette manuelle plus bas) ;
  - l'étape passkey ne tourne que sur Chromium, car l'authentificateur virtuel WebAuthn de Playwright passe par un protocole propre à Chromium.

  Étapes du parcours :
  1. `bootstrap-admin`, puis acceptation de l'invitation ;
  2. création d'un coureur et invitation, puis acceptation par un deuxième navigateur ;
  3. création d'un événement avec deux épreuves et « Je participe » ;
  4. ajout de l'ami : la participation apparaît non confirmée, avec l'auteur ;
  5. l'ami confirme depuis son accueil ;
  6. vues liste et agenda filtrées ;
  7. ajout d'une passkey puis connexion avec (Chromium seulement) ;
  8. fusion de deux événements en doublon.
- **Recette manuelle sur iPhone**, avant d'ouvrir le site au groupe, avec le téléphone d'un ami :
  - création d'une passkey avec Face ID ou Touch ID, puis connexion avec ;
  - accueil, liste, agenda et fiche d'un événement dans Safari ;
  - partage d'un lien d'invitation (Web Share).

  Un compte de test dédié sert à cette recette, puis il est désactivé.
- **CI** : GitHub Actions lance à chaque push `oxlint`, `oxfmt --check`, la vérification des types TypeScript, Vitest, `gofmt`, `go vet`, `go test`, puis Playwright sur les trois navigateurs.

## 12. Gestion des erreurs

- Les erreurs de l'API PocketBase (codes de validation par champ) et des routes sur mesure (codes métier) sont traduites dans la langue de l'utilisateur, puis affichées sous le champ concerné ou dans une notification. Un code inconnu affiche un message générique.
- Un formulaire refusé conserve ce qui a été saisi.
- Un lien d'invitation invalide affiche « Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau à l'admin. » (ou l'équivalent en anglais).
- Un bandeau « Hors connexion » apparaît quand le réseau tombe (`navigator.onLine` et événements `online`/`offline`). Les requêtes sont relancées au retour du réseau (TanStack Query).
- Une session expirée renvoie vers `/connexion`, puis ramène à la page demandée.
- WebAuthn : un refus ou une annulation par l'utilisateur est géré sans message alarmant. Un navigateur sans support masque simplement les boutons passkey.

## 13. Hypothèses

- Le groupe compte environ 15 personnes. Une seule instance suffit, et SQLite aussi.
- En v1, « aujourd'hui » est calculé dans le fuseau Europe/Paris pour tout le monde (`Temporal.Now.plainDateISO("Europe/Paris")`), quelle que soit la langue.
- La machine est en amd64. L'image est construite sur le serveur. Une construction en CI vers un registre reste possible plus tard sans changer le `Dockerfile`.
- Temporal est natif dans tous les navigateurs ciblés sauf Safari, et dans Node à partir de la version 26.
