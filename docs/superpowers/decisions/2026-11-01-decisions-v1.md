# Décisions prises en route (v1 et début de v1.1)

Ce document liste les décisions que le contrôleur autonome a prises à ta place pendant la construction de v1 et le début de v1.1, avec la raison de chacune et ce qu'il faudrait défaire si le choix était mauvais. Relis-les, puis dis au contrôleur lesquelles revoir (par leur numéro) : il les rouvrira et corrigera le code, la spec ou le README concernés.

## Décisions

### 1. Travailler sur la branche `feat/v1`, sans worktree

- **Décision :** tout le travail se fait sur la branche `feat/v1` du dépôt principal, sans `git worktree` séparé.
- **Pourquoi :** le dépôt était neuf, sans autre travail en cours, et une branche isole déjà `main`.
- **Si c'était le mauvais choix :** rien à défaire, `main` reste intacte tant que `feat/v1` n'est pas fusionnée.

### 2. Chemin de `codes.go` dans le test d'i18n (T13)

- **Décision :** le test lit `server/apperr/codes.go` avec `new URL("../../../server/apperr/codes.go", import.meta.url)`.
- **Pourquoi :** le plan écrivait `../../server/...`, qui depuis `web/src/i18n/` mène à `web/server` ; l'intention était clairement le fichier du serveur.
- **Si c'était le mauvais choix :** simple correction de chemin.

### 3. PocketBase v0.41.1 et son nouveau chemin de module

- **Décision :** PocketBase v0.41.1, importé depuis `ganigeorgiev.com/pocketbase/pocketbase`.
- **Pourquoi :** la v0.41.1 que tu demandais n'existait ni sur GitHub ni sur le proxy Go (qui s'arrêtaient à v0.40.6, version un temps retenue). Tu as ensuite indiqué la nouvelle adresse officielle, vérifiée par la balise `go-import` et les liens de `pocketbase.io/docs`, où la v0.41.1 existe.
- **Si c'était le mauvais choix :** aucun coût, c'est ta consigne ; la spec §3 et l'en-tête du plan sont déjà à jour.

### 4. Rôle et statut sans valeur par défaut dans le schéma

- **Décision :** `users.role` reste obligatoire et sans défaut (l'invitation et `bootstrap-admin` le fournissent toujours), alors qu'un déclencheur `OnRecordCreate` met `participations.status` à `interested` quand il est vide.
- **Pourquoi :** un champ `select` de PocketBase n'a pas de valeur par défaut. Le défaut de `status` a été ajouté en T6 pour respecter la spec §4, après un premier choix de le faire toujours envoyer par le client.
- **Si c'était le mauvais choix :** petit déclencheur à retirer, ou à étendre à `role` ; un appel d'API sans `role` reçoit `validation_required`.

### 5. Zéro vaut « non renseigné »

- **Décision :** une valeur 0 pour `distance_km`, `duration` ou `time_limit` veut dire « non renseigné ».
- **Pourquoi :** PocketBase stocke un nombre vide comme 0, on ne peut donc pas les distinguer ; la règle « une épreuve a au moins une mesure » (T4) s'appuie là-dessus.
- **Si c'était le mauvais choix :** il faudrait distinguer le vide du zéro, donc changer le schéma et la règle de mesure.

### 6. `manageRule` des utilisateurs

- **Décision :** `users.manageRule` vaut `@request.auth.role = "admin" && id != @request.auth.id`.
- **Pourquoi :** la spec §6.1 veut que les admins voient les emails des autres, et PocketBase les cache sinon. Exclure son propre compte garde la vérification de l'ancien mot de passe quand un admin change le sien (trouvé en revue de T3, d'abord sans cette exclusion).
- **Si c'était le mauvais choix :** les admins ont les droits « manage » de PocketBase sur les autres comptes, au-delà de la lecture des emails ; un admin ne voit pas son propre email par cette règle, mais en tant que propriétaire il le voit déjà.

### 7. Un non-admin qui liste les invitations reçoit une liste vide

- **Décision :** un non-admin qui liste les invitations reçoit 200 avec 0 résultat, pas 403.
- **Pourquoi :** la règle de liste n'est pas nulle, donc la convention de PocketBase s'applique (liste refusée, liste vide), comme la tâche le prévoyait déjà pour les autres collections.
- **Si c'était le mauvais choix :** aucun coût, seul le test attendait un 403.

### 8. Garde « connecté » sur toutes les règles de propriétaire

