# « Prends ton dossard » : un serveur MCP pour les assistants

- **Date** : 2026-11-02
- **Statut** : design écrit après trois séries de questions à l'utilisateur. Ses réponses sont au § 1 et au § 11.1 ; ce qui reste à trancher est au § 11.2
- **Auteur** : Guillaume (avec Claude)
- **Base** : la spec v1 et ses addendums (v1.1 à v6). Ce document ne décrit que ce qui s'ajoute. En cas de conflit, il l'emporte.

## 1. Objectif

> « Ajoute un serveur MCP ou API que toi ou un autre LLM puisses renseigner des courses et enregistrer des gens sans ouvrir l'interface. »

Les réponses de l'utilisateur :

- **Au nom de qui ?** « Comme un membre, par jeton. » Chacun crée un jeton personnel dans Profil → Réglages ; un assistant (Claude Code, Claude Desktop, un autre client MCP) qui a ce jeton agit au nom de cette personne. Il ne crée pas de compte lui-même.
- **Avec quels droits ?** « Le MCP doit pouvoir faire la même chose que l'utilisateur qui a créé le token. En quelque sorte, c'est juste le point d'entrée différent. » Les outils donnent exactement ce que le site donne au propriétaire du jeton, ni plus, ni moins. (Une correction antérieure, qui réservait les outils d'épreuve aux admins, venait d'un malentendu sur les règles du site : elle est remplacée par celle-ci.)
- **Et l'administration ?** « La création du type de course l'est [réservée aux admins], seul un admin peut le faire, comme créer un compte et toute l'admin. » Le jeton d'un admin a donc aussi des outils d'admin, qui couvrent la partie Admin du site ; le jeton d'un membre ne les voit pas.
- **Jusqu'où ?** « Si, ajoute le MCP pour tout ! » Tout ce que le site permet au propriétaire du jeton a son outil : les courses et les inscriptions, mais aussi les résultats, les commentaires, le covoiturage et le logement, la photo et la trace GPX, le profil et les réglages. Ce qui reste sans outil l'est parce que le site lui-même ne le fait pas faire par le serveur, ou demande un secret qu'un assistant ne doit pas voir (§ 10).
- **Combien de temps vit un jeton ?** Sans expiration : cinq par compte, la dernière utilisation affichée, supprimés quand le compte est désactivé.
- **Combien de requêtes ?** « Augmente la limite de requêtes à 300, c'est un truc entre amis. » 300 par minute et par jeton.
- **Prudence ?** « Oui plus prudent, il demandera confirmation à l'IA, comme ça le LLM pourra demander des confirmations à l'utilisateur. Dans le cas où il y a des inscrits, il sera informé qu'il y a des inscrits et devra le confirmer, en renvoyant un token de confirmation qu'il a reçu dans la réponse de sa dernière demande. » (§ 6.13)
- **Sur la démo ?** Pas de serveur MCP.

Le serveur MCP est réussi si :

- `claude mcp add --transport http … https://prends-ton-dossard.ketra.fr/mcp --header "Authorization: Bearer …"` suffit pour qu'un assistant fasse, en son nom, ce que la personne fait sur le site ;
- un jeton permet **ce que son propriétaire peut faire dans le site, jamais plus** ;
- ce que fait l'assistant se voit dans le site comme si la personne l'avait fait (« ajouté par Alice · non confirmé ») ;
- rien de ce qu'une personne a saisi n'est supprimé ou effacé sans que l'assistant ait montré ce qui serait perdu et renvoyé une confirmation ;
- aucun email, aucun mot de passe, aucun secret de clé d'accès ne passe par un assistant ; un jeton se révoque d'un clic et ne laisse aucune trace en clair (base, journaux).

## 2. Périmètre

### Dans cette version

- Un point d'entrée MCP, `/mcp`, servi par le programme Go lui-même (« streamable HTTP »).
- Des jetons personnels : créés, listés et révoqués dans Réglages ; cinq au plus par compte.
- **Trente-deux outils de membre**, pour tous les jetons, chacun limité à ce que le site permet à la personne (§ 6.3) : lire (accueil, courses, coureurs, statistiques), les courses et leurs épreuves, les participations et les résultats, les commentaires, le covoiturage et le logement, la photo et la trace GPX, le profil et les réglages.
- **Onze outils d'admin**, pour le jeton d'un admin seulement : la page Membres (coureurs, invitations, liens de réinitialisation, rôles, désactivation), les types de course et la fusion des doublons (§ 6.11).
- Un envoi de fichier en deux temps pour la photo et la trace (§ 6.9).
- La confirmation des demandes qui suppriment ou effacent ce qu'une personne a saisi, ou qui touchent aux droits ou à l'accès d'un compte (§ 6.13).
- La section « Assistant IA (MCP) » de Réglages, en français et en anglais.
- La doc : brancher Claude Code et Claude Desktop (README).

### Hors de cette version

Voir § 10.

## 3. Transport

### 3.1 Où

- **`/mcp`**, sur le même programme et le même domaine que le site : `https://prends-ton-dossard.ketra.fr/mcp`. Pas de second service, pas de second port.
- Les trois méthodes du transport sont déclarées : `POST /mcp` (les messages), `GET /mcp` et `DELETE /mcp` (qui répondent 405, voir 3.3). Sans `GET /mcp` déclaré, la route de la SPA (`GET /{path...}`) répondrait la page `index.html` à un client qui ouvre un flux, avec un 200 trompeur.
- **`/.well-known/`** devient un chemin réservé du programme (comme `/api/` et `/_/`, dans `webdist.reserved`) : un 404 en JSON au lieu de `index.html`. Un client MCP qui reçoit un 401 cherche les métadonnées OAuth à `/.well-known/oauth-protected-resource` ; il doit trouver un 404 propre, pas une page HTML.
- `mcp` s'ajoute aussi à `webdist.reserved` : sur la démo, où la route n'existe pas (§ 8.1), `GET /mcp` donne un 404 et non la page du site.
- Les fichiers arrivent par une route à part, `PUT /api/app/mcp-uploads/{id}` (§ 6.9).

### 3.2 Le SDK officiel

- **`github.com/modelcontextprotocol/go-sdk` v1.8.0** (publiée le 2026-09-04, API v1 stable). Elle demande Go 1.25 : le dépôt est en Go 1.27.
- Elle ajoute cinq modules au `go.mod`, sans changer la version d'aucun module déjà là (vérifié avec `go mod tidy` sur une copie du `go.mod`) : `github.com/google/jsonschema-go` v0.4.3, `github.com/segmentio/encoding` v0.5.4, `github.com/segmentio/asm` v1.1.3, `github.com/yosida95/uritemplate/v3` v3.0.2, `golang.org/x/time` v0.15.0. `golang-jwt/jwt/v5` v5.3.1, `x/oauth2`, `x/sync` et `x/sys` y sont déjà, à une version égale ou plus récente.
- **Pourquoi elle plutôt qu'un serveur JSON-RPC écrit à la main** : elle négocie les versions du protocole (de 2024-11-05 à 2026-07-28), tire les schémas JSON des entrées et des sorties de types Go, valide les arguments et les sorties, et suit le protocole quand il change. Un serveur à la main serait court pour `initialize`, `tools/list` et `tools/call`, mais chaque version du protocole serait à rattraper par nous.
- **Vérifié par un prototype jetable** (hors du dépôt) : un `POST /mcp` déclaré dans `OnServe`, qui passe la main au `StreamableHTTPHandler` du SDK, sur l'application de test de `testutil` ; `initialize`, `tools/list` et `tools/call` répondent en JSON, et un outil qui crée une participation par une requête interne (§ 5) obtient `added_by` et `confirmed` posés par les hooks du site.

### 3.3 Sans état, en JSON

- `StreamableHTTPOptions{Stateless: true, JSONResponse: true}` :
  - **sans état** : aucune session du protocole gardée en mémoire ; chaque `POST` se suffit à lui-même, et un redémarrage du conteneur ne casse rien. Le serveur n'a rien à pousser vers le client (pas de notification, pas de question), donc rien ne manque. Les confirmations (§ 6.13) et les envois de fichiers (§ 6.9) sont des jetons que l'assistant renvoie dans les arguments, pas une session ;
  - **réponses `application/json`**, jamais `text/event-stream` : pas de flux SSE à travers le `encode zstd gzip` de Caddy ;
  - `GET` et `DELETE` répondent 405, comme le prévoit le transport pour un serveur qui n'ouvre pas de flux.
- `DisableLocalhostProtection: true`. Cette protection du SDK refuse une requête arrivée sur une adresse locale avec un `Host` qui n'est pas local (attaque par « DNS rebinding » contre un serveur local sans authentification). Ici, chaque requête doit porter un jeton, et derrière Caddy sans Docker (le programme lancé sur l'hôte) la protection refuserait toutes les requêtes du domaine public.
- `MaxRequestBodyBytes` : 1 Mio. Le plus gros appel ordinaire, une course de vingt épreuves, fait quelques Ko ; un petit fichier en base64 tient dedans (§ 6.9), un gros passe par `PUT /api/app/mcp-uploads`.
- `Logger` : aucun. Le SDK n'écrit rien dans les journaux.

### 3.4 Limite de requêtes

- **300 requêtes par minute et par jeton** sur `/mcp` (choix de l'utilisateur). Le paquet `mcp` la tient lui-même, en mémoire, par identifiant de jeton : un seau de 300 qui se remplit de 5 par seconde, ce qui laisse passer une rafale et borne la moyenne. Au-delà : 429, avec la réponse de PocketBase pour une limite (`TooManyRequestsError`). PocketBase ne compte que par adresse : deux assistants de deux personnes derrière la même box partageraient sinon une seule limite.
- **Et 1 500 par minute et par adresse** sur `/mcp`, par une règle de plus dans les réglages de PocketBase (migration 9k) : un filet pour les requêtes sans jeton valide, qui n'ont pas de jeton par lequel compter (les jetons sont de toute façon impossibles à deviner, § 4.2). Elle est bien au-dessus des 300 par jeton, pour que deux assistants derrière la même box ne partagent pas une limite : à 300, la limite par jeton ne servirait à rien. Un libellé sans barre finale se compare par égalité : sa place dans la liste des règles ne compte pas.
- Les requêtes internes d'un outil (§ 5) portent l'adresse du client : elles comptent dans les limites du site (`/api/` 300 par 10 s, `*:create` 20 par 5 s, `/api/batch` 3 par seconde), comme les requêtes du navigateur. Un assistant qui inscrit trente personnes d'un coup peut donc attendre quelques secondes, comme le site.

## 4. Les jetons

### 4.1 Table `mcp_tokens` (migration `9k_mcp_tokens.go`)

| Champ | Type | Règles |
|---|---|---|
| `user` | relation → `users` | obligatoire, suppression en cascade |
| `name` | texte | obligatoire, 1 à 50 caractères, espaces de début et de fin retirés (« Claude sur mon PC ») |
| `token_hash` | texte | obligatoire, caché (`Hidden`) ; SHA-256 du secret, en hexadécimal |
| `last_used_at` | date-heure | facultatif ; dernière requête acceptée |
| `created`, `updated` | dates système | |

- Index sur `user`.
- **Toutes les règles d'accès sont `null`**, comme `calendar_feeds` : seules les routes du paquet `mcpauth` lisent et écrivent la table, et aucune réponse de l'API ne montre une empreinte (un super-admin voit les champs cachés, dans le tableau de bord).
- La migration ajoute aussi la règle de limite `/mcp` par adresse (§ 3.4). Son retour arrière supprime la table, donc tous les jetons, et retire la règle.

### 4.2 Forme d'un jeton

```
ptd_<id de l'enregistrement, 15 caractères>_<secret, 43 caractères>
```

- Le secret : 32 octets aléatoires (`crypto/rand`), en base64url sans remplissage (`invitations.NewToken`).
- Le préfixe `ptd_` dit d'où vient un jeton (à un humain, à un outil qui cherche des secrets dans un dépôt).
- L'identifiant n'est pas secret : il sert à retrouver l'enregistrement sans chercher par empreinte.
- **Seule l'empreinte SHA-256 du secret est gardée.** Contrairement au lien d'agenda (v3.1), qui garde son jeton pour le remontrer, un jeton MCP **ne se montre qu'une fois**, à sa création. Perdu, il se révoque et se refait. Une copie de la base ne donne donc aucun jeton qui marche.
- **Pas d'expiration** (choix de l'utilisateur) : un jeton vit jusqu'à sa révocation, la désactivation du compte ou sa suppression (§ 4.6).

### 4.3 Vérification

L'en-tête `Authorization: Bearer <jeton>` de chaque requête à `/mcp` :

1. le schéma est `Bearer` (sans tenir compte de la casse) et le jeton a exactement la forme du § 4.2. Sinon : refus, sans lire la base ;
2. l'enregistrement est cherché par son identifiant ;
3. l'empreinte du secret reçu est comparée à celle de l'enregistrement **en temps constant** (`crypto/subtle.ConstantTimeCompare`). Un identifiant inconnu est comparé à une empreinte factice, pour que les deux refus prennent le même chemin ;
4. le compte du jeton existe et n'est pas désactivé.

Tout refus donne la même réponse, qui ne dit pas pourquoi : **401**, `WWW-Authenticate: Bearer realm="prends-ton-dossard"`, corps `{"code": "token_invalid"}`. Un jeton de session du site (JWT de PocketBase) n'est pas un jeton MCP : refusé aussi.

Une requête acceptée :

- passe la limite par jeton (§ 3.4) ;
- met `e.Auth` sur le compte : le journal des requêtes de PocketBase l'attribue au compte (§ 8.4) ;
- met à jour `last_used_at`, **au plus une fois par minute et par jeton** (une écriture de moins à chaque appel) ; un échec de cette écriture est journalisé (sans le jeton) et ne fait pas échouer l'appel.

### 4.4 Limites

- **Cinq jetons par compte** (un par machine ou par assistant). Le sixième est refusé avec `token_limit` (400), par un hook de modèle sur la création.
- Nom : 1 à 50 caractères, après retrait des espaces de début et de fin ; vide → `validation_required` sur `name`.

