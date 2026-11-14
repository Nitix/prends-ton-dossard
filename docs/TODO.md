# À faire, plus tard

Idées notées le 2026-11-03, mises à jour le 2026-11-08 après la v7.

## Fait en v8

En production depuis le 2026-11-09 :
- la page d'invitation montre qui invite, une liste courte de tes prochaines courses avec les amis qui y vont, et en une phrase celles du groupe ;
- le message prêt à envoyer et le lien, affichés ensemble dans l'admin, et renvoyés par le MCP ;
- une invitation vaut 30 jours.

Le détail est dans `docs/superpowers/decisions/2026-11-09-decisions-v8.md`.

## Fait en v7

En production depuis le 2026-11-08 :
- l'ouverture des inscriptions ;
- les rappels (alarmes et notifications push) ;
- les courses au mois ;
- le zoom de la carte et du D+ ;
- le titre de chaque page ;
- le bouton « Partager » ;
- le flux d'agenda du groupe ;
- la météo, avec l'heure de départ d'une épreuve.

Le détail est dans `docs/superpowers/decisions/2026-11-07-decisions-v7.md`.

## Tes idées

- **Le matériel obligatoire d'une épreuve** (trail) : une liste saisie avec l'épreuve, que chacun coche la veille. Reporté pendant la v7. La spec est prête dans `docs/superpowers/specs/2026-11-07-courses-v7-design.md` (§ 11). Sa migration prendra la lettre qui suit `9r`.
- **Avoir l'aperçu (vignette, titre) d'une course partagée dans WhatsApp** : il faut une page que le robot de WhatsApp lit sans compte. Il faudrait :
  - un lien de partage signé, créé sur demande, qui expire ;
  - qui ne montre que le nom, les dates et le lieu (jamais qui y va) ;
  - qu'on peut révoquer.

  C'est plus de travail, et ça expose ces trois informations.

## Mes idées

