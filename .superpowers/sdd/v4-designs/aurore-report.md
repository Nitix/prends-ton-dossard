# Variante « Aurore » — une course à l'aube

Branche `design/v4-aurore` (worktree `.superpowers/worktrees/aurore`), à partir de `c5c7d1a` (v3.1).

- `1ad0943` feat(web): « Aurore », les jetons et le cadre
- `5e90833` feat(web): « Aurore » sur toutes les pages

`pnpm --dir web typecheck`, `pnpm --dir web build`, `lint` et `fmt:check` passent. Les tests unitaires (projet `unit`, 678) passent. Les tests navigateur de Vitest n'ont pas été lancés (consigne du deuxième tour).

## L'idée

Le moment où l'on part courir avant le jour : un ciel violet qui se réchauffe en rose et en pêche à l'horizon, le soleil qui se lève, et une journée claire. Le ciel est en haut de chaque page (le nom de l'appli en blanc), et la page monte par-dessus sur une feuille lilas très claire aux coins arrondis. Le dégradé ne sert qu'au ciel, aux bandeaux (fiche, profil, connexion), aux boutons principaux, à l'onglet courant, aux pastilles de date et aux anneaux. Le contenu reste sur du blanc et sur `#FBF8FF`, à l'encre prune ; les pages denses (fiche, formulaires, admin) sont des cartes blanches sobres.

## Palette

| Rôle | Jeton | Hex |
|---|---|---|
| Aube douce (anneaux, petits accents, halo) | `bg-dawn` | `#FFB38A` → `#FF7EB3` → `#8B7CFF` |
| Aube profonde (texte blanc : boutons, onglet courant, pastille de date) | `bg-dawn-deep` | `#D6336F` → `#A63FAE` → `#5E4AE3` |
| Ciel du haut de page | `bg-dawn-sky` | `#4B37C4` → `#6A4EE0` → `#A63FAE` → `#D6336F`, lueur `#FFB38A` en bas à droite |
| Ciel des bandeaux (fiche, coureur) | `bg-dawn-hero` | `#4B37C4` → `#5E4AE3` → `#8A42C4` → `#C2367F`, lueur `#D6336F` |
| Pêche | `peach-50…800` | `#FFF6F0` `#FFEADD` `#FFD5BC` `#FFB38A` `#FF9A6A` `#F47E4E` `#E5622F` `#B04A22` `#86391C` |
| Rose corail | `blush-50…800` | `#FFF2F8` `#FFE4F0` `#FFC9E0` `#FFA3C9` `#FF7EB3` `#F0579A` `#D6336F` `#B0285C` `#87204A` |
| Violet | `iris-50…900` | `#F5F3FF` `#ECE8FF` `#DAD3FF` `#BDB2FF` `#8B7CFF` `#7462F7` `#5E4AE3` `#4B37C4` `#3A2B99` `#2A2070` |
| Encre prune (texte) | `ink` = `neutral-900` | `#241B35` |
| Gris prunes (bordures, texte secondaire) | `neutral-50…950` | `#FBF8FF` `#F4EFFA` `#E9E2F2` `#D8CFE5` `#B4A9C4` `#8E829F` `#6B6080` `#4F4563` `#362D49` `#241B35` `#170F24` |
| Cartes | `white` | `#FFFFFF` |
| Danger (inchangé) | `red-700` | `#B91C1C` |

La gamme `neutral-*` de Tailwind est remplacée par les gris prunes dans `@theme` : toutes les classes `neutral-*` de l'appli les prennent sans retouche.

Contrastes vérifiés (calculés) :
- encre `#241B35` : 16,4:1 sur blanc, 15,6:1 sur `#FBF8FF` ; texte secondaire `#6B6080` : 5,8:1 sur blanc, 5,5:1 sur la page ;
- blanc sur l'aube profonde : 4,6:1 au pire (`#D6336F`), 5,3:1 (`#A63FAE`), 5,9:1 (`#5E4AE3`), toutes les teintes intermédiaires ≥ 4,6:1 ; c'est pourquoi le texte blanc n'est jamais posé sur la pêche (`#FFB38A`, 1,7:1) ni sur le violet doux (`#8B7CFF`, 3,3:1) — ceux-là ne portent que du texte à l'encre (9,4:1 et 5,0:1) ou rien ;
- blanc dans les bandeaux : ≥ 4,6:1 partout où il y a du texte (`#8A42C4` 5,7:1, `#C2367F` 5,1:1) ; l'échéance est sur un voile prune (plus sombre), les notes sur un verre blanc à l'encre ;
- le nom de l'appli sur le ciel (21 px, 800) : gros texte, ≥ 4,6:1 ;
- mois de la liste `#4B37C4` 7,6:1 ; « dans 9 jours » en `iris-700` 7,9:1 ; étiquette d'échéance `#86391C` sur `#FFF6F0` 7,5:1 ; initiales `#3A2B99` sur le pastel ≥ 8,9:1 ;
- ligne du profil d'altitude : de `#E5622F` (3,4:1) à `#5E4AE3` (5,9:1) sur blanc ;
- anneau de focus `#5E4AE3` 3 px (5,9:1), blanc sur le ciel.

## Polices

- **Plus Jakarta Sans** 600–800 : titres, nombres, pastilles, onglets (via `font-display`, et d'office sur `h1`, `h2`, `h3`, `legend`, `summary`).
- **Inter** 400–700 (variable) : le texte.

Chargées par un `<link>` Google Fonts dans `web/index.html` (avec `preconnect`). **Pour les héberger soi-même** : mettre dans `web/public/fonts/` les `woff2` latin de Plus Jakarta Sans (variable 600–800, ou 600/700/800 statiques) et d'Inter (variable 400–700), environ 150 Ko en tout ; déclarer les `@font-face` (`font-display: swap`) en tête de `styles.css` ; retirer le `<link>` et les `preconnect`. Les piles `--font-display` et `--font-sans` ont déjà leurs replis (`Inter`, `system-ui`, `Segoe UI`…).

## Motifs

- **Le soleil levant** (`SunArc`, SVG en ligne) : un demi-soleil sur l'horizon, trois arcs de lumière et, le long de l'horizon, le pointillé d'un parcours. Dans le ciel du haut (à droite sur un téléphone, entre le nom et les onglets sur grand écran ; masqué sur la fiche, qui a le sien), dans les bandeaux de la fiche et du coureur, sur la page de connexion, et en couleur dans les états vides (liste, agenda).
- **Le logotype** : une tuile blanche avec le soleil sur l'horizon et une piste en pointillé, puis le nom.
- **Le petit soleil** : un demi-disque en dégradé devant chaque titre de bloc ; un trait d'aube sous chaque titre de page ; une ligne d'horizon après le mois dans la liste ; un filet d'aube au bord des derniers commentaires.
- **Les anneaux** (`CountdownRing`) : un anneau en dégradé qui se remplit à l'approche (30 jours), avec le nombre de jours au milieu (unité `Intl` étroite : « 9 j », « 9 d ») — inscriptions à faire, prochaines courses, et en blanc dans le bandeau de la fiche (jours avant la course). Décoratif : les mots disent les jours.
- **La pastille de date** (`DateChip`) : jour de la semaine, jour en grand, mois (« NOV 29–2 DÉC » sur deux mois, l'année si ce n'est pas celle-ci), en aube profonde ; la date reste en mots pour un lecteur d'écran.
- **Verre et lueur** : la carte de connexion et les notes de la fiche en verre dépoli (`backdrop-blur`, avec un fond blanc opaque à 95 % si le navigateur ne floute pas), lueurs floues qui dérivent dans le ciel, ombres teintées de violet, halo rose autour de la carte.
- **Pétillant** : les cartes se soulèvent au survol, les boutons s'enfoncent, le « + » tourne, le soleil monte à l'arrivée, l'anneau se dessine, la coche du statut courant apparaît dans un petit soleil à l'ouverture du menu, les toasts montent. Tout est coupé par `prefers-reduced-motion`. Les dialogues ne font que s'estomper et monter de 12 px (jamais d'échelle).

## Ce qui a changé

Jetons et pièces partagées :
- `styles.css` : `@theme` (couleurs, polices, rayons, ombres `card`/`lift`/`glow`/`bar`, animations), utilitaires `bg-dawn`, `bg-dawn-deep`, `bg-dawn-sky`, `bg-dawn-hero`, `text-dawn`, `glass` ; classes `.page-title`, `.block-title`, `.card-title`, `.month-title`, `.eyebrow`, `.card`, `.card-lift`, `.press`, `.avatar-soft`, `.on-dawn` ; anneau de focus, focus des champs, dialogues, mouvement réduit.
- Nouveaux : `components/Dawn.tsx` (`SunArc`, `DateChip`, `CountdownRing`), `components/Brand.tsx` (`BrandMark`, `DawnSky`), `components/icons.tsx`.
- `buttons.ts` : pilules ; `PRIMARY` en aube profonde, `SECONDARY` blanc, nouveau `ON_DAWN` (blanc sur le ciel), `DANGER`. `section.ts`, `Field` (`INPUT`), `TextField`, `Dialog`, `Toast`, `OfflineBanner`, `AvatarPicker`.
- `AppShell` (ciel, feuille, bouton +), `TabBar` (barre blanche flottante en bas sur un téléphone, capsule blanche dans le ciel sur grand écran, collante ; icônes dès `lg` ; le nom de l'appli n'y est plus en double, il est dans le ciel), `routes/__root.tsx` (connexion et invitation sur le ciel, carte en verre).
- `web/index.html` (`theme-color` `#5e4ae3`, polices) et `manifest.webmanifest` (`theme_color` `#5e4ae3`, `background_color` `#fbf8ff`).

Pages :
- **Fiche** (`EventPage`) : bandeau ; rappel d'inscription en encadré pêche ; actions : « J'y vais » sur toute la largeur, puis « Ajouter quelqu'un », « Ajouter à mon agenda », « Modifier », « Supprimer » deux par deux (icône et mot, 44 px au moins, la dernière seule prend la ligne) ; dès `sm` sur une ligne (le contenu passe à `max-w-4xl` dès `lg`, les cinq tiennent). Sections en cartes, lignes des coureurs sur lilas, titre d'épreuve en deux tons.
- **Parcours** : `RouteSection` (tuiles), `mapBox` (cadre arrondi, liseré blanc, lueur rose et violette), `TrackMap` (liseré blanc + tracé en dégradé via un `linearGradient` SVG, départ violet, arrivée encre) et `TrackMap.css` (fond de carte désaturé, zoom arrondi, étiquettes « Départ / Arrivée » en pilules), `ElevationProfile` (largeur mesurée par `ResizeObserver` : il prend toute la largeur du panneau sans que les libellés grossissent ; ligne dégradée de 2,5 px, lavis de 28 % à 2 %, grille en filets).
- **Cartes** : `EventCard`, `ParticipantChips` (peloton d'avatars qui se chevauchent, liseré blanc ; non confirmé en pointillé), `ListPage` (mois, état vide), `Filters`, `GroupSoon`.
- **Accueil** : `PasskeyBanner`, `PendingConfirmations`, `RegistrationTodoBlock` (anneau), `MyUpcoming` (anneau + « dans 9 jours » sous la date), `ResultsToEnterBlock`, `LatestComments`.
- **Profil** : `RunnerProfile` (bandeau avec la photo cerclée de blanc, résultat en étiquette), `UpcomingRaces`, `ProfilePage`, `SettingsPage` et `Section` (réglages en cartes), `PasskeyList`, `CalendarSection`.
- **Statistiques** : `TotalsTable` — sur un téléphone, chaque ligne est une carte (titre, puis cinq tuiles avec le titre de leur colonne), plus de défilement de côté ; dès `sm`, un tableau dans une carte. Les rôles `table/row/cell…` sont écrits pour qu'il reste un tableau pour un lecteur d'écran quel que soit son affichage (lint désactivé dans ce fichier pour ces deux règles, avec la raison). `StatsPage`.
- **Agenda** : `AgendaPage`, `MonthGrid` (jour choisi en aube profonde, aujourd'hui cerclé de violet, points roses ; grand écran : aujourd'hui en pastille, événements en étiquettes lilas), `DayList`.
- **Formulaires** : `EventForm` (champs dans une carte), `FormatFieldset` (carte, légende en pilule d'aube posée sur le bord ; `min-w-0` corrige un débordement de côté à 375 px), `fields`, `DuplicateHint`.
- **Le reste** : `LoginPage`, `InvitationPage`, admin (`AdminLayout` en pilules, `MembersPage`, `MemberRow`, `TypesPage`, `DuplicatesPage`, `EventPicker`, `UserPasskeys`, `CreateLinkDialog`), `ParticipationMenu`, `CommentsSection`, `OffersSection`.

Aucun texte, aucune route, aucune donnée ni code serveur modifiés. Ajouts purement visuels : les icônes (cachées aux lecteurs d'écran), les anneaux et la pastille de date (cachés, les mots restent), l'anneau du bandeau de la fiche (jours avant la course, caché).

## Captures

Dans `C:\Users\guill\dev\courses\.superpowers\sdd\v4-designs\aurore\` (375 px en `@2x` : pleine page et `-fold` pour le premier écran ; 1280 px en pleine page) :
`connexion`, `home`, `liste`, `agenda`, `event` (avec une trace GPX de 12,3 km ajoutée en local à « Trail court » de « Trail des Crêtes », une boucle sur le Mont Veyrier), `dialog` (« Ajouter quelqu'un »), `menu` (menu d'une participation ouvert), `nouveau`, `profil`, `reglages`, `coureur`, `stats`, `admin-membres`, `admin-types`, `admin-doublons`.

Pour les captures pleine page, la fenêtre est agrandie à la hauteur de la page : la barre d'onglets et le bouton + sont donc en bas de l'image, comme sur un écran.

## Points à reprendre

- L'invitation n'a pas de capture (il faut un jeton) ; elle prend les mêmes pièces que la connexion.
- Le profil d'altitude n'a ni survol ni infobulle (le skill dataviz en voudrait une : ce serait un comportement nouveau).
- Le verre de la carte de connexion se teinte de lilas et de rose là où le soleil est derrière : voulu, mais un peu laiteux sur grand écran.
- Le pointillé « non confirmé » (`#B4A9C4`, 2,2:1) et celui de « À confirmer » (`#FFA3C9`) sont pâles ; les mots disent toujours l'état.
- Les actions des offres (covoiturage, logement) gardent leurs rangées de boutons qui passent à la ligne sur un téléphone, comme avant.
- Dans le menu principal, « Admin » n'est pas l'onglet courant sur `/admin/types` et `/admin/doublons` (comportement d'avant, non touché).
- Sur grand écran, le contenu passe de `max-w-3xl` à `max-w-4xl` dès `lg`.
- Polices chargées depuis Google Fonts (voir plus haut pour les héberger).
- Le dossier `.pb_design/` du worktree (données et binaire locaux) n'est pas suivi : il peut être supprimé.

## Tests

- `pnpm --dir web exec vitest run --project unit` : 678 tests, tous passent.
- Les tests navigateur n'ont pas été lancés. Ceux qui risquent d'échouer à cause du changement visuel : `TabBar.test.tsx` / `AppShell.test.tsx` (nom de l'appli plus dans la barre, icônes dans les onglets, classes des onglets) ; `Provisional` (classe du `h1`) ; `EventCard` / `ListPage` (date en `sr-only` + pastille, taille des pastilles d'avatar `size-9`) ; `MyUpcoming` (le compte à rebours est sous la date, plus à droite) ; `TotalsTable` / `StatsPage` / `RunnerProfile` (rôles explicites, en-tête `sr-only` sous `sm`, titres de tuiles) ; `ElevationProfile` / `drawings` (le `svg` est dans une `div`, largeur mesurée) ; `TrackMap` (un liseré `.track-halo` de plus, couleurs) ; `EventPage` (grille d'actions, la dernière seule dans une `div`) ; `Dialog` (un conteneur de plus autour du contenu) ; les tests qui lisent des classes (`rounded-lg`, `border-neutral-200`…).