### 4.5 Routes

Toutes demandent une session du site (`apis.RequireAuth("users")`) et ne concernent que les jetons de l'appelant. Elles n'existent pas sur la démo (§ 8.1).

| Route | Rôle |
|---|---|
| `GET /api/app/mcp-tokens` | `{ "url": "<APP_URL>/mcp", "max": 5, "tokens": [{ "id", "name", "created", "lastUsedAt" }] }`, du plus récent au plus ancien. Jamais le secret ni l'empreinte. `lastUsedAt` est vide pour un jeton jamais utilisé. |
| `POST /api/app/mcp-tokens` | corps `{ "name" }` → `{ "id", "name", "created", "token", "url" }`. **La seule réponse qui contient le jeton.** |
| `DELETE /api/app/mcp-tokens/{id}` | révoque (supprime) un de ses jetons → 204. Un jeton inconnu ou d'un autre compte → 404 `not_found`. Effet immédiat : la requête suivante de l'assistant reçoit un 401. |

`url` est l'adresse du serveur MCP pour la commande à copier (§ 7). En local, `APP_URL` vaut `http://localhost:5173` : le proxy de Vite transmet aussi `/mcp` au port 8090 (`web/vite.config.ts`). L'outil `mcp_tokens` (§ 6.10) passe par ces routes pour lister et révoquer ; il n'en crée pas.

### 4.6 Ce qui arrête un jeton

| Événement | Effet |
|---|---|
| Révocation dans Réglages, ou par l'outil `mcp_tokens` | supprimé, refusé dès la requête suivante |
| **Compte désactivé** par un admin | **tous ses jetons sont supprimés**, par un hook de modèle sur `users` (après la mise à jour, dans la même application ou transaction). Comme les sessions, que la désactivation ferme pour de bon (`RefreshTokenKey`), ils ne reviennent pas si le compte est réactivé : la personne en refait. La vérification du § 4.3 refuse aussi un compte désactivé, au cas où. |
| Compte supprimé (tableau de bord) | supprimés par la cascade de `user` |
| Mot de passe réinitialisé, email changé | **gardés** : ce ne sont pas des signes de vol, et la liste de Réglages permet de révoquer |
| Changement de rôle | le jeton agit avec le rôle du moment (les règles lisent le compte à chaque requête, et la liste des outils suit, § 6.3) |

### 4.7 Jamais en clair ailleurs

- La base ne garde que l'empreinte (§ 4.2).
- Le jeton n'est dans aucune URL : il voyage dans l'en-tête `Authorization`, que le journal des requêtes de PocketBase n'enregistre pas (il garde la méthode, le chemin, le statut, l'agent utilisateur ; vérifié dans `apis/middlewares.go` de la v0.41.1).
- Le middleware `loadAuthToken` de PocketBase essaie de lire tout `Authorization` comme un jeton de session ; il échoue sur un jeton MCP et l'écrit au niveau Debug, sans le jeton.
- Le code de l'application ne journalise ni l'en-tête ni le jeton, ne le met dans aucune erreur, et ne le renvoie jamais dans une réponse d'outil.
- Caddy, s'il journalise les accès un jour, masque `Authorization` par défaut (`log_credentials` est faux par défaut).
- Un test fait des appels avec un bon et un mauvais jeton, journal des requêtes activé au niveau Debug, et vérifie que ni le jeton, ni son secret, ni son empreinte n'y sont (sur le modèle de `TestInvitations_TokenIsNotLogged`).

### 4.8 Codes d'erreur (delta)

Dans `server/apperr/codes.go`, et traduits par le front comme les autres (`ERROR_CODES`, `fr.errors`, `en.errors`) :

| Code | FR | EN |
|---|---|---|
| `token_invalid` | Ce jeton n'est pas valide, ou il a été révoqué. | This token is not valid, or it was revoked. |
| `token_limit` | Tu as déjà 5 jetons : révoque-en un pour en créer un autre. | You already have 5 tokens: revoke one to make another. |
| `upload_invalid` | Cet envoi n'est pas valide, ou il a expiré. | This upload is not valid, or it has expired. |

Le site n'affiche jamais `token_invalid` ni `upload_invalid` (seuls les clients MCP et la commande d'envoi les reçoivent) ; il les traduit quand même, comme tout code du serveur.

## 5. Chaque action passe par les règles du site

### 5.1 Le choix : une requête interne, avec la session de la personne

Chaque outil fait ce que ferait le site : **une requête à l'API de PocketBase, servie dans le même processus, par le même routeur que les requêtes du navigateur**, au nom du propriétaire du jeton. C'est ce qui fait du serveur MCP « juste un point d'entrée différent » : les droits sont ceux du site, parce que ce sont les mêmes requêtes.

- La route `/mcp` est déclarée dans `OnServe`, qui donne le routeur de PocketBase (`se.Router`). Au premier appel d'outil, le paquet en construit le `http.Handler` (`se.Router.BuildMux()`), une fois (`sync.Once`), et le garde. À ce moment, toutes les routes et tous les middlewares sont déclarés : en production (PocketBase construit le sien à la fin de `OnServe`) comme dans `tests.ApiScenario` (qui sert la requête à l'intérieur de `OnServe`).
- Pour chaque appel d'outil, le paquet fabrique en mémoire un **jeton de session PocketBase de 60 secondes** pour le compte (`user.NewStaticAuthToken(time.Minute)`). Il n'est jamais écrit, journalisé ni renvoyé : il ne sort pas du processus.
- La requête interne (`http.NewRequestWithContext` sur le contexte de l'appel, réponse dans un `httptest.ResponseRecorder`, comme le fait l'API batch de PocketBase) porte :
  - `Authorization` : ce jeton de 60 secondes, et rien d'autre de l'en-tête reçu ;
  - l'adresse du client (`RemoteAddr` et les en-têtes de `TrustedProxy.Headers`, ici `X-Forwarded-For`) : les limites de requêtes et le journal voient le vrai client ;
  - `User-Agent: prends-ton-dossard-mcp` : le journal distingue les requêtes de l'assistant de celles du site ;
  - `Content-Type: application/json`, ou `multipart/form-data` pour un fichier (§ 6.9), comme le SDK du site.
- Elle traverse donc, exactement comme une requête du site :
  - les **règles d'accès** des collections ;
  - les **routes** de l'application (invitations, agenda, fusions, jetons) et leurs contrôles (`RequireAuth`, `RequireAdmin`) ;
  - les **hooks de requête** : `created_by` des événements, `added_by` et `confirmed` des participations, `author` des commentaires, `owner` des offres, `added_by` des places ;
  - les **hooks de modèle** : dates et date limite d'un événement, date d'une épreuve dans les jours de son événement, mesure obligatoire, prix au centime, `format_required`, `supporter_with_format`, `status_before_race`, résultats effacés et `rank_above_total`, conversion d'une participation à l'événement en participation à une épreuve, texte d'un commentaire, places et dates d'une offre, dernier admin, coureur supprimé, type utilisé ;
  - la **validation des fichiers** (type, taille) et les vignettes de la photo ;
  - l'**API batch** et sa transaction ;
  - les **limites de requêtes** et le **journal** de PocketBase.

### 5.2 Pourquoi pas les règles évaluées à la main

`app.CanAccessRecord` évalue une règle, mais une écriture du site est bien plus qu'une règle : le tri des champs du corps (`@request.body.x:isset`), la règle de création vérifiée par une insertion d'essai, les hooks de requête qui posent `created_by`, `added_by`, `confirmed`, `author` et `owner`, la transaction du batch, les fichiers. Les refaire à côté, c'est une deuxième copie des droits, qui finirait par différer de la première. La requête interne n'en a qu'une : celle que le site applique déjà, testée depuis la v1.

Deux autres façons écartées :

- **rappeler `apis.NewRouter(app)`** pour un routeur à part : il lierait une seconde fois les hooks du temps réel de PocketBase (`bindRealtimeEvents`, sans identifiant), et chaque changement serait diffusé deux fois ;
- **appeler l'API par le réseau** (`http://127.0.0.1:8090`) : le programme devrait connaître son port d'écoute, et chaque appel ferait un aller-retour TCP pour rien.

### 5.3 Garde-fous

- **Le paquet `mcp` n'écrit jamais lui-même** : aucun `Save`, `Delete`, `RunInTransaction` ni accès direct à la base. Un test lit ses sources et échoue sinon. Seul `mcpauth` écrit, et seulement dans `mcp_tokens`.
- **Ce que le paquet ajoute ne fait que refuser plus ou demander une confirmation**, jamais autoriser plus : les règles que le formulaire tient côté navigateur (au moins une épreuve, date de fin calculée, ordre du batch, trace lisible), la confirmation de ce qui supprime ou efface (§ 6.13), et quelques refus prudents.
- **Les refus enregistrement par enregistrement viennent de l'API** : modifier la participation confirmée d'un autre, supprimer l'épreuve ou la course d'un autre auteur, changer le commentaire ou l'offre d'un autre, la photo d'un autre. Un admin garde ses droits d'admin dans les outils de membre. Avant de demander une confirmation, un outil peut annoncer le refus que le site va donner quand il le voit dans ce qu'il a lu, pour ne pas faire confirmer à une personne ce qui sera refusé. Cette annonce ne fait que refuser ; c'est l'API qui décide au second appel.
- **Un outil que le rôle ne permet jamais n'est pas listé** : les outils d'admin n'existent pas pour le jeton d'un membre (§ 6.3). Ils passent eux aussi par l'API, dont les règles et les routes demandent déjà un admin (`ruleAdmin`, `accounts.RequireAdmin`) : la liste filtrée ne remplace pas ces contrôles, elle évite de proposer à l'assistant d'un membre des outils qui ne pourraient que lui être refusés. Un outil qu'un membre peut utiliser sur certains enregistrements (sa photo, ses clés, son coureur) est un outil de membre, même si un admin peut s'en servir sur tous.
- **Aucun secret ne passe par un assistant** : ni mot de passe, ni email, ni données de clé d'accès, ni jeton MCP autre que celui qu'il a déjà. Le lien d'agenda et les liens d'invitation et de réinitialisation, que le site montre à leur propriétaire ou à l'admin, passent par l'assistant de cette personne (§ 8.2).

## 6. Les outils

### 6.1 Conventions

- **Noms** en anglais (`add_participation`), comme les champs de l'API et les codes d'erreur ; **titres** (`title`, que les clients affichent), **descriptions** et **messages** en français. Les outils d'admin commencent par `admin_`.
- **Identifiants** : ceux de PocketBase (15 caractères), tels que les outils de lecture les donnent.
- Un **coureur** (`runner`) et un **type de course** (`race_type`) se donnent par leur identifiant **ou par leur nom**, sans tenir compte des majuscules ni des accents (`"bob"`, `"trail"`). Un nom inconnu : l'erreur liste les noms possibles (une quinzaine au plus). Là où un `runner` est facultatif, c'est le coureur du propriétaire du jeton par défaut.
- **Dates** : des jours `AAAA-MM-JJ`. « Aujourd'hui » est le jour à Paris, comme partout dans le site (`whoami` le donne). Une heure : `HH:MM`. Un temps de course : `h:mm:ss` (« 4:12:30 »).
- **Durées en minutes** (6 h = 360), **prix en euros** au centime, **distances en km**, **D+ en mètres**. Comme dans le site, 0 ou un texte vide veut dire « non renseigné » ; les réponses omettent ces valeurs.
- **Liens** : chaque course a son adresse sur le site, `url` = `<APP_URL>/evenements/<id>`, et chaque coureur la sienne, `<APP_URL>/coureurs/<id>`, pour que l'assistant les donne. Une photo ou une trace a l'adresse de son fichier (non protégé, comme sur le site).
- **Sorties** : chaque outil a un schéma de sortie ; le SDK renvoie l'objet en `structuredContent` et sa copie JSON en texte (pour les clients qui ne lisent que le texte). Les outils d'écriture ont un champ `done` (fait ou pas), un champ `summary`, une phrase en français (« Bob est inscrit à « Trail 42 km » (Trail des Crêtes), non confirmé. »), et `warnings` quand il y a lieu.
- **Confirmation** : les outils d'écriture prennent un argument facultatif `confirmation` ; ceux qui peuvent supprimer ou effacer ne font rien sans lui (§ 6.13).
- **Outils à actions** : quelques réglages tiennent en un outil avec un argument `action` (`passkeys`, `calendar_link`, `mcp_tokens`), comme une section de la page Réglages ; les autres font une seule chose.
- **Annotations** : `readOnlyHint` pour les lectures ; `destructiveHint` pour tout outil qui peut demander une confirmation ; `idempotentHint` pour les modifications (`update_*`, `rename_runner`, `set_result`, `admin_update_race_type`, `admin_set_role`, `admin_set_disabled`) ; `openWorldHint: false` partout.

**Les statuts d'une participation**, ceux du site :

| Code | Libellé | Sens |
|---|---|---|
| `interested` | Intéressé | prévoit d'y aller, pas encore inscrit sur le site de la course. Sans épreuve : « Intéressé, format à choisir » |
| `registered` | Inscrit | inscrit sur le site officiel de la course (dossard pris) |
| `finished` | Terminé | a fini la course ; seulement à partir du jour de la course |
| `dnf` | Abandon | a pris le départ et abandonné ; seulement à partir du jour de la course |
| `dns` | Non partant | ne prend pas le départ ; reste sur la fiche, dans « Non partants » |
| `supporter` | Supporteur | vient encourager sans courir ; toujours sans épreuve |

**« Confirmé » n'est pas un statut** (et n'a rien à voir avec les confirmations du § 6.13). Une participation est confirmée quand le coureur l'a ajoutée ou modifiée lui-même ; ajoutée par quelqu'un d'autre, elle est « non confirmée » et apparaît dans « À confirmer », sur l'accueil du coureur, jusqu'à ce qu'il la confirme. Seul le coureur confirme. Un coureur sans compte n'est jamais confirmé. Les sorties donnent `status`, `status_label` (le libellé) et `confirmed`.

### 6.2 Instructions du serveur

