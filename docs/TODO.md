# À faire, plus tard

Idées notées le 2026-11-03, mises à jour le 2026-11-08 après la v7.

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
- **Les tests automatiques sur GitHub : faits** (Go, `govulncheck`, web, et les tests navigateur sur Chrome, Firefox, Safari, iPhone 15 et Pixel 7 émulés). Go, les vérifications web, Chrome, Firefox et Safari bloquent ; l'iPhone et le Pixel émulés tournent et annotent sans bloquer, parce qu'ils ont encore des échecs intermittents (relevé du 2026-11-09 : l'iPhone vert au dernier run mais une page plus large que 320 px au précédent ; le Pixel, des clics « hors de l'écran » dans les fenêtres, qui passent un run sur deux), pour ce qui suit. Reste de les vérifier sur de vrais appareils (voir la première idée) : un téléphone émulé n'est pas un iPhone.
  - **Skins sur WebKit Linux** (Safari et iPhone 15 de GitHub) : **cause non établie.** Avec les feuilles `<style>` du serveur de développement, WebKit sous Linux résout mal la page après un choix de skin : le fond du `body` garde la couleur précédente et les animations des motifs ne partent pas. Le diagnostic du run 13 montrait que seul le premier choix d'un fichier restait faux, mais au run 14 onze tests de Carnet échouaient, chacun choisissant le skin de nouveau : ce n'est donc pas seulement « le premier ». Les feuilles en `<link rel=stylesheet>` (le chemin de la production) étaient justes dans le diagnostic, qui ne les passait pas en premier. Attendre deux images ou forcer un recalcul n'a rien changé (code retiré). Sautent sur WebKit sous Linux en CI seulement : `carnet/motifs` (tous), `restyle` ×2, `pageArt` Carnet (largeurs 768 à 1440), `ThemePicker` « choisir un skin », `AmbientSwitch` ×2. À confirmer sur un vrai Safari : changer de thème plusieurs fois (Carnet surtout) et regarder à chaque fois les couleurs et les animations (voir la recette de l'iPhone dans le README).
  - Reste sur l'iPhone émulé : une page plus large que 320 px au run précédent (tuiles de `RouteSection`), intermittent ; le message d'échec nomme maintenant l'élément. Les couleurs forcées (`EventForm.period`, `FormatFieldset`) sautent sur WebKit, qui n'a pas ce mode.
  - Tests sautés pour une autre raison : le test des pixels de la trace (`TrackMap`) sur le Pixel 7 émulé de Linux (0 pixel coloré lu, passe sous Windows, non compris) ; `toAvatarBlob` « photo tournée par son EXIF » sur Firefox (l'image faite à la main par le test, EXIF avant l'en-tête JFIF, est refusée par Firefox ; à refaire avec une vraie photo d'appareil) ; les tests de survol à la souris sur écran tactile.
  - Pixel 7 : les clics dans les fenêtres échouent souvent (« element is outside of the viewport ») ; tester les fenêtres avec leurs animations coupées a fait pire. À reprendre : le défilement de Playwright vers une fenêtre `position: fixed` dans l'iframe des tests.
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