- **Vérifier sur un vrai iPhone** (Safari et l'app installée) : les notifications, les alarmes d'un agenda abonné, la feuille de partage, les thèmes, le mode hors ligne, la carte et le D+, et Claude Code avec le MCP. Les tests tournent maintenant sur Chrome, Firefox et Safari (WebKit), mais en émulation. À confirmer en particulier : l'anneau de focus d'un choix après les flèches (thèmes, Réglages), qu'un test ne vérifie pas sur WebKit ; les chiffres du profil et des tuiles à 320 px, où WebKit les dessine un peu plus larges ; et le toucher sur le tracé de la carte (aucun test ne le fait avec de vrais doigts sur un téléphone émulé).
- **Les tests automatiques sur GitHub : faits** (Go, `govulncheck`, web, et les tests navigateur sur Chrome, Firefox, Safari, iPhone 15 et Pixel 7 émulés). Les sept jobs bloquent. Reste de les vérifier sur de vrais appareils (voir la première idée) : un téléphone émulé n'est pas un iPhone.
  - **Skins sur WebKit Linux** (Safari et iPhone 15 de GitHub) : **cause non établie.** Avec les feuilles `<style>` du serveur de développement, WebKit sous Linux résout mal la page après un choix de skin : le fond du `body` garde la couleur précédente et les animations des motifs ne partent pas. Le diagnostic du run 13 montrait que seul le premier choix d'un fichier restait faux, mais au run 14 onze tests de Carnet échouaient, chacun choisissant le skin de nouveau : ce n'est donc pas seulement « le premier ». Les feuilles en `<link rel=stylesheet>` (le chemin de la production) étaient justes dans le diagnostic, qui ne les passait pas en premier. Attendre deux images ou forcer un recalcul n'a rien changé (code retiré). Sautent sur WebKit sous Linux en CI seulement : `carnet/motifs` (tous), `restyle` ×2, `pageArt` Carnet (largeurs 768 à 1440), `ThemePicker` « choisir un skin », `AmbientSwitch` ×2. À confirmer sur un vrai Safari : changer de thème plusieurs fois (Carnet surtout) et regarder à chaque fois les couleurs et les animations (voir la recette de l'iPhone dans le README).
  - Sur l'iPhone émulé : une page plus large que 320 px est apparue une fois (tuiles de `RouteSection`), non reproduite depuis la correction du curseur du profil ; le message d'échec nomme l'élément. Les couleurs forcées (`EventForm.period`, `FormatFieldset`) sautent sur WebKit, qui n'a pas ce mode.
  - Tests sautés pour une autre raison (la liste est complète au jour de la v8) :
    - le test des pixels de la trace (`TrackMap`) sur le Pixel 7 émulé de Linux (0 pixel coloré lu, passe sous Windows, non compris) ;
    - `toAvatarBlob` « photo tournée par son EXIF » sur Firefox (l'image faite à la main par le test, EXIF avant l'en-tête JFIF, est refusée par Firefox ; à refaire avec une vraie photo d'appareil) ;
    - sur écran tactile (téléphones émulés), seule l'étape qui passe une souris est sautée : le survol du profil (`drawings`, `MapChunkFailure`), le survol de la carte (`RouteSection`, « au clavier, le repère suit »), la molette et le glisser à la souris (`TrackMap`), le toucher synthétique de `RouteSection` (aussi sur Firefox, qui n'a pas le constructeur `Touch`) ;
    - `TrackMap` « carte retirée au milieu d'un zoom » si le navigateur n'a pas les transformations 3D (`any3d` de Leaflet) : WebKit sous Windows ; sous Linux elles existent et le test tourne ;
    - les couleurs forcées (`EventForm.period`, `FormatFieldset`) sautent sur WebKit (pas de ce mode), et sur Firefox quand le mode n'est pas émulé ;
    - les tests de téléphone (`phoneIdentity`) sautent hors téléphone ;
    - la date (`<input type="date">`) et `OffscreenCanvas` manquent au WebKit de Windows : leurs tests sautent là.
  - **Clic de Playwright sur un téléphone Chromium émulé (Pixel 7) : cause non trouvée.** Les boutons d'une fenêtre (`<dialog>`) ou de la barre d'onglets échouaient par intermittence (« element is outside of the viewport », runs 13 à 22) sur les machines Linux de GitHub. Les mesures prises (fenêtre 412×839, bouton à 157, 558 en 91×44, clic d'essai de Playwright « ok ») viennent de runs où le clic n'avait pas échoué : elles ne disent rien de l'état où il échoue. Contournement : `clickReachable` (`web/src/test/pressFocused.ts`) appuie au clavier (focus puis Entrée) **seulement** sur Chromium tactile, pour un bouton dans un `<dialog>` ou sous un élément fixe ; partout ailleurs le clic reste réel (Firefox, Safari, iPhone, Chrome de bureau). `tapAfterScroll` garde un vrai toucher d'un bouton de fenêtre sur le Pixel (`DeleteEventDialog`, « Annuler »). Le toucher réel de ces boutons n'est donc couvert que par ce test-là. `pressFocused` (clic sur Chromium, clavier ailleurs) reste pour les tests qui vérifient où va le focus.
  - **Tests instables vus au run 23, corrigés par la cause supposée, à surveiller** (un avertissement « Test instable » qui revient les remet ici) :
    - `TrackMap` « carte retirée au milieu d'un zoom » (Safari, aussi au run 21, passé au 3e essai) : la classe `leaflet-zoom-anim` ne dure que 250 ms et le test la guettait par sondage ; il attend maintenant l'événement `zoomanim` de Leaflet ;
    - `drawings` « au clavier, le curseur dit la distance » (Firefox, runs 22 et 23) : le focus restait sur `body` après Tab. Cause non établie (le test attend maintenant le curseur, puis sonde le focus) ;
    - `MapChunkFailure` « sans carte, le profil marche seul » (Firefox) : la lecture disait 0 km au lieu de 1,1 km juste après Fin. Cause non établie (le focus est attendu avant la touche, les lectures sont sondées) ;
    - `pageArt` « Carnet, /profil à 375 px » (Pixel 7, runs 19, 22 et 23) : 2 mots sur le papier au lieu de 3. Cause supposée : un mot compté pendant le chargement de la page ; le décompte est refait par sondage après les polices.
  - **Flèches du curseur du profil sur Firefox :** le test « sur le plat, le curseur dit « pente 0 % » » (`drawings`) pose la valeur du curseur directement, parce que le pas d'une flèche n'est pas le même sur Firefox (il suit la pente du profil). Personne n'a regardé ce comportement du clavier sur Firefox : à voir à la main.
  - **Molette de la carte :** un cran de souris zoome d'un niveau sur Chrome de Windows, d'un niveau et demi ailleurs (Leaflet divise la molette par 2 sur ce seul cas). Décision de produit non prise : est-ce voulu sur Mac et Linux ? Le test exige exactement 1 sur Chrome de Windows, 1 ou 1,5 ailleurs.
- **Des sauvegardes automatiques avec une copie hors du serveur.** Aujourd'hui, elles se font seulement avant un déploiement, et sur le même disque.
- **Garder les thèmes qui servent :** dans quelques semaines, regarder quels thèmes sont choisis (ils sont sur les comptes) et retirer les autres, pour alléger le code et les tests.
- **Petits restes des versions passées :**
  - le gris d'aide sur la carte de connexion est juste à 4,5:1 ;
  - les polices des échantillons du choix du thème pèsent 318 Ko sur la page Réglages ;
  - l'accueil ne montre pas encore les prochaines courses en grille ;
  - un pincement sur le pavé tactile au-dessus du profil du D+ zoome par paliers ×2 et peut aller trop loin ;
  - le mode couleurs forcées n'a pas été regardé pour la v7.

## Écarté

- **Reprendre un résultat depuis Strava, automatiquement.** Le serveur n'a pas de LLM : seul celui de la personne, par le MCP, pourrait le faire. Et l'API de Strava est payante.
- **Céder un dossard.** Un commentaire sur la course suffit.
- **Un bilan de la saison.** Strava le fait mieux : il voit aussi l'entraînement.
- **Une galerie photos, des plans d'entraînement, une messagerie interne.** Hors du sujet, ou WhatsApp le fait déjà.
