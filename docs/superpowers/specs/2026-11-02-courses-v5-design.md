# « Prends ton dossard » v5 : démo, carte et profil liés, formulaire allégé

Demandé par l'utilisateur le 2026-11-02, avec ses réponses aux questions ; la suite est faite en autonomie. Complète les specs précédentes ; les décisions prises en route iront dans `docs/superpowers/decisions/2026-11-02-decisions-v5.md`.

## 1. Une démo pour les copains

> « un site en version démo pour le montrer aux copains sans qu'ils aient besoin d'avoir un compte. Pas besoin de rendre le site principal en démo. »

- **Une instance à part** : `https://demo-prends-ton-dossard.ketra.fr`, avec les données de test du `seed` (comptes Alice, Bob, Admin, cinq coureurs, des événements passés et à venir). Le vrai site n'a jamais de mode démo.
- **Entrer sans compte** : sur la page de connexion de la démo, un bouton « Entrer dans la démo » connecte au compte de démo, sans rien taper. Les autres moyens de connexion restent.
- **Le compte de démo** est un membre (Alice), pas un admin : il montre le site tel qu'un copain l'utilise.
- **Jamais remise à zéro** (choix de l'utilisateur) : ce que les visiteurs font reste.
- **Serveur** : la variable d'environnement `DEMO_LOGIN_EMAIL` active deux routes ; sans elle, elles n'existent pas (404).
  - `GET /api/app/demo` → `{ "enabled": true }` (public) ;
  - `POST /api/app/demo` (public) → la même réponse qu'une connexion par mot de passe pour le compte `DEMO_LOGIN_EMAIL` (jeton + compte). Le compte doit exister et ne pas être désactivé ; sinon 404.
  - Ces routes ne journalisent rien de plus que les autres ; la limite de requêtes de PocketBase s'applique.
- **Front** : la page de connexion demande `GET /api/app/demo` ; si la démo est active, elle montre le bouton (principal) et une phrase : « Démo : tout le monde partage ce compte, ce que tu fais reste visible. » / « Demo: everyone shares this account, what you do stays visible. » Texte du bouton : « Entrer dans la démo » / « Enter the demo ».

## 2. La carte et le profil du D+ liés

> « lier la trace gpx et le d+ au survol »

- Survoler (souris), toucher ou parcourir au clavier le profil du D+ place un repère sur la carte, au même kilomètre ; le repère suit le curseur et disparaît quand le curseur s'en va.
- Survoler (ou toucher) le tracé sur la carte place le curseur du profil au point du tracé le plus proche, avec sa lecture habituelle (« km 7,4 · 1 210 m · pente 12 % »).
- Le repère de la carte a la couleur de la pente du point (palette du thème courant) et un contour qui le détache du fond ; il est décoratif pour les lecteurs d'écran (la lecture vient du curseur du profil).
- Sans carte (tuiles ou module absents), le profil marche seul comme aujourd'hui.

## 3. Le formulaire montre les champs qui comptent pour le type de course

> « Masquer/afficher des champs à remplir en fonction du type de course (possiblement les mettre dans options avancées) »

- **Chaque type de course dit quelles mesures il utilise** : distance, D+, durée, temps max (un choix multiple sur `race_types`, champ `measures`, modifiable dans Admin → Types).
- **Valeurs de départ** (migration 9i, d'après le nom du type, sans casse ni accents) :
  - Route, Trail, Ultra…, Cross, Course nature → distance, D+, temps max ;
  - Backyard → temps max ;
  - « … heures », Ultra en durée, contre-la-montre en temps → durée ;
  - Hyrox → distance ;
  - tout autre type → les quatre.
- **Le formulaire d'une épreuve** montre d'abord les mesures du type choisi ; les autres sont dans « Options avancées » (un `<details>` fermé). Une mesure qui a une valeur est toujours visible. Changer de type ne perd aucune valeur.
- Le serveur ne change pas : une épreuve demande toujours une distance, une durée ou un temps max.

## 4. La date de fin vient des épreuves

> « Pour réduire quelques champs, la date max, c'est la date max de toutes les épreuves. »

- Le formulaire d'un événement n'a plus de champ « date de fin ». Sa date de fin est la plus tardive des dates des épreuves, si elle est après la date de début ; sinon l'événement tient sur un jour.
- Le formulaire montre la période qui en résulte (« Du sam. 29 nov. au mar. 2 déc., d'après les dates des épreuves »).
- **Les événements existants** : leur date de fin n'est recalculée que lorsqu'on les modifie dans le formulaire. Une épreuve sans date compte pour le premier jour.
- Le serveur ne change pas : une épreuve reste dans les jours de son événement.

## 5. Tests à ajouter

- Serveur : routes de démo avec et sans `DEMO_LOGIN_EMAIL` (404, compte absent ou désactivé, réponse d'auth) ; migration 9i (retour arrière puis réapplication, valeurs de départ par nom).
- Front : bouton de démo (affiché seulement si actif, connecte, focus) ; lien carte ↔ profil (repère au bon kilomètre, curseur au point le plus proche, clavier) ; champs par type (principaux, « Options avancées », valeur jamais cachée) ; date de fin calculée (aucune, une, plusieurs épreuves, épreuve sans date).
