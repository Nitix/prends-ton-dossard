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

- **Vérifier sur un vrai iPhone** (Safari et l'app installée) : les notifications, les alarmes d'un agenda abonné, la feuille de partage, les thèmes, le mode hors ligne, la carte et le D+, et Claude Code avec le MCP. Les tests ne tournent que dans Chrome.
- **Les tests automatiques sur GitHub** (Go et web), avec Firefox et Safari (WebKit), qui ne se lancent pas sur ce PC Windows.
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
