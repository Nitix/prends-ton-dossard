# Décisions prises en route (v8)

La v8 rend la page d'invitation engageante. Tu as fixé le but (« Je te propose une page d'invitation qui donne envie ? » — « Oui, propose »), puis tes réponses : le détail des courses plutôt qu'un résumé, rien d'enregistré dans l'invitation, la création du compte inchangée, le message prêt ou le lien seul au choix, 30 jours pour une invitation, « Guillaume t'invite » sans date d'expiration dans le message. Enfin : « on passe au plan, je te laisse faire, déploie sur l'env de dev à la fin ».

Le reste a été décidé en route, et il y a 23 décisions. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-09-courses-v8-design.md` (son § 13 était la première liste de celle-ci) ; plan : `docs/superpowers/plans/2026-11-09-courses-v8.md` ; branche `feat/v8`. Essayée sur dev, allégée après ton essai (n° 13 et 17), puis fusionnée dans `main` et mise en production le 2026-11-09 avec ton accord (« C'est bon, en prod »).

## L'aperçu (la page que la personne ouvre)

1. **Les liens créés avant la v8 gardent leurs 7 jours** (pas de migration) : les cinq invitations qui expiraient le 2026-11-09 n'ont pas été prolongées.
2. **Les noms sont affichés en entier**, tels qu'ils sont enregistrés : « Guillaume Pierson t'invite », « avec Anne Mangeolle, Maxime Richard ».
3. **« avec … » compte les supporteurs**, pas les « non partants ».
4. **Le groupe** : les courses de « Bientôt dans le groupe » (une course où il n'y a que des supporteurs n'y est pas), sans celles où la personne invitée a une participation, même « non partant ».
5. **3 lignes par bloc**, puis « et N autres » pour ses courses ; rien de plus pour le groupe.
6. **Une ligne par course**, ses épreuves regroupées ; son jour est celui de l'épreuve la plus proche qui n'est pas passée, ou le premier jour de la course sans épreuve.
7. **Seules les épreuves à venir** sont nommées sur une ligne : sur une course de plusieurs jours, une épreuve déjà courue disparaît (décidé pendant la réalisation).
8. **Les participations non confirmées comptent** comme les autres, dans les lignes et dans le total.
9. **Ni statut ni prix** dans l'aperçu : seulement qui va, où et quand.
10. **Si l'aperçu ne peut pas être calculé** (une erreur de la base), la page montre le formulaire seul, et la création du lien donne le lien sans message : le lien n'est jamais perdu (ajouté après la relecture finale).

## La page

11. **Les lignes ne sont pas des liens** : la page d'une course demande un compte.
12. **Pas de second bouton « Créer mon compte » en haut** : le formulaire reste en bas ; la liste compacte le fait arriver presque tout de suite.
13. **La liste compacte** (ton choix après l'essai : « trop lourde, beaucoup trop grande ») : une ligne par course avec sa date et son nom, les amis en petit dessous, sans lieu, épreuve ni compte à rebours ; le groupe en une phrase, « Le groupe va aussi à Hyrox Lyon (18 janv.). ». Une course au mois dit « juin 2027 ».

## Le message et le partage

14. **Les prénoms du message sont le premier mot de chaque nom** : « Salut Arnaud ! Guillaume t'invite… ». Tu relis le message avant de l'envoyer.
15. **« Guillaume t'invite »** au présent, pas « t'a invité », qui s'accorderait au genre de la personne.
16. **L'anglais au format britannique** (« Sat 14 Nov ») ; une langue autre que l'anglais donne le français.
17. **Le message et le lien sont affichés ensemble** dans la fenêtre de partage (ta demande après l'essai), chacun avec « Partager » et « Copier » ; un seul bouton principal, « Partager le message » (ou « Copier le message » sans feuille de partage) ; la date d'expiration reste affichée pour toi seulement.
18. **Pas de message pour une réinitialisation**, dont la fenêtre et la durée (7 jours) ne changent pas.
19. **Le message est figé à la création**, la page est calculée à chaque ouverture.

## La façon de faire

20. **Les règles des jours** (le jour qui range une course, le dernier jour où elle est à venir) sont dans `server/events`, partagées par le MCP et l'invitation, plutôt que dans un nouveau paquet.
21. **L'aperçu lit les courses, épreuves et participations en entier** et filtre en Go : quelques dizaines de courses, un seul chemin simple.
22. **Les commits des sous-agents** portent la ligne d'attribution de leur propre session (« Claude Sonnet 5.5 »), qui nomme le modèle qui a écrit le code.
23. **Le jeton reste dans l'adresse** tant que le compte n'est pas créé (ta demande après la mise en production) : ouvrir le lien par curiosité, recharger ou rouvrir l'onglet ne fait plus croire qu'il a expiré. Il ne quitte l'historique qu'une fois le compte créé. Le jeton est dans la partie après `#`, que le navigateur n'envoie jamais au serveur.

## Reporté

- Environ 25 remarques mineures des relectures (tests à resserrer, petites redites), notées une à une ; aucune ne bloque l'essai. Les plus utiles : vérifier en test que le compte rendu de la fenêtre de partage s'efface quand on change de choix, et calculer l'aperçu avant d'enregistrer l'invitation.
- `mcpcheck -write` ne s'utilise que sur un serveur local (il le refuse ailleurs) : passé en local sur la v8, de bout en bout. Lancé par le tunnel sur dev, il s'arrête à l'envoi de fichier et y a laissé une course d'essai, « Course de test MCP renommée » (9 décembre), que tu peux supprimer depuis le site.

## À faire de ton côté

1. Sur `https://dev-prends-ton-dossard.ketra.fr`, connecte-toi en admin avec `admin@example.test` (le mot de passe du seed est dans `/opt/ptd-dev-secrets/SEED_PASSWORD`, sur le serveur).
2. Admin, « Membres », « Inviter » sur Sam ou Julie (sans compte, avec des courses à venir). Dans la fenêtre, essaie « Partager le message » sur ton téléphone, puis « Copier le message » et « Copier le lien ».
3. Ouvre le lien dans une fenêtre privée de ton téléphone : la page doit dire « Admin t'invite », la liste courte des courses de la personne avec qui y va, puis la phrase du groupe.
4. Crée le compte, puis regarde la liste des membres : la personne est « Actif ».
5. Si tout te va : dis « c'est bon, en prod », et je fusionne `feat/v8` dans `main` puis déploie la production (avec la sauvegarde du volume avant).
