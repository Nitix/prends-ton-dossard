# Décisions prises en route (v4)

La v4 est le nouveau design du site. Tu as choisi le thème « Crête » parmi onze variantes, puis le dégradé du graphique du D+ et le thème sombre ; le reste a été décidé en route. Dis lesquels revoir, par leur numéro.

Le design est décrit dans `docs/superpowers/designs/2026-11-01-v4-crete.md` (bâti sur `2026-11-01-v4-aurore.md`), le plan dans `docs/superpowers/plans/2026-11-01-courses-v4.md`.

## Ce que fait la v4

- **Le thème « Crête »** : un ciel d'aube violet → corail avec des courbes de niveau et des crêtes, les boutons en dégradé, les anneaux de compte à rebours, la barre d'onglets flottante, la page qui glisse sur le ciel, le séparateur de crêtes d'« Alpage » sur l'accueil, le graphique du D+ de « Chrono ».
- **Un thème sombre** : l'en-tête violet ne change pas ; tout le reste passe en sombre. Il suit le réglage du système (téléphone ou ordinateur), ou « Clair » / « Sombre » dans Réglages → Apparence.
- **Le nom de l'appli dans l'en-tête** mène à l'accueil.

## Décisions

### 1. Les autres variantes restent

- **Décision :** les dix autres designs gardent leur branche (`design/v4-…`) et leur démo en ligne (`ptd-<nom>.ketra.fr`), comme tu l'as demandé.
- **Coût :** environ 12 Mo de mémoire par démo sur le serveur ; rien sur le vrai site.

### 2. Les polices viennent du site

- **Décision :** Inter et Plus Jakarta Sans sont servies par le site (plus de Google Fonts) : aucune requête vers un tiers, et l'appli installée les garde hors ligne. Environ 76 Ko au premier chargement d'une page en français.
- **Conséquence :** seuls les alphabets latins sont inclus ; un nom en cyrillique, en grec ou en vietnamien s'affiche dans la police du système.

### 3. Le dégradé du D+ : l'arc-en-ciel de « Chrono », assombri

- **Décision :** ton choix entre trois essais. Bleu, vert, moutarde, orange, framboise, juste assez foncés pour se lire sur blanc (3:1) et rester distincts pour un daltonien.
- **La nuit,** une palette sœur dans le même ordre, lisible sur le fond sombre et à côté de la ligne blanche.

### 4. Le focus suit la navigation

- **Décision :** en changeant de page, le focus (clavier, lecteur d'écran) va sur le titre de la nouvelle page. Le premier affichage et un changement de filtre ne le déplacent pas.
- **Conséquence :** le bouton retour ramène le focus sur le titre de la liste, pas sur la carte d'où l'on venait (le site remonte en haut de page à chaque navigation).

### 5. Le thème sombre

- **Décision :** l'en-tête et le haut des fiches gardent leur ciel violet ; les boutons en dégradé aussi. La carte garde ses tuiles claires dans un cadre adouci.
- **Conséquence :** le choix « Clair » / « Sombre » est gardé sur l'appareil (pas sur le compte) ; l'écran de démarrage de l'appli installée est violet, dans les deux thèmes.

### 6. Le mode contraste élevé de Windows

- **Décision :** l'onglet actif, le bouton +, les boutons en dégradé et la ligne du profil gardent un contour visible.

### 7. Les lueurs du ciel ne bougent plus

- **Décision :** les halos de l'en-tête ne s'animent plus en boucle, pour la batterie des téléphones.

### 8. Un nouveau cache pour l'appli installée

- **Décision :** à la mise à jour, l'appli installée efface les anciens fichiers de la v3.1 (environ 1 Mo).

## Reporté

- **Lecteurs d'écran :** un message bref (« Événement créé ») affiché juste avant un changement de page peut être coupé par le passage du focus au nouveau titre.
- **Carte la nuit :** ses boutons de zoom restent clairs.
- **Agenda sur téléphone :** les pastilles des jours se touchent (pour garder 44 px à 320 px).
- **Tablette :** sur un écran de 1024 px avec une barre de défilement classique, le bouton + peut chevaucher le bout du dernier élément de 3 px.
- **Navigateurs :** tout a été vérifié dans Chromium ; ni Firefox ni Safari.
- **Code :** les couleurs du thème sombre sont écrites trois fois (un test vérifie qu'elles restent identiques).

## À faire par toi

1. **Relire les décisions ci-dessus.**
2. **Essayer sur ton iPhone :** le thème sombre (Réglages → Apparence, et en suivant le téléphone), l'appli installée (son nom, l'écran de démarrage violet), le graphique du D+ au doigt. La recette iPhone de la v3 et de la v3.1 est toujours en attente (fichiers `.gpx`, « Ajouter à mon agenda », la carte au doigt).
3. **Les démos** `ptd-*.ketra.fr` tournent toujours ; dis-moi quand en arrêter certaines.
