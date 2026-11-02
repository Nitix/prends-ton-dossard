# Décisions prises en route (v5)

La v5 ajoute une démo pour les copains, relie la carte et le profil du D+, allège le formulaire d'une épreuve et calcule la date de fin d'un événement. Tu as fixé la démo (bouton, jamais remise à zéro, adresse) ; le reste a été décidé en route. Dis lesquelles revoir, par leur numéro.

Conception : `docs/superpowers/specs/2026-11-02-courses-v5-design.md` ; plan : `docs/superpowers/plans/2026-11-02-courses-v5.md`.

## La démo

### 1. Une instance à part, un bouton, le compte d'Alice

- **Décision :** `https://demo-prends-ton-dossard.ketra.fr` a ses propres données de test ; le bouton « Entrer dans la démo » ouvre le compte d'Alice (un membre). Le vrai site n'a pas ces routes (le serveur ne les crée que si `DEMO_LOGIN_EMAIL` est défini).
- **Garde-fous :** un compte admin, désactivé, absent ou sans coureur n'est jamais un compte de démo (le bouton est alors caché). Les comptes Admin et Bob ont un mot de passe aléatoire que personne ne connaît, ce qui protège aussi l'email et le mot de passe d'Alice.
- **Conséquence :** ce que les copains font dans la démo reste (ton choix) ; la doc explique comment la remettre à zéro si un jour tu le veux.

## La carte et le profil

### 2. Le survol passe par la carte entière, pas par la ligne

- **Décision :** le repère suit le curseur du profil ; survoler la carte près du tracé (12 px à la souris, 22 px au doigt) place le curseur du profil au point le plus proche. La ligne reste non cliquable : un doigt posé dessus déplace toujours la carte.
- **Détails :** faire glisser la carte ne bouge pas le curseur ; au clavier, le curseur du profil garde la main ; sur un aller-retour superposé, le curseur reste sur la branche où il était.

### 3. Le repère a la couleur de la pente

- **Décision :** le repère prend la couleur de la pente du point, et suit le thème clair ou sombre.

## Le formulaire

### 4. Chaque type de course dit ses mesures

- **Décision :** dans Admin → Types, « Mesures » choisit ce que le formulaire montre d'abord. Valeurs de départ d'après le nom : Trail / Route / Ultra / Cross / Course nature → distance, D+, temps max ; Backyard → temps max ; « … heures », « durée », « contre la montre » → durée ; Hyrox → distance ; tout autre nom → les quatre.
- **Règles :** les autres mesures sont dans « Options avancées » ; une mesure remplie est toujours visible ; changer de type ne perd rien ; au moins une de distance / durée / temps max reste visible.
- **Changement visible :** le D+ vient maintenant juste après la distance.

### 5. La date de fin vient des épreuves

- **Décision :** plus de champ « Date de fin » : c'est la date la plus tardive des épreuves (sinon l'événement tient sur un jour). Le formulaire affiche la période.
- **Événements existants :** ils gardent leur date de fin tant qu'on ne les modifie pas. Le formulaire prévient (« avant : du … au … ») si l'enregistrement raccourcit un événement. Vérifié sur une copie de la base de production : aucun événement actuel n'est concerné.
- **Garde-fous :** une période de plus de deux semaines est signalée (une faute de frappe sur l'année) ; une épreuve ne peut pas être datée avant le début.
- **Conséquence :** une épreuve unique sur plusieurs jours (course par étapes) ne fait plus un événement de plusieurs jours ; il faut une épreuve datée par jour.

## Reporté

- **Types :** la liste des types ne montre pas leurs mesures ; un admin qui change les mesures d'un type pendant qu'on remplit un formulaire peut replier un champ rempli (rare).
- **Carte :** sur une trace dont les derniers points n'ont pas d'altitude, le repère peut dépasser la fin du profil.
- **Appareils réels :** le survol et le toucher sur la carte ont été vérifiés dans Chromium, pas sur iPhone ni Android.

## À faire par toi

1. **Relire les décisions ci-dessus.**
2. **Envoyer le lien de la démo** aux copains : https://demo-prends-ton-dossard.ketra.fr.
3. **Régler les mesures** des types de course du vrai site dans Admin → Types, si les valeurs de départ ne te vont pas.
4. **Sur ton iPhone :** toucher la carte d'une fiche avec une trace, et le profil du D+.
