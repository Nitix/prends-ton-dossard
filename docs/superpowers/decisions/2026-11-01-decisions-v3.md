# Décisions prises en route (v3)

La v3 a été conçue, planifiée et construite en autonomie, comme pour la v2. Ce document liste les choix faits à ta place, avec la raison de chacun et ce qu'il faudrait défaire si le choix ne te va pas. Dis lesquels revoir, par leur numéro.

La conception complète est dans `docs/superpowers/specs/2026-11-01-courses-v3-design.md`, le plan dans `docs/superpowers/plans/2026-11-01-courses-v3.md`.

## Ce que fait la v3

- **Résultats** : un temps, un classement (« 12 sur 340 ») et une note sur chaque participation « Terminé » ou « Abandon ».
- **Résultats à saisir** : un bloc sur l'accueil après une course, pour tes participations passées sans résultat.
- **Statistiques** : une page par année (courses, kilomètres, D+, abandons, par personne) et une page par coureur (bilan par année et historique).
- **Trace GPX** : un fichier par épreuve, envoyé depuis le formulaire. La fiche montre le tracé, le profil de dénivelé, la distance et le D+, et un lien vers le parcours (Strava, Garmin, site de la course).
- **Agenda** : un lien d'abonnement personnel (tes courses et tes dates limites), à ajouter dans Google Agenda, Apple Calendrier ou Outlook. Sur la fiche, « Ajouter à mon agenda » télécharge un fichier `.ics` de l'événement.
- **Appli** : le site s'installe sur l'écran d'accueil du téléphone, et la dernière page reste lisible sans réseau.

## Décisions de conception

### 1. Le résultat est porté par la participation

- **Décision :** le temps, le classement et la note sont des champs de la participation, pas une table à part. Ils suivent ses droits : la personne concernée ou un admin les saisissent, et n'importe qui tant que la participation n'est pas confirmée (pour un coureur sans compte).
- **Si c'était le mauvais choix :** une table de résultats, si un jour on veut plusieurs résultats par participation (temps intermédiaires).

### 2. Changer le statut efface le résultat

- **Décision :** passer de « Terminé » à « Abandon » (ou à tout autre statut) vide le temps et le classement, sans demander de les effacer à la main.
- **Pourquoi :** un temps sur un abandon fausserait les statistiques.

### 3. Les statistiques sont calculées dans le navigateur

- **Décision :** pas de route ni de vue SQL ; la page lit les participations et fait les totaux.
- **Pourquoi :** pour une quinzaine de personnes, c'est instantané.
- **Si c'était le mauvais choix :** une route `/api/app/stats` si les données grossissent.

### 4. Pas d'onglet Statistiques

- **Décision :** on y va par un lien depuis le Profil et la liste des courses passées.
- **Pourquoi :** la v4 revoit toute la navigation.

### 5. La trace se lit dans le navigateur, sans fond de carte

- **Décision :** le fichier GPX est lu sur le téléphone ; le tracé est dessiné seul, sans carte, et sans bibliothèque.
- **Conséquence :** une trace de plus de 10 Mo est refusée dès qu'on la choisit.
- **Si c'était le mauvais choix :** la carte (OpenStreetMap) reste à trancher.

### 6. Le D+ ignore les variations de moins de 3 m

- **Décision :** une montée ne compte qu'à partir de 3 m d'écart, pour gommer le bruit du GPS.
- **Conséquence :** le D+ calculé peut différer un peu de celui de Strava ou de la montre. Le D+ saisi dans le formulaire reste celui qui s'affiche sur les cartes.

### 7. Le lien d'agenda ne se montre qu'une fois

