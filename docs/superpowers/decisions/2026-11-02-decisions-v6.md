# Décisions prises en route (v6)

La v6 laisse chacun choisir son habillage parmi les onze variantes de la v4, sur un seul code, à trois profondeurs. Tu as fixé le but : tous les thèmes, trois modèles (couleurs seules, mix, variante complète), la même base, jamais en production avant ta validation. Le reste a été décidé en route. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-02-courses-v6-design.md` ; plan : `docs/superpowers/plans/2026-11-02-courses-v6.md`. Branche `v6/themes`, jamais fusionnée dans `feat/v1`.

## Le modèle

### 1. Une seule architecture, trois profondeurs de construction

- **Décision :** un habillage est un dossier (`web/src/skins/<id>/`). `VITE_SKIN_DEPTH` fixe, à la construction, jusqu'où il descend :
  - `palette` : couleurs, polices et motifs, sur la structure de Crête ;
  - `mix` : en plus, les pièces signature (en-tête, onglets, carte d'événement, haut des fiches, titres) ;
  - `full` : tout ce que la variante v4 restylait (formulaires, fenêtres, filtres, agenda, profil, admin, messages, carte et D+, stats).
- **Pourquoi :** les trois modèles partagent le code ; chaque profondeur ne fait qu'ajouter.
- **Conséquence :** une instance n'a qu'une profondeur. L'image Docker la prend dans le `.env` (`VITE_SKIN_DEPTH`, vide = palette).

### 2. Crête ne bouge pas

- **Décision :** l'habillage par défaut, Crête, est identique à la v5, à chaque profondeur. Des captures le vérifient au pixel près, en clair et en sombre.
- **Toutes les fonctions de la v5 restent :** le D+ relié à la carte, les mesures par type, la période du formulaire, la démo, le choix du thème.

### 3. Un habillage ne touche qu'à ce qu'on lui ouvre

- **Classes sémantiques :** les feuilles mix et full ne visent que des classes faites pour elles (`.event-card`, `.dialog`, `.field`…), jamais une classe Tailwind ni la forme du HTML. Un test refuse un sélecteur qui nomme un élément, et une classe qui serait aussi un utilitaire Tailwind.
- **Pièces remplaçables :** une variante peut redessiner une pièce entière : carte, haut d'événement, haut de coureur, jour, état vide, titre d'épreuve, chiffres d'une trace, anneau des jours. Elle garde chaque mot, dans l'ordre ; des tests le vérifient pour chaque forme d'événement.
- **Garde-fous de tous les thèmes :**
  - contraste 4,5:1 pour le texte, 3:1 pour le reste, dans chaque thème et chaque mode ;
  - aucune animation sans fin ;
  - un tiret ne sert qu'à dire « à confirmer », sauf décorations déclarées ;
  - chaque haut d'événement montre les jours qui restent.

## Les habillages

### 4. Couleurs propres aux thèmes, acceptées

- Rétro met ses liens et l'agenda en sarcelle, Dossard en bleu ciel : c'étaient leurs couleurs.
- Les pentes du D+ finissent en violet, prune ou framboise, pour qu'un daltonien les distingue.
- Dossard élargit sa police d'affichage (112,5 %).
- Piste écrit « Track » dans son logo.

### 5. Le haut d'un événement, clair là où la variante l'était

- Marathon, Chrono, Carnet et Rétro dessinent leur haut clair (encre sur papier ou carte), comme en v4, avec leur propre contraste.
- Là où un thème ne dessine pas d'anneau (Nuit, Piste, Dossard, Sentier, Rétro), le haut écrit « dans N jours ».
- Marathon affiche « 9 j » en grand à côté du titre.

### 6. Onglets

- Piste, Sentier, Dossard, Marathon et Rétro ont la barre plate de leur variante sur téléphone.
- Sur grand écran, Dossard garde une capsule blanche sous sa guirlande, là où la v4 avait des onglets plats : la capsule reste lisible quand la page défile.
- Chrono et Carnet gardent la capsule flottante de Crête, avec leur propre onglet courant.

## Ce qui n'a pas pu être repris de la v4

### 7. Il faudrait des données ou des mots nouveaux

- les points de l'agenda colorés par type de course (Chrono, Carnet) ;
- le grand cadran de la prochaine course (Chrono) ;
- les tuiles « Le groupe » (Carnet) ;
- les barres de places ;
- les légendes « Date / Lieu / Inscriptions ».

### 8. Il faudrait toucher au code partagé

- les titres de page à deux voix de Carnet (seuls la carte et le haut d'événement les ont) ;
- les en-têtes clairs de Marathon, Chrono et Carnet (leur en-tête reste le ciel) ;
- les icônes d'onglets de Sentier et Alpage ;
- les étiquettes blanches sur encre de la carte de Piste.

### 9. Il faudrait sacrifier la lisibilité

- le bord en tirets d'une liste vide et la ligne de parcours en tirets de Sentier (un tiret doit avoir 3:1) ;
- le panneau sable autour du profil de Sentier ;
- les courbes de niveau dessinées de la carte de clé d'Alpage (des anneaux en CSS à la place).

## La taille

### 10. Ce que pèse chaque profondeur

Feuille de style principale, compressée :

| Profondeur | Taille |
| ---------- | ------- |
| v5         | 14,1 Ko |
| palette    | 24,8 Ko |
| mix        | 28,6 Ko |
| full       | 36,8 Ko |

- Le JavaScript des habillages (motifs et pièces remplaçables), compressé : 31,8 Ko à palette, 50,4 Ko à mix, 55,5 Ko à full.
- **Décision :** tout est dans un seul fichier pour l'instant ; découper par thème (charger seulement celui choisi) attend que tu choisisses une profondeur pour la production. Seul son poids comptera alors.

## Reporté

- **Petits défauts vus aux captures :**
  - les titres d'épreuve de Chrono et Carnet peuvent passer à la ligne avec un « · » en tête ;
  - celui de Chrono a deux repères ;
  - le « dans 9 jours » de Dossard est loin à droite à 1280 px ;
  - la carte de Carnet met une épreuve courte sur la ligne de sa date ;
  - la capsule de Sentier, défilée, laisse dépasser la balise du premier onglet.
- **Classement des types :** Sentier, Chrono et Carnet classent chacun les types de course d'après leur nom, et ne sont pas d'accord partout (« Marathon » est une route pour Sentier, gris pour Chrono).
- **Tests :** des aides de test sont copiées d'un thème à l'autre.
- **Crête, en production aussi :** le gris d'aide sur la carte vitrée de connexion est juste à 4,5:1. Une correction possible pour la production, pas faite ici pour garder Crête identique.

## À faire de ton côté

- Ouvrir les trois démos, avec le mot de passe des démos de design (`/opt/ptd-design/DEMO_PASSWORD` sur le serveur) :
  - `https://ptd-v6-palette.ketra.fr`
  - `https://ptd-v6-mix.ketra.fr`
  - `https://ptd-v6-complet.ketra.fr`
- Choisir un thème dans Profil → Réglages → Apparence.
- Dire quelle profondeur tu veux en production, et si certains thèmes doivent rester ou partir. Rien n'ira en production avant.
- Vérifier sur iPhone, surtout les onglets et la carte avec le D+.