Le texte que le serveur donne à l'assistant à l'initialisation (`instructions`) :

> Prends ton dossard est le site privé d'un groupe d'amis qui prévoient des courses à pied. Tu agis au nom de la personne qui a créé ce jeton, avec ses droits sur le site : tout ce que tu fais est visible du groupe, à son nom (« ajouté par … »).
> - Appelle d'abord `whoami` : il dit qui tu es et quel jour on est. `home` donne ce que la personne voit sur son accueil.
> - Une course est un événement (un nom, un lieu, des jours) qui a une ou plusieurs épreuves (« Trail 42 km », « Rando 15 km »). Avant d'en créer une, cherche-la avec `search_events` : elle existe peut-être déjà.
> - On participe à une épreuve, avec un statut : `interested` (Intéressé), `registered` (Inscrit sur le site officiel), `finished` (Terminé), `dnf` (Abandon), `dns` (Non partant). Sans épreuve, seulement `interested` (format à choisir) ou `supporter` (vient encourager).
> - Ajouter quelqu'un d'autre crée une participation « non confirmée », qu'il confirmera sur le site. Demande à la personne avant d'inscrire d'autres coureurs qu'elle-même.
> - Quand une demande supprimerait ou effacerait quelque chose (une épreuve et ses inscrits, une participation, un commentaire, une photo, une course en double…), le premier appel ne fait rien : la réponse dit ce qui serait perdu et donne un jeton de confirmation. Montre-le à la personne, demande-lui son accord, et seulement si elle accepte, rappelle le même outil avec les mêmes arguments et `confirmation`. Ne confirme jamais à sa place.
> - Pour une photo ou une trace GPX, `start_upload` donne une commande d'envoi du fichier ; un petit fichier peut aussi passer en base64.
> - Dates en AAAA-MM-JJ (heure de Paris), durées en minutes, prix en euros.

Pour le jeton d'un admin, une dernière ligne :

> - Tu as aussi les outils `admin_…` de la partie Admin du site (membres, invitations, rôles, types de course, doublons). Un compte ne se crée que par une invitation : `admin_create_link` donne le lien, que la personne ouvre elle-même. Ce lien et un lien de réinitialisation donnent l'accès à un compte : ne les transmets qu'à la personne concernée.

### 6.3 Les outils, et qui les voit

Deux ensembles :

- **membre** : tous les jetons les voient. Chacun fait, pour le propriétaire du jeton, ce que le site lui permet ;
- **admin** : seul le jeton d'un admin les voit, en plus des outils de membre. Ce sont les actions de la partie Admin du site, réservées aux admins par le code.

La colonne « Ce que le site permet » vient des règles d'accès (`4_rules.go`, `5_participation_rules.go`, `8_participation_event.go`, `9c_comments.go`, `9d_offers.go`), des hooks (`events`, `participations`, `comments`, `offers`, `accounts`) et des routes (`invitations`, `calendar`, `admin`, `mcpauth`) : c'est ce que l'outil fera, par la même requête, pour le propriétaire du jeton.

**Outils de membre** (trente-deux)

