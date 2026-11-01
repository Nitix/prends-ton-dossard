# Prends ton dossard : addendum v2

- **Date** : 2026-11-01
- **Statut** : design écrit en autonomie (l'utilisateur a demandé la v2, la v3 et la v4 « en autonomie », avec un registre des décisions à relire)
- **Auteur** : Guillaume (avec Claude)
- **Base** : la spec v1 (`2026-10-31-courses-design.md`) et l'addendum v1.1 (`2026-11-01-courses-v1.1-design.md`). Cet addendum ne décrit que ce qui change. En cas de conflit, le plus récent l'emporte.

## 1. Objectif

La feuille de route de la v2 (§ 2 de la spec v1) :

1. le **prix** d'une épreuve et la **date limite d'inscription** d'un événement, avec un **rappel** ;
2. des **commentaires** sur un événement ;
3. le **covoiturage** et le **logement** ;
4. un **mode supporteur**, pour ceux qui viennent sans courir ;
5. le **nouveau nom**, « Prends ton dossard ».

Le site n'envoie toujours aucun email (§ 3 de la spec v1). Le rappel et les commentaires se voient donc dans le site : sur l'accueil et sur la fiche.

## 2. Périmètre

### Dans la v2

- Prix facultatif sur chaque épreuve, date limite d'inscription facultative sur chaque événement.
- Rappel dans le site : un bloc « Inscriptions à faire » sur l'accueil, et un encadré sur la fiche, pour chaque événement où je suis intéressé et dont la date limite n'est pas passée.
- Commentaires sur la fiche d'un événement, et les derniers commentaires sur l'accueil.
- Covoiturage et logement : un membre propose des places (dans sa voiture, dans un logement), les autres les prennent.
- Supporteur : une participation à l'événement, sans épreuve, au statut « Supporteur ».
- Le site s'appelle « Prends ton dossard », en français comme en anglais.

### Hors v2

- **Carte** : toujours « à trancher » (§ 2 de la spec v1). Rien n'est fait en v2.
- **Notifications** (push, email) des rappels et des commentaires : une notification push demande un service worker, qui arrive avec la PWA en v3.
- Date d'**ouverture** des inscriptions, prix qui change selon la date (« early bird »).
- **Demandes de place** (« je cherche une voiture ») : elles passent par les commentaires.
- **Commentaires non lus**, mentions, mise en forme, liens cliquables, pièces jointes.
- Aller et retour distincts dans un covoiturage : une voiture = un trajet, décrit en texte libre.

## 3. Modèle de données (delta)

### `events`

| Champ | Type | Règles |
|---|---|---|
| `registration_deadline` (**nouveau**) | texte `YYYY-MM-DD` | facultatif ; dernier jour pour s'inscrire ; ≤ `start_date` (`registration_deadline_after_start`) |

### `formats`

| Champ | Type | Règles |
|---|---|---|
| `price_eur` (**nouveau**) | nombre | facultatif, ≥ 0, deux décimales au plus ; en euros |

Comme les autres nombres de la v1 (décision 5 du registre), **0 vaut « non renseigné »** : une course gratuite n'affiche pas de prix. Il suffit de l'écrire dans le nom ou les notes.

### `participations`

| Champ | Type | Règles |
|---|---|---|
| `status` | choix | **`supporter`** s'ajoute : `interested` \| `registered` \| `finished` \| `dnf` \| `dns` \| `supporter` |

- **Supporteur** : participation **à l'événement** (sans épreuve) au statut `supporter`. Elle profite de tout ce que la v1.1 a mis en place : l'index unique `(runner, event) WHERE format = ''`, l'invariant « événement ou épreuves, jamais les deux », la conversion quand le coureur reçoit une épreuve.
- **Sans épreuve**, deux statuts sont permis : `interested` et `supporter`. Les autres donnent toujours `format_required` sur `status`.
- **Avec une épreuve**, `supporter` est refusé : `supporter_with_format` sur `status`.
- **Rang** pour les fusions (`winner()`) : `supporter` a le rang d'`interested` (le plus bas).
- Libellés : FR « Supporteur », EN « Supporter ».

### `comments` (nouvelle table)

| Champ | Type | Règles |
|---|---|---|
| `event` | relation → `events` | obligatoire, suppression en cascade ; ne change plus après la création |
| `author` | relation → `runners` | fixé par le serveur à la création (le coureur de l'utilisateur connecté), ne change plus |
| `body` | texte | obligatoire, 1 à 2000 caractères ; espaces de début et de fin retirés par le serveur |

Index sur `(event, created)`. Le texte est affiché tel quel (retours à la ligne gardés), jamais interprété comme du HTML.

### `offers` (nouvelle table) : places proposées

Une **offre** est une voiture (`ride`) ou un logement (`lodging`) pour un événement, proposée par un membre, le **propriétaire**, qui y offre des places.

| Champ | Type | Règles |
|---|---|---|
| `event` | relation → `events` | obligatoire, suppression en cascade ; ne change plus après la création |
| `kind` | choix `ride` \| `lodging` | obligatoire ; ne change plus après la création |
| `owner` | relation → `runners` | fixé par le serveur à la création (le coureur de l'utilisateur connecté), ne change plus |
| `place` | texte | obligatoire, 1 à 120 caractères. Voiture : lieu de départ (« Lyon, Part-Dieu »). Logement : nom ou adresse (« Gîte des Crêtes, Valloire ») |
| `seats` | nombre entier | voiture : **obligatoire**, 1 à 8 (`offer_seats_required`) ; logement : facultatif, 1 à 30 (0 = non précisé, sans limite) |
| `date` | texte `YYYY-MM-DD` | facultatif. Voiture : jour du départ. Logement : jour d'arrivée |
| `time` | texte `HH:MM` | facultatif, voiture seulement (`time_invalid` si la forme est mauvaise) ; heure de départ |
| `end_date` | texte `YYYY-MM-DD` | facultatif, logement seulement ; jour de départ, ≥ `date` (`end_before_start`) |
| `url` | URL | facultatif, logement seulement (annonce, réservation) |
| `notes` | texte multiligne | facultatif, 1000 caractères au plus |

Les places proposées ne comptent pas le propriétaire : « 3 places » dans une voiture, c'est 3 passagers en plus du conducteur.

### `offer_members` (nouvelle table) : qui a pris une place

| Champ | Type | Règles |
|---|---|---|
| `offer` | relation → `offers` | obligatoire, suppression en cascade |
| `runner` | relation → `runners` | obligatoire, suppression en cascade |
| `added_by` | relation → `runners` | fixé par le serveur à la création |

Index unique sur `(offer, runner)`.

### Migrations

La règle de nommage de `server/migrations/doc.go` s'applique (une lettre après le 9) :

| Fichier | Contenu |
|---|---|
| `9a_registration.go` | `events.registration_deadline`, `formats.price_eur` |
| `9b_supporter.go` | statut `supporter` |
| `9c_comments.go` | table `comments`, ses index et ses règles |
| `9d_offers.go` | tables `offers` et `offer_members`, leurs index et leurs règles |

Chaque migration a son retour arrière. Celui de `9b` passe d'abord les participations `supporter` en `interested`, puis retire le statut.

## 4. Règles et hooks (delta)

Toutes les clauses qui comparent une relation à l'appelant gardent `@request.auth.id != ""` en tête (décision 8 du registre). Les hooks qui gardent une donnée vraie sont des hooks de modèle (ils valent aussi pour les écritures en Go et pour l'API batch).

### 4.1 Événements et épreuves

- `registration_deadline` : même contrôle de forme que les autres dates (`date_invalid`), puis ≤ `start_date`, sinon `registration_deadline_after_start` sur `registration_deadline`. Le contrôle porte sur l'enregistrement entier : déplacer `start_date` avant la date limite est refusé de la même façon.
- `price_eur` : ≥ 0 (règle du champ) et deux décimales au plus (`price_invalid`).

### 4.2 Participations

- **Validation** (s'ajoute à celle de la v1.1) :
  - avec une épreuve, `supporter` est refusé (`supporter_with_format` sur `status`) ;
  - sans épreuve, `interested` ou `supporter`, sinon `format_required` sur `status` (inchangé).
- **Modification** : passer d'`interested` à `supporter` (et inversement) sur une participation à l'événement est permis. Le reste de la v1.1 est inchangé : `PATCH {format, status}` donne une épreuve à une participation à l'événement, qu'elle soit `interested` ou `supporter`.
- **Conversion** : inchangée. Un supporteur qu'on inscrit à une épreuve devient coureur de cette épreuve.

### 4.3 Commentaires

| Action | Règle |
|---|---|
| lire, lister | `@request.auth.id != ""` |
| créer | `@request.auth.id != ""` ; `author` est fixé par un hook de requête, comme `created_by` |
| modifier | `@request.auth.id != "" && author.user = @request.auth.id && @request.body.author:isset = false && @request.body.event:isset = false` |
| supprimer | `@request.auth.id != "" && (author.user = @request.auth.id \|\| @request.auth.role = "admin")` |

Un admin supprime n'importe quel commentaire, mais ne modifie que les siens.

### 4.4 Offres et places

| Table | Action | Règle |
|---|---|---|
| `offers` | lire, lister | `@request.auth.id != ""` |
| `offers` | créer | `@request.auth.id != ""` ; `owner` fixé par un hook de requête |
| `offers` | modifier | `@request.auth.id != "" && (owner.user = @request.auth.id \|\| @request.auth.role = "admin") && @request.body.owner:isset = false && @request.body.event:isset = false && @request.body.kind:isset = false` |
| `offers` | supprimer | `@request.auth.id != "" && (owner.user = @request.auth.id \|\| @request.auth.role = "admin")` |
| `offer_members` | lire, lister | `@request.auth.id != ""` |
| `offer_members` | créer | `@request.auth.id != "" && (runner.user = @request.auth.id \|\| offer.owner.user = @request.auth.id \|\| @request.auth.role = "admin")` ; `added_by` fixé par un hook de requête |
| `offer_members` | modifier | personne (`null`) |
| `offer_members` | supprimer | même règle que la création |

Autrement dit : on prend une place pour soi, le propriétaire place qui il veut dans son offre, et chacun peut libérer sa place. Personne d'autre ne place quelqu'un dans la voiture d'un autre.

**Hooks de modèle** :

- **Offre** :
  - voiture : `seats` de 1 à 8, sinon `offer_seats_required` ; `end_date` et `url` sont vidés ;
  - logement : `time` est vidé ;
  - `end_date` ≥ `date` (`end_before_start`), `time` de la forme `HH:MM` (`time_invalid`) ;
  - à la modification, `seats` ne descend pas sous le nombre de places prises (`offer_seats_below_members`) ;
  - **une offre de chaque sorte par coureur et par événement** : le propriétaire ne doit pas déjà avoir une offre de la même sorte pour cet événement, ni une place dans une autre (`offer_already_member`).
- **Place** :
  - le propriétaire ne prend pas de place dans sa propre offre (`offer_owner_member`) ;
  - s'il y a une limite, l'offre ne doit pas être pleine (`offer_full`) ;
  - le coureur ne doit pas déjà avoir une place, ni posséder une offre, de la même sorte dans le même événement (`offer_already_member`).
- Ces contrôles lisent puis écrivent sans verrou : deux membres qui prennent la dernière place à la même seconde peuvent tous deux l'obtenir. Pour une quinzaine de personnes, on l'accepte (la fiche montre alors « 4 places sur 3 », et le propriétaire retire quelqu'un).

### 4.5 Coureurs

- Une place (`offer_members.runner`) part avec son coureur (cascade).
- Un commentaire ou une offre n'appartient qu'à un coureur qui a un compte, et un tel coureur ne se supprime pas (décision 20 du registre). La relation, sans cascade, protège les autres cas.

### 4.6 Fusions

- **`merge-events`** : les commentaires et les offres de l'événement fusionné passent sur l'événement gardé (compteurs `movedComments` et `movedOffers`, dans l'aperçu comme dans le résultat). Les places suivent leur offre. La règle « une offre de chaque sorte par coureur et par événement » ne vaut qu'à l'écriture d'une offre ou d'une place : après une fusion, un coureur peut se retrouver dans deux voitures, et l'admin fait le ménage.
- **`merge-formats`** : inchangée.

### 4.7 Matrice (§ 6.1 de la spec v1, lignes ajoutées)

| Action | Membre | Admin |
|---|---|---|
| Se dire supporteur d'un événement | ✓ (confirmé) | ✓ |
| Dire quelqu'un d'autre supporteur | ✓ (non confirmé) | ✓ |
| Écrire un commentaire | ✓ | ✓ |
| Modifier un commentaire | le sien | le sien |
| Supprimer un commentaire | le sien | ✓ (tous) |
| Proposer une voiture ou un logement | ✓ (une de chaque sorte par événement) | ✓ |
| Modifier ou supprimer une offre | la sienne | ✓ (toutes) |
| Prendre ou libérer une place | pour soi | ✓ |
| Placer ou retirer quelqu'un dans une offre | dans la sienne | ✓ |

## 5. Écrans (delta)

### Nom du site

« Prends ton dossard » partout où la v1 disait « Courses » : en-tête, `<title>`, page de connexion, message de partage d'une invitation, README. Le nom est le même en anglais. Le nom technique (module Go `courses`, service Docker `courses`) ne change pas.

### Créer ou modifier un événement

- **Date limite d'inscription** (date, facultative), à côté du lien d'inscription.
- Pour chaque épreuve, **Prix (€)** : nombre, facultatif, `inputmode="decimal"`, au centime près.

### Cartes (liste, agenda, « Bientôt dans le groupe »)

- Le prix s'ajoute aux caractéristiques de l'épreuve (« Trail 42 km · 2 400 m D+ · 65 € »), formaté par `Intl.NumberFormat` (`style: "currency"`, `currency: "EUR"`, sans décimales quand le prix est rond).
- Une ligne **« Inscriptions jusqu'au sam. 14 juin »** tant que la date limite n'est pas passée, **« Inscriptions closes »** quand elle est passée et que l'événement est à venir.
- Les supporteurs ont leurs pastilles sur une ligne **« Supporteurs »**, après les épreuves. Le texte le dit, jamais la couleur seule.

### Fiche d'un événement

Dans l'ordre :

1. informations : la date limite, avec « plus que 3 jours » quand il en reste 7 ou moins ; le prix de chaque épreuve ;
2. **encadré de rappel**, si j'ai une participation `interested` (à une épreuve ou à l'événement) et que la date limite n'est pas passée : « Pense à t'inscrire avant le sam. 14 juin », avec le bouton **S'inscrire sur le site officiel** si le lien existe ;
3. « Intéressés, format à choisir », les épreuves (inchangés) ;
4. **« Supporteurs »** : les participations `supporter`, s'il y en a ;
5. « Non partants (n) » (inchangé) ;
6. **« Covoiturage »** et **« Logement »** (ci-dessous) ;
7. **« Commentaires (n) »** (ci-dessous).

### J'y vais et Ajouter quelqu'un

- Un choix **« Je viens encourager »** (« Vient encourager » dans Ajouter quelqu'un) s'ajoute quand le coureur n'a encore aucune participation dans l'événement, **même s'il n'y a qu'une épreuve**. Il crée une participation à l'événement au statut `supporter`. Le champ du statut est désactivé et une phrase le dit, comme pour « Pas encore décidé ».
- Les autres choix sont inchangés.

### Menu d'une participation à l'événement

- Il propose les deux statuts possibles sans épreuve : **Intéressé** et **Supporteur**.
- **« Choisir l'épreuve »**, **Confirmer** et **Retirer** restent.

### Covoiturage et Logement

Deux sections de la fiche, construites de la même façon. Pour chaque offre :

- le propriétaire (photo et nom) ;
- voiture : « Départ de Lyon, Part-Dieu · sam. 14 juin · 6:30 » ; logement : « Gîte des Crêtes · du ven. 13 au dim. 15 juin », avec un lien **Voir l'annonce** si `url` est rempli ;
- les places en texte : « 2 places prises sur 4 » (« 3 personnes, places non précisées » pour un logement sans limite) ;
- les personnes qui ont une place (photo et nom), chacune avec **Retirer** pour elle-même, le propriétaire ou un admin ;
- les notes ;
- actions selon les droits : **Je monte** / **J'y dors** (prendre une place), **Je descends** / **Je n'y dors plus** (libérer la mienne), et pour le propriétaire ou un admin **Ajouter quelqu'un**, **Modifier**, **Supprimer** (confirmation qui nomme les personnes concernées).

Sous la liste, **Proposer une voiture** / **Proposer un logement**, seulement si je n'ai ni offre ni place de cette sorte dans l'événement. Le formulaire est un `<dialog>` : lieu, places, date, heure (voiture) ou date de fin et lien (logement), notes. La date de l'offre est préremplie avec le début de l'événement.

Une section vide affiche « Personne ne propose de voiture pour l'instant. » / « Personne ne propose de logement pour l'instant. ».

### Commentaires

- Du plus ancien au plus récent. Chaque commentaire : photo et nom de l'auteur, date relative (« il y a 2 heures », par `Intl.RelativeTimeFormat`, avec la date complète en `title` et dans un `<time datetime>`), « modifié » si `updated` diffère de `created`, et le texte (`white-space: pre-wrap`).
- L'auteur a **Modifier** (le texte devient un champ, avec Enregistrer et Annuler) et **Supprimer** ; un admin a **Supprimer** sur tous.
- En bas, un champ multiligne et **Envoyer**. Ctrl+Entrée (Cmd+Entrée sur Mac) envoie aussi. Le bouton reste actif pendant l'envoi pour garder le focus, mais un double envoi est ignoré.
- La liste se recharge quand la fenêtre reprend le focus (comportement par défaut de TanStack Query).

### Accueil

Dans l'ordre :

1. « À confirmer » (inchangé) ;
2. **« Inscriptions à faire »** (nouveau) : mes participations `interested`, à une épreuve ou à l'événement, dont l'événement a une date limite qui n'est pas passée. Triées par date limite, puis par nom d'événement. Chaque ligne : l'événement (et l'épreuve s'il y en a une), « avant le sam. 14 juin », le décompte (« dans 5 jours », « aujourd'hui »), **S'inscrire** (lien externe, si `registration_url` existe) et, pour une participation à une épreuve, **Je suis inscrit** (statut `registered`). Le bloc n'apparaît pas s'il est vide ;
3. « Mes prochaines courses » : une participation `supporter` compte, à la date de début de l'événement, avec « Supporteur » ;
4. « Bientôt dans le groupe » (inchangé : les supporteurs ne sont pas des partants) ;
5. **« Derniers commentaires »** (nouveau) : les 5 plus récents, tous événements confondus. Chaque ligne : l'auteur, l'événement (lien vers la fiche), le début du texte (140 caractères au plus, coupé au mot) et la date relative. Le bloc n'apparaît pas s'il n'y a aucun commentaire.

### Filtres

`personne` garde aussi un événement où le coureur est supporteur (ce n'est pas un « Non partant »).

### Admin > Doublons

L'aperçu d'une fusion d'événements donne aussi le nombre de commentaires et d'offres déplacés.

## 6. Codes d'erreur (delta)

Nouveaux codes dans `server/apperr/codes.go`, traduits en français et en anglais :

| Code | FR | EN |
|---|---|---|
| `registration_deadline_after_start` | La date limite d'inscription doit être au plus tard le jour du début. | The registration deadline must be on or before the start day. |
| `price_invalid` | Le prix se donne au centime près. | The price is to the cent at most. |
| `supporter_with_format` | Un supporteur ne court pas d'épreuve. | A supporter does not run a race. |
| `offer_seats_required` | Indique le nombre de places, de 1 à 8. | Give the number of seats, from 1 to 8. |
| `offer_seats_below_members` | Plus de personnes ont déjà une place. | More people already have a seat. |
| `offer_full` | Il n'y a plus de place. | There is no seat left. |
| `offer_owner_member` | Tu proposes déjà ces places. | You are the one offering these places. |
| `offer_already_member` | Cette personne a déjà une place de cette sorte pour cet événement. | This person already has a place of this kind for this event. |
| `time_invalid` | L'heure doit être de la forme 06:30. | The time must look like 06:30. |

Le front connaît aussi les codes de validation PocketBase que les nouveaux champs peuvent renvoyer (texte trop long, nombre hors limites), s'ils ne sont pas déjà dans `POCKETBASE_CODES`.

## 7. Tests à ajouter

- **Serveur** :
  - migrations 9a à 9d : schéma, index, règles, retour arrière puis réapplication ; retour arrière de 9b avec un supporteur ;
  - date limite : forme, après le début refusée, déplacement du début refusé ; prix à trois décimales refusé ;
  - supporteur : création sans épreuve, refus avec une épreuve, passage `interested` ↔ `supporter`, conversion en coureur, rang dans `winner()` ;
  - commentaires : `author` fixé par le serveur, texte vide ou trop long refusé, modification par l'auteur seulement, suppression par l'auteur ou un admin, anonyme refusé partout, cascade à la suppression de l'événement ;
  - offres : `owner` fixé par le serveur, voiture sans places refusée, une offre de chaque sorte par coureur et par événement, places pleines, propriétaire passager refusé, place pour soi ou par le propriétaire, refus pour un tiers, places sous le nombre de passagers refusées, champs vidés selon la sorte, cascades (événement, offre, coureur) ;
  - fusion d'événements : commentaires et offres déplacés, compteurs identiques dans l'aperçu.
- **Front** :
  - formulaire : date limite et prix envoyés, erreurs traduites ;
  - cartes et fiche : prix, ligne des inscriptions (ouvertes, closes), encadré de rappel, section Supporteurs ;
  - accueil : « Inscriptions à faire » (tri, décompte, Je suis inscrit), « Derniers commentaires », supporteur dans « Mes prochaines courses » ;
  - J'y vais et Ajouter quelqu'un : « Je viens encourager », y compris sur un événement à une épreuve ;
  - commentaires : envoi (bouton et Ctrl+Entrée), modification, suppression, droits affichés ;
  - offres : proposer, prendre et libérer une place, ajouter quelqu'un, places pleines, droits affichés.

## 8. Décisions prises pour la v2

- **Pas de notification** : sans email ni service worker, le rappel est un bloc de l'accueil et un encadré de la fiche. Les notifications push sont repoussées avec la PWA (v3).
- **Date limite sur l'événement, prix sur l'épreuve** : la clôture des inscriptions vaut en général pour tout l'événement, le prix change d'une épreuve à l'autre.
- **0 € = non renseigné**, comme les autres nombres de la v1.
- **Supporteur = participation à l'événement** : pas de nouvelle table, l'invariant et la conversion de la v1.1 s'appliquent tels quels.
- **Une table d'offres pour la voiture et le logement** : même mécanique (des places proposées, des personnes qui les prennent), deux présentations.
- **Prendre une place se fait pour soi** ; seul le propriétaire (ou un admin) place quelqu'un d'autre. Contrairement aux participations, il n'y a pas d'ajout « non confirmé » par un tiers : la place engage le conducteur ou l'hôte.
- **Une offre ou une place de chaque sorte par coureur et par événement**, contrôlée à l'écriture seulement.
- **Commentaires en texte brut**, sans liens cliquables ni non-lus ; « Derniers commentaires » sur l'accueil pour les découvrir.
- **Carte** : pas en v2, toujours à trancher.
