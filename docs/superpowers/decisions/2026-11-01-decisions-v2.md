# Décisions prises en route (v2)

La v2 a été conçue, planifiée et construite en autonomie, comme tu l'as demandé (« fais la v2, v3, v4 », « je te laisse en autonomie »). Ce document liste les choix faits à ta place, avec la raison de chacun et ce qu'il faudrait défaire si le choix ne te va pas. Dis lesquels revoir, par leur numéro.

La conception complète est dans `docs/superpowers/specs/2026-11-01-courses-v2-design.md`, le plan dans `docs/superpowers/plans/2026-11-01-courses-v2.md`.

## Ce que fait la v2

- **Nouveau nom** : « Prends ton dossard » partout où l'utilisateur le voit (onglet, en-tête, partage d'invitation, nom affiché par les passkeys, README).
- **Prix et date limite** : un prix par épreuve, une date limite d'inscription par événement, visibles sur les cartes et la fiche.
- **Rappel** : un encadré sur la fiche et un bloc « Inscriptions à faire » sur l'accueil pour tes participations « Intéressé » dont la date limite n'est pas passée, avec « S'inscrire » et « Je suis inscrit ».
- **Supporteur** : « Je viens encourager » dans J'y vais et Ajouter quelqu'un, une section « Supporteurs » sur la fiche et une ligne sur les cartes.
- **Commentaires** : sur la fiche (écrire, modifier, supprimer) et les 5 derniers sur l'accueil.
- **Covoiturage et logement** : proposer une voiture ou un logement, y prendre ou libérer une place, y ajouter quelqu'un (pour le propriétaire), modifier, supprimer.

## Décisions de conception

### 1. Pas de notification, un rappel dans le site

- **Décision :** le rappel de date limite et les nouveaux commentaires se voient seulement dans le site (accueil et fiche). Aucune notification.
- **Pourquoi :** le site n'envoie pas d'email (décision de la v1), et une notification push demande un service worker, qui arrive avec la PWA en v3.
- **Si c'était le mauvais choix :** ajouter les notifications push en v3, avec la PWA.

### 2. Date limite sur l'événement, prix sur l'épreuve

- **Décision :** une seule date limite par événement ; un prix par épreuve.
- **Pourquoi :** la clôture vaut en général pour tout l'événement, alors que le prix change d'une épreuve à l'autre.
- **Si c'était le mauvais choix :** déplacer la date limite sur l'épreuve (une migration, le formulaire et l'affichage).

### 3. Prix à 0 € = pas de prix

- **Décision :** comme les autres nombres de la v1, 0 veut dire « non renseigné ». Une course gratuite n'affiche pas de prix.
- **Pourquoi :** PocketBase ne distingue pas un nombre vide de 0.
- **Si c'était le mauvais choix :** écrire « gratuit » dans le nom ou les notes, ou ajouter une case « gratuit ».

### 4. Pas de date d'ouverture des inscriptions, pas de prix qui change avec la date

- **Décision :** seulement la date limite et un prix fixe.
- **Pourquoi :** c'est ce que demandait la feuille de route ; le reste peut attendre un vrai besoin.
- **Si c'était le mauvais choix :** ajouter un champ « ouverture » et un rappel associé.

### 5. Supporteur = une participation à l'événement, sans épreuve

- **Décision :** un supporteur est une participation sans épreuve au statut « Supporteur ». Il n'y a pas de table à part.
- **Pourquoi :** les règles de la v1.1 s'appliquent telles quelles : une seule participation sans épreuve par personne et par événement, jamais en même temps qu'une épreuve, et la conversion quand la personne choisit une épreuve.
- **Conséquence :** un supporteur garde les épreuves dans J'y vais ; en choisir une le fait passer coureur. Il ne compte pas comme partant (« Bientôt dans le groupe », pastilles des épreuves), mais le filtre « personne » le garde.
- **Si c'était le mauvais choix :** pouvoir être à la fois coureur d'une épreuve et supporteur d'une autre demanderait de lever l'invariant de la v1.1.

### 6. Une seule table d'offres pour la voiture et le logement

- **Décision :** une offre est une voiture ou un logement, avec des places ; les personnes y prennent une place.
- **Pourquoi :** c'est la même mécanique, présentée deux fois.
- **Si c'était le mauvais choix :** séparer les tables si l'une des deux grossit (aller et retour, chambres…).

### 7. Une place se prend pour soi ; seul le propriétaire place quelqu'un d'autre

- **Décision :** on prend ou libère sa propre place. Le propriétaire de l'offre (ou un admin) peut ajouter ou retirer n'importe qui. Personne d'autre ne place un tiers.
- **Pourquoi :** une place engage le conducteur ou l'hôte, contrairement à une participation, qu'on peut ajouter pour un ami (« non confirmé »).
- **Si c'était le mauvais choix :** ouvrir l'ajout à tous, avec un « non confirmé » comme pour les participations.

### 8. Une voiture et un logement au plus par personne et par événement

- **Décision :** on ne peut pas proposer deux voitures, ni être dans deux voitures, pour le même événement (pareil pour le logement). Le contrôle se fait à l'écriture seulement : après une fusion de doublons, quelqu'un peut se retrouver dans deux voitures, et l'admin fait le ménage.
- **Si c'était le mauvais choix :** retirer ce contrôle (une fonction dans `server/offers/hooks.go`).

### 9. Pas d'aller et retour distincts dans un covoiturage

- **Décision :** une voiture = un trajet, décrit par le lieu, le jour, l'heure et les notes.
- **Si c'était le mauvais choix :** ajouter une « direction » à l'offre.

### 10. Pas de « je cherche une place »

- **Décision :** les demandes passent par les commentaires.
- **Si c'était le mauvais choix :** ajouter des demandes de place (une table ou une sorte d'offre de plus).