- **Décision :** toutes les clauses « propriétaire » (modifier un coureur, supprimer un événement ou une épreuve, toutes les règles des passkeys) exigent `@request.auth.id != ""`, avec des lignes de test pour l'anonyme.
- **Pourquoi :** quand la relation était vide, `user = @request.auth.id` était vraie pour un anonyme (vérifié : 200 et 204 sans connexion). La spec §6.1 (seuls les membres connectés, propriétaire ou admin) prime sur le texte des règles du plan.
- **Si c'était le mauvais choix :** aucun coût, c'est strictement plus restrictif.

### 9. Compte désactivé : la connexion répond 403

- **Décision :** la connexion par mot de passe d'un compte désactivé répond 403 (règle d'authentification de PocketBase), pas 400 ; `LoginPage` affiche `t.auth.badCredentials` sur 400 et `t.errors.account_disabled` sur 403.
- **Pourquoi :** la 403 vient de PocketBase lui-même, la contourner coûterait plus cher qu'un message de plus.
- **Si c'était le mauvais choix :** une clé de message de plus à supprimer.

### 10. Changer d'email garde la session

- **Décision :** `/api/app/me/email` renvoie une réponse d'authentification neuve (`{token, record}`, via `apis.RecordAuthResponse`) au lieu de `{email}`, et la page profil enregistre cette session.
- **Pourquoi :** changer l'email régénère la clé du jeton PocketBase, et l'utilisateur serait déconnecté ; la spec §7 veut que « changer d'email » ne déconnecte pas. Un test fixe l'ancien jeton refusé et le nouveau valide.
- **Si c'était le mauvais choix :** changement de contrat de route à reprendre côté serveur et côté profil (T16 s'y adapte déjà).

### 11. Les jetons d'invitation ne voyagent jamais dans une URL vue par le serveur

- **Décision :** le lien devient `APP_URL/invitation#<jeton>` (fragment), et l'API passe à `POST /api/app/invitations/lookup` et `POST /api/app/invitations/accept` avec le jeton dans le corps ; `DELETE /api/app/invitations/{id}` ne change pas.
- **Pourquoi :** un jeton dans le chemin d'URL serait écrit en clair dans le journal des requêtes de PocketBase (`_logs`, 5 jours), ce qui casse la contrainte « seul le SHA-256 est stocké ». Cette contrainte prime sur la conception de la spec §5.3 ; la revue finale a vérifié qu'aucun jeton n'apparaît dans les journaux.
- **Si c'était le mauvais choix :** il faudrait revenir sur le contrat (URL, route `/invitation`, tâches T8, T15, T25, spec §5.2 et §5.3) et accepter qu'un jeton passe par les journaux du serveur.

### 12. Normaliser `APP_URL`

- **Décision :** `config.Load` met l'hôte de `APP_URL` en minuscules et retire le port par défaut (`:80` ou `:443`), avec tests.
- **Pourquoi :** WebAuthn compare l'origine et le RPID à l'identique, donc une majuscule ou un `:443` de trop casserait les passkeys ; cela referme un point mineur de T1.
- **Si c'était le mauvais choix :** petite modification de la configuration.

### 13. Un seul contrôle « admin » partagé

- **Décision :** le contrôle « admin actif » devient une fonction partagée `RequireAdmin` (paquet `accounts`), utilisée par les routes d'invitations et de fusion ; elle refuse aussi un admin désactivé.
- **Pourquoi :** éviter une deuxième copie du même contrôle (T10).
- **Si c'était le mauvais choix :** petit remaniement des routes d'invitations.

### 14. Jamais de `Temporal` au niveau du module

- **Décision :** le code du front n'utilise `Temporal` que dans des fonctions ou des composants, jamais au niveau du module, et chaque tâche front reçoit cette consigne.
- **Pourquoi :** sur Safari, `Temporal` n'existe pas en natif : il est chargé après les imports statiques, donc un usage au niveau du module planterait en écran blanc. Le test de bout en bout WebKit devait servir de filet (voir l'entrée 22) ; le rapport final a vérifié par `grep` qu'il n'y en a aucun aujourd'hui.
- **Si c'était le mauvais choix :** un oubli donnerait un écran blanc sur Safari, et seule la recette iPhone le détecterait.

### 15. Trois codes PocketBase pour le changement de mot de passe

- **Décision :** `validation_invalid_old_password`, `validation_min_text_constraint` et `validation_values_mismatch` rejoignent `ERROR_CODES`, avec leurs messages fr/en.
- **Pourquoi :** le changement de mot de passe du profil (`PATCH` avec `oldPassword`, `password`, `passwordConfirm`) les provoque.
- **Si c'était le mauvais choix :** l'écran afficherait le message générique.

