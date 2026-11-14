# « Prends ton dossard » v9 : une ouverture des inscriptions par épreuve

- **Date** : 2026-11-14
- **Statut** : design écrit d'après la conversation du 2026-11-14 (les réponses de la personne aux questions). Ce qui reste à trancher est au § 13.
- **Auteur** : Guillaume (avec Claude)
- **Base** : la spec v1 et ses addendums (v1.1 à v8), la spec du MCP (`2026-11-03-courses-mcp-design.md`), et surtout la v7 (`2026-11-07-courses-v7-design.md`, § 3 et § 4 : l'ouverture des inscriptions et ses rappels). Ce document ne décrit que ce qui change. En cas de conflit, il l'emporte.

## 1. Objectif

Le Marathon du lac d'Annecy (24 et 25 avril 2027) ouvre ses inscriptions un jour différent pour chaque épreuve :

| Épreuve | Ouverture |
|---|---|
| Marathon et marche nordique | lun. 16 nov. 2026 à 12:00 |
| Semi-marathon | mar. 17 nov. 2026 à 12:00 |
| 10 km | mer. 18 nov. 2026 à 12:00 |
| 5 km | jeu. 19 nov. 2026 à 12:00 |

Le site ne connaît qu'une ouverture par course (v7, `events.registration_opening` et `registration_opening_time`) : il dit « lun. 16 nov. à 12:00 » à tout le monde, et les rappels du semi, du 10 km et du 5 km partiraient un, deux ou trois jours trop tôt.

La demande : « Sur Annecy on a des dates et heures d'inscriptions différentes selon l'épreuve, il faudrait qu'on le gère. »

Les réponses de la personne :

- **L'approche** : une ouverture facultative sur l'épreuve, qui remplace celle de la course (approche 1, § 3).
- **En haut de la fiche** : « S'il est inscrit à une course ou intéressé, on doit montrer sa date. Sinon l'inscription générale. » La date de l'épreuve de la personne si elle en a une, sinon l'ouverture de la course.
- **Les rappels d'une personne sans épreuve choisie** : « le rappel général, c'est souvent le premier » : l'ouverture de la course.
- **Une course sans ouverture générale** : « si la course a plusieurs dates d'inscriptions mais pas une générale et qu'on veut une date générale, on prend la plus proche » (§ 4.2).
- **La livraison** : une seule version complète, dans l'ordre habituel (« Une seule version »), plutôt qu'un minimum livré en vitesse pour les ouvertures d'Annecy.
- **Une valeur partielle sur une épreuve** (après la première lecture de la spec) : « on peut remplir date et heure, date uniquement ou heure uniquement. Ça récupère la valeur de la date générale. Du coup, en cas de valeur partielle pour une épreuve, la valeur générale doit être remplie. » (§ 4.2, § 4.3).

La v9 est réussie si :

- chacun voit l'ouverture de **son** épreuve, sur la fiche, la liste, l'accueil et dans son agenda ;
- chacun reçoit son rappel au bon moment pour son épreuve, et une personne qui n'a pas choisi d'épreuve reçoit celui de l'ouverture générale ;
- une personne qui ne va pas à la course voit l'ouverture générale, et sur la fiche, l'ouverture de chaque épreuve qui a la sienne ;
- rien ne change pour une course qui n'a qu'une ouverture (toutes celles d'avant la v9).

## 2. Périmètre

### Dans cette version

1. L'ouverture d'une épreuve : données, règles (§ 4).
2. Quelle ouverture vaut pour qui (§ 4.2) : le cœur de la v9, partagé par tout le reste.
3. Ce que le site en dit : fiche, liste, accueil, partage, fichier d'agenda (§ 5).
4. Le formulaire (§ 6).
5. Les rappels et le flux d'agenda personnel (§ 7).
6. Le MCP (§ 8).
7. La fusion de doublons (§ 9).

Une migration : `9t_format_registration_opening.go`. Aucune dépendance nouvelle.

### Hors de cette version

Voir § 12.

## 3. Les approches

1. **Une ouverture facultative sur l'épreuve, qui remplace celle de la course** (choisie). L'épreuve gagne un jour et une heure, vides par défaut : vide, elle suit l'ouverture de la course. Rien ne change pour les courses existantes. Pour Annecy : l'ouverture de la course reste le lun. 16 nov. à 12:00 (le marathon), et le semi, le 10 km et le 5 km ont la leur.
2. **L'ouverture seulement sur les épreuves, sans ouverture générale.** Écartée : il faudrait la saisir sur chaque épreuve même quand elle est partout la même, et une personne sans épreuve n'aurait plus d'ouverture.
3. **Une liste d'ouvertures à part**, chacune pour plusieurs épreuves, voire pour un public (habitants, licenciés FFA). Écartée : une nouvelle table et un formulaire plus lourd, pour un cas rare.

## 4. Les données et la règle

### 4.1 Données (migration `9t_format_registration_opening.go`)

| Collection | Champ | Type | Sens |
|---|---|---|---|
| `formats` | `registration_opening` | texte `AAAA-MM-JJ`, facultatif | le jour où les inscriptions de cette épreuve ouvrent ; vide : le jour de l'ouverture de la course |
| `formats` | `registration_opening_time` | texte `HH:MM`, facultatif | l'heure, à l'heure de Paris ; vide : l'heure de l'ouverture de la course |

- Comme les deux champs de la course (9l) : du texte civil à l'heure de Paris, jamais d'UTC dans la base ; sans motif dans la collection (les règles sont dans le hook, pour avoir les mêmes codes d'erreur que la course).
- Les règles d'accès ne changent pas : tout membre modifie une épreuve.
- Retour arrière : les deux champs disparaissent, avec leurs valeurs ; les épreuves suivent alors l'ouverture de la course.

### 4.2 Quelle ouverture vaut pour qui

Une **ouverture** est un jour, une heure facultative, et sa **source** : la course, ou une épreuve.

- **L'ouverture d'une épreuve** :
  - un jour et une heure : les siens ;
  - **un jour seul** : ce jour, à l'heure de l'ouverture de la course (sans heure si la course n'en a pas : le site compte alors 9 h, v7 § 3.2) ;
  - **une heure seule** : le jour de l'ouverture de la course, à cette heure ;
  - rien : l'ouverture générale.
  
  Un jour seul ou une heure seule demande que la course ait **sa propre** ouverture (§ 4.3) : la partie qui manque vient toujours d'elle, jamais d'une ouverture générale tirée des épreuves. Quand la course change son ouverture, ses épreuves qui n'ont qu'une partie suivent.

  L'épreuve **a sa propre ouverture** (sa source est l'épreuve) quand elle a un jour, une heure ou les deux, **sauf** si le résultat tombe au même jour et à la même heure que l'ouverture de la course : elle compte alors comme celle de la course (pas de ligne sur la fiche, pas de second rappel, pas de nom entre parenthèses).

  Exemple : la course ouvre le lun. 16 nov. à 12:00 ; le semi n'a que « mar. 17 nov. » : il ouvre le mar. 17 nov. à 12:00. Si la course passe à 10:00, le semi passe à 10:00.
- **L'ouverture générale** de la course :
  - l'ouverture de la course si elle en a une ;
  - sinon, si des épreuves ont la leur : **la plus proche**, c'est-à-dire la prochaine à venir parmi elles (la plus tôt de celles qui ne sont pas passées) ; quand toutes sont passées, la dernière passée (les inscriptions sont alors ouvertes) ;
  - sinon, aucune.
- **Les ouvertures d'une personne** sur une course : pour chacune de ses participations « Intéressé » ou « Inscrit », l'ouverture de son épreuve, ou l'ouverture générale pour une participation sans épreuve. Un supporteur et un non-partant n'en ont pas.
- **L'ouverture qu'on montre à une personne** (en haut de la fiche, sur la carte) : la plus proche de ses ouvertures (même règle : la prochaine à venir, sinon la dernière passée) ; si elle n'en a aucune (pas de participation, supporteur, non partant), l'ouverture générale.

**Pour l'agenda** (le flux personnel, § 7.2, et le fichier d'une course, § 5), qui ne dépend pas du moment où on le lit : quand l'ouverture générale vient des épreuves (une course sans ouverture à elle), elle compte pour **toutes les ouvertures d'épreuve à la fois**, puisqu'elle les prendra l'une après l'autre. Une personne sans épreuve a alors une entrée par ouverture d'épreuve, comme elle aura un rappel pour chacune (§ 7.1). Chaque entrée a la source de son ouverture : la course, ou l'épreuve qui l'a.

« Passée » et « à venir » se comptent comme en v7 : **au jour près** sur le site (le jour de l'ouverture est « aujourd'hui » toute la journée), **à la minute près** pour les rappels (§ 7.1). Deux ouvertures du même jour se rangent par leur heure, une ouverture sans heure comptant 9 h (v7 § 3.2).

Exemples, Annecy avec une ouverture de course le lun. 16 à 12:00, le dim. 15 nov. :

| Personne | Ce qu'elle voit en haut de la fiche |
|---|---|
| intéressée par le marathon | Ouverture des inscriptions le lun. 16 nov. à 12:00 |
| intéressée par le semi | Ouverture des inscriptions le mar. 17 nov. à 12:00 (Semi) |
| inscrite sur le 10 km et intéressée par le 5 km | Ouverture des inscriptions le mer. 18 nov. à 12:00 (Route 10 km) |
| intéressée sans épreuve, supporteur, ou qui ne va pas à la course | Ouverture des inscriptions le lun. 16 nov. à 12:00 |

La même course **sans** ouverture générale, le mar. 17 nov. au matin : une personne sans épreuve voit le semi (« aujourd'hui à 12:00 (Semi) ») ; le mer. 18, le 10 km ; après le jeu. 19, plus d'ouverture à venir : les inscriptions sont ouvertes (la date limite, s'il y en a une).

**Où vit cette règle** : `features/events/opening.ts` (nouveau, logique pure), porté en Go dans `server/events` (pour les rappels, le flux et le MCP). `ports_test.go` garde l'empreinte du fichier TypeScript.

### 4.3 Règles (hooks de `server/events`)

**Sur une épreuve** (`validateFormat`) :

- `registration_opening` : un vrai jour (`date_invalid`) ; au plus tard le jour de l'épreuve, c'est-à-dire sa date, sinon le premier jour de la course, et pour une course au mois le dernier jour du mois (`registration_opening_after_start`) ; au plus tard la date limite de la course s'il y en a une (`registration_opening_after_deadline`). Le même jour est permis.
- `registration_opening_time` : `HH:MM` de `00:00` à `23:59` (`time_invalid`).
- **Un jour seul ou une heure seule** demande que la course ait sa propre ouverture : sinon `opening_general_required`, sur `registration_opening` de l'épreuve. Une heure seule n'est plus refusée par `validation_required` comme sur la course : elle prend le jour de la course.
- Une course au mois peut avoir des épreuves avec leur ouverture (comme la course elle-même) : l'ouverture a un jour, l'épreuve n'en a pas.

**Sur une course** (`validateEvent`) :

- quand sa date limite, son début ou sa fin changent : une date limite avant le jour d'ouverture d'une de ses épreuves est refusée (`format_opening_after_deadline` sur `registration_deadline`) ; un début (ou, pour une course au mois, une fin de mois) qui passerait avant le jour d'ouverture d'une épreuve sans date est refusé (`format_opening_after_start` sur `start_date`) ;
- quand son ouverture est vidée alors qu'une épreuve n'a qu'un jour ou qu'une heure : refusé, `opening_used_by_format` sur `registration_opening`. Vider seulement l'heure de la course est permis : ses épreuves qui n'ont qu'un jour n'ont alors plus d'heure.
- Les règles de la v7 sur l'ouverture de la course ne changent pas ; une épreuve qui n'a qu'une heure ouvre le jour de la course, qui les respecte déjà.

**L'ordre d'un envoi du formulaire** (`buildBatch`, porté en Go par `planBatch`) : aucun état intermédiaire refusé, quand une même modification change la course et l'ouverture d'épreuves :

1. les épreuves supprimées (comme avant) ;
2. les épreuves dont l'ouverture est **effacée ou avancée**, ou qui **cessent de dépendre** de l'ouverture de la course (elles passent d'une partie aux deux) : elles restent valables avec la course d'avant ;
3. la course ;
4. les autres épreuves modifiées, dont l'ouverture est **retardée** ou qui **se mettent à dépendre** de l'ouverture de la course (une partie seule), et les épreuves nouvelles.

Cet ordre s'ajoute à celui de la v7 (§ 5.1, le passage au mois et au jour) sans le changer ; le plan dit comment les deux se combinent, avec un test pour chaque cas.

**Codes d'erreur nouveaux** (dans les quatre endroits prévus : `apperr`, `i18n/fr.ts`, `i18n/en.ts`, `i18n/errors.ts`, et les textes du MCP) :

| Code | Français | Anglais |
|---|---|---|
| `format_opening_after_deadline` | Une épreuve ouvre ses inscriptions après cette date limite. | A race opens its registration after this deadline. |
| `format_opening_after_start` | Une épreuve ouvre ses inscriptions après ce jour. | A race opens its registration after this day. |
| `opening_general_required` | Remplis d'abord l'ouverture des inscriptions de la course : cette épreuve en reprend le jour ou l'heure. | Fill in the registration opening of the event first: this race takes its day or time from it. |
| `opening_used_by_format` | Une épreuve reprend le jour ou l'heure de cette ouverture : elle ne peut pas être vide. | A race takes its day or time from this opening: it cannot be empty. |

## 5. Ce que le site en dit

`registrationState` (`features/events/registration.ts`) ne lit plus l'ouverture sur la course : il reçoit l'ouverture qu'on montre (§ 4.2), ou rien. Les états `soon`, `today`, `open`, `closed` et leurs textes ne changent pas, sauf ce qui suit.

**Le nom de l'épreuve** : quand l'ouverture montrée est celle d'une épreuve (et non celle de la course), son nom suit entre parenthèses, tel que la page nomme l'épreuve ; plusieurs épreuves qui ouvrent au même moment sont séparées par « , ».

| Endroit | Ce qui change |
|---|---|
| **Fiche, haut de page** | l'ouverture montrée à la personne (§ 4.2) : « Ouverture des inscriptions le mar. 17 nov. à 12:00 (Semi) · jusqu'au … » |
| **Fiche, encadré « inscris-toi »** (personne « Intéressé ») | la même : « Les inscriptions ouvrent le mar. 17 nov. à 12:00 (Semi). » |
| **Fiche, chaque épreuve** | sous son nom, l'ouverture de l'épreuve **quand elle a la sienne et qu'elle est à venir** : « Ouverture le mar. 17 nov. à 12:00 », « Ouverture aujourd'hui à 12:00 » (sans le nom : on est sous l'épreuve). Rien quand elle suit la course, ni une fois passée. |
| **Liste (carte)** | la pastille dit l'ouverture montrée à la personne qui regarde : « Ouverture le 17 nov. à 12:00 (Semi) ». Les lignes d'épreuve de la carte ne changent pas. Même chose sur l'agenda et dans « Bientôt dans le groupe ». |
| **Accueil, « Inscriptions à faire »** | chaque participation « Intéressé » a sa propre ouverture : celle de son épreuve, ou l'ouverture générale sans épreuve ; la ligne est rangée par son jour à elle. Le reste comme en v7 (pas de « Je suis inscrit » avant le jour de l'ouverture). Pas de nom entre parenthèses : la ligne nomme déjà l'épreuve. |
| **Partage** | la ligne d'ouverture dit l'ouverture générale (le texte part vers quelqu'un qui ne va pas à la course) ; dans la ligne des épreuves, chaque épreuve qui a sa propre ouverture à venir l'ajoute après ses mesures : « Semi · 21,1 km · ouverture le mar. 17 nov. à 12:00 ». Toujours le jour, jamais « aujourd'hui ». |
| **Fichier d'agenda d'une course** (« Ajouter à l'agenda ») | un `VEVENT` d'ouverture par ouverture **de la personne**, comptées pour l'agenda (§ 4.2, une par source), sinon par ouverture générale (une, ou une par ouverture d'épreuve pour une course sans ouverture à elle). L'ouverture de la course garde son `UID` (`opening-<course>`) ; celle d'une épreuve a `opening-<épreuve>`, et son `SUMMARY` nomme l'épreuve. Dans le flux abonné : « Ouverture des inscriptions · Marathon du lac d'Annecy · Semi ». Dans le fichier téléchargé, qui garde la forme qu'il avait en v7 : « Ouverture des inscriptions : Marathon du lac d'Annecy · Semi » (décidé pendant la réalisation). Mêmes alarmes qu'en v7. |

**Accessibilité** : les lignes nouvelles sont du texte (aucun état dit par la couleur seule) ; la ligne d'ouverture d'une épreuve est dans le bloc de l'épreuve, après son nom, pour qu'un lecteur d'écran l'entende avec elle.

## 6. Le formulaire

**L'ouverture de la course** ne change pas, mais gagne une aide sous son jour : « Celle de toutes les épreuves, sauf celles qui ont la leur. »

**Dans le bloc de chaque épreuve**, après « Heure de départ » :

- une case « Cette épreuve ouvre ses inscriptions à un autre moment » ;
- cochée, deux champs apparaissent, **indépendants** (l'un, l'autre ou les deux) : « Ouverture des inscriptions » (date) et « Heure d'ouverture » (`type="time"`), avec une aide commune sous les deux : « À l'heure de Paris. Un jour seul garde l'heure de la course, une heure seule garde son jour. » ;
- décochée, les deux champs disparaissent ; le brouillon garde ce qui est tapé (recocher le rend), mais l'envoi les vide ;
- cochée avec les deux champs vides, rien n'est envoyé pour l'ouverture de l'épreuve (comme décochée) ;
- elle est cochée à l'ouverture du formulaire pour une épreuve qui a un jour ou une heure d'ouverture ;
- les erreurs du serveur s'affichent sous leur champ, dans le bloc de l'épreuve (`opening_general_required` sous son jour) ; `format_opening_after_deadline` sous la date limite, `format_opening_after_start` sous la date de la course, `opening_used_by_format` sous l'ouverture de la course.

**Accessibilité** : la case a son `label` et une cible de 44 px ; les champs ont leur étiquette, l'heure est décrite par son aide (`aria-describedby`) ; quand la case est cochée, le focus reste sur elle.

## 7. Les rappels et l'agenda

### 7.1 Les rappels (planificateur, `server/reminders`)

La v7 (§ 4.3, § 4.6) ne change pas, sauf ce qui suit.

- **Les ouvertures candidates** d'un passage : celles des courses **et** celles des épreuves dont le jour est aujourd'hui, demain ou après-demain à Paris, et dont l'instant `T` est dans les 25 prochaines heures.
- **Les destinataires d'une ouverture `T`** : les personnes (§ 4.2 de la v7 : compte actif, choix de rappels) dont **une des ouvertures** (§ 4.2) est `T` au moment du passage. Concrètement :
  - une ouverture d'épreuve : les participations « Intéressé » ou « Inscrit » sur cette épreuve ;
  - l'ouverture générale : les participations sans épreuve et celles sur une épreuve qui suit la course ;
  - pour une course sans ouverture générale, l'ouverture générale est la prochaine à venir **à l'instant du passage** : après l'ouverture du semi, celle du 10 km devient la générale, et son rappel « 1 jour avant », s'il est déjà dû, part au passage suivant (les fenêtres durent jusqu'à `T`, v7 § 4.3).
- **Une seule fois par personne et par instant** : la table `reminder_deliveries` et son index unique `(user, event, kind, opening_at)` ne changent pas. Deux ouvertures différentes de la même course pour la même personne (deux épreuves) donnent deux rappels ; deux épreuves qui ouvrent au même instant en donnent un.
- **Le texte** : le titre est le nom de la course, suivi du nom de l'épreuve quand l'ouverture est celle d'une épreuve : « Marathon du lac d'Annecy · Semi » (plusieurs épreuves de la personne au même instant : leurs noms séparés par « , »). Le corps ne change pas (« Les inscriptions ouvrent demain à 12:00. »).
- **`tag` et `Topic`** : `opening-<id>`, où `<id>` est celui de l'épreuve pour une ouverture d'épreuve, celui de la course sinon (23 caractères, sous la limite de 32 du `Topic`). Ainsi le rappel du semi ne remplace pas un rappel du marathon pas encore livré.

### 7.2 Le flux d'agenda personnel (`server/calendar`)

- Une entrée d'ouverture **par ouverture du coureur, comptées pour l'agenda** (§ 4.2 : une par source ; pour une course sans ouverture à elle, une par ouverture d'épreuve), au lieu d'une par course. Le flux ne dépend pas de l'heure à laquelle il est lu.
- L'`UID` suit la source, pas le rôle d'ouverture générale : l'ouverture de la course garde l'`UID` de la v7, `opening-<course>-<coureur>@prends-ton-dossard` (un abonnement existant ne voit pas de doublon) ; celle d'une épreuve a `opening-<épreuve>-<coureur>@prends-ton-dossard`, et son `SUMMARY` nomme l'épreuve, que le coureur soit sur cette épreuve ou sans épreuve.
- Le reste comme en v7 (heure ou jour entier, alarmes selon le choix, `DESCRIPTION`, `URL`, les ouvertures passées restent).
- Le flux du groupe n'a toujours aucune ouverture.

## 8. Le MCP

| Outil | Ce qui change |
|---|---|
| `create_event`, `update_event` | `formats[]` prend `registration_opening` (AAAA-MM-JJ) et `registration_opening_time` (HH:MM, heure de Paris) |
| `add_format`, `update_format` | les mêmes champs, l'un, l'autre ou les deux (un seul demande une ouverture sur la course) ; dans `update_format`, une chaîne vide efface ce champ seul, et effacer demande une confirmation comme les autres champs |
| `get_event`, `search_events` | chaque épreuve qui a sa propre ouverture donne ses champs tels qu'enregistrés (`registration_opening`, `registration_opening_time`, absents quand ils sont vides) et `opens` : le jour et l'heure qui en résultent (`AAAA-MM-JJ` et `HH:MM`, l'heure absente quand il n'y en a pas). Rien pour une épreuve qui suit la course. |
| `home` | « Inscriptions à faire » suit § 5 (portage de `registrationTodo.ts` et du nouveau `opening.ts`) |
| `admin_merge` | dit les ouvertures d'épreuve effacées (§ 9) |

- Les descriptions des champs de la course disent : « l'ouverture de toutes les épreuves, sauf celles qui ont la leur ».
- Les instructions du serveur, ligne de l'ouverture : « Une course peut avoir une ouverture des inscriptions (jour, heure de Paris), une précision au mois quand le jour n'est pas connu ; une épreuve peut avoir sa propre ouverture, qui remplace celle de la course. »
- Les règles et les codes sont ceux du § 4.3, vérifiés avant l'écriture comme le fait déjà `race_writes.go`.
- Le nombre d'outils ne change pas.

## 9. La fusion de doublons

- Une épreuve déplacée vers la course gardée qui n'a qu'une partie de son ouverture est d'abord **complétée** avec l'ouverture de la course d'où elle vient (son jour et son heure deviennent ceux qu'elle avait vraiment) : elle ne se met pas à suivre une autre course.
- Elle garde alors son ouverture si elle reste valable (§ 4.3 contre la course gardée) ; sinon l'ouverture **et** son heure sont effacées.
- Un jour seul déjà complété, sans heure, est aussi effacé quand la course gardée a une heure ou n'a pas d'ouverture à elle : il prendrait l'heure d'une autre course, ou n'aurait plus de quoi se compléter (décidé pendant la réalisation).
- Le résultat et l'aperçu de la fusion le disent, comme pour les dates effacées : `ClearedFormatOpenings`, « 1 ouverture d'épreuve effacée » / « 2 ouvertures d'épreuve effacées » (`mergePreview.ts`, porté par `describeMerge`, et son empreinte).
- Une fusion de deux épreuves garde l'ouverture de l'épreuve gardée.

## 10. Architecture

- `server/migrations/9t_format_registration_opening.go` (+ test de retour arrière puis réapplication).
- `server/events` : les règles du § 4.3 ; la règle du § 4.2 en Go (les ouvertures d'une course, l'ouverture générale à un instant, les ouvertures d'un coureur), avec `OpeningInstant` de la v7.
- `server/reminders` : candidats, destinataires, titre, `tag`/`Topic` (§ 7.1).
- `server/calendar` : entrées d'ouverture par ouverture (§ 7.2).
- `server/admin/merge.go` : § 9.
- `server/mcp` : § 8 ; `ports_test.go` : empreintes de `opening.ts`, `registration.ts`, `registrationTodo.ts`, `saveEvent.ts`, `formDraft.ts`, `mergePreview.ts` selon ce qui change.
- `server/cmd/seed.go` : une course du seed a une épreuve avec sa propre ouverture (pour la démo des instances neuves et les tests).
- Web : `lib/types.ts` (`FormatRecord`), `features/events/opening.ts` (nouveau), `registration.ts`, `EventHero.tsx`, `EventPage.tsx` (encadré, blocs d'épreuve), `EventCard.tsx` (il lui faut le coureur de la personne qui regarde), `share.ts`, `features/calendar/eventIcs.ts`, `features/home/registrationTodo.ts`, `formDraft.ts`, `saveEvent.ts`, `EventForm.tsx`, `i18n/fr.ts`, `en.ts`, `errors.ts`.

## 11. Tests

Comme le CLAUDE.md (§ 4.6) : Go en tests externes, horloge réglable, cas au changement d'heure ; web avec Vitest.

**Go** :

- `TestFormats_RegistrationOpening` : jour faux, après le jour de l'épreuve (datée, non datée, course au mois), après la date limite, le même jour que la date limite, heure fausse ; un jour seul et une heure seule acceptés quand la course a son ouverture, refusés sans (`opening_general_required`).
- `TestEvents_FormatOpeningHeld` : date limite avancée avant l'ouverture d'une épreuve, début avancé avant l'ouverture d'une épreuve sans date, ouverture de la course vidée alors qu'une épreuve n'a qu'une partie (`opening_used_by_format`), heure de la course vidée (permis), une modification qui ne touche rien de tout cela passe.
- `TestFormatOpening` : les quatre cas (les deux, un jour seul, une heure seule, rien) ; un jour seul quand la course n'a pas d'heure ; une épreuve qui retombe sur l'ouverture de la course compte comme elle ; la course qui change d'heure entraîne l'épreuve qui n'a qu'un jour.
- `TestGeneralOpening` (règle du § 4.2) : avec une ouverture de course ; sans, avec trois épreuves avant, entre et après leurs ouvertures (à la minute) ; toutes passées ; aucune ; deux épreuves au même jour, l'heure qui départage, sans heure = 9 h.
- `TestReminders_PerFormat` : Annecy (le marathon suit la course, le semi, le 10 km, le 5 km ont la leur) : la personne du semi reçoit le rappel du semi et pas celui du lundi ; une personne sans épreuve reçoit celui du lundi seulement ; une personne sur deux épreuves en reçoit deux ; deux épreuves au même instant en donnent un ; course sans ouverture générale : la personne sans épreuve reçoit le rappel de chaque ouverture, l'un après l'autre ; le titre et le `Topic`.
- `TestCalendarFeed_FormatOpenings` : une entrée par ouverture, l'`UID` de l'ouverture générale inchangé, le `SUMMARY` d'une épreuve.
- `planBatch` : chaque ordre du § 4.3, et combiné au passage au mois et au jour.
- Fusion : ouverture gardée, effacée et comptée.
- MCP (`package mcp_test`) : les champs de chaque outil, l'effacement avec confirmation, `get_event` et `search_events`, `home`.
- Migration 9t.

**Web** :

- `opening.test.ts` : les mêmes cas que `TestFormatOpening` et `TestGeneralOpening`, au jour près, et les ouvertures d'une personne (Intéressé, Inscrit, supporteur, non partant, sans épreuve, deux épreuves).
- `registrationState` avec une ouverture d'épreuve ; le nom entre parenthèses.
- `EventHero` : les quatre lignes du tableau d'exemples du § 4.2.
- `EventPage` : la ligne d'ouverture d'une épreuve qui a la sienne, rien pour une épreuve qui suit la course, rien une fois passée ; l'encadré.
- `EventCard` : la pastille selon la personne qui regarde.
- `todosOf` : chaque participation rangée par sa propre ouverture.
- `shareText` : l'ouverture générale, et l'ouverture d'une épreuve dans la ligne des épreuves.
- `eventIcs` : un `VEVENT` par ouverture de la personne, l'`UID` et le `SUMMARY` d'une épreuve.
- `EventForm` : la case, ses deux champs indépendants (un jour seul, une heure seule envoyés seuls), décocher vide à l'envoi, recocher rend ce qui était tapé, les erreurs sous leur champ.
- `buildBatch` : l'ordre du § 4.3.

## 12. Hors de cette version

- **Une date limite par épreuve** : la date limite reste celle de la course.
- **Un lien d'inscription par épreuve** : Annecy en a un seul.
- **Des ouvertures par public** (habitants, licenciés FFA, bénévoles), comme le calendrier d'Annecy : approche 3, écartée.

## 13. Décisions à valider

1. **« La plus proche », sans ouverture générale** : la prochaine à venir (au jour près sur le site, à la minute pour les rappels), et une fois toutes passées, la dernière. Conséquence : une personne sans épreuve reçoit un rappel pour chaque ouverture, l'une après l'autre. L'autre lecture : toujours la première, et un seul rappel.
2. **« Inscrit ou intéressé »** donne sa date ; un supporteur et un non-partant voient l'ouverture générale.
3. **Sur plusieurs épreuves**, le haut de la fiche dit la plus proche des siennes ; l'agenda et les rappels les ont toutes.
4. **Le nom de l'épreuve entre parenthèses** quand l'ouverture montrée est celle d'une épreuve, sur la fiche, l'encadré et la pastille.
5. **La pastille de la liste** suit la règle de la fiche (la personne qui regarde), et les lignes d'épreuve des cartes ne disent pas leur ouverture.
6. **Sur la fiche, chaque épreuve qui a sa propre ouverture à venir la dit**, à tout le monde ; une épreuve qui suit la course ne dit rien.
7. **Une valeur partielle** (ta règle : un jour seul ou une heure seule reprend l'autre partie de la course, qui doit avoir son ouverture) : j'en tire que vider l'ouverture de la course est refusé tant qu'une épreuve en dépend, que vider seulement son heure est permis (l'épreuve qui n'a qu'un jour n'a alors plus d'heure), qu'une épreuve qui retombe sur le même jour et la même heure que la course compte comme elle, et qu'une course sans ouverture à elle n'a que des épreuves complètes (jour et heure).
8. **Une case dans le bloc de l'épreuve** ouvre les deux champs, plutôt que deux champs toujours visibles dans chaque bloc.
9. **La course refuse** d'avancer sa date limite ou son début avant l'ouverture d'une épreuve (deux codes nouveaux), plutôt que d'accepter des données qui se contredisent.
10. **La fusion efface** une ouverture d'épreuve qui ne serait plus valable, et le dit.
11. **Rappels** : le titre « Course · Épreuve », un `Topic` par ouverture, un seul rappel par personne et par instant.
12. **Le flux** : une entrée par ouverture ; celle de la course garde son `UID`. Pour une course sans ouverture à elle, une personne sans épreuve a dans son agenda toutes les ouvertures d'épreuve (une entrée chacune, `UID` stable), comme elle a un rappel pour chacune ; l'agenda ne dépend pas de l'heure à laquelle il est lu (ajouté après la relecture de la spec).
13. **Le fichier d'agenda d'une course** porte les ouvertures de la personne qui le télécharge, sinon la générale.
14. **Le partage** dit l'ouverture générale, et l'ouverture de chaque épreuve qui a la sienne dans la ligne des épreuves.
15. **Le seed** gagne une course avec une épreuve qui a sa propre ouverture.
16. **Annecy** : une fois en production, je saisis le jour seul du semi (mar. 17), du 10 km (mer. 18) et du 5 km (jeu. 19), qui reprennent les 12:00 de la course, avec ton accord ; la marche nordique n'est pas une épreuve de la fiche.
17. **La fusion complète** une ouverture partielle avec la course d'où vient l'épreuve, avant de la vérifier contre la course gardée.
18. **Le calendrier** : la v9 n'arrivera pas à temps pour les ouvertures d'Annecy ; d'ici là, le site dit le lundi pour toutes les épreuves. Personne du groupe n'est encore sur le semi, le 10 km ou le 5 km, donc le rappel de lundi est le bon pour tous.
