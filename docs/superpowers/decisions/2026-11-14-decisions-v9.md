# Décisions prises en route (v9)

La v9 donne à chaque épreuve sa propre ouverture des inscriptions. Le point de départ est un cas réel, le Marathon du lac d'Annecy, qui ouvre un jour différent pour chaque épreuve : « Sur Annecy on a des dates et heures d'inscriptions différentes selon l'épreuve, il faudrait qu'on le gère. » Puis tes réponses : « S'il est inscrit à une course ou intéressé, on doit montrer sa date. Sinon l'inscription générale. » ; « le rappel général, c'est souvent le premier » ; « si la course a plusieurs dates d'inscriptions mais pas une générale et qu'on veut une date générale, on prend la plus proche » ; et pour une valeur partielle : « on peut remplir date et heure, date uniquement ou heure uniquement. Ça récupère la valeur de la date générale. Du coup, en cas de valeur partielle pour une épreuve, la valeur générale doit être remplie. » Tu as aussi voulu une seule version complète plutôt qu'un minimum livré en vitesse.

Le reste a été décidé en route, et il y a 25 décisions. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-14-courses-v9-design.md` (son § 13 était la première liste de celle-ci) ; plan : `docs/superpowers/plans/2026-11-14-courses-v9.md` ; branche `feat/v9`. Pas encore sur dev ni en production.

## Ce que la personne voit

1. **« La plus proche », quand la course n'a pas d'ouverture générale** : la prochaine à venir (au jour près sur le site, à la minute pour les rappels), et une fois toutes passées, la dernière. Conséquence : une personne sans épreuve reçoit un rappel pour chaque ouverture, l'une après l'autre. L'autre lecture aurait été de toujours prendre la première, avec un seul rappel.
2. **« Inscrit » ou « Intéressé » donne sa date** ; un supporteur et un non-partant voient l'ouverture générale.
3. **Sur plusieurs épreuves**, le haut de la fiche dit la plus proche des siennes ; l'agenda et les rappels les ont toutes.
4. **Le nom de l'épreuve entre parenthèses** quand l'ouverture montrée est celle d'une épreuve, sur la fiche, dans l'encadré et sur la pastille.
5. **La pastille de la liste** suit la règle de la fiche (la personne qui regarde), et les lignes d'épreuve des cartes ne disent pas leur ouverture.
6. **Sur la fiche, chaque épreuve qui a sa propre ouverture à venir la dit**, à tout le monde ; une épreuve qui suit la course ne dit rien.
7. **Le partage** dit l'ouverture générale, et l'ouverture de chaque épreuve qui a la sienne dans la ligne des épreuves.

## Saisir une ouverture

8. **Une valeur partielle** (ta règle : un jour seul ou une heure seule reprend l'autre partie de la course, qui doit donc avoir son ouverture). J'en tire :
   - vider l'ouverture de la course est refusé tant qu'une épreuve en dépend ;
   - vider seulement son heure est permis (l'épreuve qui n'a qu'un jour n'a alors plus d'heure) ;
   - une épreuve qui retombe sur le même jour et la même heure que la course compte comme elle ;
   - une course sans ouverture à elle n'a que des épreuves complètes (jour et heure).
9. **Une case dans le bloc de l'épreuve**, « Cette épreuve ouvre ses inscriptions à un autre moment », ouvre les deux champs, plutôt que deux champs toujours visibles dans chaque bloc.
10. **La course refuse** d'avancer sa date limite ou son début avant l'ouverture d'une épreuve (deux codes nouveaux), plutôt que d'accepter des données qui se contredisent.
11. **L'ordre d'un envoi du formulaire** : une ouverture d'épreuve que la course, telle qu'elle est enregistrée, refuserait attend la course, et aussi quand la date de l'épreuve attend elle-même. L'envoi se fait en deux temps ; une ouverture vide est toujours acceptée, donc aucun état intermédiaire n'est refusé.
12. **Le seed** gagne une épreuve qui a sa propre ouverture : le « Hyrox Doubles » de « Hyrox Lyon », un jour seul dans trois jours (l'ouverture de la course, demain, n'a pas d'heure).

## Rappels, agenda et assistant

13. **Rappels** : le titre « Course · Épreuve », un `Topic` par ouverture, un seul rappel par personne et par instant. Une course que le rappel ne peut pas lire n'empêche pas ceux des autres.
14. **Le flux d'agenda** : une entrée par ouverture ; celle de la course garde son `UID`. Pour une course sans ouverture à elle, une personne sans épreuve a dans son agenda toutes les ouvertures d'épreuve (une entrée chacune, `UID` stable), comme elle a un rappel pour chacune : l'agenda ne dépend pas de l'heure à laquelle il est lu (ajouté après la relecture de la spec). Le flux garde son titre « Ouverture des inscriptions · Marathon du lac d'Annecy · Semi ».
15. **Le fichier d'agenda d'une course** (« Ajouter à l'agenda ») porte les ouvertures de la personne qui le télécharge, sinon la générale. Le titre d'une ouverture d'épreuve y suit la forme que ce fichier a depuis la v7, « Ouverture des inscriptions : Marathon du lac d'Annecy · Semi », et non celle du flux : un seul style dans un même fichier (la spec avait écrit son exemple avec la forme du flux).
16. **L'assistant** : `get_event` donne, pour chaque épreuve, les champs enregistrés et `opens`, l'ouverture qui en résulte, pour une épreuve qui a sa propre ouverture ; une épreuve qui suit la course n'a ni l'un ni l'autre. `add_format` et `update_format` prennent `registration_opening` et `registration_opening_time`.

## Fusion et mise en service

17. **La fusion efface** une ouverture d'épreuve qui ne serait plus valable, et le dit.
18. **La fusion complète** une ouverture partielle avec la course d'où vient l'épreuve, avant de la vérifier contre la course gardée. Elle l'efface si elle prendrait l'heure d'une autre course, ou si elle ne tient pas.
19. **Annecy** : une fois en production, je saisis le jour seul du semi (mar. 17), du 10 km (mer. 18) et du 5 km (jeu. 19), qui reprennent les 12:00 de la course, avec ton accord ; la marche nordique n'est pas une épreuve de la fiche.
20. **Le calendrier** : la v9 n'arrivera pas à temps pour les ouvertures d'Annecy ; d'ici là, le site dit le lundi pour toutes les épreuves. D'après la fiche de la course sur le site de production, le 2026-11-14, personne du groupe n'est encore sur le semi, le 10 km ou le 5 km, donc le rappel de lundi est le bon pour tous.

## La façon de faire

21. **La migration est la `9t`**, pas la `9s` : le super admin de `main` a pris la `9s` en cours de route. `main` a été fusionné dans la branche (un commit de fusion signé), puis la migration, ses fonctions, son test et les mentions de la spec et du plan ont été renommés.
22. **Le travail s'est fait sur la branche `feat/v9`, dans le dossier de travail de la session**, et non dans `.superpowers/worktrees/v9` comme le dit `CLAUDE.md` : l'application n'autorise l'écriture que là, y compris pour les sous-agents. La branche est la même.
23. **Les commits des sous-agents** portent la ligne d'attribution de leur propre session (« Claude Sonnet 5.5 »), qui nomme le modèle qui a écrit le code (comme en v8).
24. **La fusion de `main`** n'a pas eu de relecture à part : sa seule résolution à la main est un bloc de dix lignes du test des migrations, vérifié ; la relecture finale de la branche la couvre.
25. **Les remarques mineures** des relectures sont notées une à une au registre : celles qui touchaient les mêmes fichiers ont été reprises dans la tâche suivante, les autres sont acceptées avec leur raison ou reportées (ci-dessous).

## Reporté

- **Une date limite par épreuve.** Une épreuve pourrait fermer à son propre jour ; la course n'en a qu'une.
- **Un lien d'inscription par épreuve.** Aujourd'hui toutes les épreuves renvoient à l'adresse de la course.
- **Des ouvertures par public** : résidents, licenciés FFA… Il n'y a qu'une ouverture par épreuve.
- **L'espace insécable avant « : »** dans le titre du fichier d'agenda de la v7 (« Ouverture des inscriptions : … ») : il a une espace simple depuis la v7 et la v9 garde sa forme.
- **Des remarques mineures** de relecture, surtout des tests à ajouter (une fusion au même instant, l'ordre de plusieurs ouvertures d'une course, une ouverture passée qui reste dans le flux, quelques cas de fusion et de contrôles) et du ménage de style. Aucune ne bloque l'essai.

## À faire de ton côté

Sur `https://dev-prends-ton-dossard.ketra.fr` (comptes `alice@`, `bob@` ou `admin@example.test` ; le mot de passe du seed est dans `/opt/ptd-dev-secrets/SEED_PASSWORD`, sur le serveur). Je déploie la v9 sur dev quand tu me le dis.

