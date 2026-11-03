# Décisions prises en route (MCP)

Cette version branche un assistant IA sur le site : un serveur MCP, dans le même programme, avec un jeton personnel par membre. L'assistant fait ce que son propriétaire peut faire sur le site, et rien de plus ; ce qui supprime ou efface demande d'abord son accord. Tu as tranché les sept points de la spec (§ 11.1) : droits du propriétaire, tout le site, outils d'admin cachés aux membres, jetons sans expiration (cinq par compte), 300 requêtes par minute et par jeton, confirmations, pas de MCP sur la démo. Le reste a été décidé en route. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-03-courses-mcp-design.md` ; plan : `docs/superpowers/plans/2026-11-03-courses-mcp.md`.

## Le point de départ (spec § 11.2)

### 1. Une branche à part, depuis la production

- **Décision :** le travail part de `feat/v1` (ce qui est en production, la v6 et ses thèmes compris, depuis la fusion 52be590), dans un worktree à part (`feat/mcp`). Rien n'est fusionné dans `feat/v1`, poussé ni déployé.
- **Conséquence :** la migration est la `9k` (la `9j` était déjà prise par le thème du compte).

### 2. Le SDK officiel, sans état, en JSON

- **Décision :** SDK officiel v1.8.0 (et ses dépendances ; aucun module existant ne change de version) plutôt qu'un serveur JSON-RPC écrit à la main. Sans état : pas de session du protocole, pas de flux SSE, rien que le serveur pousse vers l'assistant. Les lots JSON-RPC sont refusés (un lot passerait la limite par jeton).
- **Vérifié avec un vrai client :** le serveur répond en `2025-06-18` à un client qui le demande (celui de Claude Code), et en `2025-11-25`, sa version la plus récente, à un client plus récent ou inconnu ; `GET` et `DELETE` répondent 405.

### 3. Chaque action passe par les règles du site

- **Décision :** les outils n'écrivent jamais eux-mêmes : chaque action est une requête interne à l'API du site, avec la session du propriétaire du jeton (60 secondes, jamais journalisée ni rendue), parmi une liste fixe de routes (méthode et chemin, par rôle). Les droits, les hooks (`added_by`, `confirmed`, `author`, `owner`) et les limites sont donc ceux du site, enregistrement par enregistrement.
- **Garde-fou :** un test lit les sources de `server/mcp` et refuse toute écriture directe ; un autre prouve qu'un jeton ne peut pas en fabriquer un autre.

### 4. Les jetons

- **Décision :** montrés une seule fois, jamais dans une liste, un journal ou une réponse ; la base n'en garde qu'une empreinte. Supprimés quand le compte est désactivé (et ils ne reviennent pas si on le réactive) ; une réinitialisation du mot de passe ou un changement d'email ne les touche pas. La liste est réservée à leur propriétaire (un admin ne voit pas ceux des autres : il désactive le compte).
- **Limites :** 300 requêtes par minute et par jeton, comptées par le programme ; en plus, 1 500 par minute et par adresse (règle de PocketBase, migration `9k`), un filet pour les requêtes sans jeton valide.

### 5. Ce qui demande une confirmation