- **Décision :** le serveur ne garde que l'empreinte du jeton. Le lien s'affiche à sa création, avec « Copier » ; perdu, on en crée un nouveau (l'ancien cesse de marcher).
- **Pourquoi :** comme les invitations ; une fuite de la base ne donne pas les liens.

### 8. Le service worker est écrit à la main et ne garde jamais l'API

- **Décision :** pas de Workbox. Seules la page et les fichiers de `/assets/` (noms avec empreinte) vont dans le cache ; les données viennent toujours du réseau.
- **Conséquence :** hors ligne, l'appli s'ouvre mais n'affiche pas les données.

### 9. Notifications push et carte : toujours à trancher

- **Décision :** hors v3. Les notifications demandent des clés VAPID, une dépendance Go et le stockage des abonnements.

## Décisions prises pendant la construction

### 10. Contenu du flux d'agenda

- Une épreuve est placée à sa date, ou au premier jour de l'événement si elle n'en a pas.
- Une participation à l'événement sans épreuve (intéressé, supporteur) couvre tous les jours de l'événement.
- La description donne le statut (« Inscrit », « Intéressé · non confirmé »…) et l'adresse de la fiche.
- « Clôture des inscriptions » apparaît une fois par événement où tu es « Intéressé », passées comprises.
- « Non partant » n'apparaît pas.

### 11. Un compte désactivé perd son flux d'agenda

- **Décision :** le lien d'un compte désactivé répond « introuvable » ; il remarche si le compte est réactivé.

### 12. Les jetons d'agenda restent hors des journaux

- **Décision :** PocketBase ne garde pas trace des lectures réussies du flux, et Caddy n'écrit pas les adresses `/api/app/calendar/*` dans son journal.
- **Au passage (à ta demande) :** chaque projet a maintenant son journal Caddy : `linkx.log` (les hôtes Zelda), `prends-ton-dossard.log`, `ketra.log` (le reste).

### 13. Une trace sans déclaration XML est complétée avant l'envoi

- **Décision :** si le fichier ne commence pas par `<?xml …?>`, le site l'ajoute avant de l'envoyer.
- **Pourquoi :** sans elle, le serveur prend le fichier pour du texte et le refuse.

### 14. Un texte invalide ne casse pas le flux

- **Décision :** les caractères invalides ou de contrôle d'un nom ou d'un lieu sont remplacés ou retirés dans le flux et dans le fichier `.ics`.
- **Pourquoi :** une requête fabriquée pouvait enregistrer un tel nom et bloquer le serveur à la lecture du flux (corrigé avant la mise en ligne).

### 15. Le cache de l'appli garde les anciens fichiers

- **Décision :** les fichiers d'une ancienne version restent dans le cache du téléphone après une mise à jour (quelques centaines de Ko par déploiement).
- **Si c'était le mauvais choix :** les nettoyer à chaque nouvelle page.

### 16. « Installer » n'apparaît que quand le navigateur le propose

- **Décision :** sur Android et ordinateur, le bouton apparaît quand le navigateur l'offre ; sur iPhone, une phrase explique « Partager, puis Sur l'écran d'accueil ». Dans l'appli installée, la section disparaît ; dans l'onglet où on vient d'installer, elle dit « L'appli est installée. ».

### 17. Fusionner deux épreuves garde la trace

- **Décision :** quand l'admin fusionne deux épreuves, la trace GPX et le lien de parcours de l'épreuve fusionnée passent sur celle qu'on garde, si elle n'en a pas. Si les deux en ont une, celle de l'épreuve gardée reste.

### 18. Une course passée n'apparaît qu'une fois sur l'accueil

- **Décision :** une course où un ami t'a inscrit, passée et pas encore confirmée, apparaît dans « Résultats à saisir » et plus dans « À confirmer ». Saisir le résultat la confirme.

## Reporté

Les revues ont laissé des points mineurs, notés pour plus tard. Les plus visibles :

- **Statistiques** : les flèches d'année ne s'arrêtent pas ; le tableau des totaux défile au doigt mais pas au clavier ; « Temps » passe à la ligne sur un petit écran.
- **Trace** : le profil peut lisser un pic très court quand la trace a beaucoup de points (les chiffres, eux, utilisent tous les points) ; une trace très courte a peu de graduations.
- **Résultats** : pas de limite haute sur un temps ou un classement saisi ; passer d'« Abandon » à « Terminé » dans la fenêtre reformate le temps tapé.
- **Formulaire** : le message « la trace n'a pas pu être envoyée » ne reste que 5 secondes ; le bouton d'envoi du formulaire d'événement garde encore `disabled` pendant l'envoi.
- **Fichiers de tests** : plusieurs deviennent très longs (`EventPage`, `EventForm`, `HomePage`, `participations`, `migrations`) et sont à découper.
- **Dessin des icônes** : volontairement simple, il sera repris avec le nouveau design.

Le détail est dans le registre de travail (`.superpowers/sdd/2026-11-01-courses-v3/progress.md` et `final-review.md`, non versionnés).

## À faire par toi

1. **Relire les décisions ci-dessus** et dire celles à revoir.
2. **Recette iPhone**, à faire en priorité car je n'ai pas pu les vérifier ici :
   - choisir un fichier `.gpx` dans le formulaire (iOS grise parfois les `.gpx` dans le sélecteur) ;
   - dans l'appli installée, « Ajouter à mon agenda » et « Télécharger la trace » (les applis installées sur iPhone gèrent mal les téléchargements) ;
   - « Partager → Sur l'écran d'accueil » ouvre bien le site en plein écran ;
   - le lien d'agenda ajouté dans Apple Calendrier.
   Dis-moi ce qui ne marche pas, j'ai une solution de repli pour chacun.
3. **Vieilles sauvegardes du Caddyfile** : `/etc/caddy/Caddyfile.avant-linkx` (lisible par tous) et `Caddyfile.avant-secrets-20260920-192354` contiennent d'anciennes clés OVH en clair. Elles ne sont plus en service ; tu peux les supprimer.
4. **Portainer** répond 502 : aucun conteneur portainer ne tourne (constaté pendant le changement des journaux, sans lien avec lui).
5. **Pousser le dépôt vers un dépôt distant** pour que la CI tourne (toujours en attente depuis la v2).
