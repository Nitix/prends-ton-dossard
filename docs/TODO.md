# À faire, plus tard

Idées notées le 2026-11-03. Rien n'est commencé.

## Tes idées

- **Une course sans date précise :** donner seulement un mois (« juin 2027 »). Il faudra :
  - une précision de date sur l'événement (jour ou mois) ;
  - décider où la course se range dans la liste, l'agenda et les stats ;
  - décider ce qu'elle devient dans le flux iCal : rien, ou un rappel au début du mois ;
  - une date limite d'inscription qui reste facultative.
- **Zoomer sur la carte avec Ctrl (⌘ sur Mac) + molette**, comme Google Maps : la molette seule fait toujours défiler la page.
- **Zoomer sur le profil du D+ :** sélectionner une portion au glisser (ou pincer sur téléphone) pour en voir le détail, avec un bouton pour revenir à la vue entière. La carte suit la portion choisie.
- **Le titre de l'onglet change avec la page :** « Trail des Crêtes · Prends ton dossard », « Agenda · Prends ton dossard »… Ça aide aussi les lecteurs d'écran (WCAG 2.4.2).
- **Partager une course sur WhatsApp avec ses infos, sans ouvrir le site :**
  - **Le plus simple et le plus sûr :** un bouton « Partager » (Web Share API, sinon un lien `wa.me`) qui envoie un texte tout prêt : nom, dates, lieu, épreuves, date limite et le lien. Le texte part de ton téléphone ; le lien demande toujours de se connecter.
  - **Pour avoir l'aperçu (vignette, titre) dans WhatsApp,** il faut une page que le robot de WhatsApp lit sans compte. Il faudrait :
    - un lien de partage signé et qui expire, créé sur demande ;
    - qui ne montre que le nom, les dates et le lieu (jamais qui y va) ;
    - qu'on peut révoquer.

    C'est plus de travail et ça expose ces trois informations.

## Mes idées

- **Vérifier sur un vrai iPhone** (Safari et l'app installée) : les thèmes, le mode hors ligne, la carte et le D+, et Claude Code avec le MCP. Les tests ne tournent que dans Chrome.
- **Les tests automatiques sur GitHub** (Go et web), avec Firefox et Safari (WebKit), qui ne se lancent pas sur ce PC Windows.
- **Des sauvegardes automatiques avec une copie hors du serveur.** Aujourd'hui, elles se font seulement avant un déploiement, et sur le même disque.
- **Des rappels qui arrivent sans ouvrir le site** (date limite d'inscription, résultat à saisir) : notifications push de la PWA (iPhone depuis iOS 16.4, app installée) ou un email la veille.
- **Garder les thèmes qui servent :** dans quelques semaines, regarder quels thèmes sont choisis (ils sont sur les comptes) et retirer les autres, pour alléger le code et les tests.
- **Petits restes des versions passées :**
  - le gris d'aide sur la carte de connexion est juste à 4,5:1 ;
  - les polices des échantillons du choix du thème pèsent 318 Ko sur la page Réglages ;
  - l'accueil ne montre pas encore les prochaines courses en grille.