1. **Saisir.** Sur dev, choisis une course à venir avec des épreuves et une ouverture des inscriptions (ou donne-lui-en une). Dans le formulaire, sur une épreuve, coche « Cette épreuve ouvre ses inscriptions à un autre moment » et donne **un jour seul** : l'épreuve garde l'heure de la course. Dev garde les données d'un ancien seed, dont les dates ont vieilli : le nouvel exemple du seed (« Hyrox Doubles ») n'y est pas.
2. **La fiche, en haut.** Regarde-la :
   - avec le statut « Intéressé » sur cette épreuve : la ligne du haut dit son ouverture, avec le nom de l'épreuve entre parenthèses ;
   - comme un supporteur : la ligne du haut dit l'ouverture générale ;
   - la ligne de l'épreuve elle-même, qui dit sa propre ouverture à tout le monde : « Ouverture des inscriptions de l'épreuve le … » (changé à la demande de la personne, après l'essai : « Ouverture le … » ne disait pas ce qui ouvre ; le partage dit de même « ouverture des inscriptions le … »).
3. **L'accueil.** Avec un compte qui a le statut « Intéressé » sur cette épreuve, regarde « Inscriptions à faire » : la course montre l'ouverture de l'épreuve, pas celle de la course.
4. **L'agenda.** Dans le calendrier abonné (« Mes courses »), une entrée par ouverture ; puis « Ajouter à l'agenda » sur la fiche : le fichier porte « Ouverture des inscriptions : <course> · <épreuve> ».
5. **Le partage.** « Partager » donne l'ouverture générale et celle de l'épreuve dans la ligne des épreuves.
6. **Un rappel.** Dans Réglages, « Rappels », choisis « 1 heure avant » (ou « 1 jour avant ») : sans choix, c'est « Jamais » et rien ne part. Active un appareil (« Activer sur cet appareil »). Sur une épreuve où tu as le statut « Intéressé », donne une ouverture complète dans 70 minutes (le jour d'aujourd'hui et l'heure), et attends la notification : son titre porte le nom de la course et celui de l'épreuve.
7. **Sur ton téléphone**, regarde le formulaire à 320 px de large, en clair et en sombre : la case, les deux champs et leurs messages d'erreur doivent tenir sans défilement horizontal.
8. **Assistant (facultatif).** Demande à l'assistant la course : une épreuve qui a sa propre ouverture donne ses champs et `opens` ; une épreuve qui suit la course n'en a pas.
9. Si tout te va : dis « c'est bon, en prod », et je fusionne `feat/v9` dans `main`, puis je déploie la production (avec la sauvegarde du volume avant). Annecy se saisit alors (n° 19).
