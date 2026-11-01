# Décisions prises en route (v3.1)

La v3.1 applique tes retours sur la v3 : pas de « Terminé » ni d'« Abandon » avant la course, une carte sous la trace, le lien d'agenda visible à la demande, le nom de l'appli, et un vrai profil avec une page de réglages. Tu as choisi la carte (Leaflet + carte topographique) ; le reste a été décidé en route. Dis lesquels revoir, par leur numéro.

La conception est dans `docs/superpowers/specs/2026-11-01-courses-v3.1-design.md`, le plan dans `docs/superpowers/plans/2026-11-01-courses-v3.1.md`.

## Statuts avant la course

### 1. « Terminé » et « Abandon » à partir du jour de la course

- **Décision :** le jour de la course (date de l'épreuve, sinon premier jour de l'événement, heure de Paris) compte déjà. Avant, ces deux statuts et « Saisir le résultat » ne sont pas proposés, et le serveur les refuse.
- Une phrase sous le choix du statut l'explique : « Terminé et Abandon seront proposés le jour de la course. »

### 2. Un statut acquis n'est jamais retiré

- **Décision :** une participation déjà « Terminé » ou « Abandon » garde son statut si la course est décalée plus tard, et son résultat reste modifiable.
- En revanche, la passer sur une autre épreuve encore à venir est refusé (même contrôle que pour un changement de statut).

### 3. Une fusion d'épreuves garde les statuts

- **Décision :** quand l'admin fusionne deux copies d'une même épreuve, les participants gardent leur statut et leur résultat sur la copie gardée, même si sa date est plus tard. C'est la même course.
- **Si c'était le mauvais choix :** refuser la fusion dans ce cas, avec un message qui dit de garder l'autre copie ou de corriger sa date.

## Carte

### 4. Leaflet et OpenTopoMap

- **Décision :** Leaflet 1.9.4 (la 2.0 est encore en alpha), chargé seulement sur une fiche qui a une trace ; fond OpenTopoMap avec les courbes de niveau.
- **Conséquence :** les tuiles viennent d'un service externe gratuit, qui voit l'adresse IP de qui regarde la carte.

### 5. Sur téléphone, un doigt déplace la carte

- **Décision :** la molette ne zoome pas (elle fait défiler la page), mais un doigt posé sur la carte la déplace. La carte a une hauteur fixe, la page défile au-dessus et en dessous.
- **Si ça gêne :** demander deux doigts pour déplacer la carte (un petit module en plus).

### 6. Si la carte ne charge pas, la fiche reste

- **Décision :** sans réseau au mauvais moment, la carte est remplacée par « La carte n'est pas disponible pour l'instant. » ; les chiffres, le profil et les liens restent.

## Lien d'agenda

### 7. Le lien est gardé par le serveur

- **Décision :** le serveur garde le lien lui-même (plus seulement son empreinte) : « Afficher le lien » le montre quand tu veux, et « Nouveau lien » reste toujours proposé.
- **Conséquences :** le lien est en clair dans la base et ses sauvegardes, et un super-admin le voit dans le tableau de bord de PocketBase. Aucun autre membre ne le voit. Un lien créé en v3 ne peut pas être réaffiché : il faut en créer un nouveau.

## Profil

### 8. Le profil est la page de ton coureur

- **Décision :** `/profil` montre ta photo, ton nom, « Mes prochaines courses », ton bilan par année et ton historique ; tout le reste est dans « Réglages » (`/profil/reglages`).
- Le bandeau de l'accueil qui propose une clé d'accès mène maintenant aux réglages.

### 9. Une seule liste « Mes prochaines courses »

- **Décision :** l'accueil, le profil et la page d'un coureur utilisent la même liste. Un événement où tu es « Intéressé » sans épreuve, ou « Supporteur », y reste jusqu'à son dernier jour (avant : jusqu'à son premier jour, sur l'accueil).

### 10. Nom de l'appli installée

- **Décision :** « Prends ton dossard » au lieu de « Dossard ».
- **Conséquence :** sur iPhone, une appli déjà installée garde l'ancien nom tant qu'on ne la retire pas puis la réinstalle ; Android met à jour plus tard, parfois en demandant.

## Reporté

- **Focus après un changement de page** : quand on passe du profil aux réglages (et partout dans l'appli), le focus clavier repart du haut ; à faire dans la v4, pour tout le site.
- **Statistiques** : le tableau des totaux défile sur le côté sur un téléphone.
- **Fichiers de tests** : toujours quelques fichiers très longs.

Le détail est dans le registre de travail (`.superpowers/sdd/2026-11-01-courses-v3.1/progress.md` et `final-review.md`, non versionnés).

## À faire par toi

1. **Relire les décisions ci-dessus.**
2. **Prévenir le groupe** que l'appli installée sur iPhone garde l'ancien nom jusqu'à une réinstallation.
3. **Recette iPhone** (toujours en attente depuis la v3) : choisir un `.gpx`, « Ajouter à mon agenda » et « Télécharger la trace » dans l'appli installée, le lien d'agenda dans Apple Calendrier, et maintenant la carte au doigt.
4. **Choisir un design pour la v4** parmi les quatre démos (ptd-piste, ptd-sentier, ptd-nuit, ptd-dossard.ketra.fr), ou un mélange.