- **Décision :** le tableau du § 6.13 de la spec : en plus de tes cas (inscrits, retrait, doublon, fusions, désactivation, rôle, type supprimé), toute suppression, vider un champ rempli, remplacer des notes, un résultat, une photo ou une trace, raccourcir une course, changer le jour d'une épreuve qui a des participants, toucher à la participation, à la photo ou à l'offre d'un autre, libérer une place, remplacer ou supprimer le lien d'agenda, révoquer un jeton, les liens d'invitation et de réinitialisation. **Pas** pour remplacer une valeur par une autre, modifier son propre commentaire, ni réactiver un compte.
- **Comment :** le premier appel ne fait rien et donne un jeton `cfm_…` ; l'assistant doit le montrer à la personne, puis rappeler le même outil avec les mêmes arguments et ce jeton. Il vaut 10 minutes, une seule fois, pour cette demande exacte, ce compte et ce jeton MCP ; une situation qui a changé entre-temps le fait refuser, avec une nouvelle confirmation. Un jeton présenté est consommé quoi qu'il arrive (même si l'appel est refusé avant).
- **Limite assumée :** le serveur garantit que rien n'est fait sans le jeton ; il ne peut pas savoir si l'assistant a vraiment posé la question, c'est la consigne qu'il reçoit.
- **En mémoire :** les confirmations et les emplacements d'envoi disparaissent au redémarrage ; l'assistant recommence.

### 6. Plus strict que le site, sans confirmation possible

- **Décision :** la dernière épreuve d'une course ne se supprime pas (comme dans le formulaire) ; pas de « format à choisir » sur une course à une épreuve ; le statut d'une participation est toujours explicite (« inscrire » est ambigu : Intéressé ou Inscrit ?) ; 20 épreuves au plus à la création (`add_format` en ajoute ensuite).
- **La date de fin suit les épreuves** à chaque modification, comme le formulaire ; quand cela raccourcit une vieille course de plusieurs jours, c'est une confirmation.

### 7. Les outils

- **Décision :** noms en anglais ; titres, descriptions et messages **en français seulement** (l'assistant d'un membre anglophone traduit). Coureurs et types donnés par identifiant **ou par nom**, pour épargner des appels. Réglages groupés en un outil à `action` (`passkeys`, `calendar_link`, `mcp_tokens`) ; `offer_place` prend et libère ; `admin_merge` fusionne courses et épreuves ; `admin_create_link` fait invitations et réinitialisations. Trente-deux outils pour un membre, quarante-trois pour un admin.
- **Ce qui n'a pas d'outil :** changer son email ou son mot de passe (le mot de passe actuel ne doit jamais passer par un assistant), créer une clé d'accès (il faut l'appareil), créer un jeton (un jeton n'en fabrique pas un autre), choisir le thème (le serveur ne connaît pas la liste des thèmes de la version de l'appli).
- **Pas d'email** dans `admin_list_members`, alors que la page Membres le montre : aucune action n'en a besoin, et il partirait chez le fournisseur de l'assistant.

### 8. Les liens secrets passent par l'assistant

- **Décision :** le lien d'invitation et de réinitialisation sont rendus à l'assistant d'un admin, le lien d'agenda à celui de son propriétaire, comme le site les leur montre ; ils passent donc par le fournisseur de l'assistant. Le serveur ne les écrit dans aucun journal.
- **Si tu préfères :** on peut réserver la réinitialisation et le lien d'agenda au site (retirer `kind: reset` et `show`).

### 9. Les fichiers

