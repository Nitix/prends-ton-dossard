# « Prends ton dossard » v7 : l'ouverture des inscriptions et ses rappels, et sept autres choses

- **Date** : 2026-11-07
- **Statut** : design écrit d'après les demandes de l'utilisateur, ses réponses et les arbitrages du contrôleur (registre `.superpowers/sdd/2026-11-07-courses-v7/progress.md`). Ce qui reste à trancher est au § 16.
- **Auteur** : Guillaume (avec Claude)
- **Base** : la spec v1 et ses addendums (v1.1 à v6), et la spec du MCP (`2026-11-03-courses-mcp-design.md`). Ce document ne décrit que ce qui s'ajoute. En cas de conflit, il l'emporte.

## 1. Objectif

> « ouverture d'inscription avec rappel optionnel 1j et 1h (configurable) ; courses sans dates précises ; titre de la page ; zoom d+ et carte ; partage via web share api (fait gaffe que c'est dispo firefox c'est non) ; météo ; matériel. […] Déploie une version en dev dans un nouvel environnement sur le serveur pour tester en condition réelle à la fin avant de pouvoir déployer en version finale. »
>
> Puis : « ajoute un flux de calendrier avec toutes les courses où il y a du monde, à faire avant la météo ».

Les réponses de l'utilisateur :

- **Les rappels** : des alarmes dans l'agenda (iCal, `VALARM`) **et** des notifications push ; chacun les règle dans Réglages : 1 jour avant, 1 heure avant, les deux, ou aucun.
- **L'environnement de dev** : avec des données de **test** (le `seed`), pas une copie de la production.

Les arbitrages du contrôleur, suivis ici (et précisés seulement là où ils laissent de la place) :

- push : Web Push (VAPID), un abonnement par appareil dans Réglages ; le serveur envoie J-1 et H-1 avant l'ouverture des inscriptions des courses où la personne a une participation (tout statut sauf `dns`, à préciser) ; sur iPhone, il faut l'appli installée ;
- iCal : un événement « Ouverture des inscriptions » à l'heure de l'ouverture, avec les alarmes des réglages de la personne ;
- partage : `navigator.share` là où il existe ; sinon (Firefox sur ordinateur n'en a pas) copier le texte, et un lien `wa.me`. Le texte : nom, dates, lieu, épreuves, date limite ou ouverture, lien (qui demande toujours de se connecter) ;
- météo : côté serveur, Open-Meteo, avec un cache ; coordonnées du départ d'une trace GPX ou du lieu géocodé ; de J-7 au jour de la course ; aucune donnée personnelle envoyée ;
- matériel : une liste par épreuve (saisie comme l'épreuve), une liste à cocher personnelle et privée ;
- courses au mois : une précision de date jour | mois sur l'événement ; les épreuves sans date alors ; affichée « juin 2027 · date à préciser » ; liste, agenda et iCal au choix du designer ;
- un titre de page par route (WCAG 2.4.2) ;
- zoom : carte avec Ctrl/⌘ + molette (la molette seule fait défiler la page, une aide le dit), deux doigts au toucher ; profil du D+ zoomé sur une portion, avec retour à la vue entière, la carte suit ;
- MCP : ses outils gagnent les nouveaux champs (« le MCP pour tout ») ;
- flux du groupe : toutes les courses avec au moins un participant (pas `dns`), à côté du flux personnel, sur le même modèle de lien secret ; avant la météo ;
- environnement de dev : une instance à part, avec le `seed`, son dossier, son volume, son port, `noindex`, chemins d'admin en 404, MCP actif, sans `DEMO_LOGIN_EMAIL` ; déployé à la fin ; la production seulement après l'accord de l'utilisateur.

**Ordre** (celui du registre) : 1 ouverture et rappels · 2 courses au mois · 3 titres · 4 zoom · 5 partage · 6 flux du groupe · 7 météo · 8 matériel ; les champs du MCP avec chaque fonction ; à la fin, l'environnement de dev.

La v7 est réussie si :

- une course dit quand ses inscriptions ouvrent, à l'heure près, et chacun qui y va est prévenu la veille et/ou une heure avant, sur son téléphone même appli fermée, une seule fois ;
- une course dont on ne connaît que le mois se range sans mentir sur son jour ;
- chaque onglet porte le nom de sa page ;
- la carte et le profil se zooment sans gêner le défilement de la page ;
- une course se partage en deux gestes, Firefox compris ;
- un agenda peut suivre toutes les courses du groupe ;
- la météo des jours de course est là la semaine d'avant, sans rien dire de personne à un service tiers ;
- chacun coche son matériel obligatoire, sans que les autres le voient ;
- l'assistant (MCP) sait tout cela, avec les mêmes garde-fous qu'avant ;
- tout se teste d'abord sur `dev-prends-ton-dossard.ketra.fr`.

## 2. Périmètre

### Dans cette version

1. L'ouverture des inscriptions (jour et heure) sur une course, ses rappels : choix dans Réglages, alarmes dans le flux d'agenda, notifications Web Push, planificateur.
2. Les courses dont seul le mois est connu.
3. Le titre de chaque page.
4. Le zoom de la carte (Ctrl/⌘ + molette, deux doigts) et du profil du D+ (une portion, la carte suit).
5. Le partage d'une course (Web Share, sinon copier et WhatsApp).
6. Le flux d'agenda du groupe.
7. La météo des jours de course.
8. Le matériel obligatoire d'une épreuve et la liste à cocher de chacun.
9. Les champs et outils du MCP pour tout cela (§ 12).
10. L'environnement de dev (§ 13).

Sept migrations : `9l` à `9r` (règle de nommage de `server/migrations/doc.go`). Aucune dépendance nouvelle, ni en Go ni côté web : le chiffrement de Web Push est écrit sur la bibliothèque standard de Go (§ 4.5.1).

### Hors de cette version

Voir § 15.

## 3. L'ouverture des inscriptions, avec son heure

> « Beaucoup de courses sont complètes en quelques heures. » (`docs/TODO.md`)

### 3.1 Données (migration `9l_registration_opening.go`)

| Collection | Champ | Type | Sens |
|---|---|---|---|
| `events` | `registration_opening` | texte `AAAA-MM-JJ`, facultatif | le jour où les inscriptions ouvrent |
| `events` | `registration_opening_time` | texte `HH:MM`, facultatif | l'heure de l'ouverture, à l'heure de Paris |

- Comme `registration_deadline` (9a) et l'heure d'une offre (`offers.time`, 9d) : des dates civiles en texte, l'heure de Paris, jamais d'UTC dans la base.
- Les règles d'accès ne changent pas : tout membre modifie une course.
- Retour arrière : les deux champs disparaissent, avec leurs valeurs.

### 3.2 Règles (hook de modèle de `server/events`)

Dans `validateEvent`, après la date limite :

- `registration_opening` : un vrai jour (`date_invalid`), au plus tard le premier jour de la course (`registration_opening_after_start`), et au plus tard la date limite s'il y en a une (`registration_opening_after_deadline`) ; le même jour est permis.
- `registration_opening_time` : `HH:MM` de `00:00` à `23:59` (`time_invalid`, le code des offres) ; une heure sans jour est refusée (`validation_required` sur `registration_opening`).
- Pour une course au mois (§ 5), « le premier jour de la course » devient le dernier jour de son mois, pour la date limite comme pour l'ouverture.

**L'instant de l'ouverture** (`events.OpeningInstant(day, time)`) : le jour et l'heure à Paris, convertis en instant par `time.Date(…, Europe/Paris)` (la base de fuseaux est dans le programme, `time/tzdata`). **Sans heure, le site compte 9 h.** Une heure qui n'existe pas (le passage à l'heure d'été, 2 h 30 un dernier dimanche de mars) est normalisée par Go (3 h 30) : un test le fixe.

### 3.3 Ce que le site en dit

`registrationState` (`features/events/registration.ts`) gagne deux états, avant les deux qui existent :

| État | Quand | Fiche (haut de page) | Carte de la liste |
|---|---|---|---|
| `soon` | l'ouverture est après aujourd'hui | « Ouverture des inscriptions le lun. 12 janv. à 10:00 » (sans heure : « … le lun. 12 janv. ») | « Ouverture le 12 janv. à 10:00 » |
| `today` | l'ouverture est aujourd'hui | « Ouverture des inscriptions aujourd'hui à 10:00 » (sans heure : « … aujourd'hui ») | « Ouverture aujourd'hui à 10:00 » |
| `open` | comme avant : date limite aujourd'hui ou après, ouverture passée ou absente | « Inscriptions jusqu'au … » | idem |
| `closed` | comme avant | « Inscriptions closes » | idem |

- Avec une date limite, la fiche ajoute « · jusqu'au dim. 31 mai » après l'ouverture.
- L'état se calcule au jour près (`useToday`) : le jour de l'ouverture, la ligne dit « aujourd'hui à 10:00 » toute la journée, avant comme après 10 h. C'est vrai, et cela évite une horloge à la minute dans la page.
- Sans date limite et sans ouverture à venir : rien, comme aujourd'hui.
- **La fiche d'une course** où l'on est « Intéressé » montre déjà un encadré « inscris-toi avant… » ; en `soon` et `today`, il dit « Les inscriptions ouvrent le lun. 12 janv. à 10:00. », avec le lien d'inscription.
- **Accueil, « Inscriptions à faire »** (`registrationTodo.ts`) : les participations « Intéressé » d'une course en `soon` ou `today` y sont aussi, rangées par le jour qui compte (l'ouverture, sinon la date limite) : « ouvre le lun. 12 janv. à 10:00 », « ouvre demain à 10:00 », « ouvre aujourd'hui à 10:00 ». Avant le jour de l'ouverture, la ligne n'a pas « Je suis inscrit » (on ne peut pas encore l'être), seulement le lien d'inscription s'il existe ; le jour même, elle a les deux.
- **Le fichier `.ics` d'une course** (« Ajouter à l'agenda ») gagne un second `VEVENT` pour l'ouverture, avec les alarmes de la personne (§ 4.4).

### 3.4 Formulaire

Sous « Date limite d'inscription » :

- « Ouverture des inscriptions » : un champ date ;
- « Heure d'ouverture » : un champ heure (`type="time"`), avec l'aide « Facultative, à l'heure de Paris. ». Il n'est actif qu'avec un jour ; vider le jour vide l'heure (le brouillon garde ce qui est tapé jusqu'à l'envoi).
- Les erreurs du serveur s'affichent sous leur champ (codes du § 14).

### 3.5 Accessibilité

- Les états se disent en mots, jamais par la seule couleur (la pastille `soon` a son propre texte).
- Les deux champs ont leur étiquette ; l'heure est décrite par son aide (`aria-describedby`).

### 3.6 Tests