| Domaine | Outil | Titre | Action du site | Ce que le site permet (et donc l'outil) | Confirmation (§ 6.13) |
|---|---|---|---|---|---|
| Lire | `whoami` | Qui suis-je ? | le profil | lire son coureur : tout connecté | — |
| Lire | `home` | Mon accueil | l'accueil : « À confirmer », « Inscriptions à faire », « Résultats à saisir », « Mes prochaines courses », « Bientôt dans le groupe », « Derniers commentaires » | `participations`, `events`, `comments` : `list` pour tout connecté | — |
| Lire | `list_runners` | Coureurs du groupe | les coureurs des formulaires et des filtres | `runners.list` : tout connecté | — |
| Lire | `get_runner` | Voir un coureur | la page d'un coureur, le profil | `runners.view`, `participations.list` : tout connecté | — |
| Lire | `get_stats` | Statistiques | Statistiques d'une année | `participations.list` : tout connecté | — |
| Lire | `list_race_types` | Types de course | le choix du type d'une épreuve | `race_types.list` : tout connecté | — |
| Lire | `search_events` | Chercher des courses | Liste, Agenda, filtres | `events`, `formats`, `participations` : `list` pour tout connecté | — |
| Lire | `get_event` | Voir une course | la fiche d'un événement (épreuves, participants, trace, covoiturage, logement, commentaires) | idem, `view`, plus `comments`, `offers`, `offer_members` | — |
| Courses | `create_event` | Créer une course | « + », formulaire de création, « Je participe » | `events.create`, `formats.create`, `participations.create` : tout connecté ; `created_by` posé par le hook | doublon probable |
| Courses | `update_event` | Modifier une course | « Modifier » (formulaire) | `events.update` : tout connecté, pas seulement l'auteur ; ses épreuves avec (`formats.update`) ; `created_by` gardé par le hook | champ vidé, notes remplacées, course raccourcie, jour changé pour des participants |
| Courses | `delete_event` | Supprimer une course | « Supprimer » de la fiche | `events.delete` : **l'auteur de la course ou un admin** ; épreuves, participations, commentaires et offres partent avec | toujours |
| Courses | `add_format` | Ajouter une épreuve | « Ajouter une épreuve » du formulaire | `formats.create` : tout connecté | — |
| Courses | `update_format` | Modifier une épreuve | une épreuve du formulaire | `formats.update` : tout connecté | champ vidé, jour changé pour des participants |
| Courses | `delete_format` | Supprimer une épreuve | « Retirer » d'une épreuve du formulaire | `formats.delete` : **l'auteur de la course ou un admin** | toujours |
| Participations | `add_participation` | Ajouter un coureur à une course | « J'y vais », « Ajouter quelqu'un », « Je viens encourager » | `participations.create` : tout connecté, pour n'importe quel coureur ; non confirmée si ce n'est pas son propre coureur | remplace la participation « à la course seule » d'un autre |
| Participations | `update_participation` | Changer une participation | le menu d'une participation, « Choisir l'épreuve », « Confirmer », « Je suis inscrit » | `participations.update` : un admin, le coureur lui-même, ou tout connecté tant qu'elle n'est pas confirmée | participation d'un autre, ou résultat effacé |
| Participations | `remove_participation` | Retirer un coureur d'une course | « Retirer » | `participations.delete` : même règle | toujours |
| Participations | `set_result` | Saisir un résultat | « Saisir le résultat », « J'ai fini », « Abandon » | `participations.update` : même règle ; `status_before_race`, `rank_above_total` | résultat remplacé, ou participation d'un autre |
| Commentaires | `add_comment` | Écrire un commentaire | « Envoyer » des commentaires | `comments.create` : tout connecté ; `author` posé par le hook | — |
| Commentaires | `update_comment` | Modifier un commentaire | « Modifier » d'un commentaire | `comments.update` : **son auteur seulement** (même pas un admin) | — |
| Commentaires | `delete_comment` | Supprimer un commentaire | « Supprimer » d'un commentaire | `comments.delete` : son auteur ou un admin | toujours |
| Covoiturage et logement | `add_offer` | Proposer une voiture ou un logement | « Proposer une voiture », « Proposer un logement » | `offers.create` : tout connecté ; `owner` posé par le hook ; une de chaque sorte par coureur et par course | — |
| Covoiturage et logement | `update_offer` | Modifier une offre | « Modifier » d'une offre | `offers.update` : son propriétaire ou un admin | champ vidé, notes remplacées, offre d'un autre |
| Covoiturage et logement | `delete_offer` | Supprimer une offre | « Supprimer » d'une offre | `offers.delete` : son propriétaire ou un admin ; les places partent avec | toujours |
| Covoiturage et logement | `offer_place` | Prendre ou libérer une place | « Je monte », « J'y dors », « Je descends », « Je n'y dors plus », « Ajouter quelqu'un », « Retirer » d'une offre | `offer_members.create`/`.delete` : pour soi, le propriétaire de l'offre pour n'importe qui, ou un admin ; places, offre pleine, propriétaire passager | libérer : toujours |
| Fichiers | `start_upload` | Préparer l'envoi d'un fichier | le champ fichier d'une photo ou d'une trace | — (un emplacement en mémoire, § 6.9) | — |
| Fichiers | `set_photo` | Changer ou retirer une photo | « Changer la photo », « Retirer la photo » (Réglages ; Membres pour un admin) | `runners.update` (`avatar`) : son propre coureur, ou un admin pour tous ; JPEG, PNG ou WebP, 5 Mo | photo remplacée ou retirée, photo d'un autre |
| Fichiers | `set_track` | Changer ou retirer une trace GPX | « Trace GPX », « Retirer la trace », « Reprendre ces valeurs » du formulaire | `formats.update` (`gpx`) : tout connecté ; 10 Mo, GPX | trace remplacée ou retirée |
| Profil et réglages | `rename_runner` | Changer de nom | Réglages → « Nom » (Membres → « Renommer » pour un admin) | `runners.update` (`name`) : son propre coureur, ou un admin pour tous | — |
| Profil et réglages | `passkeys` | Mes clés d'accès | Réglages → « Mes clés d'accès » : la liste, « Renommer », « Supprimer » (Membres → « Clés d'accès » pour un admin) | `passkeys.list`/`.delete` : les siennes, ou un admin pour toutes ; `.update` (nom) : les siennes seulement | supprimer : toujours |
| Profil et réglages | `calendar_link` | Mon lien d'agenda | Réglages → « Agenda » : « Créer mon lien d'agenda », « Afficher le lien », « Nouveau lien », « Supprimer le lien » | `GET`/`POST`/`DELETE /api/app/calendar` : le sien | remplacer ou supprimer : toujours |
| Profil et réglages | `mcp_tokens` | Mes jetons d'assistant | Réglages → « Assistant IA (MCP) » : la liste, « Révoquer » | `GET`/`DELETE /api/app/mcp-tokens` : les siens | révoquer : toujours |

Aucun outil de membre n'est hors de portée d'un membre : chacun sert au moins sur certains enregistrements (ses propres courses, participations, commentaires, offres, photo, clés). Les refus restent ceux de l'API, enregistrement par enregistrement, traduits en français (§ 6.12).

**Outils d'admin** (onze, détaillés au § 6.11)

| Outil | Titre | Action du site | Ce que le site permet | Confirmation (§ 6.13) |
|---|---|---|---|---|
| `admin_list_members` | Membres | Admin → Membres : la liste et l'état de chacun | `runners.list` avec `expand=user`, `invitations.list`, `passkeys.list` : admin | — |
| `admin_create_runner` | Ajouter un coureur | Membres → « Ajouter un coureur » | `runners.create` : admin | — |
| `admin_delete_runner` | Supprimer un coureur | Membres → « Supprimer » (coureur sans compte) | `runners.delete` : admin ; refusé avec des participations (`runner_has_participations`) ou un compte (`runner_has_account`) | toujours |
| `admin_create_link` | Créer un lien d'invitation ou de réinitialisation | Membres → « Inviter », « Régénérer l'invitation », « Lien de réinitialisation » | `POST /api/app/invitations` : admin actif (`RequireAdmin`) | réinitialisation : toujours ; invitation : quand elle remplace un lien en attente, ou qu'elle donne le rôle admin |
| `admin_revoke_link` | Révoquer un lien | Membres → « Révoquer l'invitation », « Révoquer le lien » | `DELETE /api/app/invitations/{id}` : admin actif | toujours |
| `admin_set_role` | Changer le rôle | Membres → « Passer admin », « Retirer admin » | `users.update` (`role`) : admin ; jamais le dernier admin (`last_admin`) | toujours |
| `admin_set_disabled` | Désactiver ou réactiver un compte | Membres → « Désactiver », « Réactiver » | `users.update` (`disabled`) : admin ; `last_admin` ; désactiver ferme les sessions et supprime les jetons MCP du compte | désactiver : toujours |
| `admin_create_race_type` | Ajouter un type de course | Admin → Types → « Ajouter » | `race_types.create` : admin | — |
| `admin_update_race_type` | Modifier un type de course | Types → « Renommer », « Mesures » | `race_types.update` : admin | — |
| `admin_delete_race_type` | Supprimer un type de course | Types → « Supprimer » | `race_types.delete` : admin ; refusé s'il est utilisé (`race_type_in_use`) | toujours (un type utilisé est refusé, pas confirmé) |
| `admin_merge` | Fusionner des doublons | Admin → Doublons : aperçu, puis fusion | `POST /api/app/admin/merge-events` et `merge-formats` : admin actif | toujours (le premier appel est l'aperçu `dryRun` du site) |

« Renommer » un coureur, sa photo et ses clés d'accès, qu'un admin fait aussi depuis la page Membres, sont des outils de membre (`rename_runner`, `set_photo`, `passkeys`) : un membre s'en sert pour lui-même, un admin pour tous, et c'est l'API qui fait la différence.

**Comment la liste suit le rôle** :

- Le rôle est **relu sur le compte à chaque requête** (`role = "admin"` et compte non désactivé, le test de `accounts.RequireAdmin`) : un admin rétrogradé perd les outils d'admin à la requête suivante, sans toucher à son jeton ; un membre promu les a à la suivante.
- Il y a **deux serveurs MCP** (deux `*mcp.Server` du SDK), faits une fois : celui des membres a les trente-deux outils de membre, celui des admins les quarante-trois. Le `StreamableHTTPHandler` choisit, pour chaque requête (`getServer`), celui du rôle du compte, que la route a mis dans le contexte.
- `tools/list` d'un membre ne contient donc aucun outil d'admin, et **un appel par leur nom reçoit la réponse de n'importe quel outil inconnu**, puisque pour ce serveur-là il n'existe pas : l'erreur JSON-RPC `-32602` (paramètres invalides), message `unknown tool "admin_merge"`. Rien ne dit que l'outil existe ailleurs.
- **En plus**, chaque outil d'admin vérifie le rôle du compte avant d'agir, et répond la même erreur `unknown tool` sinon : une erreur de câblage ne suffirait pas à l'ouvrir. Et l'API garde ses propres contrôles derrière.

### 6.4 Lectures

**`whoami`** — aucune entrée.

```json
{ "runner": { "id": "…", "name": "Alice", "url": "…/coureurs/…" }, "role": "member",
  "token": { "id": "…", "name": "Claude sur mon PC" },
  "site": "https://prends-ton-dossard.ketra.fr", "today": "2026-11-02" }
```

Un compte sans coureur (impossible par les invitations) : erreur « Ton compte n'a pas de coureur : demande à un admin. »

**`home`** (l'accueil) — aucune entrée. Les blocs de l'accueil, calculés comme le site (`features/home/pending.ts`, `registrationTodo.ts`, `features/results/resultsToEnter.ts`, `MyUpcoming`, `GroupSoon`, `LatestComments`) :

```json
{ "to_confirm": [ PARTICIPATION + { "event", "format_title", "day" } ],
  "registrations_to_do": [{ "participation_id", "event", "format_title", "deadline", "days_left", "registration_url" }],
  "results_to_enter": [{ "participation_id", "event", "format_title", "day" }],
  "my_upcoming": [{ "participation_id", "event", "format_title", "day", "status", "status_label" }],
  "group_soon": [ EVENT_SUMMARY ],
  "latest_comments": [{ "comment_id", "event", "author", "excerpt", "created" }] }
```

- `to_confirm` : ses participations ajoutées par d'autres, pas encore confirmées ;
- `registrations_to_do` : ses participations `interested` dont la course a une date limite pas passée (le jour même compte) ;
- `results_to_enter` : ses participations `registered` dont le jour est passé depuis 60 jours au plus ;
- `my_upcoming` : ses participations à venir, sauf « Non partant » ;
- `group_soon` : les 5 prochaines courses qui ont des participants autres que non partants et supporteurs ;
- `latest_comments` : les 5 commentaires les plus récents, le début du texte (140 caractères, coupé au mot).

**`list_runners`** — `query` facultatif (garde les noms qui contiennent ce texte, sans majuscules ni accents). → `{ "runners": [{ "id", "name", "has_account", "is_me", "url" }] }`, par nom. `has_account` dit si la personne peut confirmer elle-même ; l'identifiant de son compte n'est jamais donné.

**`get_runner`** (la page d'un coureur, le profil) — `runner` facultatif (soi par défaut).

```json
{ "runner": { "id", "name", "has_account", "is_me", "url", "photo_url" },
  "upcoming": [{ "participation_id", "event", "format_title", "day", "status", "status_label" }],
  "years": [{ "year": 2026, "finished": 4, "dnf": 1, "distance_km": 118.4, "elevation_gain_m": 6200, "time_s": 61200 }],
  "history": [{ "participation_id", "event", "format_title", "day", "status", "status_label", "result" }] }
```

Comptage du site (`features/stats/stats.ts`) : une course terminée compte sa distance, son D+ et son temps quand ils sont renseignés ; un abandon ne compte que dans les abandons ; l'année est celle du jour de l'épreuve.

**`get_stats`** (Statistiques) — `year` facultatif (l'année en cours à Paris par défaut). → `{ "year", "runners": [{ "runner": { "id", "name" }, "finished", "dnf", "distance_km", "elevation_gain_m", "time_s" }] }`, les coureurs qui ont au moins un résultat cette année-là, triés par kilomètres puis par nom.

**`list_race_types`** — aucune entrée → `{ "race_types": [{ "id", "label", "measures" }] }`, par nom. `measures` : les mesures que le formulaire montre d'abord pour ce type (`distance` → `distance_km`, `elevation` → `elevation_gain_m`, `duration` → `duration_min`, `time_limit` → `time_limit_min`) ; les quatre quand le type n'en dit rien.

**`search_events`**

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `query` | texte | non | mots cherchés dans le nom ou le lieu, sans majuscules ni accents |
| `period` | `upcoming` \| `past` | non | `upcoming` (défaut) : pas finies (dernier jour aujourd'hui ou après), de la plus proche à la plus lointaine ; `past` : finies, de la plus récente à la plus ancienne. Ignoré avec `from` ou `to` |
| `from`, `to` | AAAA-MM-JJ | non | les courses qui ont au moins un jour dans cette plage, bornes comprises (l'Agenda) |
| `runner` | texte | non | id ou nom : les courses où ce coureur a une participation autre que « Non partant » (le filtre `personne`) |
| `race_type` | texte | non | id ou nom : les courses qui ont au moins une épreuve de ce type |
| `limit` | entier 1–50 | non | 20 par défaut |

→ `{ "events": [EVENT_SUMMARY], "count", "truncated" }` :

```json
{ "id": "…", "name": "Trail des Crêtes", "location": "Annecy",
  "start_date": "2026-06-13", "end_date": "2026-06-14", "registration_deadline": "2026-05-31",
  "url": "https://…/evenements/…",
  "formats": [{ "id": "…", "title": "Trail 42 km", "race_type": "Trail", "date": "2026-06-14" }],
  "participants": 3,
  "mine": [{ "participation_id": "…", "format_id": "…", "status": "registered", "status_label": "Inscrit" }] }
```

- `participants` compte les participations qui ne sont pas « Non partant » ; `mine` : celles du propriétaire du jeton.
- `title` d'une épreuve : comme le site (`formatDisplayName`) : son nom, sinon le type et sa mesure principale (« Trail 42,2 km », « Route 6h », « Backyard max 48h »). Les mots viennent de ceux du flux d'agenda (`calendar/texts.go`), déplacés dans un paquet `wording` que les deux partagent ; les libellés des statuts aussi.
- Mêmes requêtes que la liste du site (filtre de période ou de plage, `expand` des épreuves et des participations) ; le texte, le coureur et le type sont filtrés ensuite, comme le fait le site.

**`get_event`** (la fiche) — `event_id` (obligatoire).

```json
{ "id": "…", "name": "…", "location": "…", "start_date": "…", "end_date": "…",
  "registration_url": "…", "registration_deadline": "…", "notes": "…",
  "created_by": { "id": "…", "name": "Alice" }, "url": "…",
  "formats": [{
    "id": "…", "title": "Trail 42 km", "name": "", "race_type": { "id": "…", "label": "Trail" },
    "distance_km": 42, "elevation_gain_m": 2400, "time_limit_min": 600, "price_eur": 65,
    "date": "2026-06-14", "day": "2026-06-14", "route_url": "…", "track_url": "…",
    "participants": [ PARTICIPATION ] }],
  "undecided": [ PARTICIPATION ],
  "supporters": [ PARTICIPATION ],
  "rides": [ OFFER ], "lodgings": [ OFFER ],
  "comments": [{ "id", "author": { "id", "name" }, "body", "created", "edited" }] }
```

- `day` : la date effective de l'épreuve (sa date, sinon le premier jour de la course) ; `track_url` : l'adresse du fichier GPX s'il y en a un.
- `undecided` : « Intéressés, format à choisir » ; `supporters` : les supporteurs. Les non partants restent dans leur épreuve, avec `status: "dns"`.
- `PARTICIPATION` :

  ```json
  { "id": "…", "runner": { "id": "…", "name": "Bob" }, "status": "interested", "status_label": "Intéressé",
    "confirmed": false, "added_by": { "id": "…", "name": "Alice" },
    "result": { "finish_time": "4:12:30", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "note": "…" } }
  ```

  `result` n'apparaît que s'il y en a un.
- `OFFER` (§ 6.8) :

  ```json
  { "id": "…", "kind": "ride", "owner": { "id", "name" }, "place": "Lyon, Part-Dieu",
    "seats": 3, "taken": 2, "date": "2026-06-13", "time": "06:30", "end_date": "", "url": "", "notes": "…",
    "members": [{ "place_id": "…", "runner": { "id", "name" }, "added_by": { "id", "name" } }] }
  ```

- `comments` : du plus ancien au plus récent, le texte tel quel ; `edited` quand il a été modifié plus d'une seconde après avoir été écrit (comme le site : PocketBase date la création et la mise à jour à une milliseconde près).

### 6.5 Courses et épreuves

**Une épreuve** (dans `create_event.formats[]` et `add_format`) :

| Champ | Type | Obligatoire | Sens |
|---|---|---|---|
| `race_type` | texte | oui | id ou nom du type (`list_race_types`) |
| `name` | texte | non | nom propre ; sinon le site l'appelle « Trail 42 km » |
| `distance_km` | nombre > 0 | — | décimales permises (42,195) |
| `elevation_gain_m` | entier ≥ 0 | non | D+ |
| `duration_min` | entier > 0 | — | course au temps (6 h = 360) |
| `time_limit_min` | entier > 0 | — | barrière horaire (46 h 30 = 2790) |
| `price_eur` | nombre ≥ 0 | non | au centime |
| `route_url` | URL | non | lien du parcours |
| `date` | AAAA-MM-JJ | non | jour de l'épreuve s'il n'est pas le premier jour de la course ; jamais avant `start_date` |

Au moins un de `distance_km`, `duration_min`, `time_limit_min` (`format_measure_required`, vérifié par le serveur). La description dit de remplir de préférence les mesures du type (`list_race_types`). Comme dans le formulaire, une mesure que le type n'utilise pas est acceptée. La trace GPX passe par `set_track` (§ 6.9).

**Une modification d'épreuve** (dans `update_event.formats[]` et `update_format`) : les mêmes champs, tous facultatifs, plus `format_id` (obligatoire). Un champ absent ne change pas ; 0 ou un texte vide l'efface.

**La date de fin vient des épreuves, comme dans le formulaire de la v5.** Aucun outil ne prend de `end_date` : à chaque création ou modification d'une course ou d'une de ses épreuves, l'outil recalcule `end_date` = la plus tardive des dates des épreuves si elle est après `start_date`, sinon rien (la course tient sur un jour) ; c'est `eventEndDate` du front, portée en Go. Le serveur garde ses contrôles (`end_before_start`, `format_date_out_of_range`).

**L'ordre du batch est celui du formulaire.** Chaque écriture sur une course passe par un seul `POST /api/batch` (une transaction), construit comme `buildBatch` du front, porté en Go :

1. les épreuves retirées sont supprimées ;
2. les épreuves gardées sont mises à jour, avec leur date si elle est dans les jours que la course a encore, sans date sinon ;
3. la course est mise à jour (avec sa nouvelle date de fin) ;
4. les épreuves dont la date attendait la course la reçoivent, et les nouvelles épreuves sont créées.

Une épreuve déplacée après la fin actuelle de la course, ou une course déplacée avec ses épreuves (`update_event` et son argument `formats`), passe donc en un seul appel, sans état intermédiaire refusé, comme dans le formulaire.

Une différence avec `buildBatch` : **une épreuve gardée qui ne change pas n'est pas envoyée** (le formulaire renvoie toutes ses épreuves). Le formulaire montre l'état qu'il enverra ; un outil, lui, lit la course puis écrit, et renvoyer telles quelles des épreuves qu'il ne touche pas écraserait ce qu'une autre personne vient d'y changer.

**Avertissements** (`warnings`, des phrases en français, qui ne bloquent pas) : la course dure plus de deux semaines : « Plus de deux semaines : vérifie les dates des épreuves. » (comme le formulaire). Raccourcir une course est une confirmation (§ 6.13).

**`create_event`**

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `name` | texte, 1 à 120 | oui | |
| `location` | texte | oui | une ville ou un lieu |
| `start_date` | AAAA-MM-JJ | oui | premier jour |
| `registration_url` | URL | non | page d'inscription officielle |
| `registration_deadline` | AAAA-MM-JJ | non | dernier jour pour s'inscrire, au plus tard `start_date` |
| `notes` | texte | non | |
| `formats` | liste de 1 à 20 épreuves | oui | |
| `join` | `{ "format_index": 0, "status": "interested" }` | non | « Je participe » du formulaire : ajoute le propriétaire du jeton à l'épreuve d'indice `format_index` (à partir de 0), avec ce statut |
| `confirmation` | texte | non | § 6.13 |

- **Doublons** : avant d'écrire, l'outil cherche les courses que le formulaire proposerait comme doublons (à 30 jours au plus de `start_date`, dont le nom a un mot de 4 lettres ou plus du nom donné, `duplicates.ts`). S'il en trouve, il demande une confirmation qui les nomme : « Des courses semblables existent déjà : « Trail des Crêtes » (2026-06-13 au 2026-06-14, Annecy, 3 participants, id …). » Le formulaire se contente de les proposer ; un assistant à qui l'on redemande la même chose en créerait une deuxième.
- Plus de 20 épreuves : refusé (le batch du site est limité à 50 requêtes).
- → la course comme `get_event`, avec `done`, `summary` et `warnings`. `created_by` est le coureur du propriétaire du jeton, posé par le serveur.

**`update_event`** (le formulaire « Modifier ») — `event_id` (obligatoire), puis, tous facultatifs :

- les champs de la course : `name`, `location`, `start_date`, `registration_url`, `registration_deadline`, `notes` (absent : inchangé ; un texte vide efface un champ facultatif) ;
- `formats` : une liste de modifications d'épreuves, appliquées dans le même batch que la course. C'est ce qui permet de déplacer une course et ses épreuves datées en une fois, comme le formulaire ;
- `confirmation`.

→ la course, `done`, `summary`, `warnings`.

**`delete_event`** (« Supprimer » de la fiche) — `event_id` (obligatoire), `confirmation`.

- **Toujours une confirmation** : elle nomme la course, ses épreuves, et ce qui part avec elle par la cascade du site : les participations (avec les noms et les statuts), les commentaires et les offres (leur nombre), comme la fenêtre de confirmation du site qui liste les participants.
- Le site ne laisse supprimer une course qu'à son auteur et aux admins : « Seule Alice, qui a créé la course, ou un admin peut la supprimer. » (annoncé avant la confirmation, § 5.3, et refusé par l'API sinon).
- → `{ "done", "removed": { "id", "name", "start_date" }, "summary" }`.

**`add_format`** — `event_id` (obligatoire) et une épreuve. → la course, `done`, `summary`, `warnings`.

**`update_format`** — une modification d'épreuve et `confirmation`. Raccourci d'`update_event` avec une seule épreuve. → la course, `done`, `summary`, `warnings`.

**`delete_format`** — `format_id` (obligatoire), `confirmation`.

- **Toujours une confirmation** : elle nomme l'épreuve et, s'il y en a, ses participants avec leur statut, dont les participations partent avec elle (« Supprimer « Trail 42 km » supprime aussi 3 participations : Alice (Inscrit), Bob (Intéressé, non confirmé), Sam (Non partant). »), et sa trace s'il y en a une.
- Refusé si c'est **la seule épreuve** de la course : « Une course garde au moins une épreuve. » (le formulaire ne permet pas de retirer la dernière).
- Le site ne laisse supprimer une épreuve qu'à l'auteur de la course et aux admins : « Seule Alice, qui a créé la course, ou un admin peut supprimer une de ses épreuves. » (annoncé, § 5.3).
- → la course, `done`, `summary`, `warnings`.

### 6.6 Participations et résultats

**`add_participation`** (« J'y vais », « Ajouter quelqu'un », « Je viens encourager »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `runner` | texte | non | id ou nom du coureur ; le propriétaire du jeton par défaut |
| `event_id` | id | sans `format_id` | la course |
| `format_id` | id | non | l'épreuve ; sans elle, une participation à la course seule |
| `status` | un des six codes | oui | pas de valeur par défaut : « inscrire » est ambigu (Intéressé ou Inscrit ?), l'assistant choisit |
| `confirmation` | texte | non | § 6.13 |

- Avec `format_id` et `event_id`, l'épreuve doit être de cette course (`format_other_event`).
- Sans épreuve, `interested` ou `supporter` seulement (`format_required`, serveur). Sur une course qui n'a **qu'une épreuve**, `interested` sans épreuve est refusé par l'outil (le site ne le propose pas) : « Cette course n'a qu'une épreuve (« Trail 42 km », id …) : ajoute le coureur à cette épreuve. »
- Déjà une participation à cette épreuve (ou à la course seule) : « Bob a déjà une participation à « Trail 42 km » (Intéressé, id …) : change-la avec update_participation. »
- Une participation à une épreuve **remplace** la participation à la course seule du même coureur (conversion du serveur). Pour un autre coureur que soi, c'est une confirmation ; pour soi, le `summary` le dit.
- → `{ "done", "participation": PARTICIPATION, "event": { "id", "name", "url" }, "format_title", "summary" }`. Le `summary` dit « non confirmé : Bob le verra dans « À confirmer » » quand c'est le cas.

**`update_participation`** (le menu d'une participation)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `participation_id` | id | oui | |
| `status` | un des six codes | non | |
| `format_id` | id | non | une épreuve de la même course : choisir l'épreuve d'un « Intéressé, format à choisir », ou changer d'épreuve |
| `confirmation` | texte | non | § 6.13 |

- Sans `status` ni `format_id` : **confirme** la participation (« Confirmer » de l'accueil), ce que seul son coureur peut faire ; sinon « Seul Bob peut confirmer sa participation. » Pas de confirmation du § 6.13 pour cela : rien n'est effacé.
- Toute modification par le coureur lui-même confirme sa participation (règle du site).
- Changer la participation **d'un autre coureur**, ou un statut qui **effacerait un résultat** (temps, classement, note : le hook les efface quand le statut ne va plus avec), demande une confirmation.
- Refus du site sur une participation confirmée d'un autre : « Bob a confirmé cette participation : seuls Bob et les admins peuvent la changer. » (annoncé, § 5.3).
- `finished` et `dnf` avant le jour de la course : `status_before_race`.
- → comme `add_participation`.

**`remove_participation`** (« Retirer ») — `participation_id` (obligatoire), `confirmation`. Supprime la participation : c'est la désinscription du site. **Toujours une confirmation**, qui dit le coureur, l'épreuve, le statut et le résultat perdu s'il y en a un. La description conseille plutôt `dns` (Non partant) pour quelqu'un qui ne prend pas le départ d'une course où il était inscrit. Mêmes droits que le site : un admin, le coureur lui-même, ou n'importe qui tant que le coureur n'a pas confirmé. → `{ "done", "removed": PARTICIPATION, "event": { "id", "name", "url" }, "summary" }`.

**`set_result`** (« Saisir le résultat », « J'ai fini », « Abandon » des « Résultats à saisir »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `participation_id` | id | oui | une participation à une épreuve |
| `status` | `finished` \| `dnf` | oui | Terminé ou Abandon |
| `finish_time` | `h:mm:ss` | non | temps final (Terminé seulement) |
| `rank`, `rank_of` | entiers > 0 | non | classement et nombre de classés (Terminé seulement) ; `rank` ≤ `rank_of` (`rank_above_total`) |
| `note` | texte, 200 au plus | non | « 3e V1H », « abandon au km 30 » |
| `confirmation` | texte | non | § 6.13 |

- Une seule écriture (`PATCH` de la participation), avec les mêmes droits qu'`update_participation` ; le hook garde ce qui va avec le statut (temps et classement pour Terminé, note pour les deux).
- Avant le jour de la course : `status_before_race`. Une participation sans épreuve : « Choisis d'abord l'épreuve. »
- Confirmation quand le résultat **remplace** un résultat existant (temps, classement ou note déjà saisis), ou que la participation est celle d'un autre coureur.
- → comme `add_participation`, avec le résultat écrit (« Terminé · 4h 12min 30s · 12e sur 340 », écrit comme le site : style court, sans espace entre le nombre et l'unité).

### 6.7 Commentaires

**`add_comment`** (« Envoyer ») — `event_id`, `body` (1 à 2000 caractères ; le serveur retire les espaces de début et de fin, et refuse un texte vide). → `{ "done", "comment": { "id", "author", "body", "created" }, "summary" }`. L'auteur est le coureur du propriétaire du jeton, posé par le serveur.

**`update_comment`** (« Modifier ») — `comment_id`, `body`. Seul l'auteur modifie son commentaire, même un admin ne modifie pas ceux des autres (règle du site) : « Seul Bob peut modifier son commentaire. » (annoncé). Pas de confirmation : c'est son propre texte. → le commentaire.

**`delete_comment`** (« Supprimer ») — `comment_id`, `confirmation`. L'auteur ou un admin. **Toujours une confirmation**, qui cite le début du texte et son auteur. → `{ "done", "removed": { "id", "author", "excerpt" }, "summary" }`.

### 6.8 Covoiturage et logement

Une **offre** est une voiture (`ride`) ou un logement (`lodging`) pour une course, proposée par son propriétaire, qui y offre des places (spec v2 § 3).

**`add_offer`** (« Proposer une voiture », « Proposer un logement »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `event_id` | id | oui | |
| `kind` | `ride` \| `lodging` | oui | |
| `place` | texte, 1 à 120 | oui | voiture : lieu de départ ; logement : nom ou adresse |
| `seats` | entier | voiture : oui (1 à 8) ; logement : non (1 à 30) | places offertes, sans compter le propriétaire |
| `date` | AAAA-MM-JJ | non | voiture : jour du départ ; logement : jour d'arrivée (le début de la course par défaut, comme le site) |
| `time` | `HH:MM` | non | voiture seulement : heure de départ |
| `end_date` | AAAA-MM-JJ | non | logement seulement : jour de départ, ≥ `date` |
| `url` | URL | non | logement seulement : l'annonce |
| `notes` | texte, 1000 au plus | non | |

- Le propriétaire est le coureur du propriétaire du jeton (hook). Une offre de chaque sorte par coureur et par course, et pas d'offre quand on a déjà une place de cette sorte (`offer_already_member`) ; places (`offer_seats_required`), heure (`time_invalid`), dates (`end_before_start`) : les messages du site.
- → `{ "done", "offer": OFFER, "event", "summary" }`.

**`update_offer`** (« Modifier ») — `offer_id`, les mêmes champs facultatifs (sauf `event_id` et `kind`, qui ne changent pas), `confirmation`. Le propriétaire ou un admin. Des places sous le nombre de passagers : `offer_seats_below_members`. Confirmation quand un champ rempli serait vidé, des notes non vides remplacées, ou que l'offre est celle d'un autre (un admin). → l'offre.

**`delete_offer`** (« Supprimer ») — `offer_id`, `confirmation`. Le propriétaire ou un admin. **Toujours une confirmation**, qui nomme les personnes qui perdent leur place (comme la fenêtre du site). → `{ "done", "removed", "summary" }`.

**`offer_place`** (« Je monte », « J'y dors », « Je descends », « Je n'y dors plus », « Ajouter quelqu'un », « Retirer »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `offer_id` | id | oui | |
| `action` | `take` \| `free` | oui | prendre une place, ou la libérer |
| `runner` | texte | non | soi par défaut ; un autre coureur seulement pour le propriétaire de l'offre ou un admin (règle du site, annoncée sinon : « Seul Bob, qui propose cette voiture, peut y placer quelqu'un d'autre. ») |
| `confirmation` | texte | non | § 6.13 |

- Prendre : `offer_full`, `offer_owner_member`, `offer_already_member` (messages du site). Pas de confirmation.
- Libérer : **toujours une confirmation** (comme retirer une participation).
- → l'offre, `done`, `summary` (« 2 places prises sur 3 »).

### 6.9 Fichiers : la photo et la trace GPX

Le site envoie une photo et une trace comme un fichier d'un formulaire (`multipart/form-data`). Un assistant n'a pas de champ fichier : un fichier arrive au serveur de l'une de deux façons.

**1. En base64 dans les arguments**, pour un petit fichier (une trace courte, une image déjà petite) : `content_base64`, **512 Ko décodés au plus**. Au-delà, l'appel serait trop lourd pour l'assistant (chaque caractère compte) et dépasserait la limite du corps d'une requête `/mcp` (1 Mio).

**2. Par un envoi en deux temps**, pour tout fichier :

1. `start_upload` (`purpose` : `photo` ou `track`) réserve un emplacement et répond :

   ```json
   { "upload_id": "…", "upload_url": "https://…/api/app/mcp-uploads/<upload_id>",
     "secret": "ptu_…", "expires_at": "…", "max_bytes": 5242880,
     "accepted": "JPEG, PNG ou WebP",
     "command": "curl -sS -X PUT -H \"X-Upload-Secret: ptu_…\" --data-binary @<fichier> https://…/api/app/mcp-uploads/<upload_id>" }
   ```

2. L'assistant (ou la personne) envoie le fichier tel quel à `upload_url`, avec la commande donnée. Claude Code la lance dans son terminal ; un client sans terminal passe par la base64.
3. L'outil qui en a besoin (`set_photo`, `set_track`) reçoit `upload_id` et prend le fichier.

La route **`PUT /api/app/mcp-uploads/{id}`** (paquet `mcp`, absente sur la démo) :

- n'a pas de session : l'en-tête **`X-Upload-Secret`** est le secret, comparé en temps constant à son empreinte ; il n'est jamais dans une URL, donc jamais dans le journal ;
- lit au plus `max_bytes` (`http.MaxBytesReader`) : **5 Mo pour une photo, 10 Mo pour une trace**, les limites des champs du site ; au-delà, 413 ;
- regarde le type du contenu (`http.DetectContentType`, et pour une trace : du XML) ; un mauvais type : 400 `upload_invalid` ;
- un seul envoi par emplacement ; un emplacement inconnu, expiré, déjà rempli ou un mauvais secret : 400 `upload_invalid` (sans dire lequel) ; → 204.

Les emplacements vivent **en mémoire**, comme les confirmations (§ 6.13) : **10 minutes**, **deux en attente par jeton MCP**, **64 Mo en tout** (au-delà, l'emplacement le plus ancien part) ; un fichier pris par un outil ou expiré est libéré aussitôt. Un emplacement est lié au jeton MCP qui l'a demandé et à son usage : une photo ne sert pas de trace, et un autre assistant ne s'en sert pas. Un redémarrage les perd : l'assistant recommence.

Le fichier lui-même n'est pas transformé, sauf ce que le site fait aussi (ci-dessous) : la validation finale est celle du champ du site (`validation_invalid_mime_type`, `validation_file_size_limit`, avec leurs messages).

**`set_photo`** (« Changer la photo », « Retirer la photo »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `runner` | texte | non | soi par défaut ; un autre coureur pour un admin (règle du site, annoncée sinon) |
| `upload_id` ou `content_base64` | — | l'un des deux, sauf avec `remove` | la nouvelle photo : JPEG, PNG ou WebP, 5 Mo au plus |
| `remove` | booléen | non | retirer la photo |
| `confirmation` | texte | non | § 6.13 |

- `PATCH runners/{id}` en `multipart/form-data`, champ `avatar`, comme le site ; pour retirer la photo, un `PATCH` JSON `{"avatar": null}`, comme `removeAvatar` du site. Le site réduit l'image dans le navigateur avant de l'envoyer ; l'outil l'envoie telle quelle, dans les limites du champ, et PocketBase fait les vignettes 96×96 et 256×256 comme pour toute photo.
- Confirmation quand une photo existe déjà (remplacée ou retirée), ou que le coureur n'est pas soi.
- → `{ "done", "runner": { "id", "name", "photo_url" }, "summary" }`.

**`set_track`** (« Trace GPX », « Retirer la trace », « Reprendre ces valeurs »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `format_id` | id | oui | |
| `upload_id` ou `content_base64` | — | l'un des deux, sauf avec `remove` | le fichier GPX, 10 Mo au plus |
| `remove` | booléen | non | retirer la trace |
| `use_track_values` | booléen | non | « Reprendre ces valeurs » : met la distance et le D+ de l'épreuve à ceux de la trace, dans la même écriture |
| `confirmation` | texte | non | § 6.13 |

- L'outil lit la trace comme le site (`parseGpx` de `features/route/gpx.ts`, porté en Go) : les points `trkpt`, sinon `rtept` ; aucun point exploitable → « Ce fichier n'est pas une trace GPX exploitable. », rien n'est envoyé. Il en tire les chiffres du site (`gpxStats` : distance par haversine, D+ et D− avec l'hystérésis de 3 m, altitudes min et max).
- Comme le site (`withXmlDeclaration`), un fichier sans déclaration XML en reçoit une, sinon PocketBase le prend pour du texte et le refuse.
- `PATCH formats/{id}` en `multipart/form-data`, champ `gpx`, avec `distance_km` et `elevation_gain_m` si `use_track_values` ; pour retirer la trace, un `PATCH` JSON `{"gpx": null}`, comme le site. Tout connecté (règle du site).
- Confirmation quand une trace existe déjà (remplacée ou retirée).
- → `{ "done", "format": { "id", "title", "track_url" }, "track": { "points", "distance_km", "elevation_gain_m", "elevation_loss_m", "min_m", "max_m", "has_elevation" }, "summary" }`.

### 6.10 Profil et réglages

**`rename_runner`** (Réglages → « Nom » ; Membres → « Renommer » pour un admin) — `runner` facultatif (soi par défaut), `name` (1 à 50, unique sans tenir compte de la casse : `validation_not_unique`). Son propre coureur, ou n'importe lequel pour un admin. → le coureur.

**`passkeys`** (Réglages → « Mes clés d'accès » ; Membres → « Clés d'accès » pour un admin)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `action` | `list` \| `rename` \| `delete` | oui | |
| `runner` | texte | non | `list` : les clés du compte d'un autre coureur, pour un admin (soi par défaut) |
| `passkey_id` | id | `rename`, `delete` | |
| `name` | texte | `rename` | |
| `confirmation` | texte | non | § 6.13 |

- `list` → `[{ "id", "name", "created", "last_used_at" }]` : jamais les données d'identification (champ caché du site), ni l'identifiant de la clé chez l'appareil.
- `rename` : ses propres clés seulement (règle du site : le nom, rien d'autre).
- `delete` : les siennes, ou n'importe lesquelles pour un admin ; **toujours une confirmation** (« La clé « iPhone » ne pourra plus te connecter. »).
- **Créer une clé** n'est pas possible : il faut l'appareil (WebAuthn), dans le navigateur (§ 10).

**`calendar_link`** (Réglages → « Agenda »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `action` | `show` \| `create` \| `renew` \| `delete` | oui | |
| `lang` | `fr` \| `en` | non | la langue des textes du flux, à la création (`fr` par défaut) |
| `confirmation` | texte | non | § 6.13 |

- `show` → `{ "exists", "url" }`, comme `GET /api/app/calendar` ; `url` est vide pour un lien d'avant la v3.1. **Le site montre ce lien à son propriétaire** (« Afficher le lien ») : l'outil le donne à l'assistant de son propriétaire, et à personne d'autre (la route ne connaît que celui de l'appelant).
- `create` : sans lien ; avec un lien, « Tu as déjà un lien : renew le remplace. ».
- `renew` (« Nouveau lien ») et `delete` (« Supprimer le lien ») : **toujours une confirmation** (« L'ancien lien cessera de marcher : les agendas abonnés ne recevront plus tes courses. »).

**`mcp_tokens`** (Réglages → « Assistant IA (MCP) »)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `action` | `list` \| `revoke` | oui | |
| `token_id` | id | `revoke` | |
| `confirmation` | texte | non | § 6.13 |

- `list` → `[{ "id", "name", "created", "last_used_at", "current" }]` : jamais un secret ni une empreinte ; `current` marque le jeton qui fait l'appel.
- `revoke` : **toujours une confirmation**. Révoquer le jeton qui fait l'appel est permis : la réponse dit que c'est le dernier appel.
- **Créer un jeton** n'a pas d'outil : un jeton ne doit pas en fabriquer un autre, dont le secret passerait par l'assistant (§ 10).

### 6.11 Les outils d'admin

Ils reprennent les trois pages Admin du site (`web/src/features/admin`, `web/src/routes/admin`) : Membres, Types, Doublons. Chacun passe par la même requête que la page (`features/admin/api.ts`) et répond une erreur `unknown tool` à un compte qui n'est pas admin (§ 6.3). Un coureur se donne par son id ou son nom, comme ailleurs ; un compte se désigne par son coureur (le site n'en montre pas d'autre).

**`admin_list_members`** (Membres) — `query` facultatif (un nom). → `{ "members": [MEMBER] }`, par nom :

```json
{ "runner": { "id": "…", "name": "Bob" },
  "state": "active", "state_label": "Actif",
  "role": "member", "participations": 4, "passkeys": 2,
  "invitation": { "id": "…", "expires_at": "2026-11-09" },
  "reset": { "id": "…", "expires_at": "2026-11-09" } }
```

- `state` : `no_account` (« Sans compte »), `invited` (« Invitation en attente »), `active` (« Actif »), `disabled` (« Désactivé »), calculés comme `memberState` du front, qui compte une invitation comme en attente tant qu'elle n'est ni utilisée ni expirée.
- `invitation`, `reset` : le lien en attente, s'il y en a un (jamais son jeton : le site ne garde que son empreinte) ; `role`, `passkeys` (leur nombre ; le détail par `passkeys`, § 6.10) : seulement pour un coureur qui a un compte ; `participations` : leur nombre, qui dit si le coureur peut être supprimé.
- **Pas d'email.** La page Membres montre l'email des comptes à un admin ; l'outil ne le donne pas : aucune action n'en a besoin, et il partirait chez le fournisseur de l'assistant (§ 11.2).

**`admin_create_runner`** (« Ajouter un coureur ») — `name` (1 à 50 caractères, unique sans tenir compte de la casse : `validation_not_unique`). → le coureur. Pour lui créer un compte : `admin_create_link`.

**`admin_delete_runner`** (« Supprimer ») — `runner`, `confirmation`. Le site ne supprime qu'un coureur sans compte et sans participation (`runner_has_account`, `runner_has_participations`) : l'outil l'annonce sans demander de confirmation (« Bob a un compte : désactive-le plutôt. », « Sam a 3 participations : retire-les d'abord. »). Sinon, une confirmation. → `{ "done", "removed": { "id", "name" }, "summary" }`.

**`admin_create_link`** (« Inviter », « Régénérer l'invitation », « Lien de réinitialisation ») — c'est ainsi qu'un compte se crée, comme sur le site.

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `runner` | texte | oui | id ou nom du coureur |
| `kind` | `invite` \| `reset` | oui | `invite` pour un coureur sans compte (la personne crée son compte en ouvrant le lien) ; `reset` pour un coureur qui en a un (la personne choisit un nouveau mot de passe ; ses sessions sont fermées quand elle s'en sert) |
| `role` | `member` \| `admin` | non | le rôle du compte que l'invitation crée ; `member` par défaut ; rien pour `reset` |
| `confirmation` | texte | non | § 6.13 |

- → `{ "done", "url": "https://…/invitation#…", "expires_at": "…", "summary" }` : **ce que la page montre à l'admin**, le lien à envoyer et sa date d'expiration (7 jours). Un nouveau lien remplace celui qui attendait, du même genre, pour ce coureur (le site le fait).
- Le `summary` dit à l'assistant que le lien donne l'accès au compte, qu'il ne le transmet qu'à la personne, et qu'il ne l'écrit nulle part ailleurs.
- Le lien voyage dans la réponse de l'outil, donc chez l'assistant, comme il s'affiche à l'admin sur le site. Le serveur ne le garde pas et ne le journalise pas (le jeton est dans le fragment de l'URL, et la route ne l'écrit nulle part).
- Refus du site : `invitation_kind_mismatch` (une invitation pour un coureur qui a déjà un compte, une réinitialisation pour un coureur qui n'en a pas), avec son message.

**`admin_revoke_link`** (« Révoquer l'invitation », « Révoquer le lien ») — `runner`, `kind`, `confirmation`. Révoque le lien en attente de ce genre pour ce coureur (`DELETE /api/app/invitations/{id}`) ; aucun en attente : « Aucun lien en attente pour Sam. »

**`admin_set_role`** (« Passer admin », « Retirer admin ») — `runner`, `role` (`member` | `admin`), `confirmation`. Un coureur sans compte : « Sam n'a pas de compte. » Le dernier admin actif ne perd pas son rôle (`last_admin`, message du site). Retirer son propre rôle d'admin est permis par le site (s'il en reste un autre) : les outils d'admin disparaissent à la requête suivante.

**`admin_set_disabled`** (« Désactiver », « Réactiver ») — `runner`, `disabled` (booléen), `confirmation`. Désactiver ferme les sessions du compte et supprime ses jetons MCP (§ 4.6) ; le dernier admin actif ne se désactive pas (`last_admin`). Désactiver son propre compte (s'il reste un admin) coupe aussi le jeton qui fait la demande : la réponse le dit, et c'est la dernière.

**`admin_create_race_type`** (Types → « Ajouter ») — `label` (unique sans tenir compte de la casse), `measures` facultatif (une liste de `distance`, `elevation`, `duration`, `time_limit` ; vide : les quatre). → le type.

**`admin_update_race_type`** (Types → « Renommer », « Mesures ») — `race_type` (id ou nom), `label` et `measures` facultatifs. Un nouveau nom change ce que toutes les courses affichent pour leurs épreuves de ce type : le `summary` le dit. → le type.

**`admin_delete_race_type`** (Types → « Supprimer ») — `race_type`, `confirmation`. Un type utilisé par au moins une épreuve est refusé par le site (`race_type_in_use`) : l'outil l'annonce sans confirmation, avec le nombre d'épreuves (« 12 épreuves sont de type « Ultra-trail » : change leur type ou fusionne-les d'abord. »).

**`admin_merge`** (Doublons)

| Entrée | Type | Obligatoire | Sens |
|---|---|---|---|
| `kind` | `events` \| `formats` | oui | deux courses, ou deux épreuves de la même course |
| `keep_id` | id | oui | celle qui reste |
| `merge_id` | id | oui | celle qui est fusionnée dans l'autre, puis supprimée |
| `confirmation` | texte | non | § 6.13 |

- **Le premier appel est l'aperçu du site** : la même route avec `dryRun: true`, qui ne change rien. La confirmation en donne les chiffres (`MergeResult` : épreuves, participations, commentaires et offres déplacés, participations supprimées, dates d'épreuve effacées) et nomme les deux courses ou épreuves.
- **L'empreinte de l'état** (§ 6.13) comprend ces chiffres : si une participation arrive entre les deux appels, l'aperçu change, le jeton est refusé et un nouvel aperçu est donné.
- Le second appel fait la fusion (`dryRun: false`), dans la transaction du site. Refus du site : `merge_same_record`, `merge_formats_different_events`.
- → `{ "done", "result": MergeResult, "kept": { "id", "name" }, "summary" }`.

### 6.12 Erreurs

- **Une erreur d'outil** (le site refuse, un nom est inconnu…) est un résultat `isError: true` avec un texte en français : le message, le champ, et le code entre parenthèses, pour que l'assistant puisse corriger et réessayer. Exemple : « Épreuve 2 (« Trail 15 km »), date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range) »
- **Les messages viennent du site** : ceux de `fr.errors` (`web/src/i18n/fr.ts`) pour les codes du serveur que les outils peuvent rencontrer, et pour les codes de validation de PocketBase (`validation_required`, `validation_not_unique`, `validation_invalid_url`, `validation_max_text_constraint`, `validation_invalid_mime_type`, `validation_file_size_limit`…), avec le message du champ concerné (la photo ou la trace). Un code sans message : « Le site a refusé (code …). »
- **Les champs ont un nom français** : `start_date` « date de début », `registration_deadline` « date limite d'inscription », `date` « date de l'épreuve », `distance_km` « distance », `duration_min` « durée », `time_limit_min` « temps max », `elevation_gain_m` « D+ », `price_eur` « prix », `route_url` « lien du parcours », `status` « statut », `body` « texte », `seats` « places », `place` « lieu », `avatar` « photo », `gpx` « trace »…
- **Une erreur du batch** désigne la requête fautive (la course, l'épreuve n, la participation), comme `toSaveError` du front.

| Réponse de l'API | Message |
|---|---|
| 400 avec des codes de champ | le message de chaque champ (ci-dessus) |
| 400 sur une création, sans champ (règle de création) | « Tu n'as pas le droit de faire ça. » |
| 403 | « Tu n'as pas le droit de faire ça. » |
| 404 sur une lecture | « Introuvable : il a peut-être été supprimé. » |
| 404 sur une modification ou une suppression | message propre à l'outil quand il sait pourquoi (participation confirmée d'un autre, course d'un autre auteur, commentaire ou offre d'un autre), sinon « Introuvable, ou ce n'est pas à toi de le modifier. » |
| 429 | « Trop de demandes d'un coup : attends une minute avant de réessayer. » |
| 5xx, réponse illisible | « Le site a rencontré une erreur. Réessaie dans un instant. » (et le paquet journalise l'erreur, sans jeton) |

- Un argument qui ne respecte pas le schéma (statut inconnu, nombre attendu) est refusé par le SDK avant l'outil, avec son propre message (en anglais).
- Un **jeton refusé** n'est pas une erreur d'outil : c'est le 401 du § 4.3, avant le protocole. **Trop de requêtes pour un jeton** : le 429 du § 3.4.
- **Une demande de confirmation n'est pas une erreur** : c'est un résultat normal, `done: false` (§ 6.13).

### 6.13 Confirmation des demandes qui suppriment ou effacent

#### Ce qui en demande une

Une demande qui supprimerait ou effacerait ce qu'une personne a saisi, ou qui toucherait aux droits ou à l'accès d'un compte, **ne fait rien au premier appel**. Remplacer une valeur par une autre (corriger une distance, renommer une course, un coureur ou un type, modifier son propre commentaire) n'en demande pas : c'est ce que la personne a demandé, et rien n'est perdu qu'elle ne voie.

| Outil | Quand | Ce que la réponse dit |
|---|---|---|
| `create_event` | une course semblable existe (doublon probable, § 6.5) | les courses semblables : nom, jours, lieu, nombre de participants, id |
| `update_event` | un champ rempli serait vidé (`registration_url`, `registration_deadline`, `notes`, ou un champ d'une épreuve de `formats`) ; des notes non vides seraient remplacées ; la course serait raccourcie (sa date de fin recule ou disparaît) ; le jour d'une épreuve qui a des participants changerait (sa date, ou le début de la course pour une épreuve sans date) | chaque champ vidé et sa valeur actuelle ; les notes actuelles ; les jours avant et après ; chaque épreuve dont le jour change, avec ses participants |
| `delete_event` | toujours | la course, ses épreuves, ses participants (nom, statut), le nombre de commentaires et d'offres : tout part avec elle |
| `update_format` | un champ rempli serait vidé ; le jour d'une épreuve qui a des participants changerait | idem |
| `delete_format` | toujours | l'épreuve, sa trace, et ses participants (nom, statut, résultat) : leurs participations partent avec elle |
| `add_participation` | la participation remplacerait la participation à la course seule (« Intéressé, format à choisir » ou « Supporteur ») d'un autre coureur que soi | la participation remplacée, et qui l'avait ajoutée |
| `update_participation` | c'est la participation d'un autre coureur (statut ou épreuve) ; ou le nouveau statut effacerait un résultat (temps, classement, note) | la participation, ce qui change, le résultat perdu |
| `remove_participation` | toujours | la participation : coureur, épreuve, statut, confirmée ou non, résultat |
| `set_result` | un résultat existant serait remplacé ; ou c'est la participation d'un autre coureur | l'ancien résultat et le nouveau |
| `delete_comment` | toujours | le début du texte et son auteur |
| `update_offer` | un champ rempli serait vidé ; des notes non vides remplacées ; l'offre est celle d'un autre | ce qui change, l'offre et son propriétaire |
| `delete_offer` | toujours | l'offre et les personnes qui perdent leur place |
| `offer_place` | libérer une place | qui perd sa place, dans quelle offre |
| `set_photo` | une photo existe (remplacée ou retirée) ; ou c'est la photo d'un autre coureur | la photo actuelle (son adresse) et le coureur |
| `set_track` | une trace existe (remplacée ou retirée) | la trace actuelle (son adresse) et l'épreuve |
| `passkeys` | `delete` | la clé (nom, dernière utilisation) et le compte |
| `calendar_link` | `renew`, `delete` | que l'ancien lien cessera de marcher |
| `mcp_tokens` | `revoke` | le jeton (nom, dernière utilisation) ; si c'est celui de l'appel |
| `admin_delete_runner` | toujours | le coureur (le site refuse s'il a des participations ou un compte : c'est alors un refus, annoncé sans confirmation) |
| `admin_create_link` | une réinitialisation, toujours ; une invitation qui remplacerait un lien en attente, ou qui donnerait le rôle admin | à qui le lien donne accès et à quoi ; le lien en attente qui cesserait de marcher (et sa date d'expiration) ; le rôle donné |
| `admin_revoke_link` | toujours | le lien qui cesserait de marcher, pour qui, et sa date d'expiration |
| `admin_set_role` | toujours | le compte, son rôle actuel et le nouveau ; ce qu'un admin peut faire de plus |
| `admin_set_disabled` | désactiver | le compte ; ses sessions fermées, ses jetons MCP supprimés ; il ne pourra plus se connecter. Réactiver ne demande rien |
| `admin_delete_race_type` | toujours (un type utilisé par une épreuve est refusé par le site, `race_type_in_use` : refus, sans confirmation) | le type et ses mesures |
| `admin_merge` | toujours | l'aperçu du site (`dryRun`) : ce qui reste, ce qui part, les épreuves, participations, commentaires et offres déplacés, les participations supprimées, les dates d'épreuve effacées |

Le statut d'une inscription reste obligatoire (§ 6.6) : la confirmation ne remplace pas ce choix.

#### Le premier appel

L'outil lit ce qu'il faut, vérifie ce qu'il peut sans rien écrire (les refus du § 5.3, les refus propres à l'outil), puis, s'il y a quelque chose à confirmer, ne fait rien et répond :

```json
{ "done": false,
  "confirmation": {
    "token": "cfm_…", "expires_at": "2026-11-02T14:35:00Z",
    "message": "Rien n'a été fait. Supprimer l'épreuve « Trail 42 km » (Trail des Crêtes) supprime aussi 2 participations : Alice (Inscrit), Bob (Intéressé, non confirmé). Demande son accord à la personne ; si elle accepte, rappelle delete_format avec les mêmes arguments et confirmation: \"cfm_…\" (valable 10 minutes, une seule fois).",
    "details": [ "…une ligne par élément perdu ou touché…" ] } }
```

Le `message` est en français, prêt à être montré à la personne. Un fichier envoyé (`upload_id`) n'est pas pris par le premier appel : il attend le second.

#### Le jeton de confirmation

- **Forme** : `cfm_` suivi de 26 caractères (`crypto/rand.Text()`, 128 bits).
- **Lié** à ce qui a été montré :
  - le compte **et** le jeton MCP qui l'ont demandé (un autre assistant de la même personne ne peut pas s'en servir) ;
  - l'outil ;
  - l'**empreinte des arguments** : SHA-256 du JSON canonique des arguments **normalisés** (les noms remplacés par les identifiants, les valeurs par défaut posées, les textes sans espaces de début et de fin, un fichier remplacé par l'empreinte de son contenu), sans `confirmation`. « bob » et l'identifiant de Bob sont la même demande ; une autre épreuve, un autre statut, un autre texte, un autre fichier n'en sont pas ;
  - l'**empreinte de l'état** : SHA-256 de ce que la réponse a décrit (les éléments de `details`, dans l'ordre) et de la date `updated` des enregistrements lus pour la décrire (la course, ses épreuves, leurs participations, les doublons, le commentaire, l'offre, la photo…).
- **Une seule fois** : le jeton est retiré dès qu'un appel le présente, qu'il soit accepté ou non.
- **10 minutes** : le temps de demander à la personne et d'avoir sa réponse.
- **En mémoire**, dans le processus, comme les défis des clés d'accès (`passkeys.Sessions`, spec v1 § 5.1) : une seule instance tourne ; une confirmation ne vaut que 10 minutes ; un redémarrage qui les perd oblige seulement à redemander ; une table demanderait une migration, une écriture à chaque demande risquée et un ménage. Si un jour le site tournait sur plusieurs instances, elles iraient dans une table.
- **Bornée** : 20 confirmations en attente par jeton MCP et 1 000 en tout ; au-delà, la plus ancienne part. Celles qui ont expiré partent à chaque nouvelle demande. (Le magasin des clés d'accès n'a pas de plafond, ce que la revue de la v1 avait relevé.)

#### Le second appel

Le même outil, les mêmes arguments, et `confirmation`. L'outil relit tout, recalcule les deux empreintes, prend le jeton et le compare :

- **tout correspond** (même compte, même jeton MCP, même outil, mêmes arguments, même état, pas expiré, pas déjà utilisé) : l'outil écrit, une fois, et répond `done: true` ;
- **sinon** : rien n'est écrit, et la réponse (`done: false`) dit pourquoi : « Confirmation refusée : elle a expiré. » / « … elle a déjà servi. » / « … elle ne correspond pas à cette demande. » / « … elle est inconnue (le site a peut-être redémarré). » / « … la situation a changé depuis : … » (par exemple : un nouvel inscrit). Puis :
  - si la demande doit toujours être confirmée : **une nouvelle confirmation**, qui décrit la situation d'aujourd'hui, avec un nouveau jeton ;
  - sinon : « Cette demande n'a plus besoin de confirmation : rappelle-la sans confirmation. »

Une `confirmation` présentée est toujours prise et vérifiée : un assistant ne peut pas la réutiliser pour autre chose, ni la glisser dans une demande pour voir. Entre la seconde vérification et l'écriture, une autre personne peut encore changer la course : la fenêtre est de quelques millisecondes, comme entre deux onglets du site (§ 8.5).

## 7. Réglages : la section « Assistant IA »

Sur `/profil/reglages`, après « Agenda » (`McpSection`, dans `AppSections` de `SettingsPage`). Mêmes composants et mêmes styles que « Agenda » et « Mes clés d'accès » (Crête) : `Section`, `PRIMARY`, `SECONDARY`, `DANGER`, `READ_ONLY_INPUT`, lignes comme celles des clés d'accès, en clair, en sombre et en couleurs forcées.

**Textes** (le français ; l'anglais dans `en.ts`) :

- Titre : « Assistant IA (MCP) ».
- Introduction : « Un jeton laisse un assistant IA (Claude Code, Claude Desktop…) faire sur le site ce que tu y fais, en ton nom, sans l'ouvrir. Tout ce qu'il fait est signé de ton nom, et il te demande ton accord avant de supprimer quoi que ce soit. Il ne peut rien de plus que toi : l'administration seulement si tu es admin, et jamais ton mot de passe ni ton email. »
- Liste vide : « Aucun jeton pour l'instant. »
- Chaque jeton : son nom ; « Créé le 2 nov. » · « Utilisé le 3 nov. à 14:05 » ou « Jamais utilisé » ; un bouton « Révoquer » (texte rouge), nommé « Révoquer le jeton « Claude sur mon PC » » pour un lecteur d'écran.
- « Nouveau jeton » (principal). À cinq jetons, il laisse la place à : « Tu as déjà 5 jetons : révoque-en un pour en créer un autre. »

**Créer** : « Nouveau jeton » ouvre une fenêtre (`<dialog>` de `components/Dialog`) :

1. « Nom du jeton », avec l'aide « Pour le reconnaître : « Claude sur mon PC », par exemple. », et « Créer le jeton ». Une erreur (nom vide, limite) s'affiche dans la fenêtre (`role="alert"`) et garde ce qui est tapé.
2. Une fois créé, la même fenêtre montre :
   - « Copie ce jeton maintenant : il ne sera plus jamais affiché. » ;
   - le jeton dans un champ en lecture seule, qui prend le focus, sélectionné, et « Copier le jeton » ;
   - « Pour Claude Code, lance cette commande dans un terminal : », la commande dans un champ multiligne en lecture seule (police à chasse fixe, le texte passe à la ligne) et « Copier la commande » :

     ```
     claude mcp add --transport http --scope user prends-ton-dossard https://prends-ton-dossard.ketra.fr/mcp --header "Authorization: Bearer ptd_…"
     ```

     `--scope user` : le jeton va dans la configuration de l'utilisateur (`~/.claude.json`), jamais dans le `.mcp.json` d'un projet, qui finit souvent dans un dépôt ;
   - « Pour un autre assistant : l'adresse est https://…/mcp, avec l'en-tête Authorization: Bearer suivi du jeton. Le README du site explique Claude Desktop. » ;
   - « J'ai copié le jeton », qui ferme.
3. Copier : « Jeton copié. » / « Commande copiée. » (notification, et le texte dans une ligne `role="status"` de la fenêtre, décision 21 de la v1). Si le navigateur ne peut pas copier, le texte est sélectionné pour une copie à la main.

**Le jeton ne vit que dans la fenêtre** : il est dans l'état du composant, jamais dans le cache de TanStack Query (la mutation a `gcTime: 0` et est remise à zéro à la fermeture ; la liste reçoit le nouveau jeton sans son secret). Fermer la fenêtre, par le bouton ou par Échap, l'efface.

**Révoquer** : « Révoquer » ouvre une confirmation : titre « Révoquer le jeton ? », texte « L'assistant qui utilise « Claude sur mon PC » n'aura plus accès au site. », « Annuler » et « Révoquer » (danger). Puis la notification « Jeton révoqué. » ; le titre de la section prend le focus (le bouton n'existe plus).

**Accessibilité** (règles de la maison) : cibles de 44 px ; boutons d'envoi en `aria-disabled` avec une garde synchrone, jamais `disabled` ; le focus ne tombe jamais sur `<body>` ; la fenêtre rend le focus au bouton qui l'a ouverte, ou au titre de la section s'il n'existe plus.

**Démo** : `GET /api/app/mcp-tokens` y répond 404 ; la section ne s'affiche pas.

## 8. Sécurité

### 8.1 La démo

Sur une instance de démo (`DEMO_LOGIN_EMAIL` défini), **le serveur MCP est absent** (choix de l'utilisateur) : ni `/mcp`, ni les routes des jetons, ni celle des envois (404), ni la section des Réglages. Le compte de démo est partagé par tous les visiteurs : chacun verrait et révoquerait les jetons des autres, et un jeton y donnerait un accès durable au compte, hors du bouton « Entrer dans la démo » et de sa limite de requêtes. Les hooks de la table restent (ils ne coûtent rien).

### 8.2 Ce qui n'est jamais exposé

- **Les emails** : aucun outil ne donne un email. Les outils de membre ne lisent pas `users` ; un coureur y est donné par son nom et `has_account`, jamais par l'identifiant de son compte. `admin_list_members` lit les comptes par la même requête que la page Membres, mais n'en garde que le rôle et l'état (§ 6.11).
- **Les mots de passe** : aucun outil n'en demande ni n'en change (§ 10).
- **Les jetons MCP** : le sien n'apparaît qu'une fois, dans Réglages ; `mcp_tokens` ne liste que des noms et des dates ; ceux des autres jamais (règles `null`, routes limitées à l'appelant) ; aucune empreinte dans une réponse.
- **Les clés d'accès** : leurs données d'identification jamais (champ caché du site) ; leur nom et leur dernière utilisation à leur propriétaire, et à un admin, comme le site.
- **Le lien d'agenda** (qui contient son jeton) : seulement à son propriétaire, comme « Afficher le lien » du site (`calendar_link`).
- **Les liens d'invitation et de réinitialisation** : seulement dans la réponse de `admin_create_link`, à un admin, comme la page Membres les lui montre ; `admin_list_members` donne les liens en attente sans leur jeton (le site ne garde que l'empreinte).
- **Le jeton de session interne** (§ 5.1) : en mémoire, 60 secondes, jamais renvoyé.
- **Les jetons de confirmation et les secrets d'envoi** : en mémoire, 10 minutes, une fois ; liés au jeton MCP qui les a demandés ; le secret d'envoi voyage dans un en-tête, jamais dans une URL.
- Un test vérifie que les réponses des outils de lecture, `admin_list_members` compris, ne contiennent ni `@`, ni `email`, ni `token_hash`, ni `credential`, ni `user` comme champ d'un coureur.

### 8.3 Caddy

**Rien à changer.** `reverse_proxy` transmet tous les chemins, dont `/mcp` et `/api/app/mcp-uploads`, et les en-têtes `Authorization` et `X-Upload-Secret` ; `encode zstd gzip` compresse des réponses JSON (aucun flux SSE, § 3.3) ; le blocage `@pbadmin` ne touche pas ces chemins ; Caddy ne limite pas la taille d'un corps par défaut (le programme le fait, § 6.9). Le programme se fie déjà à `X-Forwarded-For` (migration 6) : les limites par adresse marchent pour `/mcp` comme pour le reste. Si un jour Caddy journalise les accès, il masque `Authorization` par défaut ; `X-Upload-Secret` ne vit que 10 minutes et ne sert qu'une fois.

### 8.4 Traces

- **`last_used_at`** de chaque jeton, visible dans Réglages et par `mcp_tokens` (§ 4.3).
- **Le journal des requêtes de PocketBase** (5 jours, tableau de bord par le tunnel SSH) :
  - chaque `POST /mcp`, attribué au compte (`e.Auth`), avec dans `meta` l'identifiant du jeton, celui du compte, les outils appelés, et pour chacun s'il a demandé une confirmation ou en a utilisé une (`apis.RequestEventKeyLogMeta`) ;
  - chaque requête interne, avec l'agent `prends-ton-dossard-mcp` ;
  - chaque `PUT /api/app/mcp-uploads/{id}`, sans le secret.
- **Dans le site**, ce que fait l'assistant porte le nom de la personne, comme si elle l'avait fait : `created_by` d'une course, `added_by` d'une participation ou d'une place, `author` d'un commentaire, `owner` d'une offre.
- **Pas d'historique par course** : le site n'en a pas, et ce n'est pas au serveur MCP d'en créer un. Pas de marque « via un assistant » sur les enregistrements non plus (§ 11.2).

### 8.5 Le reste

- **CORS** : le programme garde le CORS par défaut de PocketBase. Un jeton n'est pas un identifiant « ambiant » (cookie) qu'un site tiers pourrait faire envoyer par un navigateur : il faudrait le connaître.
- **Taille** : le corps d'une requête `/mcp` est limité à 1 Mio (§ 3.3), un envoi à 5 ou 10 Mo (§ 6.9).
- **Mémoire** : confirmations (1 000 au plus) et envois (64 Mo au plus), tous de 10 minutes.
- **Concurrence** : deux assistants qui modifient la même course au même moment peuvent s'écraser (lecture, puis écriture), comme deux onglets du site. Les épreuves qu'un outil ne change pas ne sont pas renvoyées (§ 6.5), et une confirmation est refusée si l'état a changé entre les deux appels (§ 6.13).

## 9. Tests

- **Serveur** (`go test`, avec `testutil`) :
  - migration 9k : table, champs cachés, règles `null`, index, règle `/mcp` de 1 500 par minute, que `FindRateLimitRule` retrouve ; retour arrière puis réapplication ;
  - jetons : forme, empreinte seule, comparaison, identifiant inconnu, mauvais secret, en-tête mal formé, jeton de session refusé, compte désactivé, cinquième et sixième jeton, nom vide ou trop long, révocation immédiate, jetons supprimés à la désactivation, routes réservées à l'appelant, liste sans secret, absentes sur la démo ;
  - `/mcp` : 401 et son en-tête, `GET` et `DELETE` en 405, `initialize`, `tools/list` et leurs annotations, 300 requêtes par minute et par jeton (la 301e en 429, un autre jeton passe), `last_used_at` au plus une fois par minute, jeton absent du journal (niveau Debug), `meta` du journal, absent sur la démo, `/.well-known/…` en 404 JSON ;
  - outils selon le rôle : le `tools/list` d'un membre a les trente-deux outils de membre et aucun outil `admin_…` ; celui d'un admin les quarante-trois ; un membre qui appelle un outil d'admin reçoit exactement la réponse d'un outil qui n'existe pas (`-32602`, `unknown tool "…"`), et rien n'est écrit ; un admin rétrogradé perd ces outils à la requête suivante, un membre promu les gagne ; chaque outil d'admin refuse aussi un appelant qui n'est pas admin ;
  - requête interne : règles et hooks de requête appliqués (`added_by`, `confirmed`, `created_by`, `author`, `owner`), refus d'une règle, adresse du client transmise, fichier en `multipart` ;
  - le paquet `mcp` n'écrit jamais lui-même (lecture de ses sources) ;
  - chaque outil : cas nominaux, refus du site traduits, refus propres à l'outil, droits du propriétaire du jeton (un membre, un autre membre, l'auteur ou le propriétaire, un admin), chacun obtenant ce que le site lui donne ;
  - confirmations : chaque ligne du tableau du § 6.13 ne fait rien au premier appel et le décrit ; avec le bon jeton, l'écriture a lieu une fois ; un jeton réutilisé, expiré, d'un autre outil, d'autres arguments, d'un autre jeton MCP ou d'un autre compte est refusé, sans rien écrire, avec une nouvelle confirmation ; un état qui a changé (un nouvel inscrit) fait refuser le jeton et décrit le nouvel état ; « bob » et l'id de Bob sont la même demande ; les demandes sans risque se font au premier appel ; le magasin des confirmations (expiration, une fois, plafonds) ;
  - envois : un emplacement par jeton et par usage, le secret dans l'en-tête, 5 et 10 Mo, le type, une fois, 10 minutes, deux par jeton, 64 Mo en tout, jamais le secret dans le journal ; la base64 de 512 Ko ; une photo et une trace arrivées par les deux chemins ; une trace sans déclaration XML acceptée ; un fichier qui n'est pas une trace refusé sans rien envoyer ; les chiffres d'une trace ceux du site (les cas de `gpx.test.ts`, portés en Go) ;
  - lectures : l'accueil, la page d'un coureur et les statistiques donnent ce que donnent les blocs et les pages du site (les cas de `pending.test.ts`, `registrationTodo.test.ts`, `resultsToEnter.test.ts`, `stats.test.ts`, portés en Go) ;
  - date de fin et ordre du batch : les cas de `saveEvent.test.ts` (`buildBatch`) et de `formDraft.test.ts` (`eventEndDate`), portés en Go ; une épreuve gardée qui ne change pas n'est pas envoyée ; une course déplacée avec ses épreuves datées en un appel.
- **Front** (Vitest) : la section « Assistant IA » (liste, création montrée une fois, copie du jeton et de la commande, fermeture qui efface le jeton, limite, révocation et focus, absente en démo) ; la commande de Claude Code ; les nouveaux codes d'erreur traduits.
- **De bout en bout** : un vrai client MCP (le client du SDK Go, `tools/mcpcheck`) contre le programme lancé en local sur le port 8090, base remplie par `seed`, en membre puis en admin, confirmations et envois de fichiers compris.

## 10. Hors de cette version

Ce que le site permet mais qui reste sans outil, et pourquoi :

- **Changer son email ou son mot de passe** : le site demande le mot de passe actuel, qui ne doit jamais passer par un assistant.
- **Créer une clé d'accès** : il faut l'appareil (WebAuthn), dans le navigateur.
- **Créer un jeton MCP** : un jeton ne fabrique pas un autre jeton, dont le secret passerait par l'assistant ; cela se fait dans Réglages.
- **Choisir le thème** : depuis la 9j, le thème (l'habillage) est gardé sur le compte (`users.skin`), mais il se choisit dans la liste des thèmes de la version de l'appli, que le serveur ne connaît pas (il ne vérifie que la forme d'un identifiant) et qu'un assistant ne peut pas connaître. Le mode clair ou sombre reste celui de l'appareil.
- **Installer l'appli, se déconnecter, entrer dans la démo** : ce sont des réglages de l'appareil ou du navigateur, pas du site.
- **Télécharger le fichier `.ics` d'une course, la carte, le profil du D+** : le navigateur les fabrique ; l'assistant a le lien d'agenda, la fiche et les chiffres de la trace.
- **Le reste de ce que le site ne fait pas** : créer un compte directement ou choisir le mot de passe d'un autre (une invitation ou un lien de réinitialisation, que la personne ouvre) ; `bootstrap-admin`, `seed` et le tableau de bord de PocketBase (la ligne de commande et le super-admin restent hors du site).
- **OAuth 2.1** (connexion de l'assistant par le site, sans jeton à copier) : il le faudrait pour les connecteurs distants de claude.ai et de Claude Desktop, qui ne prennent pas d'en-tête fixe. En attendant, Claude Desktop passe par le pont `mcp-remote` (README).
- **Ressources et invites MCP** (`resources/*`, `prompts/*`), et l'« élicitation » du protocole (le serveur qui pose lui-même la question à la personne) : les confirmations passent par l'assistant (§ 6.13), que tous les clients savent faire.
- **Jetons limités** (lecture seule, une partie des outils) et **expiration** des jetons.
- **Notifications** au coureur qu'on ajoute : il le voit dans « À confirmer », comme aujourd'hui.

## 11. Décisions

### 11.1 Tranché par toi

1. **Droits** : le serveur MCP fait exactement ce que le site permet au propriétaire du jeton ; c'est un autre point d'entrée, pas d'autres droits. Les refus viennent de l'API, enregistrement par enregistrement.
2. **Tout le site** : chaque action que le site permet a son outil (§ 6.3), sauf celles du § 10.
3. **Administration** : le jeton d'un admin a aussi les onze outils d'admin (la partie Admin du site) ; le jeton d'un membre ne les voit pas, et les appeler répond comme un outil inconnu. Le rôle est relu à chaque requête.
4. **Jetons sans expiration**, cinq par compte, dernière utilisation affichée, supprimés quand le compte est désactivé (une réinitialisation du mot de passe les garde).
5. **300 requêtes par minute et par jeton.**
6. **Confirmation** des demandes qui suppriment ou effacent, par un jeton de confirmation renvoyé au second appel (§ 6.13) ; côté admin : fusions, désactivation, changement de rôle, suppressions.
7. **Pas de MCP sur la démo.**

### 11.2 À valider

Ce que ni tes réponses ni le code ne tranchaient ; dis lesquelles revoir, par leur numéro.

1. **Branche** : le travail part de `feat/v1` (ce qui est en production, la v6 et ses thèmes compris depuis la fusion 52be590), dans un worktree à part (`feat/mcp`).
2. **SDK officiel** v1.8.0, avec ses cinq modules, plutôt qu'un serveur JSON-RPC écrit à la main.
3. **Sans état, réponses JSON** : pas de session du protocole, pas de flux SSE, rien que le serveur pousse vers l'assistant.
4. **Jeton montré une seule fois** (pas comme le lien d'agenda, qu'on peut réafficher).
5. **Ce qui demande une confirmation** (tableau du § 6.13) : en plus de tes cas (inscrits, retrait, doublon, fusions, désactivation, rôle, type supprimé), toute suppression, vider un champ rempli, remplacer des notes, un résultat, une photo ou une trace, raccourcir une course, changer le jour d'une épreuve qui a des participants, toucher à la participation, à la photo ou à l'offre d'un autre, libérer une place, remplacer ou supprimer le lien d'agenda, révoquer un jeton, les liens d'invitation et de réinitialisation. **Pas** pour remplacer une valeur par une autre, modifier son propre commentaire, ni réactiver un compte.
6. **Confirmations et envois en mémoire**, 10 minutes, une fois, liés au jeton MCP qui les a demandés : un redémarrage les perd (l'assistant recommence).
7. **Limite** : 300 par minute et par jeton, comptée par le programme, et aussi 1 500 par minute et par adresse, un filet pour les requêtes sans jeton valide ; les limites du site restent pour les requêtes internes.
8. **Noms des outils en anglais**, titres, descriptions et messages **en français seulement** (l'assistant du membre anglophone traduit).
9. **Encore plus strict que le site, sans confirmation possible** : la dernière épreuve d'une course ne se supprime pas (comme dans le formulaire) ; pas de « format à choisir » sur une course à une épreuve ; statut toujours explicite ; 20 épreuves au plus par course.
10. **La date de fin suit les épreuves à chaque modification**, comme le formulaire ; quand cela raccourcit une vieille course de plusieurs jours, c'est une confirmation.
11. **Traces** : `last_used_at` et le journal des requêtes de PocketBase (5 jours) ; pas d'historique par course, pas de marque « via un assistant » sur les enregistrements.
12. **Liste des jetons réservée à leur propriétaire** : un admin ne voit pas ceux des autres (pas comme les clés d'accès) ; il désactive le compte.
13. **Section « Assistant IA (MCP) »** de Réglages, après « Agenda », avec la commande `claude mcp add … --scope user` toute prête.
14. **Coureurs et types donnés par id ou par nom**, pour épargner des appels à l'assistant.
15. **Pas d'email** dans `admin_list_members`, alors que la page Membres le montre à un admin : aucune action n'en a besoin, et il partirait chez le fournisseur de l'assistant.
16. **Liens rendus à l'assistant** : les liens d'invitation et de réinitialisation à celui d'un admin, le lien d'agenda à celui de son propriétaire, comme le site les leur montre ; ils passent donc par le fournisseur de l'assistant. On peut réserver la réinitialisation et le lien d'agenda au site.
17. **Fichiers** : par un envoi en deux temps (`start_upload` puis une commande `curl`) ou en base64 jusqu'à 512 Ko ; la photo n'est pas réduite comme le fait le navigateur (elle reste dans les 5 Mo du site) ; aucun fichier n'est récupéré par le serveur à une adresse web (pas de requête sortante, rien à protéger contre un détournement).
18. **Pas de création de jeton MCP, de changement d'email ni de mot de passe** par un assistant (§ 10).
19. **Outils groupés** : `passkeys`, `calendar_link` et `mcp_tokens` en un outil chacun avec une `action`, `offer_place` pour prendre et libérer, `admin_merge` pour les courses et les épreuves, `admin_create_link` pour les invitations et les réinitialisations ; `rename_runner`, `set_photo` et `passkeys` sont des outils de membre qu'un admin utilise aussi sur les autres. Quarante-trois outils pour un admin, trente-deux pour un membre.
