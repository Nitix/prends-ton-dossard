# Variante « Crête » — l'aube sur les crêtes, dessinée comme une carte

Branche `design/v4-crete` (worktree `.superpowers/worktrees/crete`), à partir de `design/v4-aurore` (`03e16ec`).

- `5472f3d` feat(web): « Crête », l'aube d'« Aurore » sur les crêtes de « Sentier »
- `26f925a` feat(web): le profil du D+ de « Chrono » dans « Crête »

Demande de l'utilisateur : « essaie de faire un mélange aurora et sentier. J'aime bien le mode map des entêtes et j'aime bien les dégradés des boutons et tout d'aurora », puis « et peux tu ajouter le graphique du d+ de chrono ».

`pnpm --dir web typecheck`, `build`, `lint` et `fmt:check` passent ; tests unitaires (projet `unit`) : 678, tous passent. Les tests navigateur n'ont pas été lancés (consigne du second tour).

## L'idée

Tout « Aurore » (le ciel violet qui se réchauffe en corail, les boutons et pastilles en dégradé, les anneaux, les cartes blanches, la barre d'onglets flottante, la feuille lilas qui monte sur le ciel, Plus Jakarta Sans + Inter), avec les entêtes « carte » de « Sentier » repeints aux couleurs de l'aube : l'alpenglow. Le ciel porte les courbes de niveau d'une carte topographique en blanc, et à son pied trois crêtes en violet de plus en plus profond, le soleil qui se lève derrière elles. La feuille de la page monte par-dessus les crêtes : ses coins arrondis laissent voir la nuit de la vallée. Les motifs restent dans les entêtes, les bandeaux (fiche, profil, coureur), la connexion et les états vides ; jamais derrière un contenu dense.

## Palette

Celle d'« Aurore » (voir `aurore-report.md` : pêche, rose corail, violet, gris prunes, encre `#241B35`, dégradés `bg-dawn`, `bg-dawn-deep`, `bg-dawn-sky`, `bg-dawn-hero`), plus :

| Rôle | Hex |
|---|---|
| Crêtes lointaines (éclairées par l'aube), dégradé du sommet au pied | `#E46AA6` → `#A54CB6`, liseré `#FFD5BC` à 60 % (l'alpenglow) |
| Crête du milieu | `#7D43B8` → `#5B3AA8` |
| Collines proches (la nuit de la vallée, aussi sous la feuille) | `#3B2B8A` → `#2A2070` |
| Soleil | dégradé radial `#FFF7F0` → `#FFD2B8` → `#FF9FC4`, halo `#FFD5BC` → transparent, arcs blancs à 45 / 28 / 16 % |
| Courbes de niveau sur le ciel | blanc à 15 % (entête), 14 % (bandeaux, fondues vers le haut), 16 % (connexion) |
| Courbes de niveau des états vides | `iris-800` `#3A2B99` à 9 % |
| Pente < 5 % | `#8DA4F2` (pervenche) |
| Pente 5–10 % | `#3FBF84` (vert) |
| Pente 10–15 % | `#F8C64B` (or) |
| Pente 15–25 % | `#FF8A4C` (mandarine) |
| Pente ≥ 25 % | `#D6336F` (framboise, le rose profond de l'aube) |

Contrastes (calculés) :
- le nom de l'appli (21 px, 800 : gros texte) sur le ciel, à l'endroit d'un trait de courbe : 5,6:1 sur `#4B37C4`, 4,2:1 au pire sur `#6A4EE0` (3:1 demandé) ; sans trait, comme dans « Aurore » ;
- texte blanc des bandeaux : les courbes y sont masquées en haut (dégradé de masque), là où sont le nom, la date, le lieu ; au bas du texte, avec 6 % de trait, 5,1:1 sur `#8A42C4` et 4,7:1 sur `#C2367F` ;
- profil d'altitude : légende `#4F4563` 8,9:1, graduations `#6B6080` 5,8:1 sur blanc, altitude du sommet et lecture du curseur en blanc sur `bg-dawn-deep` (≥ 4,6:1) ; la ligne du profil est à l'encre (16:1) et dessine la forme quelle que soit la couleur dessous ; les zones de pente sont des aplats (2,3 à 4,6:1 sur blanc, l'or 1,6:1), comme dans « Chrono » : leur sens est écrit dans la légende et dit en mots par le curseur.

## Polices

Celles d'« Aurore » : Plus Jakarta Sans 600–800 (titres, nombres) et Inter 400–700, par un `<link>` Google Fonts. Pour les héberger : voir `aurore-report.md`. Le profil d'altitude garde ces polices, chiffres en `tabular-nums` (pas la police mono de « Chrono »).

## Motifs (SVG en ligne, aucune image)

- **Une seule définition par page** (`components/Alpenglow.tsx`, `MotifDefs`, rendu une fois par la racine) : le tracé des courbes de niveau (celui de « Sentier », 9,6 Ko), les trois crêtes, leurs dégradés, le soleil et un motif (`<pattern>`) de la carte en miroir. Chaque entête, bandeau ou état vide n'y fait référence que par `<use>` : quelques éléments chacun, pas quelques kilo-octets de tracé.
- **Courbes de niveau** (`Contours`) : étirées pour couvrir un bandeau, la connexion ou un état vide ; en motif répété à une échelle fixe (une tuile de 864 × 432 px, chaque tuile le miroir de sa voisine pour que les traits se rejoignent) dans le ciel de l'entête, large et bas, pour garder la même densité du téléphone au grand écran. Traits d'un pixel.
- **Crêtes** (`Ridges`) : trois silhouettes de 2 400 unités, générées pour cette variante (déplacement du point milieu sous un profil dessiné : une vallée basse sous le nom de l'appli au téléphone, un sommet et un col pour le soleil à droite), prolongées de leur image en miroir de chaque côté (bande de 7 200 unités pour les très grands écrans). Elles gardent leurs proportions : un écran plus large montre plus de montagnes, pas des montagnes plus larges ; `steep` les rend plus hautes (connexion : ×2,2). Le soleil se place tout seul derrière la crête la plus haute au point choisi (calcul sur les points des tracés), un tiers caché.
- **Où** : l'entête (crêtes juste au-dessus de la feuille, soleil à droite au téléphone, entre le nom et les onglets sur grand écran ; pas de soleil dans l'entête des pages qui ont le leur : fiche, profil, coureur), le bandeau de la fiche (crêtes en bas du bandeau, soleil dans un col à droite, l'anneau du compte à rebours en haut à droite comme dans « Aurore »), le bandeau du profil et du coureur (la photo devant les montagnes), la connexion et l'invitation (tout l'écran : ciel de carte, grande chaîne en bas, carte en verre au milieu).
- **Le logotype** : la tuile blanche d'« Aurore », dessin nouveau (`PeakGlyph`) : le soleil dans un col, un sommet lointain lilas, une crête proche en violet profond et un sentier en pointillé.
- **États vides** (`EmptyState`, liste et agenda) : carte blanche sur des courbes de niveau prune à 9 %, une petite aube sur deux sommets (arcs en dégradé, soleil, sentier en pointillé), fondue vers le bas.
- **Sous les titres de page** : le trait d'aube d'« Aurore » devient une petite ligne de crête en dégradé (masque SVG en CSS).
- **Mouvement** : les lueurs du ciel dérivent, le soleil monte à l'arrivée ; tout est coupé par `prefers-reduced-motion` (vérifié : le soleil est bien là, immobile).

## Le graphique du D+ (repris de « Chrono »)

`features/route/ElevationProfile.tsx` et `features/route/slope.ts` :
- le profil coloré par la pente, en cinq zones (< 5 %, 5–10, 10–15, 15–25, ≥ 25 %, en montée comme en descente), lu par bandes de 5 px et lissé (une bande isolée prend la zone de ses voisines) ;
- la ligne à l'encre, la grille en filets, les graduations (une étiquette de km qui toucherait la précédente est omise, sa graduation reste) ;
- la légende « Pente » sous le graphique, chaque couleur avec ses mots ;
- le sommet nommé : un point cerclé de blanc et son altitude dans une pastille d'aube ;
- le curseur au doigt et à la souris : un trait, un point de la couleur de la bande dessous, et la pastille qui devient « 7,2 km · 1 238 m · 5 % » ;
- **au clavier aussi** (ajout) : le curseur est un `<input type="range">` natif posé sur le tracé, sans pouce visible (le dessin le montre) ; Tab y entre (anneau de focus violet autour du tracé), les flèches avancent d'un centième du parcours, Page préc./suiv. d'un dixième, Début et Fin vont au départ et à l'arrivée, Échap range le curseur ; un lecteur d'écran entend « Position sur le profil, 5 km, altitude 953 m, pente 15 % » (`aria-valuetext`). Deux textes ajoutés en FR et EN : `route.slope`, `route.profileCursor`, `route.profileReading`.
- toute la largeur du panneau (mesurée), hauteur 212 px.
- Les couleurs de « Chrono » (bleu, vert, jaune, orange, rouge) sont légèrement réaccordées à l'aube : le bleu tire vers la pervenche, le rouge devient la framboise de l'aube ; l'ordre et l'écart de clarté restent, pour qu'elles se distinguent aussi avec un daltonisme.
- La carte : le graphique de « Chrono » ne marque ni départ ni arrivée, il n'y avait rien à accorder ; la carte garde celle d'« Aurore » (tracé en dégradé, départ violet, arrivée encre).

## Ce qui a changé (par rapport à « Aurore »)

- Nouveaux : `components/Alpenglow.tsx` (`MotifDefs`, `Contours`, `Ridges`, `NIGHT`), `components/motifPaths.ts` (courbes de « Sentier », trois crêtes générées), `components/EmptyState.tsx`, `features/route/slope.ts`.
- `components/Brand.tsx` (logotype `PeakGlyph`, ciel `DawnSky` avec carte, crêtes, soleil et la nuit sous la feuille), `components/AppShell.tsx` (entête plus haute : 116 px au téléphone, 160 px sur grand écran ; la feuille chevauche aussi sur grand écran ; pas de soleil d'entête sur les pages à bandeau), `components/TabBar.tsx` (décalage de la capsule pour l'entête plus haute), `components/Dawn.tsx` (le `SunArc` d'« Aurore » retiré, remplacé par les crêtes), `routes/__root.tsx` (les définitions des motifs une fois par page ; la scène de connexion), `features/events/EventPage.tsx` et `features/runners/RunnerProfile.tsx` (bandeaux), `features/events/ListPage.tsx` et `features/agenda/AgendaPage.tsx` (état vide), `features/route/ElevationProfile.tsx` (graphique de « Chrono »), `i18n/fr.ts` et `i18n/en.ts` (trois textes du graphique), `styles.css` (en-tête, ligne de crête sous les titres, curseur du profil, le halo de focus des champs ne s'applique pas au curseur).
- `index.html` et `manifest.webmanifest` inchangés (`#5e4ae3`, `#fbf8ff`, ceux d'« Aurore »).
- Aucune route, donnée ni code serveur modifiés ; aucun texte existant changé.

## Captures

`C:\Users\guill\dev\courses\.superpowers\sdd\v4-designs\crete\` — 375 px (en `@2x`) et 1280 px, `-fold` pour le premier écran, sans suffixe pour la page entière :
`connexion`, `home`, `liste`, `agenda`, `event` (Trail des Crêtes avec une trace : carte et profil), `dialog` (« Ajouter quelqu'un »), `nouveau`, `profil`, `reglages`, `coureur`, `stats`, `admin-membres`, `admin-types`, `admin-doublons`, `vide` (liste vide), `agenda-vide`, et `profile-cursor` / `profile-keys` (le curseur du profil à la souris, puis au clavier avec l'anneau de focus).

La trace est une boucle synthétique de 13 km et 829 m D+ au-dessus d'Annecy (Mont Veyrier, Mont Baret), ajoutée en local à « Trail court » (`.pb_design`, non suivi).

## Points à reprendre

- L'entête est plus haute que dans « Aurore » (+12 px au téléphone, +48 px sur grand écran) : il faut la place des crêtes.
- Les crêtes de l'entête au téléphone sont pensées pour le nom à gauche : la vallée basse est dessous. Une langue où le nom serait bien plus long pourrait toucher les premiers sommets.
- Sur grand écran, le soleil de l'entête est petit (dans une bande de 60 px) ; l'arc le plus large peut passer derrière la capsule des onglets sur un écran étroit (768–900 px).
- Le motif répété des courbes (entête) est en miroir : sur un très grand écran, un œil attentif voit la symétrie d'une tuile à l'autre (à 15 % d'opacité).
- Profil : comme dans « Chrono », une étiquette de km peut manquer au téléphone (elle toucherait sa voisine) ; les aplats de pente ne contrastent pas à 3:1 avec le blanc (l'or surtout) : la ligne à l'encre porte la forme, la légende et le curseur portent le sens.
- Au doigt, le curseur disparaît quand le doigt se lève (comme dans « Chrono ») ; au clavier il reste jusqu'à Échap ou la sortie du focus.
- Les puces de format teintées par terrain de « Sentier » n'ont pas été reprises : elles auraient fait une deuxième famille de couleurs à côté des pentes.
- Repris d'« Aurore » : invitation sans capture, verre un peu laiteux sur grand écran, pointillés « non confirmé » pâles, rangées de boutons des offres, onglet « Admin » sur les sous-pages, polices Google Fonts.
- Le dossier `.pb_design/` du worktree (données, binaire et journal locaux) n'est pas suivi : il peut être supprimé.

## Tests

- `pnpm --dir web exec vitest run --project unit` : 678 tests, tous passent.
- Tests navigateur non lancés. En plus de ceux listés pour « Aurore » (classes, structure des cartes, des onglets, des totaux…), ceux qui risquent d'échouer : `drawings.test.tsx` (le profil a maintenant une légende, une pastille, un curseur `input type=range`, des bandes de pente ; une étiquette de km peut être omise), `RouteSection.test.tsx` (un champ `range` en plus dans la section), `ListPage` / `AgendaPage` (état vide : un autre dessin, le texte est le même), `AppShell.test.tsx` (le ciel contient des SVG de crêtes et de courbes), et tout test qui chercherait le `SunArc`.
