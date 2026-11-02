# « Prends ton dossard » v6 : choisir son thème parmi toutes les variantes

Demandé par l'utilisateur le 2026-11-02 : « options thèmes avec tous les thèmes qu'on avait » ; « chaque variante complète avec les améliorations de la crête comme le d+. Ne la déploie pas pour être sûr que ça fonctionne bien […] essaie d'avoir la même base possible. Tu devras peut-être faire deux modèles différents, un purement couleurs, polices et motifs sur la structure de crête, un autre c'est la variante complète, et la dernière un mix. »

**Jamais en production** tant que l'utilisateur ne l'a pas validé : la v6 vit sur la branche `v6/themes` et sur des instances de démo.

## 1. Une seule base : des « habillages »

- Un **habillage** (skin) est un dossier `web/src/skins/<id>/` qui déclare :
  - ses **jetons** (couleurs, rayons, ombres, polices) sous `[data-skin="<id>"]`, en clair et, s'il en a une, en sombre ;
  - ses **polices** (fichiers servis par le site, chargés seulement quand l'habillage est choisi) ;
  - ses **motifs** (composants SVG) pour des emplacements nommés : `HeaderArt`, `BrandMark`, `HeroArt`, `Divider`, `SectionMarker`, `EmptyArt` ;
  - optionnellement des **styles de structure** pour des classes sémantiques (`.event-card`, `.event-hero`, `.tabbar`, `.page-title`, `.section-title`, `.stat-tile`, `.chip`…) et des **variantes de composants** pour les rares changements de balisage (le dossard d'« Dossard », le ticket de « Rétro », la colonne cadrée de « Carnet »).
- « Crête » est l'habillage par défaut ; son rendu ne change pas.
- Tout ce qui fait les fonctions (graphique du D+, carte liée, formulaire par type, démo…) reste commun : un habillage ne peut que l'habiller.

## 2. Trois modèles, même base

Le modèle est la **profondeur** à laquelle chaque habillage descend ; un réglage de build (`VITE_SKIN_DEPTH`) le fixe pour une instance :

- **Palette** : jetons, polices et motifs seulement, sur la structure de Crête.
- **Mix** : Palette + les styles de structure des pièces signature (en-tête, barre d'onglets, carte d'événement, haut de fiche, titres de section).
- **Complet** : Mix + tous les styles de structure et les variantes de composants de la variante d'origine.

Trois démos : `ptd-v6-palette.ketra.fr`, `ptd-v6-mix.ketra.fr`, `ptd-v6-complet.ketra.fr`, chacune avec les onze habillages au choix.

## 3. Choisir

- Réglages → Apparence : « Thème » (onze cartes avec un aperçu : nom, deux couleurs, la police), puis « Clair / Sombre / Auto » quand l'habillage a un mode sombre (Crête, Nuit toujours sombre…).
- Gardé sur l'appareil (`ptd-skin`), appliqué avant le premier dessin comme le mode sombre.

## 4. Garde-fous

- Pour chaque habillage et chaque mode : contraste AA du texte, des boutons (repos, survol), des pointillés « non confirmé », des bordures de champs, des couleurs de pente (3:1 et distinctes), mode contraste élevé — mêmes tests qu'en v4, paramétrés.
- Les tests de comportement passent dans chaque profondeur avec l'habillage par défaut ; une batterie de rendu (pas de débordement à 320 px, cibles de 44 px) passe pour chaque habillage.
