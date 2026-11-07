# Décisions prises en route (v7)

La v7 ajoute l'ouverture des inscriptions avec ses rappels, les courses dont on ne connaît que le mois, le titre de chaque page, le zoom de la carte et du profil du D+, le partage d'une course, le flux d'agenda du groupe et la météo. Tu as fixé le but, ta liste d'idées et deux ajouts en route :
- « ajoute un flux de calendrier avec toutes les courses où il y a du monde, à faire avant la météo » ;
- « peux-tu ignorer l'étape du matériel pour le moment ? ».

Le reste a été décidé en route, et il y a 20 décisions. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-07-courses-v7-design.md` (son § 16 était la première liste de celle-ci) ; branche `feat/v7`. Rien n'est fusionné, poussé ni déployé : l'environnement de dev vient d'abord (n° 18), la production seulement après ton accord.

## L'ouverture et les rappels

### 1. Une ouverture, c'est un jour et une heure facultative

- **Décision :** l'ouverture est donnée à l'heure de Paris. **Sans heure, le site compte 9 h** : « 1 jour avant » part la veille à 9 h, « 1 heure avant » à 8 h le jour même.
- **Bornes :** l'ouverture est au plus tard la date limite et le premier jour de la course.
- **Sur la fiche :** le jour de l'ouverture, elle dit « aujourd'hui à 10:00 » toute la journée (un calcul au jour près, pas à la minute).

### 2. Qui reçoit les rappels

- **Décision :** les personnes « Intéressé » ou « Inscrit », sur une épreuve ou sur la course seule. Les supporteurs n'en ont pas. Un rappel par course, même à deux épreuves.
- **Un seul réglage** pour les alarmes de l'agenda et pour les notifications, et **« Jamais » par défaut** : rien ne change pour personne tant qu'on n'a pas choisi.

### 3. « 1 jour avant » veut dire la veille à la même heure

- **Décision :** le rappel du jour est dû **la veille à la même heure de Paris** que l'ouverture. Les deux nuits du changement d'heure, cela fait 23 h ou 25 h avant, pas 24 h.
- **Pas deux notifications en une heure :** « 1 jour avant » ne part pas quand « 1 heure avant » est déjà dû et choisi.
- **En retard :** un rappel que le programme n'a pas pu envoyer à l'heure (il redémarrait) part tant que l'ouverture n'est pas passée, avec le texte du moment.

### 4. Plutôt perdu que deux fois

- **Décision :** un rappel part **au plus une fois**. Un arrêt du programme pendant un envoi perd ce rappel plutôt que d'en envoyer deux, et un arrêt attend 5 secondes au plus la fin du passage en cours.
- **Une ouverture déplacée** réarme ses rappels pour sa nouvelle heure.

### 5. Les clés des notifications

- **Décision :** les clés VAPID sont dans un fichier du volume, `pb_data/push_vapid.json`, créées au premier démarrage, **jamais régénérées d'elles-mêmes** et sauvegardées avec les données. Rien n'est dans le dépôt, une variable ou un journal.
- **À savoir :** le fichier est publié par un **lien dur** : le volume doit en accepter (ext4 et overlay le font).
- **Web Push est écrit sur la bibliothèque standard de Go**, sans `webpush-go`, et vérifié par l'exemple de la RFC 8291.
- **Changer les clés** (une fuite) : supprimer le fichier, redémarrer ; chaque appareil se réabonne à sa prochaine ouverture du site. La marche est dans le README.

### 6. Les services de notification acceptés

- **Décision :** les adresses d'abonnement sont limitées à Google (`fcm.googleapis.com`), Mozilla, Apple et Microsoft, en `https` et avec des noms ASCII. Sans cette liste, un membre ferait appeler au serveur n'importe quelle adresse.
- **Ce que je ne sais pas :** certaines versions de Chrome pourraient passer par un autre nom de Google (`jmt17.google.com` a été vu dans des rapports). Si un vrai appareil en montre un, élargir la liste est ton choix : une ligne, mais c'est ta confiance qu'on étend.

### 7. Les appareils

- **Décision :** dix par compte (le plus ancien est remplacé) ; **se déconnecter retire l'appareil** ; un compte désactivé perd les siens ; un bouton « Envoyer un essai ».
- **La démo n'a ni rappels ni notifications.**

### 8. L'agenda personnel

- **Décision :** il se relit toutes les heures (`REFRESH-INTERVAL`) ; le fichier d'une course porte les alarmes de la personne.
- **Limite, hors de notre main :** Google Agenda et Outlook les ignorent d'après des utilisateurs ; Apple Calendrier sur Mac les retire par défaut (case « Supprimer les alertes » à décocher). Les notifications sont le canal sûr.

## Les courses au mois

### 9. Gardées jusqu'à la fin du mois

- **Décision :** une course au mois va du 1er au dernier jour du mois (la fin est posée par le serveur) ; ses épreuves n'ont pas de date ; « Terminé » est possible dès le 1er.
- **Rangement :** à la fin de leur mois dans les listes ; **à part dans l'agenda** (un bloc au-dessus de la grille), à venir jusqu'à la fin du mois, résultats à saisir après.
- **Dans les flux d'agenda :** un jour entier le 1er du mois, « (date à préciser) », plutôt que rien.
- **Formulaire :** une liste de mois (12 en arrière à 36 en avant), pas `<input type="month">`.

## Titres, zoom, partage

### 10. Le titre de chaque page

- **Décision :** « `Page` · Prends ton dossard », dans la langue de l'interface, le mois et l'année dans ceux de l'agenda et des statistiques.
- **Sans titre propre :** il n'y a pas de routes à part pour la démo ou la réinitialisation du mot de passe ; ces pages gardent le titre du site.

### 11. La carte au toucher

- **Décision :** sur un écran tactile, **un doigt fait défiler la page, deux doigts déplacent la carte** ; Ctrl (⌘ sur Mac) + molette zoome à l'ordinateur.
- **Limite :** l'écran tactile est lu une fois, à l'ouverture de la page, selon la lettre de la spec (§ 7.1) : une tablette où l'on se sert d'une souris ne peut pas glisser la carte.

### 12. Le zoom du profil

- **Décision :** glisser, pincer, boutons, touches + et −, et Ctrl ou ⌘ + molette sur le profil (le même pas que les boutons) ; 200 m au moins ; la carte suit la portion choisie. La carte garde `zoomSnap: 0.5` : un petit pincement sur un téléphone garde son demi-niveau au lieu de revenir en arrière, et un cran de molette reste d'un niveau.
- **Les couleurs de pente suivent le zoom (changé à ta demande, après « le zoom ne semble pas zoomer tant que ça… enfin avoir les détails »).** La première version les lisait sur une longueur fixe, 1 % de la trace (846 m sur 42 km), si bien qu'une portion de 200 m n'avait qu'une couleur. Une pente se lit maintenant sur `max(portion / 100, 25 m, l'écart entre les points)` de chaque côté (75 m au lieu de 25 m en vue entière) : en vue entière rien ne change, et en zoomant les couleurs changent à l'échelle de la vue (une rampe de 150 m à 20 % a sa couleur).
- **Nom accessible :** « Vue entière du profil » (le nom contient le texte du bouton, « Vue entière »).

### 13. Partager

- **Décision :** un texte seul, l'adresse dedans, **sans aucun nom de participant** ; il porte aussi, pour chaque épreuve, la limite de temps et le prix comme la fiche. Le texte donne la **vraie date** de l'ouverture, jamais « aujourd'hui » (il est lu plus tard).
- **Firefox sur ordinateur** n'a pas Web Share : une fenêtre copie le texte et propose un lien `wa.me` (« Envoyer sur WhatsApp », dans un nouvel onglet). Il n'y a pas d'aperçu dans WhatsApp : le lien demande toujours de se connecter, et un aperçu demanderait une page publique signée (`docs/TODO.md`).

## Le flux du groupe

### 14. Un second lien secret

- **Décision :** toutes les courses avec au moins une participation autre que « Non partant » (supporteurs et intéressés sans épreuve compris), **jusqu'à un an en arrière**, avec les noms et statuts par épreuve ; **ni ouverture, ni date limite, ni alarme**.
- **C'est un lien à part**, parce qu'il donne les noms des membres. Un lien de chaque sorte par compte ; en renouveler un ne touche pas l'autre.
- **Sur la démo, le lien du groupe répond 404** (tout le monde y partage le même compte, et ce lien donne les noms des membres).
- **Les liens, personnel et du groupe, survivent à un changement de mot de passe ou d'email**, comme avant. Seule la désactivation du compte les coupe. (Les jetons MCP, eux, sont révoqués par un tel changement.)

## La météo

### 15. Où, quand, combien

- **Décision :** les jours de la course seulement, de J-7 à son dernier jour, depuis aujourd'hui (pendant une course commencée, les jours passés sont laissés de côté). Au départ de la première trace GPX, sinon du lieu géocodé (premier résultat, avec le lieu trouvé affiché).
- **Changé après le test de l'utilisateur :** avant J-7 (et pour une course au mois), la fiche ne se tait plus : la section « Météo prévue » dit « La météo sera là à partir du … , une semaine avant la course » (ou « La météo viendra quand le jour de la course sera connu »), sans requête. Le silence se lisait comme une panne.
- **Open-Meteo :** l'API gratuite est réservée à un usage non commercial, ce que ce site privé est. Le serveur envoie des coordonnées arrondies à 0,01° (ou le texte du lieu pour le géocodage), jamais un nom de membre ni de course. L'attribution est sur la fiche et dans l'outil MCP.
- **Cache en mémoire :** 1 heure pour une prévision, 30 jours pour un lieu ; une prévision de moins de 6 heures est montrée (« ancienne ») si Open-Meteo ne répond pas.
- **Budget partagé :** **500 appels par heure et 2 500 par jour de Paris au plus pour tous les membres ensemble, 300 par jour sur la démo** (la production, la démo et le dev partagent une IP, limitée à 10 000 appels par jour par Open-Meteo ; ajouté après la relecture finale). Au-delà, le cache (périmé s'il y en a un), sinon « météo indisponible ».
- **Un appel raté est retenu une minute** : un Open-Meteo qui ne répond pas n'est pas rappelé à chaque ouverture de page.

### 16. Aussi sur la démo

- **Décision :** la route de la météo existe sur la démo (aucune donnée personnelle, bornée par le budget).

## Le MCP et le dev

### 17. Deux outils nouveaux, un champ

- **Décision :** `reminders` (voir ou changer son choix de rappels) et `get_weather` ; `calendar_link` gagne `scope` (le lien du groupe). Cela fait **34 outils de membre et 45 d'admin**.
- **Pas d'outil pour activer un appareil** (il faut le navigateur de l'appareil), ni pour partager.
- **Confirmations :** effacer une ouverture ; passer au mois une course dont des épreuves ont une date (elles la perdent) ; renouveler ou supprimer le lien du groupe, comme le personnel.
- **Ce qui vient d'Open-Meteo** (le nom d'un lieu) est cité comme le texte d'un membre.
- **Les instructions du serveur** gagnent une ligne : l'ouverture et la précision au mois.