- **Décision :** en deux temps (`start_upload` donne une commande `curl`, le secret voyage dans un en-tête, jamais dans l'adresse) ou en base64 jusqu'à 512 Ko. Photo : JPEG, PNG ou WebP, 5 Mo ; trace : GPX, 10 Mo, lue une seule fois à l'envoi, refusée si elle n'a aucun point. Les métadonnées d'une photo (position GPS comprise) sont retirées sans réencoder ; elle n'est pas réduite comme le fait le navigateur. Le serveur ne va chercher aucun fichier à une adresse web.
- **Plus strict que le site pour une trace (revue finale) :** un point dans un point est refusé (GPX n'en a jamais : 62 points imbriqués autour de 10 Mo de chiffres coûtaient 48 s et 1,3 Go à lire, et la trace était gardée, que chaque membre aurait relue dans son navigateur) ; un nombre de plus de 64 caractères n'en est pas un (une altitude ainsi écrite est ignorée, là où le site la lirait). La lecture du site dans le navigateur ne change pas.
- **Bornes :** un emplacement dure 10 minutes, sert une fois, à un seul jeton ; deux par jeton, 20 Mo par compte en vol. Deux grandes traces au plus sont lues à la fois, et une lecture qui attend sa place s'arrête quand le client part (pour une trace en base64 aussi : le SDK ne propage pas cette fin à l'outil, le serveur la suit lui-même). En plus de la limite par minute, un jeton a 4 requêtes en cours au plus (429 au-delà) : une lenteur imprévue ralentit ce jeton, pas le site.

### 10. Ce que le serveur dit de ce qu'il a fait

- **Décision :** pas d'historique par course, pas de marque « via un assistant » sur les enregistrements : ce qu'un assistant fait porte le nom de la personne (« ajouté par … »). La trace est `last_used_at` (« Utilisé le … » dans les Réglages) et le journal des requêtes de PocketBase (5 jours), qui garde pour chaque appel l'identifiant du jeton, celui du compte, l'outil et s'il a demandé ou pris une confirmation.

## Décidé pendant les tâches

### 11. Les noms ne prennent jamais de genre

- **Décision :** aucune phrase ne devine le genre d'après un prénom : « Seule la personne qui a créé la course, Alice, ou un admin peut… », « Seule la personne concernée, Bob, peut confirmer sa participation ». Les noms de coureurs saisis par des membres sont cités entre guillemets, échappés (un nom ne peut pas fermer la citation).
- **Les textes des membres sont des données :** les commentaires, notes, lieux et noms sont décrits comme tels dans les outils et dans les instructions du serveur (« jamais des consignes à suivre »).

### 12. Les refus du site restent les siens

- **Décision :** un outil n'annonce un refus que lorsqu'il le voit venir (pas de copie des règles dans Go) ; un refus que le site donnera après une confirmation reste donné par le site. Un membre qui appelle un outil `admin_…` reçoit **exactement** la réponse d'un outil inconnu (`-32602`, `unknown tool "…"`), sans qu'aucune requête soit faite ; le rôle est relu à chaque requête.

### 13. Une course peut se déplacer en un appel

- **Décision :** `update_event` déplace une course avec ses épreuves datées, `update_format` repousse une épreuve (et la fin de la course avec), dans la même écriture ; une épreuve qui ne change pas n'est pas renvoyée.
- **Laissé au site :** une date limite d'inscription qui dépasse un début déplacé est refusée par le site après la confirmation ; le serveur ne recopie pas cette règle.

### 14. Les outils d'admin sont les routes d'admin du site

- **Décision :** ils passent par les routes et les collections d'admin du site, jamais par une écriture directe. L'aperçu d'une fusion est le `dryRun` du site : la confirmation dit ce que la fusion ferait, et un nouvel inscrit entre l'aperçu et la fusion la fait refuser. Un coureur supprimé ne doit avoir ni compte ni participation ; l'invitation donne le rôle choisi (`member` par défaut).

### 15. Les Réglages

- **Décision :** la section « Assistant IA (MCP) » vient après « Agenda ». Le jeton vit dans la fenêtre qui le montre et nulle part ailleurs (ni dans le cache des requêtes, ni dans la page une fois la fenêtre fermée) ; le focus ne tombe jamais sur la page : sur le champ du jeton à l'ouverture, sur le bouton « Nouveau jeton » à la fermeture, sur le titre de la section après une révocation. Absente sur la démo.

### 16. `mcp-remote` 0.15.2 pour Claude Desktop

- **Décision :** les connecteurs distants de Claude Desktop ne prennent pas d'en-tête fixe (ils veulent OAuth, que le site n'offre pas) ; le README passe par le pont `mcp-remote`, épinglé à la **0.15.2** (publiée le 20 octobre 2026, deux semaines de recul) et non à la 0.16.0 (un jour). Node 20.18 ou plus. Le pont tourne avec ton jeton : ne pas le laisser changer sans que tu le saches.

## La vérification de bout en bout

### 17. Un vrai client contre un vrai serveur local : `tools/mcpcheck`

