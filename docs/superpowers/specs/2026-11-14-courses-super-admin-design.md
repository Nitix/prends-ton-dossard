# Super admin : garder ses droits en donnant ceux d'admin

Date : 2026-11-14. Petit changement, design court.

## Pourquoi

La personne qui a créé le site veut pouvoir donner les droits d'admin à des amis sans risquer de perdre les siens. Aujourd'hui, tous les admins ont les mêmes pouvoirs. Un autre admin peut, contre son compte :

- lui retirer le rôle d'admin (la seule garde : il reste au moins un admin actif) ;
- désactiver son compte ;
- créer un lien de réinitialisation pour son compte, l'ouvrir et s'en emparer ;
- supprimer ses passkeys ;
- renommer son coureur ou changer sa photo.

Elle peut toujours se rattraper depuis le serveur (`bootstrap-admin --force`), mais c'est pénible et ne protège pas d'une prise de compte.

## Objectifs

- Un compte marqué « super admin » ne peut être modifié par aucun autre admin, ni par le site ni par l'assistant (MCP) : ni son rôle, ni sa désactivation, ni un lien de réinitialisation, ni ses passkeys, ni le nom ou la photo de son coureur. Le nom et la photo sont protégés à la demande de la personne : « un admin basique ne devrait pas pouvoir modifier un super admin, photo et nom ».
- La marque ne se donne et ne se retire que sur le serveur, par une commande.

## Non-objectifs

- Donner la marque depuis le site (la personne l'a écarté : « moi seul »).
- Des pouvoirs en plus pour le super admin : il fait ce que fait un admin, rien de plus.
- Protéger le contenu du groupe que le super admin a écrit (courses, épreuves, commentaires) : les admins gardent leurs droits de modération sur le contenu. Seuls le compte et le coureur du super admin sont protégés.

## Anti-objectifs

- Qu'un admin puisse se donner la marque, ou la retirer à quelqu'un, par l'API.
- Qu'une vérification d'admin existante change de sens : le super admin reste un compte au rôle « admin ».

## Approches

- **A. Une marque à côté du rôle, posée par une commande (choisie par la personne).** Un champ `super_admin` sur le compte, que l'API ne peut jamais écrire. Les vérifications d'admin ne changent pas. Pour un deuxième super admin, il faut repasser par le serveur.
- B. Un troisième rôle « super admin » : toutes les vérifications d'admin (règles, serveur, MCP, site, invitations) devraient l'accepter, et il faudrait décider qui peut le donner. Plus de surface, plus de risque. Écartée.
- C. Une adresse e-mail dans la configuration du serveur : liée à une adresse que la personne peut changer depuis le site, et un redémarrage à chaque changement. Écartée.

## Ce qui est construit

### Le champ et les règles

- Migration `9s_super_admin` : un champ booléen `super_admin` sur `users`, faux par défaut. Visible, comme `role` : les règles ne montrent un compte qu'à son titulaire et aux admins.
- La règle de mise à jour des comptes refuse `super_admin` dans le corps, pour tout le monde (les deux branches). La branche des admins ne s'applique plus à un compte super admin : seul son titulaire le modifie, avec les limites de tout membre (ni rôle, ni désactivation, ni e-mail par l'API).
- La règle de mise à jour des coureurs : la branche des admins ne s'applique plus au coureur d'un compte super admin (nom et photo). Le super admin modifie le sien comme tout membre.
- La règle de suppression des passkeys devient : la personne elle-même, ou un admin si le compte n'est pas super admin.
- Un refus de ces règles répond 404, comme tout refus de règle de PocketBase (la règle est vérifiée avant les hooks de requête). Le site cache les boutons, et le MCP annonce le refus d'avance avec le texte de `super_admin_protected`.

### La garde du serveur (hook des comptes)

- Un compte qui reste super admin après une écriture doit être un admin actif (`role = admin`, `disabled = false`). Sinon : refus `super_admin_protected` (403). Cela couvre aussi les écritures qui ne passent pas par l'API : code Go, commandes.
- La garde du dernier admin ne change pas.

### Les liens de réinitialisation

- Créer un lien de réinitialisation pour un compte super admin est refusé (`super_admin_protected`, 403), sauf si c'est le super admin qui le demande pour lui-même.
- Un lien de réinitialisation d'un compte super admin que quelqu'un d'autre a créé (par exemple avant la pose de la marque) est invalide (`invitation_invalid`) à l'ouverture comme à l'utilisation.

### La commande

`super-admin <nom du coureur> [--remove]` :

