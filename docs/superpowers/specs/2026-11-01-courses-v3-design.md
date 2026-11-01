# Prends ton dossard : addendum v3

- **Date** : 2026-11-01
- **Statut** : design écrit en autonomie (l'utilisateur a demandé la v2, la v3 et la v4 « en autonomie », avec un registre des décisions à relire)
- **Auteur** : Guillaume (avec Claude)
- **Base** : la spec v1, les addendums v1.1 et v2. Cet addendum ne décrit que ce qui change. En cas de conflit, le plus récent l'emporte.

## 1. Objectif

La feuille de route de la v3 (§ 2 de la spec v1, complétée par l'utilisateur le 2026-11-01) :

1. les **résultats** (temps, classement) et des **statistiques annuelles** par personne ;
2. une **trace GPX** par épreuve, avec son **profil de dénivelé** en graphique, ou un **lien** vers le parcours (Strava, Garmin…) ;
3. l'**export vers un agenda** (iCal) ;
4. l'**installation sur l'écran d'accueil** du téléphone, comme une appli (PWA).

## 2. Périmètre

### Dans la v3

- Un résultat sur chaque participation terminée ou abandonnée : temps, classement, nombre de classés, note libre.
- Un bloc « Résultats à saisir » sur l'accueil après une course.
- Une page de statistiques par année, et une page par coureur (bilan par année et historique).
- Une trace GPX et un lien de parcours facultatifs par épreuve ; sur la fiche, le tracé, le profil de dénivelé et ses chiffres.
- Un lien d'abonnement d'agenda personnel (mes courses et les dates limites qui me concernent), et un fichier `.ics` à télécharger pour un événement.
- Le site installable : manifeste, icônes, service worker, aide à l'installation dans le profil.

### Hors v3

- **Carte** (fond de carte, OpenStreetMap…) : toujours à trancher. Le tracé GPX est dessiné seul, sans fond.
- **Notifications push** : à trancher ; elles demandent des clés VAPID, une dépendance Go et le stockage des abonnements.
- **Import automatique** des résultats ou des activités (Strava, sites de chronométrage).
- **Classements par catégorie**, temps intermédiaires, records personnels.
- Modification de la trace dans le site (on envoie un fichier, c'est tout).

## 3. Modèle de données (delta)

### `participations`

| Champ | Type | Règles |
|---|---|---|
| `finish_time_s` (**nouveau**) | nombre entier | facultatif, ≥ 0 (0 = non renseigné) ; temps final en secondes ; seulement au statut `finished` |
| `rank` (**nouveau**) | nombre entier | facultatif, ≥ 0 ; classement général ; seulement au statut `finished` |
| `rank_of` (**nouveau**) | nombre entier | facultatif, ≥ 0 ; nombre de classés ; seulement au statut `finished` ; `rank ≤ rank_of` quand les deux sont donnés (`rank_above_total`) |
| `result_note` (**nouveau**) | texte | facultatif, 200 caractères au plus ; aux statuts `finished` et `dnf` (« 3e V1H », « abandon au km 30 », « 12 boucles ») |

Un résultat n'a de sens qu'avec le bon statut : quand le statut change, le serveur **efface** les champs qui ne s'appliquent plus (plutôt que de refuser l'écriture).

### `formats`

| Champ | Type | Règles |
|---|---|---|
| `gpx` (**nouveau**) | fichier | facultatif, un seul, 10 Mo au plus ; types `application/gpx+xml`, `application/xml`, `text/xml` ; **non protégé** (même raison que la photo d'un coureur, § 3 de l'addendum v1.1) |
| `route_url` (**nouveau**) | URL | facultatif ; lien vers le parcours (Strava, Garmin, site de la course) |

### `calendar_feeds` (nouvelle table)

| Champ | Type | Règles |
|---|---|---|
| `user` | relation → `users` | obligatoire, unique, suppression en cascade |
| `token_hash` | texte | obligatoire ; SHA-256 du jeton, en hexadécimal ; caché (`Hidden`) |
| `lang` | choix `fr` \| `en` | obligatoire ; langue des textes du flux |

Toutes les règles d'accès sont `null` : seules les routes sur mesure (§ 6) la lisent et l'écrivent.

### Migrations

| Fichier | Contenu |
|---|---|
| `9e_results.go` | les quatre champs de résultat |
| `9f_format_route.go` | `formats.gpx`, `formats.route_url` |
| `9g_calendar_feeds.go` | table `calendar_feeds` |

## 4. Règles et hooks (delta)

- **Résultats** (hook de modèle `OnRecordValidate("participations")`, avant `e.Next()`) :
  - statut autre que `finished` : `finish_time_s`, `rank` et `rank_of` remis à 0 ;
  - statut autre que `finished` et `dnf` : `result_note` vidé ;
  - après la validation système : `rank > rank_of > 0` → `rank_above_total` sur `rank`.
- Les règles d'accès des participations ne changent pas : saisir un résultat, c'est modifier la participation (la sienne, ou une non confirmée, ou n'importe laquelle pour un admin). Un résultat saisi par la personne concernée confirme sa participation, comme toute modification de sa part.
- **Trace** : la règle de modification des épreuves ne change pas (tout membre connecté). La garde `@request.body.event:isset = false` reste.

## 5. Écrans (delta)

### Saisir un résultat

- Dans le menu d'une participation à une épreuve : **« Saisir le résultat »** (ou « Modifier le résultat » s'il y en a un), pour qui peut modifier la participation.
- Un `<dialog>` : statut (**Terminé** ou **Abandon**), temps (heures, minutes, secondes), classement « sur » nombre de classés, note. Temps et classement ne sont proposés que pour Terminé.
- Sur la fiche, une ligne terminée affiche « Terminé · 4 h 12 min 30 s · 12e sur 340 » (temps par `Intl.DurationFormat`, rang par `Intl.PluralRules` ordinal), puis la note.

### Accueil : « Résultats à saisir »

- Mes participations **inscrites** (`registered`) à une épreuve dont la date effective est passée, depuis 60 jours au plus.
- Chaque ligne : l'événement, l'épreuve, la date, et trois boutons : **J'ai fini** (ouvre le dialogue de résultat, statut Terminé), **Abandon** (statut `dnf`), **Pas parti** (statut `dns`).
- Le bloc vient juste après « À confirmer » ; il n'apparaît pas s'il est vide.

### Statistiques

- **`/stats?annee=2026`** (l'année en cours par défaut ; des flèches pour changer d'année, l'année dans l'URL) : un tableau des coureurs qui ont au moins un résultat cette année-là, avec, pour chacun : courses terminées, abandons, kilomètres, D+, temps cumulé. Trié par kilomètres, puis par nom. Le nom mène à la page du coureur.
- **`/coureurs/:id`** : photo et nom, puis **« À venir »** (ses prochaines participations, comme « Mes prochaines courses ») et **« Bilan par année »** (une ligne par année avec les mêmes totaux), puis **« Historique »** (participations terminées ou abandonnées, de la plus récente à la plus ancienne, avec le résultat).
- Comptage : une course terminée compte sa distance (`distance_km`), son D+ (`elevation_gain_m`) et son temps (`finish_time_s`) quand ils sont renseignés ; un abandon ne compte que dans « abandons ». L'année est celle de la date effective de l'épreuve.
- **Accès** : un lien **« Statistiques »** dans la page Profil et en haut de la liste en vue « passées » ; les noms des coureurs sur la fiche mènent à leur page. Pas d'onglet de plus : la barre du bas reste à cinq onglets au plus (la navigation sera revue en v4).

### Trace et parcours

- **Formulaire** : dans chaque épreuve, **« Trace GPX »** (un champ fichier `accept=".gpx,application/gpx+xml"`), **« Retirer la trace »** s'il y en a une, et **« Lien du parcours »** (URL).
  - Dès qu'un fichier est choisi, le navigateur le lit : s'il n'y a pas de trace exploitable, un message le dit. Sinon, il affiche sa distance et son D+, avec **« Reprendre ces valeurs »**, qui remplit la distance et le D+ de l'épreuve.
  - L'envoi : l'événement et ses épreuves sont enregistrés comme avant (lot), puis chaque trace nouvelle ou retirée est envoyée par une modification de son épreuve. Si un envoi échoue, l'événement reste enregistré et un message dit quelle trace n'est pas passée.
- **Fiche** : dans chaque épreuve qui a une trace, une partie **« Parcours »** :
  - les chiffres : distance, D+, D−, altitude minimale et maximale ;
  - le **tracé**, dessiné en SVG (projection plane centrée sur la trace, nord en haut), avec le départ et l'arrivée marqués ;
  - le **profil de dénivelé** : altitude selon la distance, en SVG, avec des graduations en kilomètres et en mètres ;
  - **« Télécharger la trace »** (le fichier), et **« Voir le parcours »** si `route_url` est rempli (sans trace, ce lien s'affiche seul).
- **Lecture d'un GPX** (dans le navigateur, `DOMParser`) : les points `trkpt`, ou à défaut `rtept` ; la distance par la formule de haversine ; le D+ et le D− avec un seuil d'hystérésis de 3 m (une montée ne compte qu'à partir de 3 m au-dessus du dernier creux), pour ne pas additionner le bruit du GPS. Une trace sans altitude n'a pas de profil (les autres chiffres restent).
- Pour l'affichage, la trace est réduite à 1 000 points au plus.
- Accessibilité : chaque dessin a un `role="img"` et un `aria-label` qui résume les chiffres ; les couleurs ne portent aucune information seules.

### Agenda

- **Profil, section « Agenda »** :
  - sans lien : **« Créer mon lien d'agenda »** ;
  - à la création, le lien s'affiche une fois, avec **« Copier »** et l'aide « Ajoute-le comme abonnement dans ton agenda (Google Agenda, Apple Calendrier, Outlook). » ; il n'est plus montré ensuite, puisque le serveur ne garde que son empreinte ;
  - avec un lien : **« Nouveau lien »** (l'ancien cesse de marcher) et **« Supprimer le lien »**.
- **Contenu du flux** (une journée entière par entrée, `VALUE=DATE`) :
  - chaque participation de mon coureur, sauf « Non partant » : à une épreuve, le jour de l'épreuve, titre « Trail des Crêtes · Trail 42 km » ; à l'événement (intéressé, supporteur), les jours de l'événement, titre « Trail des Crêtes » ; la description donne le statut, et l'adresse de la fiche ;
  - pour chaque événement où j'ai une participation « Intéressé » avec une date limite : « Clôture des inscriptions · Trail des Crêtes », ce jour-là ;
  - les identifiants (`UID`) sont stables, pour que l'agenda mette à jour sans doublon ;
  - textes en français ou en anglais, selon la langue du navigateur qui a créé le lien.
- **Fiche d'un événement** : **« Ajouter à mon agenda »** télécharge un fichier `.ics` de l'événement (ses jours), fait dans le navigateur.

### Installer l'appli (PWA)

- `manifest.webmanifest` : nom « Prends ton dossard », nom court « Dossard », `display: standalone`, `start_url: /`, couleurs, icônes PNG 192 et 512 (dont une « maskable ») ; `apple-touch-icon` 180 pour l'iPhone.
- **Icônes** : un pictogramme simple de dossard, généré par un petit programme Go (`go run ./tools/icons`), sans dépendance ; le vrai dessin viendra avec la v4.
- **Service worker** (`/sw.js`, écrit à la main, enregistré seulement en production) :
  - pages : le réseau d'abord, la dernière `index.html` gardée en cache si le réseau manque ;
  - `/assets/*` (noms avec empreinte) : le cache d'abord ;
  - tout le reste, dont `/api/` : jamais mis en cache, toujours le réseau ;
  - à l'activation, les anciens caches sont supprimés.
- **Serveur** : `sw.js` avec `Cache-Control: no-cache`, `manifest.webmanifest` avec le type `application/manifest+json`.
- **Profil, section « Application »** : **« Installer »** quand le navigateur le propose (`beforeinstallprompt`) ; sur iPhone, une phrase explique « Partager, puis Sur l'écran d'accueil » ; rien quand le site est déjà installé (`display-mode: standalone`).

## 6. Routes sur mesure (delta)

| Route | Accès | Rôle |
|---|---|---|
| `GET /api/app/calendar` | connecté | `{ "exists": bool }` |
| `POST /api/app/calendar` | connecté | crée ou remplace le lien : corps `{ "lang": "fr" \| "en" }`, réponse `{ "url": "<APP_URL>/api/app/calendar/<jeton>.ics" }` |
| `DELETE /api/app/calendar` | connecté | supprime le lien |
| `GET /api/app/calendar/{token}.ics` | public, par jeton | le flux iCalendar (`text/calendar; charset=utf-8`) ; 404 pour un jeton inconnu |

- Le jeton : 32 octets aléatoires en base64url ; le serveur n'en garde que l'empreinte SHA-256, comme pour les invitations.
- Contrairement aux invitations (décision 11 du registre v1), le jeton est dans l'URL : un agenda ne sait appeler qu'une adresse. La route du flux ne garde pas de trace dans le journal de PocketBase quand elle réussit (`apis.SkipSuccessActivityLog()`), et le jeton ne donne accès qu'à la liste de courses de son propriétaire.
- Limite de requêtes : celle de PocketBase pour `/api/`, comme les autres routes.

## 7. Codes d'erreur (delta)

| Code | FR | EN |
|---|---|---|
| `rank_above_total` | Le classement dépasse le nombre de classés. | The rank is higher than the number of finishers. |

Le front traduit aussi `validation_invalid_mime_type` et `validation_file_size_limit` pour la trace (« Ce fichier n'est pas une trace GPX. », « La trace est trop lourde : 10 Mo maximum. »), en tenant compte du champ (le message de la photo reste pour `avatar`).

## 8. Tests à ajouter

- **Serveur** : migrations 9e à 9g (retour arrière puis réapplication) ; résultats effacés au changement de statut, `rank_above_total`, droits inchangés ; envoi et retrait d'une trace, type refusé, fichier lisible sans jeton ; routes de l'agenda (création, remplacement, suppression, flux par jeton, jeton inconnu, contenu : épreuves, événements, dates limites, « Non partant » absent, UID stables, échappement iCalendar des virgules, points-virgules et retours à la ligne, lignes repliées à 75 octets).
- **Front** : lecture GPX (distance, D+ avec hystérésis, sans altitude, `rtept`, fichier invalide, réduction des points) ; tracé et profil (graduations, `aria-label`) ; formulaire (reprendre les valeurs, envoi après le lot, échec d'un envoi) ; dialogue de résultat ; « Résultats à saisir » ; statistiques (totaux, année, tri, abandon) ; page d'un coureur ; section Agenda (création une fois, copie, nouveau lien, suppression) ; fichier `.ics` d'un événement ; service worker (stratégies par chemin) et section Application.

## 9. Décisions prises pour la v3

- **Résultats sur la participation**, pas dans une table à part : un résultat appartient à une participation, et ses droits suivent.
- **Champs effacés au changement de statut**, plutôt qu'un refus : passer de Terminé à Abandon ne doit pas exiger de vider le temps à la main.
- **Statistiques calculées dans le navigateur** à partir des participations : pour une quinzaine de personnes, inutile d'ajouter des routes ou des vues SQL.
- **Pas d'onglet Statistiques** : un lien depuis le Profil et la liste des courses passées ; la v4 revoit la navigation.
- **Trace lue dans le navigateur**, tracé sans fond de carte, sans dépendance : la carte reste à trancher.
- **Hystérésis de 3 m** pour le D+ : assez pour gommer le bruit d'un GPS, assez fin pour ne pas manquer les petites bosses.
- **Lien d'agenda montré une fois**, empreinte seule côté serveur ; perdu, il se régénère.
- **Service worker écrit à la main** (sans Workbox ni plugin), qui ne met jamais l'API en cache.
- **Notifications push** et **carte** : à trancher, hors v3.
