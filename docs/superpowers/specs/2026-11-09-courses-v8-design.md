# « Prends ton dossard » v8 : une invitation qui donne envie

- **Date** : 2026-11-09
- **Statut** : design écrit d'après la conversation du 2026-11-09 avec l'utilisateur (ses réponses aux questions et son accord sur chaque section). Ce qui reste à trancher est au § 13.
- **Auteur** : Guillaume (avec Claude)
- **Base** : la spec v1 et ses addendums (v1.1 à v7), et la spec du MCP (`2026-11-03-courses-mcp-design.md`). Ce document ne décrit que ce qui change. En cas de conflit, il l'emporte.

## 1. Objectif

Le 2026-11-09, sur la production, cinq invitations envoyées une semaine plus tôt expirent sans avoir servi. Sur seize coureurs, quatre ont un compte. Ce qu'une personne invitée voit en ouvrant son lien, c'est « Bienvenue Arnaud », un email, un mot de passe, sa confirmation et « Créer mon compte » : rien ne dit qui l'invite, à quoi sert le site, ni qu'elle a déjà des courses prévues avec le groupe (deux des invités en ont huit chacun).

La demande, dans la conversation : « Je te propose une page d'invitation qui donne envie ? » — « Oui, propose ».

Les réponses de l'utilisateur :