- Go : `TestEvents_RegistrationOpening` (jour faux, après le début, après la date limite, le même jour que la date limite, heure sans jour, heure fausse, course au mois) ; `TestOpeningInstant` (été, hiver, sans heure → 9 h, l'heure qui n'existe pas) ; migration 9l (retour arrière puis réapplication).
- Web : `registrationState — ouverture demain, aujourd'hui, passée` ; `todosOf — une ouverture à venir est une inscription à faire, rangée par son jour` ; `EventForm — l'heure d'ouverture demande un jour` ; `EventHero — l'ouverture et la date limite sur une ligne` ; `EventCard — la pastille d'ouverture` ; `RegistrationTodoBlock — avant l'ouverture, pas de « Je suis inscrit »` ; `eventIcs — l'ouverture est un second événement`.
- Portages du MCP : `registration.ts` et `registrationTodo.ts` sont portés en Go (`home.go`) ; leurs nouveaux cas le sont aussi, et leurs empreintes changent dans `TestPorts_TheTypeScriptHasNotChanged`.

## 4. Les rappels

### 4.1 Le choix de chacun (migration `9m_user_reminders.go`)

- `users.reminders` : choix multiple, valeurs `day` (1 jour avant) et `hour` (1 heure avant), au plus deux. **Vide par défaut : aucun rappel** tant que la personne ne choisit pas.
- **Un seul réglage pour les deux canaux** : les alarmes du flux d'agenda (§ 4.4) et les notifications (§ 4.5) suivent le même choix. Les notifications demandent en plus d'activer un appareil.
- La règle de modification de `users` (9j) gagne, dans sa clause d'admin, `@request.body.reminders:isset = false` : un admin ne change pas les rappels d'un autre. La clause du propriétaire ne change pas.
- **Routes** (`server/reminders`, session du site requise, absentes sur la démo) :
  - `GET /api/app/me/reminders` → `{ "reminders": ["day", "hour"] }` ;
  - `PUT /api/app/me/reminders`, corps `{ "reminders": [...] }` → la même réponse. Une valeur inconnue : `400` avec le code de PocketBase sur `reminders`. L'ordre et les doublons ne comptent pas : le serveur garde `day` puis `hour`.
  - Le site et l'outil `reminders` du MCP (§ 12.2) passent par ces routes, jamais par la collection `users`.

**Réglages → « Rappels »** (nouvelle section, avant « Agenda ») :

- Titre : « Rappels ».
- Introduction : « Avant l'ouverture des inscriptions des courses où tu es intéressé ou inscrit. »
- Un groupe de boutons radio, légende « Me prévenir » : « 1 jour avant », « 1 heure avant », « 1 jour et 1 heure avant », « Jamais ». Le choix s'enregistre dès qu'il change (comme le thème), puis « Rappels enregistrés. » dans une ligne `role="status"` ; un refus remet l'ancien choix et l'écrit en `role="alert"`.
- Sous le choix : « Sans heure d'ouverture connue, « 1 jour avant » arrive la veille à 9 h et « 1 heure avant » le jour même à 8 h. »
- « Où ils arrivent » : « En notification sur les appareils activés ci-dessous, et en alarme dans ton agenda abonné (section « Agenda »). Google Agenda et Outlook ignorent souvent les alarmes d'un agenda abonné : les notifications sont plus sûres. »
- Puis la sous-section « Notifications sur cet appareil » (§ 4.5.6).

### 4.2 Qui reçoit un rappel

Pour une course qui a une ouverture, une personne reçoit ses rappels si :

- son coureur a, sur cette course, une participation **« Intéressé » ou « Inscrit »** (sur une épreuve ou sur la course seule) ;
- son compte n'est pas désactivé ;
- son choix (§ 4.1) contient ce rappel.

Précision de l'arbitrage « tout statut sauf `dns` » : un **supporteur** ne s'inscrit pas, il n'a pas de rappel ; « Terminé » et « Abandon » n'existent pas avant la course. « Inscrit » est gardé : avant l'ouverture, ce statut dit une intention ou une préinscription (on ne peut pas encore être vraiment inscrit), et le rappel reste utile. Plusieurs participations sur la même course (deux épreuves) donnent **un** rappel. Un coureur sans compte n'en a pas.

La même règle choisit les ouvertures du flux d'agenda personnel (§ 4.4).

### 4.3 Quand

Soit `T` l'instant de l'ouverture (§ 3.2 ; 9 h sans heure).

- **« 1 heure avant »** est dû de `T − 1 h` à `T`.
- **« 1 jour avant »** est dû de **la veille à la même heure de Paris que `T`** (la même heure sur l'horloge de Paris : 23 h ou 25 h avant `T` les deux nuits du changement d'heure, et non `T − 24 h`) à `T`, sauf quand « 1 heure avant » est dû et choisi : la personne ne reçoit alors que le rappel d'une heure (deux notifications en une heure seraient de trop).
- Après `T`, plus rien : les inscriptions sont ouvertes.
- Le texte dit ce qui reste, à l'heure de l'envoi :
  - plus de 2 heures, la veille : « Les inscriptions ouvrent demain à 10:00. » ;
  - plus de 2 heures, le jour même : « Les inscriptions ouvrent aujourd'hui à 10:00. » ;
  - 2 heures ou moins : « Les inscriptions ouvrent à 10:00, dans 45 min. » ;
  - sans heure connue : « Les inscriptions ouvrent demain. », « Les inscriptions ouvrent aujourd'hui. ».
  - En anglais : « Registration opens tomorrow at 10:00. », « … today at 10:00. », « … at 10:00, in 45 min. », « … tomorrow. », « … today. ».

Une course créée, une ouverture ajoutée ou une participation prise **pendant** une fenêtre donne son rappel au passage suivant du planificateur (au plus une minute après), avec le texte de ce moment.

### 4.4 Dans l'agenda : les alarmes (`VALARM`)

**Le flux personnel** (`server/calendar`, v3) gagne, pour chaque course qui a une ouverture et où la personne a une participation qui compte (§ 4.2) :