### 18. L'environnement de dev

- **Décision :** `https://dev-prends-ton-dossard.ketra.fr` (dossier `/opt/ptd-dev`, port 8130, volume `ptd-dev_pb_data`), avec les données du `seed` : mot de passe au hasard dans `/opt/ptd-dev-secrets/SEED_PASSWORD` (root seulement ; je ne l'affiche jamais). Rappels, notifications et météo y sont actifs, avec leurs vrais services ; pas de `DEMO_LOGIN_EMAIL`.
- **Le `seed`** a de quoi tout essayer : « Trail des Crêtes » dans 5 jours (ouverture passée, date limite dans 2 jours, une trace GPX sur le 42 km), « Grand Trail du Vercors » au mois (ouverture dans 2 jours à 10:00 ; Alice et Sam intéressés, Bob inscrit), « Hyrox Lyon » (ouverture demain, sans heure).
- **La production** ne vient qu'après ton accord, avec la sauvegarde du volume `pb_data` d'abord ; elle génère ses propres clés VAPID à son premier démarrage.

## Reporté

### 19. Le matériel obligatoire

- **Décision (la tienne, le 2026-11-07) :** le matériel d'une épreuve et sa liste à cocher **ne sont pas dans la v7**. Rien n'en est dans le code, la base, le `seed` ni les outils de l'assistant ; l'idée reste dans `docs/TODO.md`. La spec en garde les paragraphes, marqués comme reportés.

### 20. Ce qui reste hors de la v7

- Un aperçu (vignette) dans WhatsApp ; les rappels d'autre chose que l'ouverture (date limite, résultat à saisir) ; un email de rappel (le site n'en envoie pas) ; la météo heure par heure ; les notifications par l'assistant ; une page « historique des rappels ».
- Les tests sur GitHub et les sauvegardes hors du serveur (`docs/TODO.md`).

## À faire de ton côté

Sur l'environnement de dev, `dev-prends-ton-dossard.ketra.fr` (comptes `alice@`, `bob@` ou `admin@example.test`, mot de passe dans `/opt/ptd-dev-secrets/SEED_PASSWORD`) :

- **Notifications, sur iPhone :**
  - installer le site sur l'écran d'accueil depuis `dev-prends-ton-dossard.ketra.fr` (Partager, « Sur l'écran d'accueil ») et l'ouvrir depuis l'icône (iOS 16.4 ou plus) ;
  - dans Réglages, « Rappels », choisir « 1 jour et 1 heure avant », « Activer sur cet appareil », puis « Envoyer un essai » ;
  - sur une course où tu es « Intéressé », mettre une ouverture **dans 70 minutes** et attendre la notification, une heure avant ;
  - en cas de doute sur Chrome ou un autre navigateur : si l'activation est refusée, dis-le-moi avec le nom du navigateur (voir le n° 6).
- **Agenda :**
  - abonner le lien « Mes courses » et celui de « Les courses du groupe » dans Apple Calendrier (décocher « Supprimer les alertes » pour voir les alarmes) ;
  - les abonner aussi dans Google Agenda, et regarder si les alarmes y apparaissent (on s'attend à ce que non).
- **Partager :** depuis Firefox sur un ordinateur (la fenêtre « Copier le texte » et « Envoyer sur WhatsApp ») et depuis le téléphone (la feuille de partage).
- **La météo** de « Trail des Crêtes » : les jours, le lieu et la source.
- **Zoom :** Ctrl + molette sur la carte d'un ordinateur, deux doigts sur le téléphone ; une portion du profil du D+ (glisser ou pincer), avec la carte qui suit.
- **Claude Code (MCP) :** lui demander la météo d'une course, et de changer tes rappels.
- **Une fois content :** dis-le-moi, et la production suit, après la sauvegarde du volume.