- **Ce que montre la page** : ses courses et celles du groupe (« Ses courses + le groupe »), puis, après avoir vu les deux maquettes, **le détail** plutôt qu'un résumé chiffré.
- **Le contenu est calculé à chaque ouverture** du lien, rien n'est enregistré dans l'invitation (« les courses de l'invité et le groupe devraient être dynamiques et chargés à la lecture »).
- **La création du compte ne change pas** : pas de compte créé avec une clé d'accès, parce qu'on la perd en changeant de téléphone ou en passant sur un ordinateur, et que tout le monde n'a pas un gestionnaire de mots de passe synchronisé.
- **Le partage depuis l'admin** propose **le message prêt ou le lien seul**, au choix (« les deux, je choisirai en fonction des envies »). Le MCP renvoie les deux.
- **La durée des liens** : **30 jours pour une invitation**, 7 jours inchangés pour une réinitialisation.
- **L'approche** : enrichir les routes existantes (approche A), plutôt qu'écrire le message dans le front et à part dans le MCP, ou ajouter une route d'aperçu séparée.

La v8 est réussie si :

- une personne qui ouvre son lien voit en quelques secondes qui l'invite, ce qu'est le site, ses prochaines courses avec les amis qui y vont, et ce que prépare le groupe ;
- ce qu'elle voit est toujours à jour : une course ajoutée après la création du lien y apparaît ;
- l'admin envoie, au choix, un message qui donne envie ou le lien seul, depuis le site comme depuis l'assistant ;
- une invitation laisse 30 jours pour être ouverte ;
- la page ne montre rien de plus que ce que le lien donne déjà (l'accès au site), et rien du tout pour un lien invalide, expiré ou utilisé.

## 2. Périmètre

### Dans cette version

1. La durée des liens selon leur genre (§ 3).
2. L'aperçu renvoyé par la route publique `lookup` pour une invitation (§ 4).
3. La page d'invitation qui l'affiche (§ 5).
4. Le message prêt, écrit par le serveur à la création d'une invitation (§ 6).
5. Le choix « Le message » / « Le lien seul » dans la fenêtre de partage de l'admin (§ 7).
6. Le champ `message` de l'outil MCP `admin_create_link`, et sa description (§ 8).

Aucune migration : la durée est une constante du code, et l'aperçu se calcule depuis les tables existantes. Aucune dépendance nouvelle.

### Hors de cette version

Voir § 12.

## 3. La durée des liens

- Une invitation (`invite`) vaut **30 jours** à partir de sa création, à la seconde près.
- Une réinitialisation (`reset`) vaut toujours **7 jours**.
- Les liens créés avant la v8 gardent leur date d'expiration (`expires_at` est enregistrée à la création) : seuls les nouveaux liens ont 30 jours.
- Ce qui dit la durée suit :
  - la description de l'outil MCP `admin_create_link` et de son champ `expires_at` (§ 8) ;
  - la spec v1 § 5.2 et le plan v1 parlent de 7 jours : ce document l'emporte pour l'invitation.
- Rien d'autre ne change : un lien ne sert qu'une fois, un nouveau lien du même genre remplace celui qui attendait, l'admin peut le révoquer.

**Pourquoi 30 jours.** Le risque réel, dans un groupe d'amis, est la personne qui ouvre son lien le neuvième jour et tombe sur « Ce lien a expiré », au moment où elle était enfin décidée. Un lien volé est peu probable : le jeton fait 32 octets aléatoires, il ne sert qu'une fois, la personne invitée voit tout de suite qu'il a servi (« déjà utilisé ») et l'admin voit le compte créé. Une réinitialisation garde 7 jours : elle donne l'accès à un compte qui existe, avec son historique, et la personne qui l'attend l'ouvre tout de suite.

## 4. L'aperçu d'une invitation (`POST /api/app/invitations/lookup`)

### 4.1 La requête et la réponse

- **La requête** : `{ "token": "…", "lang": "fr" }`. `lang` est facultatif : `en` donne les noms d'épreuves générés en anglais, toute autre valeur (ou rien) en français. Seuls ces deux champs sont lus.
- **Une réinitialisation** répond exactement comme aujourd'hui : `{ "runnerName", "kind" }`, sans autre clé.
- **Une invitation** répond :

```json
{
  "runnerName": "Arnaud Hildenbrand",
  "kind": "invite",
  "invitedBy": "Guillaume Pierson",
  "upcoming": {
    "total": 8,
    "races": [
      {
        "event": "Trail des Crêtes",
        "location": "Annecy",
        "day": "2026-11-14",
        "monthOnly": false,
        "formats": ["Trail long"],
        "people": ["Anne Mangeolle", "Maxime Richard", "Violaine Sourisse"],
        "morePeople": 1
      }
    ]
  },
  "group": [
    {
      "event": "6 heures de la Doua",
      "location": "Villeurbanne",
      "day": "2026-12-14",
      "monthOnly": false,
      "people": ["Anne Mangeolle", "Guillaume Pierson"],
      "morePeople": 0
    }
  ]
}
```

- **Un lien invalide, expiré ou déjà utilisé** répond toujours `404 invitation_invalid`, sans aucune donnée.
- **Tout est calculé à chaque appel**, depuis la base telle qu'elle est, avec le jour de Paris au moment de l'appel. Rien n'est enregistré dans l'invitation.
- **Si le calcul de l'aperçu échoue** (une erreur de la base), la route le note dans le journal du serveur (jamais le jeton) et répond comme pour une invitation sans aperçu, `{ "runnerName", "kind" }` : la personne peut toujours créer son compte. (Ajouté après la relecture finale.)

### 4.2 Les règles

- **`invitedBy`** : le nom du coureur rattaché au compte qui a créé l'invitation (`invitations.created_by` → `runners.user`). `null` quand l'invitation vient de la ligne de commande (`bootstrap-admin`), ou quand ce compte n'a plus de coureur.
- **`upcoming.races`** : les courses du coureur invité qui sont à venir, avec la règle de « Mes prochaines courses » (`upcomingOf`, spec v7 § 5.3) :
  - pas les participations `dns` ;
  - une participation sur une épreuve est passée après le jour de son épreuve ; une participation sur la course seule (intéressé sans épreuve, ou supporter) reste jusqu'au dernier jour de la course ; une course connue seulement par son mois reste jusqu'à la fin de son mois ;
  - les participations non confirmées comptent comme les autres : c'est souvent l'admin qui les a ajoutées ;
  - **une ligne par course** : deux épreuves d'une même course font une seule ligne, avec les deux noms dans `formats` ;
  - triées comme « Mes prochaines courses » (le jour qui compte, puis les courses au mois à la fin de leur mois, puis le nom) ;
  - **les 3 premières** seulement.
- **`upcoming.total`** : le nombre de lignes avant la coupe à 3.
- **`group`** : les courses de « Bientôt dans le groupe » sur l'accueil (même règle, `hasStarters` : quelqu'un y prend le départ d'une épreuve, ou y est intéressé sans épreuve ; une course où il n'y a que des supporters n'en est pas une ; même ordre), **sans celles où le coureur invité a une participation** (même `dns`), **les 3 premières**.
- **Les champs d'une ligne** :
  - `event`, `location` : le nom et le lieu de la course ;
  - `day` : le jour de la ligne, `YYYY-MM-DD`. Pour une ligne de `upcoming`, le jour de l'épreuve la plus proche du coureur parmi celles qui ne sont pas passées (date effective : `format.date ?? event.start_date`), ou le premier jour de la course pour une participation sans épreuve. Pour une ligne de `group`, le premier jour de la course. Pour une course au mois, le premier jour de son mois. Le jour peut donc être passé pour une course de plusieurs jours déjà commencée (§ 5.2) ;
  - `monthOnly` : `true` pour une course connue seulement par son mois ;
  - `formats` (dans `upcoming` seulement) : les noms des épreuves du coureur sur cette course qui ne sont pas passées (comme `day` ; précisé pendant la réalisation), comme le site les nomme (`wording.RaceName`, dans la langue de `lang`), dans l'ordre de leurs jours ; vide pour une participation sans épreuve ;
  - `people` : les autres coureurs qui ont une participation autre que `dns` sur cette course (supporters compris), **sans le coureur invité**, triés par nom comme sur le site, **3 au plus**, les noms tels qu'ils sont enregistrés ;
  - `morePeople` : le nombre de ces coureurs au-delà des 3.

### 4.3 Ce qui ne sort jamais

L'aperçu ne contient que : des noms de courses, des lieux, des jours, des noms d'épreuves et des noms de coureurs, plus le nom de l'auteur de l'invitation. **Jamais** :

- d'identifiant (de course, de coureur, de compte) ;
- les notes d'une course, son lien d'inscription, ses prix, ses dates limites ou d'ouverture ;
- les commentaires, le covoiturage, le logement, les photos, les traces, la météo ;
- les statuts des participations (inscrit, intéressé…), les résultats ;
- un email, un rôle, l'état d'un compte.

### 4.4 L'exception à la règle de lecture

La spec v1 § 6.1 dit : « Hors invitation et réinitialisation, seuls les utilisateurs connectés peuvent lire ou écrire quoi que ce soit. » La v8 ajoute, pour la personne qui a un lien d'invitation valide, la lecture de l'aperçu ci-dessus.

**Pourquoi c'est acceptable.** Ce lien permet déjà de créer le compte et de tout lire. L'aperçu en montre une petite partie, à la même personne, tant que le lien est valide. La différence est qu'ouvrir le lien ne le consomme pas : un lien transféré à quelqu'un d'autre montre l'aperçu à cette personne. Mais elle pourrait tout aussi bien créer le compte.

### 4.5 Sécurité

- La route reste publique, sous la règle de débit existante (`/api/app/invitations/`, 10 requêtes par minute).
- Le corps de la requête reste borné, et seuls `token` et `lang` sont lus.
- Le jeton se cherche comme aujourd'hui (son SHA-256), et l'erreur reste la même pour un jeton inconnu, expiré ou utilisé : rien ne permet de les distinguer.
- Un test vérifie la liste exacte des clés de la réponse (§ 10).

## 5. La page d'invitation

La page garde son cadre (la carte sur le fond, comme la page de connexion) et son formulaire. Elle appelle `lookup` avec `lang` = la langue de l'interface. Pour une **invitation** :

> **Allégée après l'essai sur dev** (2026-11-09) : « la page d'invitation est trop lourde, elle est beaucoup trop grande ». L'utilisateur a choisi une **liste compacte** : plus de cartes, une ligne par course, le groupe en une phrase. La route `lookup` ne change pas : la page n'affiche plus `location` ni `formats`.

### 5.1 L'ordre

```
Guillaume Pierson t'invite
Le groupe prépare ses courses ici.

Tes prochaines courses (4)
 sam. 14 nov.   Trail des Crêtes
                avec Anne Mangeolle, Maxime Richard +2
 dim. 29 nov.   Backyard des Aiguilles
                avec Alice, Bob
 lun. 14 déc.   6 heures de la Doua
 et 1 autre

Le groupe va aussi à Hyrox Lyon (18 janv.).

[formulaire]
```

1. **Le titre** (`<h1>`) :
   - avec un auteur : « Guillaume Pierson t'invite » / « Guillaume Pierson invited you » ;
   - sans auteur : le titre d'aujourd'hui, « Bienvenue Arnaud Hildenbrand » / « Welcome Arnaud Hildenbrand ».
2. **La phrase** sous le titre, la même avec ou sans auteur : « Le groupe prépare ses courses ici. » / « The group plans its races here. »
3. **Ses courses** (`<h2>`) : « Tes prochaines courses (8) » / « Your next races (8) », puis la liste des lignes de `upcoming.races`. Quand `total` dépasse 3, une ligne après la liste : « et 1 autre » / « and 1 more », « et 5 autres » / « and 5 more ».
4. **Le groupe, en une phrase** (un `<p>`) : les courses de `group` jointes avec `Intl.ListFormat` (conjonction, langue de l'interface), chacune « Nom (date) », la date en jour et mois (« 18 janv. »), ou le mois et l'année pour une course au mois (« juin 2027 ») :
   - avec des courses à lui : « Le groupe va aussi à Hyrox Lyon (18 janv.), 6 heures de la Doua (14 déc.) et Trail du Vercors (juin 2027). » / « The group is also going to … » ;
   - sans course à lui : « Le groupe va à … » / « The group is going to … ».
5. **Le formulaire**, inchangé : email, mot de passe, confirmation, « Créer mon compte ». Après la création, l'accueil, comme aujourd'hui.

### 5.2 Une ligne

- **La date**, dans une colonne de largeur fixe, en texte discret : le format court du site (`f.date`, « sam. 14 nov. ») ; une course au mois : le mois et l'année (« juin 2027 »). Pas de compte à rebours.
- **Le nom** de la course.
- **Les personnes**, sous le nom, en petit et discret : « avec » / « with », les noms séparés par des virgules, puis « +1 » quand `morePeople` > 0. Pas de ligne quand `people` est vide.
- Ni lieu, ni épreuve, ni carte : une simple liste.
- **Les lignes ne sont pas des liens** : la page d'une course demande un compte.

### 5.3 Les cas particuliers

- **`upcoming.total` = 0 et `group` non vide** : pas de bloc 3, et la phrase du groupe dit « Le groupe va à … ».
- **`group` vide** : pas de phrase.
- **Les deux vides** : le titre, la phrase et le formulaire.
- **Une réinitialisation** : la page ne change pas.
- **Un lien invalide, expiré ou utilisé** : le message d'aujourd'hui (« Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau à l'admin. »).
- **Le chargement et l'erreur réseau** : comme aujourd'hui (« Chargement… », puis l'erreur et « Réessayer »).

### 5.4 Accessibilité

- Ses courses sont une `<section>` titrée par son `<h2>` (`aria-labelledby`), et ses lignes une liste (`<ul>`). La phrase du groupe est un paragraphe.
- Le focus va au `<h1>` à l'arrivée, comme aujourd'hui.
- « +1 » est du texte, lu tel quel ; rien n'est dit par la couleur seule.

## 6. Le message prêt

### 6.1 La route de création

- `POST /api/app/invitations` accepte un champ facultatif `lang` : `en` pour l'anglais, toute autre valeur (ou rien) pour le français. Le site envoie la langue de l'interface. Le MCP envoie `fr`.
- Pour une **invitation**, la réponse devient `{ "url", "expiresAt", "message" }`. Pour une **réinitialisation**, elle reste `{ "url", "expiresAt" }`.
- Le message s'écrit **à la création**, avec l'aperçu du coureur à ce moment-là (§ 4.2 : `invitedBy`, `upcoming.total` et la première ligne). Il ne change plus ensuite : c'est un texte que l'admin envoie.
- Il est écrit par le paquet `server/wording`, comme les autres textes lus hors du site.
- **Si l'aperçu ne peut pas être calculé** à la création (une erreur de la base, après l'enregistrement de l'invitation), la route le note dans le journal (jamais le lien ni le message) et répond `{ "url", "expiresAt" }` sans message : le lien n'est pas perdu, et la fenêtre de partage comme le MCP montrent alors le lien seul. (Ajouté après la relecture finale.)

### 6.2 Le texte, mot pour mot

Plusieurs courses (`total` ≥ 2) :

```
Salut Arnaud ! Guillaume t'invite sur Prends ton dossard, le site où on prépare nos courses. Tu as déjà 8 courses prévues avec nous, la prochaine : Trail des Crêtes, sam. 14 nov.

Crée ton compte ici, ce lien n'est que pour toi :
https://prends-ton-dossard.ketra.fr/invitation#…
```

```
Hi Arnaud! Guillaume invited you to Prends ton dossard, the site where we plan our races. You already have 8 races planned with us, the next one: Trail des Crêtes, Sat 14 Nov.

Create your account here, this link is just for you:
https://prends-ton-dossard.ketra.fr/invitation#…
```

- **Une seule course** : « Tu as déjà une course prévue avec nous : Trail des Crêtes, sam. 14 nov. » / « You already have one race planned with us: Trail des Crêtes, Sat 14 Nov. »
- **Aucune course** : la phrase disparaît ; le premier paragraphe s'arrête après « nos courses. » / « our races. »
- **La prochaine course au mois** : le mois et l'année à la place du jour, « Grand Trail du Vercors, juin 2027 » / « Grand Trail du Vercors, June 2027 ».
- **Les prénoms** : la salutation prend le premier mot du nom du coureur invité (« Arnaud » pour « Arnaud Hildenbrand »), et « Guillaume » le premier mot du nom du coureur de l'admin qui crée le lien (`invitedBy`, § 4.2). Un nom d'un seul mot est pris entier.
- **Sans coureur pour l'admin** (un compte qui n'en a plus) : « Salut Arnaud ! Voici ton invitation pour Prends ton dossard, le site où on prépare nos courses. » / « Hi Arnaud! Here's your invitation to Prends ton dossard, the site where we plan our races. »
- **La formule est neutre en genre** : « Guillaume t'invite », au présent, à la demande de l'utilisateur (« Guillaume t'a invité sur Prends ton dossard, le site… »), sans le participe : « t'a invité » s'accorderait avec le genre de la personne invitée, qu'on ne devine pas (CLAUDE.md § 2).
- **Pas de date d'expiration** dans le message, à la demande de l'utilisateur : la personne qui ouvre le lien crée son compte tout de suite. La date reste dans la fenêtre de partage de l'admin (§ 7).
- **Les formats de date** du serveur, écrits dans `wording` (le serveur n'a pas `Intl`) :
  - français : « sam. 14 nov. » ; jours `lun. mar. mer. jeu. ven. sam. dim.` ; mois `janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.` ; un mois avec son année : « juin 2027 » (mois en entier : `janvier` … `décembre`) ;
  - anglais : « Sat 14 Nov » ; jours `Mon Tue Wed Thu Fri Sat Sun` ; mois `Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec` ; un mois avec son année : « June 2027 » ;
  - dans les dates, des espaces ordinaires.
- **Les espaces insécables** : en français, une espace insécable (U+00A0) avant « ! » et « : », comme dans les textes du site (CLAUDE.md § 5) ; aucune en anglais.
- **Pas de mot relatif au jour** (« aujourd'hui », « demain », « dans 5 jours ») : le message est lu plus tard que sa création (CLAUDE.md § 5).
- **L'adresse** est l'`url` de la réponse, seule sur la dernière ligne.

## 7. La fenêtre de partage de l'admin

Pour une **invitation** (`ShareLinkDialog`), sous la phrase d'aujourd'hui (« Envoie ce lien à Arnaud Hildenbrand : il lui permet de créer son compte. »), **le message et le lien sont affichés tous les deux**, sans sélecteur (à la demande de l'utilisateur après l'essai sur dev : « pas besoin de faire un sélecteur pour le message, affiche les deux directement ») :

1. **Le message** : un champ multiligne en lecture seule « Message » / « Message » avec le texte du § 6, qui se sélectionne en entier au focus, puis :
   - « Partager le message » / « Share the message », là où le navigateur a une feuille de partage (`navigator.canShare({ text: message })`) : `navigator.share({ title: shareSubject, text: message })`, l'adresse dans le texte (comme le partage d'une course, spec v7 § 8) ;
   - « Copier le message » / « Copy the message ».
2. **Le lien** : le champ « Lien » d'aujourd'hui, puis :
   - « Partager le lien » / « Share the link », quand `navigator.canShare({ url })` : `navigator.share({ url, title })` ;
   - « Copier le lien » / « Copy the link ».
3. **La date et l'avertissement** d'aujourd'hui (« Valable jusqu'au … », « Ce lien ne sera plus affiché une fois cette fenêtre fermée : copie-le ou partage-le maintenant. »).

- **Un seul bouton principal** : « Partager le message » quand il est là, sinon « Copier le message ».
- **Les comptes rendus** (`<output>` et toast, comme aujourd'hui) : « Message copié. » / « Message copied. », « Lien copié. » / « Link copied. » ; en cas d'échec de la copie, « Copie impossible. Sélectionne le message et copie-le à la main. » / « Could not copy. Select the message and copy it by hand. », ou le texte d'aujourd'hui pour le lien ; en cas d'échec du partage, « Le partage a échoué. Copie le message à la place. » / « Sharing failed. Copy the message instead. », ou le texte d'aujourd'hui pour le lien. Une annulation (`AbortError`) ne fait rien.
- **Une réinitialisation**, ou une invitation sans message : la fenêtre d'avant la v8 (le lien, « Partager », « Copier »).

## 8. Le MCP

- `admin_create_link` renvoie, pour une invitation, un champ `message` en plus de `url` et `expires_at`. Sa description de schéma : « invite seulement : un message prêt à envoyer à la personne, qui contient le lien ; à ne transmettre qu'à elle, comme le lien ».
- Le résumé de la réponse dit à l'assistant de montrer le lien **et** le message, la personne choisissant lequel envoyer, et rappelle que le message contient le lien.
- La description de l'outil dit « Le lien vaut 30 jours pour une invitation, 7 jours pour une réinitialisation » à la place de « Le lien vaut 7 jours », et celle de `expires_at` « (30 jours pour une invitation, 7 jours pour une réinitialisation) ».
- L'outil passe toujours par la route du site (requête interne, spec MCP) : il envoie `lang: "fr"` et reprend `message` de la réponse.
- `admin_list_members` ne change pas.

## 9. Architecture

- **La règle des prochaines courses, partagée.** Elle existe en TypeScript (`web/src/features/home/MyUpcoming.tsx`) et recopiée en Go pour le MCP (`upcomingOf` et `participationRow.lastDay` dans `server/mcp/home.go`, surveillés par `ports_test.go`). Plutôt qu'une troisième copie, les règles des jours (le jour qui range une course, le dernier jour où une participation est à venir) passent dans le paquet `server/events`, qui a déjà `MonthOnly` et `LastDayOfMonth`, sous forme de deux fonctions sur des textes ; le MCP et l'invitation les appellent, et le MCP garde son tri. Les sommes SHA-256 de `ports_test.go` ne changent pas. (Précisé pendant le plan : un nouveau paquet aurait demandé de déplacer les types du MCP pour peu de gain.)
- **`server/invitations`** :
  - la durée devient fonction du genre (`invite` : 30 jours, `reset` : 7 jours) ;
  - une fonction calcule l'aperçu d'un coureur pour un jour de Paris donné ; `lookup` et la création du message l'appellent ;
  - `lookup` et la création lisent `lang`.
- **`server/wording`** : le message (§ 6.2) et les formats de date du serveur, en français et en anglais.
- **`server/mcp/admin_links.go`** : le champ `message`, la description, le résumé.
- **Le web** :
  - `features/auth/InvitationPage.tsx` : l'appel avec `lang`, les blocs et les lignes (un composant à part pour une ligne) ;
  - `features/admin/ShareLinkDialog.tsx`, `CreateLinkDialog.tsx` et `api.ts` : `lang` à la création, le choix et le message ;
  - `lib/types.ts` : les types de la réponse ;
  - `i18n/fr.ts` et `i18n/en.ts` : les textes des § 5 et 7.

## 10. Tests

Les tests suivent le CLAUDE.md (§ 4.6) : Go en tests externes avec une horloge qu'on règle ; web avec Vitest (`*.test.ts` pour la logique, `*.test.tsx` dans un vrai navigateur, Chromium sur ce PC).

**Go, `server/invitations`** :

- **La durée** : une invitation créée expire dans 30 jours (± 1 min), une réinitialisation dans 7 jours (± 1 min).
- **`lookup` d'une invitation** :
  - `invitedBy` vaut le nom du coureur de l'admin qui l'a créée ; `null` pour une invitation sans auteur ;
  - `upcoming` : l'ordre ; 3 lignes au plus et le bon total ; pas de `dns` ; rien de passé ; une course au mois gardée jusqu'à la fin de son mois ; une participation sans épreuve gardée jusqu'au dernier jour de la course ; une participation non confirmée comptée ; deux épreuves d'une course en une ligne, avec les deux noms ;
  - `day` : l'épreuve la plus proche, le premier jour sans épreuve, le premier jour du mois pour une course au mois ;
  - `people` : sans le coureur invité, sans `dns`, avec les supporters, triés, 3 au plus et `morePeople` ;
  - `day` d'une course de plusieurs jours déjà commencée : son premier jour, même passé ;
  - `group` : sans les courses de l'invité (même `dns`), sans les courses où personne ne va ni celles qui n'ont que des supporters, 3 au plus, dans l'ordre ;
  - le jour de Paris : un appel à 23 h 30 à Paris (22 h 30 UTC) et un autre à 0 h 30 voient la course du jour passer à la bonne heure ;
  - `lang: "en"` donne les noms d'épreuves générés en anglais.
- **Ce qui ne sort jamais** : une course avec des notes, un lien d'inscription, un prix, un commentaire, un covoiturage, et des comptes avec leurs emails, chacun avec un marqueur unique (« NOTE-SECRETE », etc.). La réponse ne contient aucun marqueur, aucun `@`, aucun identifiant d'enregistrement, et ses clés sont exactement celles du § 4.1.
- **Sans changement** : une réinitialisation répond exactement `{runnerName, kind}` ; un jeton inconnu, expiré ou utilisé répond `404 invitation_invalid` sans autre donnée.
- **Le message** :
  - présent pour une invitation, absent pour une réinitialisation ;
  - le texte exact du § 6.2, en français et en anglais, pour : plusieurs courses, une seule, aucune, une prochaine course au mois ;
  - les deux prénoms sur le premier mot de chaque nom, et un nom d'un seul mot ;
  - un admin sans coureur : « Voici ton invitation… » ;
  - aucune date d'expiration dans le texte ;
  - `lang` absent ou inconnu donne le français ;
  - le message finit par l'`url` de la réponse.
- **`server/wording`** : les formats de date (chaque jour, chaque mois, en français et en anglais).

**Go, `server/mcp`** (`package mcp_test`) : `admin_create_link` renvoie `message` pour une invitation et pas pour une réinitialisation ; `expires_at` à 30 jours pour une invitation ; la description dit 30 et 7 jours ; `ports_test.go` passe avec le nouveau fichier.

**Web** :

- `InvitationPage` :
  - le titre et la phrase, avec et sans auteur ;
  - une ligne : la date et le nom, « avec … +N » dessous, ni lieu, ni épreuve, ni compte à rebours ;
  - « Tes prochaines courses (8) », « et 5 autres », « et 1 autre » ;
  - la phrase du groupe avec une course, avec trois (« A (…), B (…) et C (…) »), sans course à lui (« Le groupe va à … »), absente quand `group` est vide ;
  - le cas sans aucune course ;
  - une course au mois (« juin 2027 ») ;
  - une ligne sans personne ;
  - aucune ligne n'est un lien ;
  - `lang` envoyé avec la langue de l'interface ;
  - la réinitialisation, le lien invalide et le formulaire comme avant (les tests existants passent).
- `ShareLinkDialog` :
  - pour une invitation, le message et le lien affichés ensemble ;
  - « Partager le message » envoie `{ title, text }`, « Partager le lien » `{ url, title }` ;
  - chaque bouton « Copier » copie son contenu, avec le bon compte rendu ;
  - un seul bouton principal ;
  - une annulation du partage ne fait rien ;
  - une réinitialisation garde la fenêtre d'avant.

**Avant la prod** : les vérifications complètes du CLAUDE.md (§ 3), puis un essai sur dev : créer une invitation pour un coureur de test qui a des courses, ouvrir le lien sur un téléphone, partager le message, créer le compte.

## 11. Déploiement

- Comme les versions précédentes : dev d'abord, la prod seulement après l'accord de l'utilisateur, avec une sauvegarde du volume `pb_data` avant.
- Aucune migration.
- La démo publique : elle n'a pas de compte admin utilisable (on y entre en tant qu'Alice, membre) ; la page d'invitation y marche comme ailleurs pour un lien valide, et aucune invitation n'y est créée.

## 12. Hors de cette version

- **Créer son compte avec une clé d'accès** : refusé (§ 1), une clé se perd en changeant de téléphone.
- **Un rappel automatique** d'une invitation pas encore ouverte : le site n'envoie pas d'email, et l'admin peut renvoyer le message.
- **Un aperçu (vignette) dans WhatsApp** : il faudrait une page publique signée (`docs/TODO.md`).
- **Un message prêt pour une réinitialisation** : pas demandé.
- **Une page « lien expiré » qui nomme l'auteur** : elle demanderait de répondre autre chose qu'un 404 pour un jeton expiré.
- **Le bandeau « Ajoute une clé d'accès »** de l'accueil, qu'un nouveau compte voit en premier : pas changé.
- **Une durée de lien réglable** dans l'admin : 30 jours pour tous.

## 13. Décisions à valider

Ce que ni tes réponses ni la conversation ne tranchaient ; dis lesquelles revoir, par leur numéro.

**L'aperçu**

1. **Les liens créés avant la v8 gardent leurs 7 jours** (pas de migration) : les cinq invitations qui expirent le 2026-11-09 ne sont pas prolongées.
2. **Les noms sont affichés tels qu'ils sont enregistrés** (nom complet) : « Guillaume Pierson t'invite », « avec Anne Mangeolle, Maxime Richard ».
3. **« avec … » compte les supporters**, pas les « non partant ».
4. **Le groupe** : les courses de « Bientôt dans le groupe » (une course où il n'y a que des supporters n'y est pas), sans celles où l'invité a une participation, même `dns`.
5. **3 lignes par bloc**, puis « et N autres » pour ses courses ; rien de plus pour le groupe.
6. **Une ligne par course**, ses épreuves regroupées ; son jour est celui de l'épreuve la plus proche, ou le premier jour de la course sans épreuve.
7. **Les participations non confirmées comptent** comme les autres, dans les lignes et dans le total.
8. **Ni statut ni prix** dans l'aperçu : seulement qui va, où et quand.

**La page**

9. **Les lignes ne sont pas des liens.**
10. **Pas de second bouton « Créer mon compte » en haut** : le formulaire reste en bas ; la liste compacte (après l'essai sur dev) le fait arriver presque tout de suite.

**Le message et le partage**

11. **Les prénoms du message sont le premier mot de chaque nom** (« Salut Arnaud ! Guillaume t'invite… ») ; l'admin relit le message avant de l'envoyer.
12. **L'anglais au format britannique** (« Sat 14 Nov ») ; une langue autre que `en` donne le français.
13. **Le message et le lien sont affichés ensemble** dans la fenêtre de partage, chacun avec ses boutons (après l'essai sur dev ; d'abord un choix « Le message » / « Le lien seul »).
14. **Pas de message pour une réinitialisation**, dont la fenêtre ne change pas.
15. **Le message est figé à la création**, la page est calculée à chaque ouverture.