### 16. `registerPasskey` renvoie un booléen

- **Décision :** `registerPasskey` renvoie `Promise<boolean>` (`false` quand l'utilisateur annule) au lieu de `Promise<void>`.
- **Pourquoi :** cela évite la notification « passkey ajoutée » quand on annule ; même forme que `loginWithPasskey`.
- **Si c'était le mauvais choix :** aucun coût, c'est compatible avec les appelants qui ignorent la valeur.

### 17. Bloquer l'API WebAuthn réelle dans les tests navigateur

- **Décision :** après T17, une mini-tâche remplace globalement `navigator.credentials.get` et `navigator.credentials.create` dans l'initialisation des tests navigateur : elles lèvent une erreur, sauf si un test les redéfinit.
- **Pourquoi :** tu as vu une fenêtre Windows de clé de sécurité en cours de route, et Chromium sous Windows passe par la boîte du système même sans fenêtre visible. En réalité aucun test existant n'atteignait l'API : la fenêtre venait sans doute de la vérification manuelle de T16 avec Playwright.
- **Si c'était le mauvais choix :** un peu de code d'initialisation à retirer.

### 18. Authentificateur virtuel pour les vérifications manuelles

- **Décision :** toute vérification manuelle ou de bout en bout dans un navigateur attache d'abord un authentificateur virtuel (CDP) avant le moindre appel WebAuthn, et ne déclenche jamais WebAuthn dans Firefox ou WebKit sur cette machine Windows.
- **Pourquoi :** pour que la fenêtre de sécurité de Windows ne réapparaisse pas pendant les vérifications.
- **Si c'était le mauvais choix :** tu reverrais la fenêtre du système, rien de plus.

### 19. Suppression d'un événement : naviguer, puis `removeQueries`

- **Décision :** après la suppression d'un événement, la page navigue puis appelle `removeQueries` sur `["event", id]`, au lieu de l'invalider.
- **Pourquoi :** l'invalider relancerait la lecture d'un enregistrement qui n'existe plus.
- **Si c'était le mauvais choix :** aucun coût.

### 20. Un coureur qui a un compte ne se supprime pas

- **Décision :** le serveur refuse de supprimer un coureur qui a un compte (code `runner_has_account`), et l'écran Membres cache « Supprimer » pour ces coureurs.
- **Pourquoi :** la spec §6.2 demande de désactiver le compte plutôt, et supprimer le coureur laissait un compte orphelin (seules les participations bloquaient). Prévu comme mini-tâche 22b, puis fondu dans le premier tour de corrections de T22 ; l'avertissement `deleteAccountWarning`, devenu inutile, a été retiré.
- **Si c'était le mauvais choix :** un code d'erreur de plus à retirer.

### 21. Message de partage aussi dans la boîte de dialogue

- **Décision :** après une copie ou un partage de lien, le message s'affiche aussi dans une ligne `role="status"` à l'intérieur de la boîte de dialogue ; la notification reste.
- **Pourquoi :** la notification apparaît derrière le fond du dialogue modal, donc inerte, et n'est probablement pas annoncée aux lecteurs d'écran (point important de la revue de T22).
- **Si c'était le mauvais choix :** une ligne de plus dans la boîte, à retirer.

### 22. Tests de bout en bout reportés à la v5, CI gardée

- **Décision :** les tests de bout en bout (Playwright, trois navigateurs) passent à la v5, leur travail en cours est gardé sur la branche `wip/e2e-v5`, et seules les tâches `go` et `web` de la CI sont conservées (intégrées à T25, sans tâche e2e).
- **Pourquoi :** tu as mis l'E2E de côté pour la v5, mais une CI reste utile dès la v1.
- **Si c'était le mauvais choix :** un fichier de CI à compléter plus tard ; en attendant, plus aucun test ne tourne sur WebKit (voir « Reporté » et la recette iPhone).

### 23. Faire confiance à `X-Forwarded-For` derrière Caddy

- **Décision :** la migration `6_trusted_proxy.go` règle `TrustedProxy.Headers = ["X-Forwarded-For"]` (avec `UseLeftmostIP` à faux), et le README interdit d'exposer le port du conteneur.
- **Pourquoi :** derrière Caddy, PocketBase ignorait l'en-tête et tous les visiteurs partageaient une seule limite de requêtes (point important de la revue de T25). C'est sûr parce que le conteneur n'est publié que sur `127.0.0.1` (port `HOST_PORT`, réglable car le 8090 de ketra.fr est pris) et que Caddy remplace `X-Forwarded-For`.
- **Si c'était le mauvais choix :** l'en-tête ne pourrait être falsifié que si le port était exposé à Internet.

### 24. « Non partant » masqué, « Abandon » reste visible

- **Décision :** seul « Non partant » (`dns`) est masqué de l'affichage direct ; « Abandon » (`dnf`) reste visible.
- **Pourquoi :** la personne a bien pris le départ.
- **Si c'était le mauvais choix :** un filtre à changer.

### 25. Une vague de correctifs après la revue finale

- **Décision :** une seule vague corrige les cinq points importants de la revue : session révoquée qui devient anonyme (rafraîchissement au retour sur l'onglet), connexion sensible à la casse de l'email (migration `7_users_email_nocase.go`), restauration à la main non destructrice, tableau de bord PocketBase bloqué sur le domaine public, « aujourd'hui » recalculé. Elle y ajoute les mineurs peu coûteux : sauvegardes à 3 h heure de Paris, `Caddyfile.example`, `seed` refusé hors `localhost` sauf `--force`, 404 sur un fichier `/assets/*` manquant, et README (tunnel SSH, iOS 17+, seul admin qui oublie son mot de passe).
- **Pourquoi :** aucun défaut n'était critique, mais chacun touchait de vrais utilisateurs (listes vides après une désactivation, mauvais jour affiché, accès super-admin exposé). Les autres mineurs ont été jugés reportables (voir « Reporté »).
- **Si c'était le mauvais choix :** le travail tient en 9 commits (`682da21..fad23cb`), annulables un par un. Deux points d'attention : la migration 7 échoue si deux emails ne diffèrent que par la casse, et le Caddyfile de ketra.fr a déjà été modifié (sauvegardes dans `/etc/caddy/Caddyfile.avant-prends-ton-dossard-20261101-000508` et `/etc/caddy/Caddyfile.avant-ptd-blocage-20261101-005514`).

### 26. Photo de profil

- **Décision :** champ fichier `runners.avatar` (JPEG, PNG ou WebP, 5 Mo au plus, miniatures `96x96` et `256x256`), non protégé, posé par le coureur depuis son profil ou par un admin depuis la page Membres ; le navigateur réduit l'image à 512 px en WebP (`createImageBitmap` puis `OffscreenCanvas`, repli sur `<canvas>`).
- **Pourquoi :** c'est ta demande (une photo à la place des initiales). « Non protégé » évite un jeton de fichier à chaque `<img>` : les URL sont imprévisibles et l'affichage est réservé aux membres.
- **Si c'était le mauvais choix :** quiconque connaît l'URL exacte d'une photo peut la voir ; la protéger demanderait des jetons de fichier PocketBase à chaque affichage.

### 27. Hypothèses du planificateur de la v1.1 acceptées

- **Décision :** le contrôleur a accepté les hypothèses du §9 de `docs/superpowers/specs/2026-11-01-courses-v1.1-design.md` : pas de participation à l'événement en même temps que des participations à des épreuves, pour un même coureur et un même événement, et conversion quand quelqu'un ajoute une épreuve. Il a aussi accepté : « Non partant » absent de « Mes prochaines courses » et du filtre `personne`, « Pas encore décidé » seulement sans aucune participation à l'événement, règles d'abandon de participations à la fusion, et rien de tout cela dans le formulaire de création.
- **Pourquoi :** c'est cohérent avec le design approuvé, y compris ton choix d'une participation sans épreuve (« intéressé » au niveau de l'événement), transformée quand une épreuve est choisie.
- **Si c'était le mauvais choix :** surtout des retouches d'interface.

### 28. Lancer un seul fichier de test

- **Décision :** pour lancer un seul fichier de test, les tâches utilisent `pnpm --dir web exec vitest run <fichier>`.
- **Pourquoi :** `pnpm test -- <nom>`, écrit dans le plan, ne filtre pas.
- **Si c'était le mauvais choix :** aucun coût.

## Reporté

### Tests de bout en bout : v5

- Playwright sur trois navigateurs, reporté à la v5 à ta demande ; le travail déjà fait est sur la branche `wip/e2e-v5`.
- En attendant, la recette iPhone est le seul contrôle qui fait tourner Safari ; le rapport final conseille aussi un test manuel de 10 minutes sur le site déployé (inviter quelqu'un, créer un événement à deux épreuves avec « Je participe », ajouter un ami, le désactiver et vérifier que son onglet ouvert va sur `/connexion`, fusionner un doublon).

### Points mineurs que la revue finale dit pouvoir attendre

Détail dans `.superpowers/sdd/2026-10-31-courses-v1/final-review-report.md` et dans le `progress.md` du même dossier.

**Sécurité et exploitation**

- Pas de CSP sur le site : un en-tête `default-src 'self'` posé par Caddy protégerait le jeton gardé dans `localStorage`.
- La CI ne se lance que sur `push` (pas sur les demandes de fusion) et n'a pas de `timeout-minutes`.
- Le magasin de sessions WebAuthn n'a pas de plafond global (les limites par IP le bornent déjà).
- `/api/app/me/email` n'est protégée contre les essais de mot de passe que par la limite générique de `/api/`.
- Version `gabriel-vasile/mimetype` v1.4.15 (dépendance indirecte) retirée par son auteur : **fait**, mise à jour en v1.4.16 avant la photo de profil de la v1.1 (commit 4ac36df).

**Front**

- Le cache n'est pas vidé quand on change d'utilisateur sans se déconnecter (la clé `["pending"]` n'a pas d'identifiant utilisateur).
- Des erreurs PocketBase n'ont pas de message dédié (mot de passe de plus de 71 octets, nom de coureur de plus de 50 caractères, URL d'inscription refusée) : le texte est générique.
- La page « introuvable » est provisoire : elle affiche seulement « Courses », sans message ni lien vers l'accueil.
- « À venir », « passées » et le groupement par mois se calculent par événement et non par épreuve (spec §7), et la bannière passkey passe avant « À confirmer » sur l'accueil.
- Accessibilité : pas de `safe-area-inset-bottom` sur la barre d'onglets (iPhone), 35 à 42 arrêts de tabulation dans l'agenda, notification qui disparaît en 5 s sans pause.
- Typographie française (apostrophes droites, pas d'espace insécable avant les deux-points) et quelques coquilles de texte.
- Fonctions dupliquées (`TextField`, `useSettled`, classes de boutons, bloc « erreur + réessayer », trois descripteurs d'erreur) : un composant `<QueryError>` partagé viendra plus tard.
- `Intl.DurationFormat` est construit au démarrage, sans risque sur les navigateurs qui font déjà tourner l'application.

**Serveur**

- Le serveur accepte des événements de n'importe quelle durée (une faute d'année donne un événement de 36 ans dans chaque mois de l'agenda).
- La garde « dernier admin » n'est pas atomique pour deux modifications simultanées (inatteignable en pratique).
- Les invitations admin en attente survivent à la rétrogradation de leur auteur, et leur rôle n'est pas affiché sur la ligne du membre.
- Un compteur de passkey qui régresse ne donne qu'un avertissement, une seule fois, et pas un refus.
- Une requête de fusion au corps illisible répond 404 `not_found`, faute de code `bad_request`.

**Tests**

- Plusieurs cas de refus ne vérifient que le statut HTTP, pas que les données sont restées inchangées.
- `/api/batch` n'est testé qu'en création, et le compteur de passkey qui régresse n'a pas de test.
- Un premier lancement à froid de Vitest peut échouer par intermittence (piste : `optimizeDeps.include` si cela arrive en CI).

## À faire par toi

Le site de test tourne déjà sur https://prends-ton-dossard.ketra.fr (dans `/opt/prends-ton-dossard`, dernier déploiement `fad23cb`), mais sans super-admin ni admin.

1. **Créer le super-admin PocketBase puis le premier admin du site.** Les commandes `superuser upsert` et `bootstrap-admin` sont aux étapes 4 et 5 de « Mise en service » du README (à lancer avec `docker compose exec courses …` sur le serveur) ; le mot de passe se tape avec `read -rs`, pas dans la commande.
2. **Faire une restauration pour de vrai, une fois, avant d'ouvrir le site au groupe.** La procédure est dans « Restauration » du README (depuis le tableau de bord par le tunnel SSH, à préférer ; à la main sinon), suivie de « Vérifier la restauration » ; elle n'a jamais été exécutée, faute de Docker en local.
3. **Faire la recette iPhone.** « Recette manuelle sur iPhone » du README, sur le vrai domaine en HTTPS, avec un iPhone sous iOS 17+ (note sa version) et un compte de test désactivé ensuite.
4. **Pousser le dépôt vers un dépôt distant pour que la CI tourne.** Aucun dépôt distant n'est configuré : la CI (`.github/workflows/ci.yml`, tâches `go` et `web`) n'a donc jamais tourné, et les versions des actions GitHub et des images Docker n'ont pas pu être vérifiées.
