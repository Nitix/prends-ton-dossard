# Décisions prises en route (v6)

La v6 laisse chacun choisir son habillage parmi onze : Crête, celui d'aujourd'hui, et les dix autres variantes de la v4. Tu as fixé le but et les grands choix :
- tous les thèmes, sur la même base ;
- en production, seulement la profondeur « palette » ;
- la liste en grille ;
- Carnet plus proche de l'original, avec son fond qui bouge ;
- le thème gardé sur le compte ;
- la main sur les boutons.

Le reste a été décidé en route. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-02-courses-v6-design.md` ; plan : `docs/superpowers/plans/2026-11-02-courses-v6.md`. Branche `v6/themes`.

## Le modèle

### 1. Palette seulement

- **Décision :** un habillage change les couleurs, les polices et les motifs (le dessin du ciel, des en-têtes, des états vides), sur la structure de Crête. Les profondeurs « mix » et « full » ont été construites, montrées sur deux démos, puis retirées à ta demande : leur code n'est plus dans la branche (l'historique git le garde).
- **Conséquence :** une seule construction, plus de réglage de profondeur. Les démos `ptd-v6-mix` et `ptd-v6-complet` sont arrêtées ; leurs données restent sur le serveur.

### 2. Crête ne bouge pas, sauf ce que tu as demandé

- **Ce qui change pour tout le monde :** la liste en grille (n° 6) et la main sur les boutons (n° 9).
- **Le reste de Crête :** identique à la v5, vérifié par des captures avant et après chaque étape, en clair et en sombre, sur téléphone et grand écran. Ces captures ne sont pas un test permanent.
- **Toutes les fonctions de la v5 restent.**

### 3. Chaque thème ne se charge que si on le choisit

- **Décision :** un utilisateur de Crête télécharge Crête et la liste des thèmes, rien de plus. Un autre thème (4 à 8 Ko compressés) se charge au moment où on le choisit, puis reste en cache, hors ligne compris.
- **Pas de flash :** le thème gardé est appliqué avant le premier affichage, y compris sur les pages de connexion et d'invitation.
- **Garde-fou :** les classes de style d'un thème portent son préfixe, si bien qu'un thème ne peut jamais casser la mise en page commune, quel que soit l'ordre de chargement. Un test le vérifie à 1280 px pour chaque thème.
- **Un thème qui ne se charge pas** (hors ligne, jamais choisi sur cet appareil) : la page ne se recharge pas, l'ancien thème reste, un message le dit, et un lecteur d'écran entend « Chargement du thème… » pendant l'attente.

### 4. Le thème suit le compte

- **Décision :** le thème choisi est gardé sur l'appareil et sur le compte.
  - À la connexion, celui du compte s'applique ; si le compte n'en a pas, celui de l'appareil y est enregistré.
  - Déconnecté, l'appareil garde le dernier.
  - Hors ligne, le choix attend la prochaine connexion.
- **Confidentialité :** personne ne peut voir ni changer le thème d'un autre, admins compris.
- **Démo :** le compte partagé de la démo ne garde aucun thème, pour que chaque visiteur garde le sien.
- **Ce qui reste par appareil :** le mode clair ou sombre, et « Animer le fond » (n° 7).
- **Petit défaut accepté :** sur un nouvel appareil, le thème de l'appareil peut s'afficher un instant avant celui du compte.

### 5. Le choix du thème montre chaque police

- Chaque carte du choix (Réglages → Apparence) affiche « Aa » dans la police de son thème.
- **Coût accepté :** ces polices (318 Ko au total) ne se chargent que sur la page Réglages, et une seule fois.

## Ce que tu as demandé en plus

### 6. La liste en grille

- **Décision :** la page Liste montre deux colonnes à partir de la tablette, pour tous les thèmes. Les cartes d'une même rangée ont la même hauteur. Sur téléphone, rien ne change.
- **Choix :** seulement la page Liste ; les prochaines courses de l'accueil restent sur une colonne. Une ligne suffit pour l'étendre.

### 7. Carnet, plus proche de la v4

- **Le fond qui bouge :**
  - dans l'en-tête et le haut d'une course : des taches de points qui s'effacent et reviennent lentement, deux anneaux qui tournent en sens contraires, un point qui pulse ;
  - derrière toute la page : la feuille de points vivante de la v4.
- **L'accessibilité :**
  - le fond ne bouge que si le système ne demande pas moins d'animations ;
  - un interrupteur « Animer le fond », dans Apparence, l'arrête. Il n'est montré que pour un thème dont le fond bouge, il est allumé par défaut et gardé sur l'appareil ;
  - les mots restent lisibles par-dessus (4,5:1, mesuré).
- **Conséquence :** les points sont plus pâles qu'en v4 (le contraste des textes l'impose). Dis-le si tu les veux plus marqués : la marge est faible.
- **Nouveau :** un emplacement « fond de page » que tout thème peut dessiner ; Crête n'y dessine rien.

### 8. Couleurs propres aux thèmes, acceptées

- Rétro met ses liens et l'agenda en sarcelle, Dossard en bleu ciel : c'étaient leurs couleurs.
- Les pentes du D+ finissent en violet, prune ou framboise, pour qu'un daltonien les distingue.
- Dossard élargit sa police d'affichage (112,5 %).
- Piste écrit « Track » dans son logo.

### 9. La main sur les boutons

- **Décision :** tout ce qui se clique (bouton, menu dépliant, liste, case et la carte qui la porte) montre la main, comme un lien. Un bouton désactivé montre qu'il est hors d'atteinte.

## La taille

### 10. Ce que pèse la v6 pour un utilisateur de Crête

Fichiers compressés :

| | v5 | v6 |
| --- | --- | --- |
| Feuille de style | 12,9 Ko | 13,9 Ko |
| Script principal et ses préchargements | 157,8 Ko | 163,3 Ko |

- Chaque autre thème ajoute 4 à 8 Ko, seulement pour qui le choisit.
- Le script grossit de 5,5 Ko : les motifs de Crête, chargés jusqu'ici avec chaque page, arrivent avec le script, plus la liste des thèmes.

## Reporté

- **Crête, en production aussi :** le gris d'aide sur la carte vitrée de connexion est juste à 4,5:1. Une correction possible, pas faite ici pour garder Crête identique.
- **Navigateurs :** les tests tournent dans Chromium seulement (Firefox et WebKit ne démarrent pas sur cette machine).

## À faire de ton côté

- **Sur iPhone (Safari et l'app installée) :**
  - choisir un thème, se déconnecter : la page de connexion est dans ce thème ;
  - en mode avion, choisir un thème jamais pris : un message, pas de rechargement ;
  - se connecter sur un deuxième appareil : le thème suit.
- **Carnet :** regarder le fond qui bouge et « Animer le fond ».
- **La démo `ptd-v6-palette.ketra.fr` :** mot de passe des démos de design (`/opt/ptd-design/DEMO_PASSWORD` sur le serveur), comptes `alice@`, `bob@` ou `admin@example.test`.