- un `VEVENT`, `UID:opening-<événement>-<coureur>@prends-ton-dossard` (stable : il suit l'ouverture si elle change) ;
- `SUMMARY` : « Ouverture des inscriptions · Trail des Crêtes » (« Registration opens · … » pour un lien en anglais) ;
- **avec une heure** : `DTSTART:20270112T090000Z` (l'instant en UTC, qui se passe de `VTIMEZONE`), `DTEND` 30 minutes plus tard ;
- **sans heure** : un jour entier (`DTSTART;VALUE=DATE`) ;
- `DESCRIPTION` : le lien d'inscription s'il y en a un, puis l'adresse de la course ; `URL` : l'adresse de la course ;
- une alarme par rappel choisi, `ACTION:DISPLAY`, `DESCRIPTION` = le `SUMMARY` :
  - avec une heure : « 1 jour avant » `TRIGGER:-P1D`, « 1 heure avant » `TRIGGER:-PT1H` ;
  - sans heure (début du jour, à l'heure locale de l'agenda) : `TRIGGER:-PT15H` (la veille à 9 h) et `TRIGGER:PT8H` (le jour même à 8 h), les mêmes moments que les notifications ;
- les ouvertures passées restent, comme les dates limites.

Le calendrier entier gagne `REFRESH-INTERVAL;VALUE=DURATION:PT1H` et `X-PUBLISHED-TTL:PT1H` : les applis qui les lisent (Apple Calendrier) reprennent le flux toutes les heures, et une ouverture ajoutée la veille y arrive à temps.

**Le fichier d'une course** (bouton « Ajouter à l'agenda », fabriqué dans le navigateur) porte les mêmes alarmes, d'après le choix de la personne (lu par `GET /api/app/me/reminders` ; aucune alarme si la lecture échoue ou sur la démo). Un fichier **importé** garde ses alarmes là où un abonnement les perd.

**Ce que font les agendas** (vérifié le 2026-11-07, voir § 16, « Vérifié ») :

- Apple Calendrier sur Mac demande, à l'abonnement, s'il faut « supprimer les alertes » (coché par défaut) : il faut le décocher. Sur iPhone, à vérifier pendant la recette.
- Google Agenda et Outlook ignorent les alarmes d'un calendrier abonné (rapports d'utilisateurs, pas de documentation officielle), et Google relit un abonnement rarement (jusqu'à un jour).
- D'où la phrase de Réglages (§ 4.1) : les notifications sont le canal sûr.

### 4.5 Les notifications (Web Push)

#### 4.5.1 Comment ça marche

- Les standards : **Push API** côté navigateur, et côté serveur RFC 8030 (le protocole), RFC 8291 (le chiffrement `aes128gcm` du message) et RFC 8292 (l'identification du serveur, VAPID).
- Le navigateur donne un **abonnement** : une adresse (`endpoint`) chez le service push de son éditeur (Google pour Chrome, Edge et Android ; Mozilla pour Firefox ; Apple pour Safari ; Microsoft pour une partie d'Edge) et deux clés (`p256dh`, `auth`).
- Le serveur chiffre le message pour ces clés et le poste à l'adresse, avec un jeton signé de sa clé VAPID. **Le service push ne lit pas le message** : il voit l'adresse, la taille, l'heure, et la durée de vie demandée.
- **Paquet `server/push`, sur la bibliothèque standard** : `crypto/ecdh` (P-256), `crypto/hkdf` (Go 1.24 et plus), `crypto/aes` + `cipher.NewGCM`, `crypto/ecdsa` (ES256 du jeton VAPID). Pas de `webpush-go` : le chiffrement tient en une centaine de lignes, vérifiées par l'exemple de l'annexe A de la RFC 8291 (clés, sel et résultat attendus).
- Le message chiffré est un JSON : `{ "title", "body", "url", "tag" }` (`url` est un chemin du site, `/evenements/<id>` ; `tag` est `opening-<id>`). Le nom de la course, saisi par un membre, n'en sort que chiffré.
- En-têtes de l'envoi : `TTL` = les secondes jusqu'à `T` (60 au moins) ; `Urgency: high` pour « 1 heure avant », `normal` pour « 1 jour avant » ; `Topic: opening-<id>` (le service remplace un rappel pas encore livré par le suivant de la même course) ; `Content-Encoding: aes128gcm`.
- Le jeton VAPID : `aud` = l'origine de l'adresse, `exp` = maintenant + 1 heure (la durée la plus courte demandée par les services), `sub` = `PUSH_CONTACT` s'il est réglé, sinon `APP_URL` quand elle est en `https`, sinon `mailto:push@example.invalid` (en local).

#### 4.5.2 Les clés VAPID

- **Générées une fois, au premier démarrage du programme (`serve`)**, et gardées dans le dossier des données : `<pb_data>/push_vapid.json` (`{ "publicKey", "privateKey", "created" }`, base64url ; droits `0600`).
- **Jamais dans le dépôt** : `pb_data/` est dans `.gitignore` et `.dockerignore`. Jamais dans une variable d'environnement, un journal, une réponse ou un message d'erreur ; seule la clé publique sort (`GET /api/app/push`).
- **Sauvegardées avec les données** : le volume `pb_data` (sauvegarde avant chaque déploiement) et les sauvegardes de PocketBase, qui copient tout le dossier sauf `backups`. Restaurer une sauvegarde rend les clés **et** les abonnements qui vont avec.
- **Jamais régénérées d'elles-mêmes** : un fichier présent mais illisible n'est pas remplacé (cela casserait tous les abonnements sans le dire) ; le programme le journalise, et les notifications sont indisponibles (`push_unavailable`) jusqu'à ce qu'on le répare ou le supprime.
- **Changer de clés** : arrêter le conteneur, supprimer le fichier, redémarrer. Chaque appareil se réabonne de lui-même à la prochaine ouverture du site (§ 4.5.6). Le README le dit.
- Chaque instance a les siennes (production, dev, démo) : elles sont dans son volume.

#### 4.5.3 Un abonnement par appareil (migration `9n_push_subscriptions.go`)

Table `push_subscriptions` :

| Champ | Type | Règles |
|---|---|---|
| `user` | relation → `users` | obligatoire, suppression en cascade |
| `endpoint` | texte | obligatoire, 1 000 caractères au plus, **unique** |
| `p256dh` | texte | obligatoire, caché ; base64url de 65 octets |
| `auth` | texte | obligatoire, caché ; base64url de 16 octets |
| `lang` | choix `fr` \| `en` | obligatoire : la langue des messages |
| `label` | texte, 60 au plus | ce que la page appelle l'appareil (« Firefox sur Windows », « iPhone ») |
| `last_success_at` | date-heure | la dernière livraison acceptée |
| `failures` | entier ≥ 0 | les échecs de suite |
| `created`, `updated` | | |

- Index sur `user`. **Toutes les règles sont `null`** : seules les routes du paquet `push` et le planificateur lisent et écrivent la table (comme `calendar_feeds` et `mcp_tokens`).
- **Dix appareils par compte** au plus : le onzième remplace le plus ancien (par `updated`).
- **Un compte désactivé** perd ses abonnements (hook de modèle sur `users`, comme les jetons MCP).
- **Adresses permises** : `https`, port par défaut, et un hôte de cette liste, sans exception :
  `fcm.googleapis.com`, `updates.push.services.mozilla.com`, `web.push.apple.com` et `*.push.apple.com`, `*.notify.windows.com`. Toute autre adresse est refusée (`push_endpoint_invalid`) : le serveur ne poste jamais vers une adresse choisie par quelqu'un (pas de requête vers le réseau interne). Le client HTTP de l'envoi ne suit pas les redirections.

**Routes** (`server/push`, absentes sur la démo) :

| Route | Rôle |
|---|---|
| `GET /api/app/push` (session) | `{ "available": true, "publicKey": "…", "devices": [{ "id", "label", "created", "lastSuccessAt" }] }`, du plus récent au plus ancien ; jamais une adresse ni une clé d'abonnement. `available: false` (et pas de clé) quand les clés VAPID sont illisibles. |
| `POST /api/app/push/subscriptions` (session) | corps `{ "endpoint", "keys": { "p256dh", "auth" }, "lang", "label" }` → `{ "id" }`. Crée ou met à jour l'abonnement de cette adresse, **au nom de l'appelant** (un appareil qui change de compte change de propriétaire). Clés de mauvaise longueur ou point hors de la courbe : `400` (codes de champ). |
| `DELETE /api/app/push/subscriptions` (session) | corps `{ "endpoint" }` : l'appareil se retire → `204`, même s'il n'y avait rien. |
| `DELETE /api/app/push/subscriptions/{id}` (session) | « Retirer » un autre de ses appareils → `204` ; celui d'un autre : `404`. |
| `POST /api/app/push/renew` (sans session) | le service worker remplace un abonnement que le navigateur a changé : `{ "oldEndpoint", "oldAuth", "endpoint", "keys" }`. Seul celui qui connaît l'ancienne adresse **et** son secret `auth` (comparé en temps constant) le remplace ; sinon `404`. Les limites de requêtes de `/api/` s'appliquent. |
| `POST /api/app/push/test` (session) | envoie « Ceci est un essai : tes rappels arriveront ainsi. » à tous ses appareils → `{ "sent", "failed" }`. Une fois par 30 secondes et par compte (au-delà : `429`). |

#### 4.5.4 iPhone et iPad

- **Web Push n'existe que dans l'appli installée** (« Sur l'écran d'accueil »), **depuis iOS et iPadOS 16.4**, jamais dans un onglet de Safari. Le manifeste a déjà `display: standalone`.
- La permission ne se demande que **sur un geste** (le bouton « Activer sur cet appareil ») : `Notification.requestPermission()` est le premier appel du gestionnaire de clic, avant tout `await`. La clé publique est donc lue avant (avec la section), pas après le clic.
- Les notifications passent par le service push d'Apple (`*.push.apple.com`) ; aucun compte développeur Apple n'est nécessaire.
- Dans un onglet de Safari sur iPhone, la section explique comment installer, au lieu du bouton (§ 4.5.6).
- Safari sur Mac (16 et plus) reçoit les notifications sans installation.

#### 4.5.5 Le service worker

`web/public/sw.js` gagne trois gestionnaires (le cache ne change pas, `ptd-2`) :

- `push` : lit le JSON et montre **toujours** une notification (`userVisibleOnly`) : `showNotification(title, { body, tag, lang, icon: "/icons/icon-192.png", data: { url } })` ; un message illisible donne « Prends ton dossard » sans corps.
- `notificationclick` : ferme la notification, donne le focus à un onglet du site déjà à cette adresse, sinon en ouvre un (`clients.openWindow`) ; seulement une adresse du site (même origine).
- `pushsubscriptionchange` : se réabonne avec la même clé (`oldSubscription.options.applicationServerKey`) et poste `POST /api/app/push/renew` avec l'ancienne adresse et son `auth`. Sans `oldSubscription` (Chrome ne le donne pas toujours), il ne fait rien : la page resynchronise à sa prochaine ouverture.

#### 4.5.6 Réglages : « Notifications sur cet appareil »

Dans la section « Rappels », module `features/push` :

- **Appareil prêt et pas encore activé** : « Activer sur cet appareil » (principal). Le clic demande la permission, abonne l'appareil, l'enregistre, puis « Notifications activées sur cet appareil. ».
- **Activé** : « Désactiver sur cet appareil » (désabonne le navigateur et retire l'abonnement du serveur), et « Envoyer un essai » (« Essai envoyé à 2 appareils. »).
- **Mes appareils** : la liste (`label`, « depuis le 7 nov. », « dernier rappel le … ») avec « Retirer » pour chacun ; celui de cet appareil est marqué « cet appareil ».
- **Si le choix est « Jamais »** : « Choisis d'abord quand être prévenu. » au-dessus du bouton, qui reste utilisable.
- **iPhone ou iPad dans Safari** : « Sur iPhone et iPad, les notifications ne marchent que dans l'appli installée (iOS 16.4 ou plus) : touche Partager, puis « Sur l'écran d'accueil », ouvre l'appli et reviens ici. »
- **Permission refusée** : « Les notifications sont bloquées pour ce site sur cet appareil : autorise-les dans les réglages du navigateur (ou de l'iPhone), puis reviens ici. »
- **Navigateur sans Push API** : « Ce navigateur ne peut pas recevoir de notifications. »
- **Clés indisponibles** (`available: false`) : « Les notifications ne sont pas disponibles pour l'instant. »
- **Synchronisation** : à chaque ouverture du site par une personne connectée, si la permission est accordée et que le navigateur a un abonnement, la page le renvoie (`POST`, idempotent) ; si sa clé n'est plus celle du serveur, elle se réabonne. Une fois par session.
- **Se déconnecter** retire d'abord l'abonnement de cet appareil (`DELETE`, 2 secondes au plus, sans bloquer la déconnexion) puis désabonne le navigateur : sur un appareil partagé, la personne suivante ne reçoit pas les rappels de la précédente.
- Le service worker n'est enregistré qu'en production : avec le serveur de Vite, la section dit « Ce navigateur ne peut pas recevoir de notifications. » (le README dit comment essayer en local).

#### 4.5.7 Permissions, désabonnement, abonnements expirés

| Réponse du service push | Effet |
|---|---|
| `201`, `202`, `200` | livré : `last_success_at`, `failures` remis à 0 |
| `404`, `410` | l'abonnement n'existe plus (appli désinstallée, permission retirée) : **supprimé** |
| `400`, `401`, `403`, `413` | refusé (clé VAPID qui ne correspond plus, message trop gros) : `failures` + 1 |
| `429`, `5xx`, délai dépassé (10 s) | pas livré cette fois : `failures` + 1 |

- À **10 échecs de suite**, l'abonnement est supprimé.
- Un rappel n'est tenté qu'une fois par appareil (§ 4.6) : pas de nouvelle tentative au passage suivant.
- Retirer la permission dans le navigateur rend l'abonnement mort chez le service push : la prochaine livraison reçoit `410`, et il part.
- Le journal du programme dit le nombre de livraisons et d'échecs d'un passage, jamais une adresse, une clé ou un message.

### 4.6 Le planificateur (migration `9o_reminder_deliveries.go`)

**Où** : dans le programme, par le cron de PocketBase (`app.Cron()`, démarré par `serve`, fuseau de Paris réglé par `setup`), tâche `ptd-reminders`, **chaque minute** (`* * * * *`). Un passage qui dure plus d'une minute n'en lance pas un second (`sync.Mutex.TryLock`).

**Quelles courses** : celles dont `registration_opening` est aujourd'hui, demain ou après-demain (à Paris ; filtre par paramètres sur le texte du jour), et dont `T` est dans les prochaines 25 heures (la veille à la même heure de Paris est, au plus, 25 h avant `T`).

**Pour qui** : § 4.2, par personne (compte), une fois par course.

**Sans envoyer deux fois** : table `reminder_deliveries` :

| Champ | Type | Règles |
|---|---|---|
| `user` | relation → `users` | obligatoire, cascade |
| `event` | relation → `events` | obligatoire, cascade |
| `kind` | choix `day` \| `hour` | obligatoire |
| `opening_at` | texte | l'instant `T` en RFC 3339 UTC |
| `delivered` | entier | les appareils qui l'ont reçu |
| `created` | | |

- **Index unique** `(user, event, kind, opening_at)`. Règles `null`.
- Pour chaque rappel dû, le planificateur **insère d'abord la ligne**, puis envoie : si l'insertion échoue sur l'index, le rappel est déjà fait. Au plus une fois, donc : un arrêt du programme entre l'insertion et l'envoi perd ce rappel-là, plutôt que d'en envoyer deux.
- **Une ouverture déplacée** (autre jour ou autre heure) a un autre `opening_at` : ses rappels repartent pour la nouvelle heure.
- Une personne qui n'a **aucun appareil** n'a pas de ligne : il n'y a rien à ne pas renvoyer, et un appareil activé avant `T` reçoit encore le rappel dû.
- Les lignes de plus de 60 jours sont supprimées (au premier passage de chaque heure).

**Après un redémarrage** : chaque fenêtre dure jusqu'à `T` (§ 4.3). Un programme arrêté pendant la fenêtre de « 1 jour avant » (de la veille à la même heure de Paris, § 4.3, à `T`) envoie « 1 jour avant » à son premier passage, s'il est encore avant `T`, avec le texte de ce moment ; arrêté pendant `T − 1 h`, il envoie « 1 heure avant » s'il redémarre avant `T`. Après `T`, rien. Un redémarrage n'efface rien : les lignes sont en base.

**Ce qui écrit** : le paquet `reminders` écrit `reminder_deliveries` ; le paquet `push` met à jour et supprime `push_subscriptions`. Aucun des deux n'écrit ailleurs.

### 4.7 La démo

Sur une instance de démo (`DEMO_LOGIN_EMAIL`), **pas de rappels ni de notifications** : les routes de `server/reminders` et de `server/push` n'existent pas (404), le planificateur ne tourne pas, la section « Rappels » est absente. Le compte est partagé : un visiteur changerait les rappels des autres, et ses appareils recevraient ceux d'inconnus.

### 4.8 Accessibilité

- Le choix est un `<fieldset>` de boutons radio, avec sa `<legend>`, et des cibles de 44 px.
- Les boutons d'activation sont en `aria-disabled` pendant l'attente, avec une garde synchrone, jamais `disabled`.
- Après « Désactiver » ou « Retirer », le focus va au titre de la section (le bouton n'existe plus).
- La notification elle-même est celle du système : son texte se suffit (nom de la course, quand).

### 4.9 Tests

- **Go** :
  - `push` : `TestWebPush_RFC8291Example` (le chiffrement de l'annexe A) ; `TestVAPID_Token` (en-tête, `aud`, `exp`, `sub`, signature vérifiée par la clé publique) ; `TestKeys_CreatedOnceAndKept` (créées au premier appel, relues ensuite, fichier en `0600`, un fichier illisible n'est pas remplacé) ; `TestKeys_NeverLeave` (ni la clé privée ni un `auth` dans une réponse ou dans le journal, au niveau Debug) ; `TestEndpoints_AllowList` (les quatre services ; refusés : `http`, une adresse IP, `localhost`, un autre port, `fcm.googleapis.com.evil.test`, une redirection) ; `TestSender_Outcomes` (chaque ligne du § 4.5.7, contre un faux service push `httptest`) ;
  - routes : création, mise à jour du même appareil, changement de compte, dixième et onzième appareil, `renew` (bon et mauvais `auth`), essai et sa limite, absentes sur la démo, abonnements supprimés à la désactivation ; migration 9n ;
  - `reminders` : `TestReminders_Recipients` (Intéressé, Inscrit, supporteur, non partant, sans compte, compte désactivé, choix vide, deux épreuves de la même course) ; `TestReminders_Windows` (J-1, H-1, les deux choisis à T − 30 min, après T, sans heure → 9 h, passage à l'heure d'été) ; `TestReminders_OncePerOpening` (deux passages, deux programmes simultanés) ; `TestReminders_MovedOpeningRearms` ; `TestReminders_CatchUpAfterRestart` ; `TestReminders_Texts` (fr, en) ; routes `me/reminders` ; migrations 9m et 9o ;
  - flux : `TestCalendarFeed_Openings` (avec et sans heure, alarmes selon le choix, `UID` stable, supporteur sans ouverture, `REFRESH-INTERVAL`).
- **Web** : `RemindersSection` (choix, enregistrement, refus) ; `PushSection` (chaque état du § 4.5.6, la permission demandée avant tout `await`, activer, désactiver, retirer un appareil et le focus, essai) ; `deviceLabel` ; `sw — une notification à chaque push`, `sw — un clic ouvre la course`, `sw — un abonnement changé est renouvelé` ; `logout — retire d'abord l'appareil` ; `eventIcs — les alarmes de la personne`.
- **Sur de vrais appareils** (environnement de dev, § 13) : Chrome sur Android ou ordinateur, Firefox, l'appli installée sur iPhone.

## 5. Les courses dont on ne connaît que le mois

> « Une course sans date précise : donner seulement un mois (« juin 2027 »). » (`docs/TODO.md`)

### 5.1 Données et règles (migration `9p_event_date_precision.go`)

- `events.date_precision` : choix `day` | `month`, facultatif ; vide = `day` (toutes les courses existantes).
- **Une course au mois** a `start_date` = le **1er du mois** et `end_date` = le **dernier jour du mois**. Le serveur pose `end_date` lui-même (hook de modèle, à la création et à la modification, avant la validation) : la fin d'une course au mois ne vient pas de ses épreuves.
- C'est ce qui garde justes, sans autre changement, les filtres du serveur : « à venir » jusqu'à la fin du mois, « passées » après, l'agenda la trouve dans son mois, et la date limite comme l'ouverture peuvent tomber dans le mois.
- **Règles** (`validateEvent`, `validateFormat`) :
  - `start_date` d'une course au mois est un 1er (`month_start_invalid`) ;
  - ses épreuves n'ont **pas de date** (`format_date_month`, sur la date de l'épreuve ; et sur `date_precision` si l'on passe au mois alors qu'une épreuve est datée) ;
  - la date limite et l'ouverture : au plus tard le dernier jour du mois (§ 3.2).
- **Passer d'une précision à l'autre** se fait dans le formulaire, en un envoi : l'ordre du batch (`buildBatch`, porté en Go par `planBatch`) traite une course **au mois comme une course sans jours** pour ses épreuves : vers le mois, les dates des épreuves sont vidées d'abord, puis la course change ; vers le jour, la course change d'abord, puis les épreuves reçoivent leur date. Aucun état intermédiaire refusé.
- « Terminé » et « Abandon » sont permis dès le 1er du mois (le jour de la course est inconnu ; `status_before_race` ne change pas).
- Retour arrière : le champ disparaît ; les courses au mois deviennent des courses du 1er au dernier jour du mois.

### 5.2 Le formulaire

- Sous « Date » : une case « Le jour n'est pas encore connu ». Cochée, le champ date laisse la place à **« Mois »**, une liste déroulante des mois, de 12 mois en arrière à 36 mois en avant (plus le mois enregistré s'il est hors de cet intervalle) : « juin 2027 ». Pas de `<input type="month">` : Firefox et Safari sur ordinateur n'ont pas de sélecteur de mois.
- Les champs de date des épreuves disparaissent, remplacés par une ligne : « Les épreuves auront leur date quand le jour sera connu. » Le brouillon garde ce qui y était tapé (décocher le rend), mais l'envoi les vide.
- La ligne de période dit « juin 2027, date à préciser ».
- Modifier une course au mois en course datée (décocher, choisir un jour) : le formulaire ordinaire.

### 5.3 Où elle se range

**Le texte** : partout où une course dit ses jours, `eventWhen` (nouveau, `features/events/eventWhen.ts`) dit « juin 2027 · date à préciser » (« June 2027 · date to be set »).

| Endroit | Ce qui change |
|---|---|
| Fiche (haut de page) | « juin 2027 · date à préciser » ; pas d'anneau des jours restants |
| Liste | rangée **à la fin de son mois** (après les courses datées du mois, triée par le dernier jour du mois) ; la pastille de date dit le mois abrégé et « ? » à la place du jour, nommée « juin 2027, date à préciser » |
| Agenda | jamais sur un jour de la grille ; au-dessus de la grille du mois, un bloc « Ce mois-ci, date à préciser » qui la liste (lien vers la fiche) ; absent quand il n'y en a pas |
| Accueil, « Mes prochaines courses », « Bientôt dans le groupe », page d'un coureur | la ligne dit « juin 2027 · date à préciser » ; à venir **jusqu'à la fin du mois**, rangée à la fin du mois |
| « Résultats à saisir » | à partir du lendemain du dernier jour du mois |
| Statistiques | l'année du mois (inchangé : le 1er est dans la bonne année) |
| Doublons probables | inchangé (à 30 jours du 1er) |
| Partage (§ 8) | « juin 2027 (date à préciser) » |
| Météo (§ 10) | aucune : pas de jour |

Le jour qui range une course au mois et dit si elle est passée est le **dernier jour du mois** (`lastRaceDay`, `lib/dates.ts`) ; le jour qui dit si elle a pu commencer reste le 1er (`raceStarted`).

### 5.4 Les flux d'agenda

- Une course au mois est **un seul jour entier, le 1er du mois**, dans le flux personnel (une participation à une épreuve comme à la course seule), dans le flux du groupe (§ 9) et dans le fichier d'une course, avec le `SUMMARY` suivi de « (date à préciser) ». Un rappel au début du mois plutôt que rien : on n'oublie pas la course. Son `UID` ne change pas quand le jour est connu : l'agenda la déplace au bon jour.
- Son ouverture et sa date limite, qui ont un jour, restent des événements ordinaires.

### 5.5 Accessibilité

- La case et la liste des mois ont leur étiquette ; la liste reprend la description de la ligne de période.
- La pastille « ? » a son nom en mots (« juin 2027, date à préciser »).
- Le bloc de l'agenda est une `<section>` titrée.

### 5.6 Tests

- Go : `TestEvents_MonthPrecision` (fin posée par le serveur, 1er exigé, épreuve datée refusée, date limite et ouverture dans le mois, passage au mois avec une épreuve datée refusé hors batch) ; `TestPlan_*` (les nouveaux cas de `buildBatch`) ; `TestCalendarFeed_MonthPrecision` ; migration 9p.
- Web : `buildBatch — passer au mois vide d'abord les dates des épreuves`, `buildBatch — passer au jour date les épreuves après la course` ; `eventEndDate — une course au mois finit le dernier jour du mois` ; `EventForm — « Le jour n'est pas encore connu »` ; `eventWhen` ; `sortEvents — une course au mois à la fin de son mois` ; `AgendaPage — le bloc « Ce mois-ci, date à préciser »`, `eventsByDay — une course au mois n'est sur aucun jour` ; `resultsToEnter — une course au mois à partir de la fin du mois` ; `MyUpcoming — une course au mois reste jusqu'à la fin du mois` ; `eventIcs — une course au mois`.

## 6. Le titre de la page

> « Le titre de l'onglet change avec la page : « Trail des Crêtes · Prends ton dossard ». Ça aide aussi les lecteurs d'écran (WCAG 2.4.2). » (`docs/TODO.md`)

- Un crochet `usePageTitle(title: string | null)` (`lib/usePageTitle.ts`) pose `document.title` : « `<titre>` · Prends ton dossard », ou « Prends ton dossard » seul pour `null`. Chaque page l'appelle avec son titre, dans la langue de l'interface ; il change avec les données (le nom de la course arrive) et avec la langue.
- Pas de `<title>` rendu par React (sa remontée dans `<head>` laisserait celui d'`index.html` en premier) ni de `head` de TanStack Router (les pages lisent leurs données par TanStack Query, pas par des `loader`).

| Page | Titre (fr) | Titre (en) |
|---|---|---|
| `/` | Accueil | Home |
| `/liste` | Courses à venir · Courses passées (selon la période) | Upcoming races · Past races |
| `/agenda` | Agenda · juin 2027 (le mois affiché) | Calendar · June 2027 |
| `/stats` | Statistiques 2026 (l'année affichée) | Statistics 2026 |
| `/evenements/nouveau` | Nouvelle course | New race |
| `/evenements/$id` | le nom de la course ; « Course » pendant le chargement ; « Course introuvable » | idem, « Race », « Race not found » |
| `/evenements/$id/modifier` | Modifier · `<nom>` | Edit · `<name>` |
| `/coureurs/$id` | le nom du coureur ; « Coureur » pendant le chargement | idem, « Runner » |
| `/profil`, `/profil/reglages` | Profil, Réglages | Profile, Settings |
| `/admin/membres`, `/admin/types`, `/admin/doublons` | Membres · Admin, Types de course · Admin, Doublons · Admin | Members · Admin, Race types · Admin, Duplicates · Admin |
| `/connexion`, `/invitation` | Connexion, Invitation | Sign in, Invitation |
| toute autre adresse | Page introuvable | Page not found |

- Un nom saisi par un membre va dans `document.title` comme du texte : rien n'y est interprété.
- **Tests** : `usePageTitle` ; un test par route (`routes/titles.test.tsx`) qui ouvre la page avec le routeur de test et lit `document.title`, en français et en anglais, avant et après l'arrivée du nom d'une course.

## 7. Zoomer sur la carte et sur le profil du D+

### 7.1 La carte

- **Molette seule** : la page défile, la carte ne bouge pas, et une aide apparaît sur la carte 1,5 seconde : « Ctrl + molette pour zoomer » (« ⌘ + molette pour zoomer » sur Mac, iPhone et iPad, d'après `navigator.platform`).
- **Ctrl ou ⌘ + molette** (et le pincement d'un pavé tactile, que les navigateurs envoient comme une molette avec Ctrl) : zoom de la carte autour du pointeur, sans zoomer la page.
- Mise en œuvre : le gestionnaire de molette de Leaflet (`scrollWheelZoom`) est activé, et un écouteur en **phase de capture** sur le parent de la carte arrête la propagation d'une molette **sans** Ctrl ni ⌘ avant qu'elle n'atteigne Leaflet, **sans** `preventDefault` : la page défile comme sans carte.
- **Au toucher** : quand le pointeur principal de l'appareil est grossier (`(pointer: coarse)`), la carte est créée sans `dragging` : **un doigt fait défiler la page**, **deux doigts déplacent et zooment la carte** (le pincement de Leaflet, qui suit aussi le milieu des deux doigts). Un doigt qui glisse sur la carte montre l'aide « Deux doigts pour déplacer la carte ». Toucher le tracé place toujours le curseur du profil (v5).
- Un appareil à souris et écran tactile (pointeur principal fin) garde le glisser d'aujourd'hui, au doigt comme à la souris.
- Les boutons + et − et le clavier (flèches, + et −, une fois la carte focalisée) restent.
- L'aide est une couche par-dessus la carte, sans pointeur (`pointer-events: none`), décorative (`aria-hidden`) ; avec moins d'animations demandé, elle apparaît et disparaît sans fondu.

### 7.2 Le profil

État `range: { from, to } | null` (en km), tenu par `RouteSection` comme le curseur.

- **À la souris ou au stylet** : appuyer et glisser sur le profil trace une bande (couleur du thème, `--profile-selection`) ; au relâcher, si la portion fait au moins **200 m** et 8 pixels, le profil s'y limite. Un clic sans glisser place le curseur, comme avant.
- **Au toucher** : un doigt déplace le curseur (comme avant) ; **deux doigts qui s'écartent** zooment autour de leur milieu, qui se resserrent dézooment.
- **Boutons**, sous le profil, pour tous (et pour le clavier, WCAG 2.5.7) : « Zoomer » (la portion deux fois plus courte, autour du curseur ou du milieu), « Dézoomer » (deux fois plus longue), « Vue entière ». « Vue entière » et « Dézoomer » sont en `aria-disabled` sur le profil entier.
- **Clavier**, le profil focalisé : `+` zoome, `−` dézoome (les flèches, Début, Fin et Échap gardent leur rôle).
- **Zoomé**, le profil redessine la portion : ses points relus dans la trace entière et réduits à 1 000 (le détail apparaît), l'échelle des altitudes de la portion, les graduations en km de la portion (`distanceTicks(from, to)`). La pente d'un point se lit sur la même longueur qu'en vue entière (1 % de la trace) : une couleur ne change pas avec le zoom, seule la finesse des bandes augmente.
- Une ligne `<output>` (polie) dit la portion : « Du km 12,4 au km 18,0 » ; le nom accessible du profil la reprend.
- Le curseur ne sort pas de la portion ; un point de la carte touché hors de la portion n'y met pas de curseur.
- L'aide sous le profil : « Glisse sur le profil pour zoomer sur une portion. » (pointeur fin) ou « Écarte deux doigts sur le profil pour zoomer. » (pointeur grossier).

### 7.3 La carte suit

- Une portion choisie : la carte se cadre sur ses points (mêmes marges que pour la trace entière) et la trace de la portion est mise en avant (une ligne de plus, plus épaisse, au-dessus ; le reste de la trace à demi-transparent). « Vue entière » recadre sur toute la trace.
- Sans carte (pas de module, pas de tuiles), le profil zoome seul.
- Avec moins d'animations demandé, le cadrage se fait sans animation (comme le zoom d'aujourd'hui).

### 7.4 Accessibilité

- Toute action de zoom a son bouton : glisser et pincer ne sont jamais le seul moyen.
- Les boutons ont un nom complet (« Zoomer sur le profil », « Dézoomer le profil », « Vue entière du profil » ; en anglais « Zoom in on the profile », « Zoom out of the profile », « Whole view of the profile »), 44 px. Le nom de « Vue entière » contient son texte visible (WCAG 2.5.3).
- La bande de sélection et la portion mise en avant sur la carte se voient en couleurs forcées (contour `CanvasText`).

### 7.5 Tests

- `TrackMap — la molette seule fait défiler la page et montre l'aide` (l'évènement n'est pas annulé, le zoom ne change pas) ; `TrackMap — Ctrl + molette zoome` ; `TrackMap — ⌘ sur Mac` ; `TrackMap — un appareil tactile n'a pas le glisser à un doigt` ; `TrackMap — la portion cadre la carte`.
- `range — zoomAround, bornes, 200 m au moins` (fonctions pures) ; `distanceTicks — sur une portion` ; `ElevationProfile — glisser choisit une portion` ; `… — un clic sans glisser place le curseur` ; `… — pincer zoome` ; `… — les boutons et les touches + et −` ; `… — la couleur d'un point ne change pas avec le zoom` ; `RouteSection — la carte suit la portion`.

## 8. Partager une course

- Sur la fiche, une action **« Partager »** (icône de partage), après « Ajouter à l'agenda ».
- **Le texte** (`shareText`, `features/events/share.ts`), dans la langue de l'interface :

  ```
  Trail des Crêtes
  Du sam. 13 au dim. 14 juin 2026 · Annecy
  Épreuves : Trail 42 km · 2 400 m D+ · max 10h · 65 € ; Trail 15 km · 800 m D+
  Ouverture des inscriptions le lun. 12 janv. à 10:00
  Inscriptions jusqu'au dim. 31 mai
  https://prends-ton-dossard.ketra.fr/evenements/abc123
  ```

  - le nom ; les jours (ou « juin 2027 (date à préciser) ») et le lieu ; les épreuves comme la fiche les nomme, avec leurs mesures, leur limite de temps et leur prix quand elles en ont (« max 10h », « 65 € », comme la fiche) ; l'ouverture à venir ; la date limite ; l'adresse de la course ;
  - **jamais qui y va** : ni participant, ni commentaire, ni covoiturage ;
  - une ligne absente quand la course n'a pas la donnée.
- **Avec `navigator.share`** (téléphones, Safari, Chrome et Edge récents sur ordinateur) : `navigator.share({ title: nom, text })`, l'adresse dans le texte (pas dans `url` : certaines applis la mettraient deux fois, d'autres perdent le texte). Annulé par la personne (`AbortError`) : rien. Autre refus : la fenêtre ci-dessous.
- **Sans `navigator.share`** (Firefox sur ordinateur, qui ne l'a dans aucune version ; Chrome sur Linux) : une fenêtre « Partager la course » :
  - le texte dans un champ multiligne en lecture seule, qui prend le focus, sélectionné ;
  - « Copier le texte » (presse-papiers ; « Texte copié. » ; si le navigateur refuse, le texte reste sélectionné pour une copie à la main) ;
  - « Envoyer sur WhatsApp » : un lien `https://wa.me/?text=<texte encodé>` dans un nouvel onglet (`noopener noreferrer`) ;
  - la phrase « Le lien ne s'ouvre qu'après connexion : seuls les membres du groupe voient la course. » ;
  - « Fermer ».
- Le lien de la course **demande toujours de se connecter** : pas de page publique, pas d'aperçu (vignette) dans WhatsApp. L'aperçu demanderait un lien public signé (`docs/TODO.md`) : hors de cette version.
- **Accessibilité** : la fenêtre est un `<dialog>` (`components/Dialog`) ; le focus revient au bouton « Partager » à sa fermeture ; « Envoyer sur WhatsApp » dit qu'il ouvre un nouvel onglet (« (nouvel onglet) » pour un lecteur d'écran).
- **Tests** : `shareText` (un jour, plusieurs, au mois, ouverture, date limite, épreuve sans mesure, aucun nom de participant) ; `ShareButton — navigator.share reçoit le texte` ; `— une annulation ne fait rien` ; `— sans navigator.share, la fenêtre` ; `— la copie` ; `— le lien wa.me est encodé`.

## 9. Le flux d'agenda du groupe

> « ajoute un flux de calendrier avec toutes les courses où il y a du monde »

### 9.1 Données (migration `9q_calendar_feed_scope.go`)

- `calendar_feeds.scope` : choix `mine` | `group`, obligatoire. Les liens existants deviennent `mine`.
- L'index unique `idx_calendar_feeds_user` (un lien par compte) devient `idx_calendar_feeds_user_scope` sur `(user, scope)` : un lien de chaque sorte par compte.
- Retour arrière : les liens `group` sont supprimés, le champ et l'index reviennent comme en 9h.

### 9.2 Le même modèle de lien

Celui de la v3.1 : un jeton aléatoire dans l'adresse (`…/api/app/calendar/<jeton>.ics`), son empreinte pour le trouver, le jeton gardé caché pour le remontrer à son propriétaire, « Nouveau lien » et « Supprimer le lien » après confirmation, un compte désactivé qui coupe le flux (404). Les routes prennent la sorte :

- `GET /api/app/calendar?scope=group`, `DELETE /api/app/calendar?scope=group` ;
- `POST /api/app/calendar`, corps `{ "lang", "scope": "group" }` ;
- sans `scope` : `mine`, comme aujourd'hui (le site et le MCP existants ne changent pas) ; une autre valeur : `400` avec le code de PocketBase sur `scope`.

Sur la démo, le lien du groupe n'existe pas (`404` pour les trois routes, et le flux d'une telle ligne n'est jamais servi) : tout le monde y partage le même compte, et ce lien donne les noms des membres.

La route du flux est la même : le lien trouvé dit sa sorte. Renouveler ou supprimer l'un ne touche pas l'autre. Caddy ne journalise déjà pas `/api/app/calendar/*`.

### 9.3 Ce que le flux contient

- **Les courses** : toutes celles qui ont au moins une participation qui n'est pas « Non partant » (supporteurs et intéressés sans épreuve compris : il y a du monde), **dont le dernier jour est au plus un an en arrière**.
- **Un `VEVENT` par course** : `UID:group-<événement>@prends-ton-dossard` ; ses jours entiers (une course au mois : le 1er, « (date à préciser) », § 5.4) ; `SUMMARY` : son nom ; `LOCATION` ; `URL` ; `DESCRIPTION` : qui y va, par épreuve, puis l'adresse :

  ```
  Trail 42 km : Alice (Inscrit), Bob (Intéressé · non confirmé)
  Trail 15 km : Sam (Inscrit)
  Intéressés, format à choisir : Léa
  Supporteurs : Max
  https://…/evenements/abc123
  ```

  Les non partants n'y sont pas. Les noms et statuts sont ceux du site (paquet `wording`).
- **Pas d'ouverture, pas de date limite, pas d'alarme** : elles sont dans le flux personnel, qui sait pour qui elles comptent.
- Le calendrier s'appelle « Prends ton dossard · groupe » (`X-WR-CALNAME`), avec le même `REFRESH-INTERVAL` d'une heure.

### 9.4 Réglages → « Agenda »

La section garde son titre et gagne deux sous-titres :

- « Mes courses » : le lien d'aujourd'hui, inchangé ;
- « Les courses du groupe » : « Créer le lien des courses du groupe », puis les mêmes actions (afficher, copier, nouveau lien, supprimer). Aide : « Toutes les courses où au moins un membre va, avec qui y va. Ce lien est secret : il donne les noms des membres. »

Les deux blocs sont le même composant (`CalendarLinkBlock`, avec `scope`), et le statut de chacun a sa clé de requête (`["calendar", compte, scope]`).

### 9.5 Tests

- Go : `TestCalendarFeed_Group` (participants autres que non partants, supporteurs compris, une course sans monde absente, une course de plus d'un an absente, description par épreuve, course au mois, `UID` stable) ; `TestCalendarRoutes_Scope` (deux liens par compte, l'un renouvelé sans l'autre, sorte inconnue refusée, flux d'une sorte qui ne montre pas l'autre, compte désactivé) ; migration 9q.
- Web : `CalendarSection — deux liens, mes courses et le groupe` ; `— renouveler le lien du groupe garde le mien`.

## 10. La météo

### 10.1 Open-Meteo : ce qui est permis, ce qui est envoyé

Vérifié le 2026-11-07 sur `open-meteo.com/en/terms` et `/en/licence` :

- **L'API gratuite est réservée à un usage non commercial** : un site privé ou associatif, sans abonnement ni publicité, en fait partie. C'est notre cas (un site privé entre amis).
- **Limites** : moins de 10 000 appels par jour, 5 000 par heure, 600 par minute (300 000 par mois), par adresse IP. Open-Meteo peut bloquer sans prévenir une application qui en abuse.
- **Licence** : données sous CC BY 4.0 ; il faut citer la source à côté des données, avec un lien (exemple donné : « Weather data by Open-Meteo.com ») ; les lieux du géocodage viennent de GeoNames (CC BY 4.0).
- **Ce qu'Open-Meteo garde** : les adresses IP et les journaux de son serveur web, qui peuvent contenir les coordonnées, effacés après 90 jours, non partagés.

**Ce que le site envoie** (toujours depuis le serveur, jamais depuis le navigateur : les adresses des membres ne vont pas chez Open-Meteo) :

- à la **prévision** : des coordonnées arrondies à 0,01° (environ 1 km), une altitude arrondie à 50 m quand la trace en donne une, les jours voulus, `timezone=auto` et la liste des grandeurs ;
- au **géocodage** : le texte du lieu de la course tel qu'il est saisi (« Annecy »), `count=1`, `language=fr` ;
- l'adresse IP du serveur, et un agent `prends-ton-dossard (+<APP_URL>)`.

**Jamais** : un nom de membre, un compte, le nom de la course, qui y va, une adresse de visiteur.

### 10.2 Où

Dans cet ordre :

1. **le départ d'une trace** : la première épreuve de la course, dans l'ordre de la fiche (par jour, puis par distance), qui a une trace GPX ; son premier point (`trkpt`, sinon `rtept`), lu par le serveur dans le fichier (au plus 1 Mo lu, analyse XML arrêtée au premier point), avec son altitude si elle en a une ;
2. sinon **le lieu de la course**, géocodé par Open-Meteo : le texte entier, puis, s'il ne donne rien, chacune de ses parties séparées par des virgules, de la dernière à la première (« Lac d'Annecy, Sevrier ») ; trois essais au plus ; le premier résultat est pris ;
3. sinon : « lieu introuvable ».

Le lieu trouvé est dit (« À Annecy (Auvergne-Rhône-Alpes, France) » ou « Au départ de la trace de « Trail 42 km » »), pour qu'une erreur du géocodage se voie.

### 10.3 Quand

- **De J-7 au dernier jour** de la course (aujourd'hui à Paris entre `start_date − 7 jours` et `end_date`) ; avant et après, pas de météo.
- **Les jours de la course seulement**, ceux de l'horizon d'Open-Meteo (16 jours) ; une course au mois : aucune. Les jours partent d'**aujourd'hui** : pendant une course déjà commencée, les jours passés sont laissés de côté (le premier jour de la réponse n'est pas toujours le premier jour de la course).
- Par jour : le temps (code WMO), les températures minimale et maximale, la probabilité et la hauteur de pluie, le vent maximal et les rafales, à l'heure locale du lieu.

### 10.4 Cache et limites (paquet `server/weather`)

- **En mémoire**, bornés (500 entrées chacun, les plus anciennes partent) :
  - prévision : par coordonnées arrondies, altitude arrondie et jours, **1 heure** ;
  - géocodage : par texte du lieu (minuscules, sans accents, espaces réduits), **30 jours** (« introuvable » aussi, 1 jour) ;
  - premier point d'une trace : par nom du fichier (il change à chaque envoi), sans limite de temps.
- **Une seule requête à la fois par clé** : deux membres qui ouvrent la fiche ensemble font un appel.
- **En cas d'échec** (délai de 8 secondes, réponse non 200, JSON illisible) : la dernière prévision gardée de moins de 6 heures est rendue, marquée `stale` ; sinon `502 weather_unavailable`.
- **Un budget** : 500 appels par heure au plus pour tout le programme (dix fois sous la limite d'Open-Meteo) ; au-delà, le cache, sinon `weather_unavailable`. Le journal dit quand le budget est atteint.
- Un redémarrage vide le cache : c'est un appel de plus par course, pas une donnée perdue.
- Les adresses d'Open-Meteo sont des variables du paquet, remplacées par un faux serveur `httptest` dans les tests : **aucun test n'appelle Open-Meteo**.

### 10.5 API

`GET /api/app/events/{id}/weather` (session du site ; présente sur la démo, où le budget borne les appels) :

```json
{ "status": "ok",
  "place": { "source": "track", "name": "Annecy", "detail": "", "format": "Trail 42 km" },
  "days": [{ "date": "2026-06-13", "code": 61, "tMin": 9.1, "tMax": 17.3,
             "rainChance": 60, "rainMm": 2.1, "windKmh": 20, "gustKmh": 35 }],
  "fetchedAt": "2026-06-08T12:05:00Z", "stale": false }
```

- `status` : `ok` ; `not_yet` (avant J-7, avec `"from": "2026-06-06"`) ; `over` ; `no_day` (course au mois) ; `no_place` (lieu introuvable, avec `"query": "<le lieu>"`).
- `place.source` : `track` (avec `format`, le nom de l'épreuve) ou `place` (avec `name` et `detail` du géocodage).
- Course inconnue : `404`. Échec sans cache : `502` `weather_unavailable`.

### 10.6 Sur la fiche

- Une section **« Météo prévue »**, après les actions, seulement quand la page sait qu'on est dans la fenêtre (§ 10.3) ; elle demande la route (`["weather", id]`, gardée 30 minutes).
- Une ligne par jour de course :
  « sam. 13 juin · Averses · 9 à 17 °C · pluie 60 %, 2 mm · rafales 35 km/h », avec une icône du temps (décorative).
- Le lieu (§ 10.2), et « Prévision de 14:05 » (« Prévision de 14:05, pas à jour » quand `stale`).
- La source, en petit : « Données : Open-Meteo.com (CC BY 4.0) », lien, et « · lieu : GeoNames » pour un lieu géocodé.
- Chargement : « Chargement de la météo… » ; `no_place` : « Pas de météo : le lieu « Annecy » n'a pas été trouvé. » ; échec : « La météo n'a pas pu être chargée. » et « Réessayer ».

Les codes WMO deviennent des mots (fr / en) :

| Codes | Français | Anglais |
|---|---|---|
| 0 | Ciel dégagé | Clear sky |
| 1, 2 | Peu nuageux | Partly cloudy |
| 3 | Couvert | Overcast |
| 45, 48 | Brouillard | Fog |
| 51, 53, 55, 56, 57 | Bruine | Drizzle |
| 61, 63 | Pluie | Rain |
| 65 | Forte pluie | Heavy rain |
| 66, 67 | Pluie verglaçante | Freezing rain |
| 71, 73, 75, 77 | Neige | Snow |
| 80, 81 | Averses | Showers |
| 82 | Fortes averses | Heavy showers |
| 85, 86 | Averses de neige | Snow showers |
| 95 | Orage | Thunderstorm |
| 96, 99 | Orage et grêle | Thunderstorm with hail |
| autre | Temps inconnu | Unknown weather |

**Accessibilité** : une liste (`<ul>`), chaque jour en une phrase lisible seule ; aucune information par l'icône seule ; le bouton « Réessayer » de `LoadFailure`.

### 10.7 Tests

- Go (faux Open-Meteo) : `TestWeather_SendsOnlyPlaceAndDays` (les paramètres exacts des deux requêtes, rien d'autre) ; `TestWeather_Window` (J-8, J-7, le jour, le lendemain de la fin, course au mois) ; `TestWeather_TrackStart` (premier point, `rtept`, fichier sans point, gros fichier lu jusqu'à 1 Mo seulement) ; `TestWeather_Geocoding` (texte entier, parties, introuvable) ; `TestWeather_Cache` (un appel pour deux demandes, une heure plus tard un autre, demandes simultanées) ; `TestWeather_StaleOnError` ; `TestWeather_Budget` ; `TestWeather_Route` (session requise, 404, codes).
- Web : `weatherWindow` ; `WeatherSection — chaque état` ; `weatherLabel — chaque code`.

## 11. Le matériel obligatoire

> **Reporté (décision de l'utilisateur, 2026-11-07) : le matériel n'est pas construit en v7.** Ni `formats.gear`, ni `gear_checks`, ni migration `9r`, ni outil `gear_checklist`, ni mention dans les instructions du MCP ; l'idée reste dans `docs/TODO.md`. Ce qui parle de matériel dans ce document (§ 2, 11, 12, 14, 16) est gardé comme il a été écrit, pour plus tard ; les nombres d'outils réels sont **trente-quatre** de membre et **quarante-cinq** d'admin.

### 11.1 Données (migration `9r_gear.go`)

- `formats.gear` : JSON, une liste de textes (« Frontale », « Couverture de survie »…). Vide ou absent : pas de matériel.
- **Règles** (hook de modèle de `server/events`) : 50 objets au plus, chacun de 1 à 80 caractères sans espaces autour, sans doublon (sans tenir compte des majuscules ni des accents) : sinon `gear_invalid`. Les droits sont ceux d'une épreuve : tout membre.
- Table **`gear_checks`** : la liste cochée d'une personne pour une épreuve.

| Champ | Type | Règles |
|---|---|---|
| `user` | relation → `users` | obligatoire, cascade |
| `format` | relation → `formats` | obligatoire, cascade |
| `items` | JSON, liste de textes | les objets cochés, tels que la liste de l'épreuve les écrit ; mêmes bornes que `gear` |
| `created`, `updated` | | |

- Index unique `(user, format)`.
- **Règles d'accès, privées, même pour un admin** :
  - `list`, `view`, `delete` : `@request.auth.id != "" && user = @request.auth.id` ;
  - `create` : `@request.auth.id != "" && @request.body.user = @request.auth.id` ;
  - `update` : `@request.auth.id != "" && user = @request.auth.id && @request.body.user:isset = false && @request.body.format:isset = false`.
- Un objet renommé ou retiré de la liste de l'épreuve ne compte plus (la case cochée se perd avec lui) ; ce que la liste n'a plus est ignoré à l'affichage et retiré à la prochaine écriture.

### 11.2 Le formulaire

- Dans chaque épreuve : « Matériel obligatoire », un champ multiligne, un objet par ligne, avec l'aide « Un objet par ligne. Chacun pourra le cocher la veille. ».
- Dans « Options avancées » de l'épreuve, sauf s'il est rempli (la règle de la v5 : une valeur n'est jamais cachée).
- À l'envoi : lignes sans espaces autour, lignes vides et doublons retirés.

### 11.3 Sur la fiche

- Dans la section de chaque épreuve qui a du matériel, après les participants : un sous-titre « Matériel obligatoire ».
- **La personne qui a une participation sur cette épreuve** (pas « Non partant ») voit des cases à cocher, la ligne « 3 sur 8 prêts » (`<output>` polie) et « Ce que tu coches n'est vu que par toi. ». Cocher écrit tout de suite (`gear_checks`, créé à la première case) ; un échec rend la case et le dit (`role="alert"`).
- **Les autres** voient la liste, sans cases.
- Pas de rappel du matériel en v7 (ni accueil, ni notification).

### 11.4 Accessibilité

- Les cases sont des `<input type="checkbox">` avec leur étiquette (le nom de l'objet), 44 px de haut, dans un `<fieldset>` dont la légende est « Matériel obligatoire ».
- L'état coché se dit par la case, pas par une couleur.

### 11.5 Tests

- Go : `TestFormats_Gear` (bornes, doublons à la casse et aux accents près, vide) ; `TestGearChecks_Private` (un autre membre, un admin : liste vide, `404` à la lecture, à la modification, à la suppression ; créer pour un autre refusé ; changer `format` ou `user` refusé) ; migration 9r.
- Web : `FormatFieldset — le matériel, un objet par ligne, dans « Options avancées » sauf rempli` ; `buildBatch — le matériel part avec l'épreuve` (et son portage Go) ; `GearList — cocher, l'échec rend la case, « 3 sur 8 prêts »` ; `GearList — sans participation, une liste sans cases`.

## 12. Le MCP

Les règles de la spec du MCP valent toutes : chaque outil passe par l'API du site avec la session du propriétaire du jeton (ses droits, jamais plus) ; ce qui supprime ou efface demande une confirmation (§ 6.13) ; ce qu'un membre a écrit est cité entre « » et ses « » deviennent ‹ › ; le paquet `mcp` n'écrit jamais lui-même.

### 12.1 Les champs nouveaux des outils qui existent

| Outil | Entrées nouvelles | Sorties nouvelles |
|---|---|---|
| `create_event` | `registration_opening` (AAAA-MM-JJ), `registration_opening_time` (HH:MM), `date_precision` (`day` \| `month` ; avec `month`, `start_date` peut être `AAAA-MM`, l'outil en fait le 1er), `formats[].gear` (liste) | comme `get_event` |
| `update_event` | les mêmes, et `formats[].gear` dans les modifications d'épreuves | comme `get_event` |
| `add_format`, `update_format` | `gear` | comme `get_event` |
| `search_events` | — | `registration_opening`, `registration_opening_time`, `date_precision` (absent pour `day`) |
| `get_event` | — | les mêmes, et `formats[].gear` |
| `home` | — | `registrations_to_do[]` : `state` (`soon` \| `today` \| `open`), `opening`, `opening_time` ; `deadline` et `days_left` facultatifs ; `date_precision` sur les lignes qui ont un `day` |
| `get_runner` | — | `date_precision` sur les lignes qui ont un `day` |
| `calendar_link` | `scope` (`mine` par défaut \| `group`) | — |

- **Avec `date_precision: "month"`**, `start_date` est le 1er du mois et `end_date` le dernier jour (le serveur la pose) ; `day` d'une épreuve est le 1er. Les descriptions le disent : « le jour n'est pas connu ».
- Les dates de fin et l'ordre du batch suivent le formulaire (§ 5.1) : `planBatch` porte les nouveaux cas de `buildBatch`, et `eventEndDate` ceux de la course au mois.
- `calendar_link` avec `scope: "group"` : son `summary` rappelle que ce lien secret donne les noms des membres ; l'état de sa confirmation est l'empreinte de l'adresse **de cette sorte** de lien.
- Les instructions du serveur gagnent une ligne : « Une course peut avoir une ouverture des inscriptions (jour, heure de Paris), une précision au mois quand le jour n'est pas connu. »

### 12.2 Les outils nouveaux (membre)

**`reminders`** (Réglages → « Rappels ») — `action` : `show` | `set` ; `when` : une liste de `day` et `hour` (`set` ; vide : aucun rappel).

- Passe par `GET` et `PUT /api/app/me/reminders` ; lit aussi `GET /api/app/push` pour dire combien d'appareils sont activés.
- → `{ "done", "summary", "reminders", "devices" }`. Le `summary` dit que les notifications demandent d'activer un appareil dans les Réglages du site (l'assistant ne peut pas le faire), et que les alarmes vont dans le flux d'agenda personnel.
- Pas de confirmation : c'est un choix de la personne, remplacé par un autre.
- Absent sur la démo (il n'y a pas de MCP sur la démo).

**`get_weather`** — `event_id`. Lecture (`readOnlyHint`).

- Passe par `GET /api/app/events/{id}/weather`.
- → la réponse de la route, avec, pour chaque jour, `label` (les mots du tableau du § 10.6) ; et `attribution` : « Données : Open-Meteo.com (CC BY 4.0) ». Un nom de lieu venu du géocodage est un texte qui ne vient pas du site : cité comme un texte de membre.
- `not_yet`, `over`, `no_day`, `no_place` sont des réponses, pas des erreurs : le `summary` les dit (« La météo arrive 7 jours avant la course, à partir du 2026-06-06. »).

**`gear_checklist`** — `format_id` ; `action` : `show` | `check` | `uncheck` ; `items` (pour `check` et `uncheck`) : des noms d'objets, comparés sans majuscules ni accents à la liste de l'épreuve.

- Passe par les enregistrements `gear_checks` de la personne (`list`, `create`, `update`), comme le site.
- Un objet inconnu : une erreur qui liste ceux de l'épreuve (cités). Une épreuve sans matériel : « Cette épreuve n'a pas de matériel obligatoire. »
- → `{ "done", "summary", "format": { "id", "title", "event" }, "items": [{ "item", "checked" }], "ready", "total" }`.
- Pas de confirmation : la liste est celle de la personne, et décocher se refait d'un appel. `idempotentHint`.

Outils : **trente-cinq** de membre, **quarante-six** pour un admin (aucun nouvel outil d'admin).

### 12.3 Confirmations (ajouts au tableau du § 6.13 de la spec du MCP)

| Outil | Quand | Ce que la réponse dit |
|---|---|---|
| `update_event` | l'ouverture ou son heure seraient vidées ; la course passerait au mois alors que des épreuves ont une date (elles la perdent) | la valeur actuelle ; chaque épreuve et son jour perdu, avec ses participants |
| `update_event`, `update_format` | une liste de matériel non vide serait vidée | la liste actuelle (citée) |
| `calendar_link` | `renew`, `delete`, pour `scope: "group"` comme pour `mine` | que l'ancien lien de cette sorte cessera de marcher |

Remplacer une liste de matériel par une autre, une ouverture par une autre, ou passer d'une course au mois à une course datée ne demande rien : rien n'est perdu.

### 12.4 Ce qui reste sans outil

- **Activer un appareil pour les notifications** : il faut le navigateur de l'appareil (permission, abonnement).
- **Partager** : le partage est un geste du téléphone ; l'assistant a déjà le nom, les jours, les épreuves et l'adresse de la course.
- **Titres, zoom** : de l'interface seulement.

### 12.5 Tests

- `TestTools_*` des outils nouveaux et des champs nouveaux (cas nominaux, refus du site traduits, droits : la liste à cocher d'un autre est introuvable) ; les lignes du § 12.3 dans `TestTools_Confirmation_NothingWrittenFirst` ; `wantMemberTools` et `wantHints` à jour ; le test des textes de membres (« », » et ) dans un objet de matériel et dans un lieu géocodé) ; `tools/mcpcheck` attend 35 et 46 outils.

## 13. L'environnement de dev

> « Déploie une version en dev dans un nouvel environnement sur le serveur pour tester en condition réelle à la fin avant de pouvoir déployer en version finale. »

| | |
|---|---|
| **Adresse** | `https://dev-prends-ton-dossard.ketra.fr` (couverte par le certificat `*.ketra.fr` de Caddy) |
| **Dossier** | `/opt/ptd-dev` (nom différent de celui de la production : Docker Compose nomme le projet et le volume d'après le dossier) |
| **Volume** | `ptd-dev_pb_data` (ses données, ses clés VAPID) |
| **Port** | `127.0.0.1:8130` (`HOST_PORT=8130` ; 8096 est la production, 8120 la démo) |
| **`.env`** | `APP_URL=https://dev-prends-ton-dossard.ketra.fr`, `HOST_PORT=8130`, **sans `DEMO_LOGIN_EMAIL`** (le script de déploiement refuse s'il y est) |
| **Données** | le `seed` (`seed --force`), avec un mot de passe aléatoire gardé dans `/opt/ptd-dev-secrets/SEED_PASSWORD` (root seulement, jamais affiché ; l'utilisateur en reçoit le chemin) ; comptes `alice@`, `bob@`, `admin@example.test` |
| **MCP** | actif (pas de `DEMO_LOGIN_EMAIL`) |
| **Rappels, notifications, météo** | actifs, avec leurs vrais services (services push, Open-Meteo) |
| **Code** | le dernier commit de `feat/v7` (`git archive`), jamais `main` avant l'accord |

**Les données du `seed`** gagnent ce qu'il faut pour essayer la v7 (les jours sont relatifs au jour du `seed`) :

- « Trail des Crêtes » dans 5 jours (la météo se montre), une ouverture passée, une date limite dans 2 jours, une **trace GPX** sur son épreuve de 42 km (un fichier du dépôt, `server/cmd/seed_track.gpx`, embarqué) et du **matériel** sur ses deux épreuves ;
- « Grand Trail du Vercors », **au mois** (dans 7 mois), à Villard-de-Lans, **ouverture dans 2 jours à 10:00**, Alice et Sam intéressés, Bob inscrit ;
- « Hyrox Lyon » : une ouverture demain, **sans heure**.

**Caddy** (dans le site `*.ketra.fr` de `/etc/caddy/Caddyfile`, sur le modèle de la démo) :

```
@ptd-dev host dev-prends-ton-dossard.ketra.fr
handle @ptd-dev {
	header X-Robots-Tag "noindex, nofollow"
	@ptd-dev-admin path /_/* /api/collections/_superusers/* /api/collections/pbc_3142635823/*
	respond @ptd-dev-admin 404
	respond /robots.txt <<TXT
		User-agent: *
		Disallow: /
		TXT 200
	reverse_proxy http://127.0.0.1:8130
}
```

(le `heredoc` demande Caddy 2.7 ou plus ; sinon, l'en-tête `X-Robots-Tag` seul suffit), et un journal à lui, sur le modèle de celui de la production (`hostnames dev-prends-ton-dossard.ketra.fr`, `log_skip` sur `/api/app/calendar/*`). Caddyfile sauvegardé avant, `caddy validate`, puis `systemctl reload caddy`.

**Déployer** (par le contrôleur seulement ; Task 20 du plan) : archive du commit, dossier neuf, `.env`, `docker compose build`, `up -d`, `seed` si la base est vide, Caddy la première fois, puis les vérifications : `/api/health`, `/_/` en 404, `/mcp` en 401 sans jeton, `X-Robots-Tag`, `robots.txt`, `/api/app/push` et `/api/app/events/x/weather` en 401 sans session, `/api/app/demo` en 404. **Redéployer** après une correction : le même script ; le `seed` ne refait rien sur une base remplie.

**Ensuite** : l'utilisateur essaie (liste « À faire de ton côté » des décisions de la v7), puis, **seulement avec son accord**, la production : fusion de `feat/v7` dans `main`, **sauvegarde du volume `pb_data` d'abord** (conteneur arrêté), puis le déploiement habituel. La production génère ses propres clés VAPID à son premier démarrage.

## 14. Codes d'erreur (delta)

Dans `server/apperr/codes.go`, et traduits par le front comme les autres (`ERROR_CODES`, `fr.errors`, `en.errors`), et par le MCP (`messages.go`) :

| Code | FR | EN |
|---|---|---|
| `registration_opening_after_start` | L'ouverture des inscriptions doit être au plus tard le jour du début. | Registration must open on or before the first day. |
| `registration_opening_after_deadline` | L'ouverture des inscriptions doit être au plus tard la date limite. | Registration must open on or before the deadline. |
| `push_endpoint_invalid` | Cet appareil ne peut pas recevoir de notifications de ce site. | This device cannot receive notifications from this site. |
| `push_unavailable` | Les notifications ne sont pas disponibles pour l'instant. | Notifications are not available right now. |
| `month_start_invalid` | Pour une course dont seul le mois est connu, la date est le 1er du mois. | For a race known only by its month, the date is the 1st. |
| `format_date_month` | Une course dont seul le mois est connu n'a pas de date d'épreuve. | A race known only by its month has no race dates. |
| `weather_unavailable` | La météo n'a pas pu être chargée. Réessaie dans un moment. | The weather could not be loaded. Try again in a moment. |
| `gear_invalid` | Le matériel : 50 objets au plus, de 80 caractères au plus, sans doublon. | Gear: at most 50 items of 80 characters, no duplicates. |

## 15. Hors de cette version

- **Un aperçu (vignette) dans WhatsApp** : il faudrait une page publique signée (`docs/TODO.md`).
- **Les rappels d'autre chose que l'ouverture** (date limite, résultat à saisir, matériel la veille) : le planificateur et les notifications les permettraient ; pas demandés pour cette version.
- **Un email** de rappel : le site n'envoie pas d'email.
- **La météo heure par heure** ou de l'heure du départ : les épreuves n'ont pas d'heure de départ.
- **Les notifications par l'assistant** (MCP) : il faut l'appareil.
- **Une page « historique des rappels »** : le journal du programme suffit.
- **Les tests sur GitHub, les sauvegardes hors du serveur** (`docs/TODO.md`, « Mes idées ») : à part.

## 16. Décisions à valider

Ce que ni tes réponses ni les arbitrages ne tranchaient ; dis lesquelles revoir, par leur numéro.

**L'ouverture et les rappels**

1. **Ouverture = un jour et une heure facultative**, à l'heure de Paris ; **sans heure, le site compte 9 h** (« 1 jour avant » la veille à 9 h, « 1 heure avant » à 8 h le jour même).
2. L'ouverture est **au plus tard la date limite** et **le premier jour** de la course.
3. Le jour de l'ouverture, la fiche dit « aujourd'hui à 10:00 » toute la journée (calcul au jour près, pas à la minute).
4. **Qui reçoit les rappels : « Intéressé » et « Inscrit »** (sur une épreuve ou sur la course seule). Les supporteurs n'en ont pas (précision de « tout statut sauf `dns` »). Un rappel par course, même avec deux épreuves.
5. **Un seul réglage pour les alarmes et les notifications**, **« Jamais » par défaut** : rien ne change pour personne tant qu'il ne choisit pas.
6. **« 1 jour avant » ne part pas** quand « 1 heure avant » est déjà dû et choisi (pas deux notifications en une heure) ; un rappel en retard (programme redémarré) part tant que l'ouverture n'est pas passée, avec le texte du moment.
7. **Au plus une fois** : un arrêt du programme pendant un envoi perd ce rappel plutôt que d'en envoyer deux. Une ouverture déplacée réarme ses rappels.
8. **Clés VAPID dans un fichier du volume** (`pb_data/push_vapid.json`), créées au premier démarrage, jamais régénérées d'elles-mêmes, sauvegardées avec les données.
9. **Web Push écrit sur la bibliothèque standard de Go** (pas de `webpush-go`), vérifié par l'exemple de la RFC 8291.
10. **Adresses de notification limitées aux services push de Google, Mozilla, Apple et Microsoft.**
11. **Dix appareils par compte**, le plus ancien remplacé ; **se déconnecter retire l'appareil** ; un compte désactivé perd les siens.
12. Un bouton **« Envoyer un essai »**.
13. **Pas de rappels ni de notifications sur la démo.**
14. Le flux personnel se relit toutes les heures (`REFRESH-INTERVAL`) ; le fichier d'une course porte les alarmes de la personne.

**Les courses au mois**

15. **Gardées du 1er au dernier jour du mois** (la fin posée par le serveur), épreuves sans date ; « Terminé » possible dès le 1er.
16. **Rangées à la fin de leur mois** dans les listes, **à part dans l'agenda** (un bloc au-dessus de la grille), à venir jusqu'à la fin du mois, résultats à saisir après.
17. **Dans les flux d'agenda : un jour entier le 1er du mois**, « (date à préciser) », plutôt que rien.
18. **Une liste de mois** dans le formulaire (12 mois en arrière à 36 en avant), pas `<input type="month">`.

**Titres, zoom, partage**

19. Titres « `Page` · Prends ton dossard », dans la langue de l'interface, le mois et l'année dans ceux de l'agenda et des statistiques.
20. **Sur un écran tactile, un doigt fait défiler la page**, deux doigts déplacent la carte ; un ordinateur à écran tactile garde le glisser.
21. **Zoom du profil : glisser, pincer, boutons et touches + et −** ; 200 m au moins ; les couleurs de pente ne changent pas avec le zoom.
22. **Partage : un texte seul** (l'adresse dedans), sans aucun nom de participant ; sans Web Share, une fenêtre « Copier le texte » et « Envoyer sur WhatsApp ».

**Le flux du groupe**

23. **Toutes les courses avec au moins une participation autre que « Non partant »**, supporteurs et intéressés sans épreuve compris, **jusqu'à un an en arrière**.
24. **Avec les noms et statuts par épreuve**, dans un lien secret à part (« il donne les noms des membres ») ; **sans ouvertures, dates limites ni alarmes**.

**La météo**

25. **Les jours de la course seulement, de J-7 à la fin**, au départ de la première trace, sinon au lieu géocodé (premier résultat, avec le lieu trouvé affiché).
26. **Cache en mémoire** (1 heure pour une prévision, 30 jours pour un lieu), une prévision de moins de 6 heures si Open-Meteo ne répond pas, **500 appels par heure au plus**.
27. **Météo aussi sur la démo** (sans données personnelles, bornée par le budget).

**Le matériel**

28. **50 objets de 80 caractères** par épreuve ; dans « Options avancées » sauf rempli.
29. **Cases seulement pour qui a une participation** sur l'épreuve (pas « Non partant ») ; **privées même pour un admin** ; pas de rappel du matériel en v7.

**Le MCP et le dev**

30. **Trois outils de membre** : `reminders`, `get_weather`, `gear_checklist` (35 de membre, 46 d'admin) ; pas d'outil pour activer un appareil ; confirmations pour vider une ouverture ou une liste de matériel, et pour passer au mois une course aux épreuves datées.
31. **Environnement de dev `dev-prends-ton-dossard.ketra.fr`** (`/opt/ptd-dev`, port 8130), mot de passe du `seed` dans `/opt/ptd-dev-secrets/SEED_PASSWORD`.

**Vérifié** (le 2026-11-07) : les conditions, la licence et la documentation d'Open-Meteo (`open-meteo.com/en/terms`, `/en/licence`, `/en/docs`) ; Web Push sur iOS (`webkit.org/blog/13878`, et l'exigence d'un geste dans des sources secondaires) ; la prise en charge de Web Share (`caniuse.com/web-share` : Firefox sur ordinateur jamais, Firefox Android oui ; MDN `Navigator.share`) ; le sort des `VALARM` d'un abonnement (Google Agenda et Outlook les ignorent d'après des rapports d'utilisateurs, sans source officielle ; Apple Calendrier sur Mac les retire par défaut, case « supprimer les alertes »). La RFC 8291 et la RFC 8292 sont celles de l'IETF ; leur exemple sert de test.