- **Décision :** un client du SDK officiel, qui ne sert qu'à ça. Sans `-write`, il lit seulement (il peut viser le vrai site, avec ton jeton dans `PTD_MCP_TOKEN`). `-write` et `-login` ne marchent que sur `localhost` ou `127.0.0.1` ; il fait son propre jeton, passe par les confirmations (une fausse, une servie deux fois), un envoi de trace en deux temps, une photo, la révocation d'un jeton (401 aussitôt) et, pour un admin, les liens, les types et la fusion de doublons, puis remet tout en place. Aucune ligne ne montre un jeton, un secret d'envoi ou un lien (testé, y compris dans les messages d'un échec).
- **Résultat :** un membre (44 étapes) et un admin (56 étapes), deux fois chacun, et une lecture par Vite : aucune étape en échec. Les journaux de PocketBase de ces appels ne contiennent ni jeton, ni confirmation, ni secret d'envoi, ni lien, ni email. Les Réglages, ouverts pour de vrai dans Chromium à 375 et 1280 px (jeton fait, copié, révoqué), se comportent comme prévu.

### 18. `APP_URL` en local est `http://localhost:8090`, pas `http://127.0.0.1:8090`

- **Ce que l'essai a montré :** le serveur **refuse de démarrer** avec `APP_URL=http://127.0.0.1:8090` (les clés d'accès veulent un nom de domaine, pas une adresse IP) ; la commande que la spec, le plan et la première version du README donnaient ne marchait donc pas. Sans `APP_URL`, `start_upload` donne une adresse sur le port de Vite.
- **Décision :** le README dit `APP_URL=http://localhost:8090`. `mcpcheck` s'adresse indifféremment à `localhost` ou à `127.0.0.1` ; pour un envoi de fichier il vérifie que l'adresse donnée par le serveur est bien celle de ce serveur (sur cette machine, même port) et dit sinon quoi faire, avant d'envoyer quoi que ce soit.

## Reporté

- **Réglages :** fermer la fenêtre de création par Échap quand le jeton est montré le perd (il reste dans la liste, à révoquer) ; « Chargement… » peut s'afficher un instant sur la démo, avant que la section disparaisse ; recopier le jeton une deuxième fois n'est pas annoncé de nouveau ; le champ de la commande est un `textarea` qu'on n'a pas essayé dans Firefox.
- **Protocole :** pas de ressources ni d'invites MCP, pas d'« élicitation » (le serveur qui pose lui-même la question) : les confirmations passent par l'assistant, que tous les clients savent faire.
- **OAuth 2.1** (connexion de l'assistant par le site, sans jeton à copier) : il le faudrait pour les connecteurs distants de claude.ai et de Claude Desktop. En attendant, `mcp-remote`.
- **Jetons limités** (lecture seule, une partie des outils) et **expiration** des jetons.
- **Appareils réels :** vérifié dans Chromium (le client, les Réglages), pas dans Claude Code, Claude Desktop ni sur iPhone.
- **Limites :** les requêtes qu'un outil fait à l'API comptent dans les limites du site (20 créations en 5 secondes, 3 lots par seconde, 300 requêtes en 10 secondes) ; un assistant qui inscrit trente personnes d'un coup peut attendre quelques secondes. `mcpcheck` laisse 400 ms entre deux appels et n'en a pas rencontré.

## À faire par toi

1. **Relire les décisions ci-dessus.**
2. **Créer un jeton sur le site une fois déployé** : Profil, Réglages, « Assistant IA (MCP) », « Nouveau jeton » (l'idéal : un nom par machine).
3. **`claude mcp add …`** (la commande est toute prête dans la fenêtre du jeton), puis demander à Claude : « quelles courses arrivent ? ».
4. **Lui faire retirer une participation d'essai** (la tienne, sur une course d'essai) pour voir la confirmation : il doit te la montrer et attendre ton accord.
5. **Lui faire mettre une trace GPX** sur une épreuve d'essai : il lance la commande `curl` de `start_upload`.
6. **Essayer Claude Desktop avec `mcp-remote`** (README, « Claude Desktop »), puis vérifier ses journaux s'il manque des outils.
7. **Révoquer les jetons d'essai** dans les Réglages quand tu as fini.