### 11. Commentaires en texte brut

- **Décision :** pas de liens cliquables, de mise en forme, de mentions, ni de « non lu ». Les retours à la ligne sont gardés. « modifié » s'affiche quand le commentaire a été changé plus d'une seconde après son écriture.
- **Pourquoi :** le plus simple et le plus sûr ; « Derniers commentaires » sur l'accueil suffit pour les découvrir.
- **Si c'était le mauvais choix :** rendre les liens cliquables (avec `rel="noopener"`), ou suivre les commentaires lus par personne.

### 12. La carte reste à trancher

- **Décision :** pas de carte en v2.
- **Pourquoi :** elle n'était pas dans ta liste de la v2, et la spec la note « à trancher ».

## Décisions prises pendant la construction

### 13. « Je suis inscrit » confirme aussi la participation

- **Décision :** une participation « Intéressé » ajoutée par quelqu'un d'autre et pas encore confirmée apparaît aussi dans « Inscriptions à faire ». « Je suis inscrit » la passe en « Inscrit », et le serveur la confirme du même coup, comme pour toute modification par la personne concernée.

### 14. Un super-admin ne commente pas et ne propose pas d'offre par l'API

- **Décision :** l'auteur d'un commentaire et le propriétaire d'une offre sont toujours le coureur de la personne connectée. Un super-admin PocketBase n'en a pas : il passe par le tableau de bord.

### 15. L'heure d'un covoiturage s'affiche telle quelle

- **Décision :** « 06:30 », comme saisie, en français comme en anglais.

### 16. Les dates relatives avancent seules

- **Décision :** « il y a 2 minutes » se met à jour chaque minute tant que la page est ouverte, et au retour sur l'onglet. « hier » suit les jours du calendrier de Paris.

## Reporté

Les revues ont laissé des points mineurs, notés pour plus tard. Les plus visibles :

- **Focus clavier, cas rares** : annuler « Ajouter quelqu'un » sur une offre qui s'est remplie entre-temps renvoie le focus en haut de la page ; les fenêtres de la v1 (admin, profil, formulaire d'événement) gardent `disabled` sur leur bouton d'envoi pendant l'envoi.
- **Rafraîchissements** : supprimer un événement attend le rechargement de ses commentaires et offres avant de partir ; renommer un coureur dans l'admin met jusqu'à 10 s à se voir dans les commentaires et les offres.
- **Fenêtre « Ajouter quelqu'un »** : si l'offre se remplit pendant qu'elle est ouverte, elle dit « Tout le monde a déjà une place. » au lieu de « Complet ».
- **Tests** : quelques fichiers de test deviennent très longs (`EventPage.test.tsx`, `HomePage.test.tsx`) et pourraient être découpés ; quelques assertions de tests Go pourraient être plus strictes.

Le détail est dans le registre de travail (`.superpowers/sdd/2026-11-01-courses-v2/progress.md`, non versionné).

## À faire par toi

1. **Relire les décisions ci-dessus** et dire celles à revoir.
2. **Créer le super-admin et le premier admin**, si ce n'est pas déjà fait (README, « Mise en service », étapes 4 et 5).
3. **Recette iPhone** : la liste du README a de nouvelles lignes pour la v1.1 ; il faudrait y ajouter la v2 (date limite et « Je suis inscrit », « Je viens encourager », commentaires, covoiturage et logement).
4. **Pousser le dépôt vers un dépôt distant** pour que la CI tourne.