- applique les migrations, comme `bootstrap-admin` ;
- refuse un coureur introuvable ou sans compte ;
- sans `--remove` : le compte devient admin, actif, et super admin. C'est aussi un moyen de récupérer ses droits si on les a déjà perdus ;
- avec `--remove` : la marque est retirée ; le rôle et l'état du compte ne changent pas ;
- n'affiche jamais d'e-mail ni de secret : `<nom> is now a super admin.` ou `<nom> is no longer a super admin.`

### La page Membres

- La ligne d'un super admin dit « Actif · Super admin » (en : « Active · Super admin ») au lieu de « Actif · Admin ».
- Sur la ligne d'un super admin, un autre admin ne voit plus aucun bouton (ni « Renommer », ni « Photo », ni « Lien de réinitialisation », ni « Retirer admin », ni « Désactiver », ni « Passkeys »). À la place : « Compte protégé : personne d'autre ne peut le modifier. » (en : « Protected account: nobody else can change it. »).
- Sur sa propre ligne, le super admin ne voit plus « Retirer admin » ni « Désactiver » (le serveur refuserait). Le reste est inchangé.

### Le texte de l'erreur

Code `super_admin_protected`, dans les endroits prévus (`codes.go` et son test, `web/src/i18n/errors.ts`, `fr.ts`, `en.ts`, `server/mcp/messages.go`) :

- fr : « Ce compte est super admin : personne d'autre ne peut le modifier. »
- en : « This account is a super admin: nobody else can change it. »

### Le MCP

- `admin_list_members` dit « super admin » pour ce compte.
- `admin_set_role`, `admin_set_disabled`, `admin_create_link` (réinitialisation), `rename_runner`, `set_photo` et `passkeys` (supprimer celles d'un autre ; les lire reste permis) annoncent le refus d'avance, avec le texte ci-dessus, quand quelqu'un d'autre que le super admin vise son compte ou son coureur. Leurs descriptions le disent.

## Sécurité

- L'API ne peut jamais écrire `super_admin` : seule la commande, sur le serveur, le fait.
- La garde du rôle et de l'état est un hook de modèle : elle protège aussi les écritures qui ne passent pas par l'API.
- Aucune adresse e-mail, aucun lien ni secret dans les sorties de la commande, les journaux ou les erreurs.
- La démo n'a pas de super admin ; rien ne change pour elle.

## Tests attendus

- Règles des comptes : un admin ne peut ni poser ni retirer `super_admin` par l'API, sur son compte ou un autre ; le super admin non plus ; un admin ne modifie aucun champ d'un super admin ; un admin modifie toujours un compte ordinaire.
- Hook : changer le rôle ou désactiver un super admin par le code Go est refusé avec `super_admin_protected` ; retirer la marque puis le rôle est permis.
- Coureurs : un admin ne renomme pas le coureur d'un super admin et n'y met pas de photo ; le super admin le fait pour le sien ; un admin le fait toujours pour un coureur ordinaire ou sans compte.
- Passkeys : un admin ne supprime pas celles d'un super admin ; le super admin supprime les siennes ; un admin supprime toujours celles d'un compte ordinaire.
- Réinitialisation : un admin ne peut pas en créer pour un super admin ; le super admin peut pour lui-même ; un ancien lien créé par un autre est invalide.
- Commande : pose, retrait, coureur introuvable, coureur sans compte, récupération d'un compte rétrogradé ou désactivé ; aucune adresse dans la sortie.
- MCP : liste, refus annoncés d'avance.
- Web : la ligne d'un super admin, vue par un autre admin et par lui-même.

## Méthode

Petit changement : réalisation en TDD dans ce worktree, puis une relecture de sécurité de toute la branche par un sous-agent (`opus`) et une vague de corrections. Ensuite dev, essai par la personne, puis prod après son accord.

## Décisions à valider

1. La commande rend aussi le compte admin et actif (utile pour récupérer ses droits) ; `--remove` ne retire que la marque.
2. Le super admin ne peut pas renoncer à sa marque depuis le site : seulement par la commande.
3. Un autre admin ne voit plus du tout le bouton « Passkeys » sur la ligne du super admin (même pour seulement les regarder).
4. Un ancien lien de réinitialisation créé par quelqu'un d'autre devient invalide dès que la marque est posée.
5. Plusieurs comptes peuvent porter la marque si la commande est lancée plusieurs fois ; rien ne l'empêche.
6. Le contenu écrit par le super admin (courses, commentaires…) reste modérable par les admins.
