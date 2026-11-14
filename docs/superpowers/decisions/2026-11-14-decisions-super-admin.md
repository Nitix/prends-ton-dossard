# Décisions : le super admin

Date : 2026-11-14. Spec : `docs/superpowers/specs/2026-11-14-courses-super-admin-design.md`. Plan : `docs/superpowers/plans/2026-11-14-courses-super-admin.md`.

Ce que tu as décidé :

- une marque posée par une commande sur le serveur, pas un troisième rôle ni une adresse dans la configuration (approche A) ;
- toi seul : la marque ne se donne pas depuis le site ;
- un admin ordinaire ne modifie rien du super admin, ni le nom ni la photo de son coureur.

## Les choix faits à ta place

1. **La commande rend aussi le compte admin et actif.** Si quelqu'un t'a déjà retiré tes droits, `super-admin "<Prénom>"` te les rend. `--remove` ne retire que la marque.
2. **Tu ne renonces à la marque que par la commande**, pas depuis le site.
3. **Un autre admin ne voit plus du tout le bouton « Clés d'accès » sur ta ligne**, même pour les regarder. Son assistant IA peut toujours en lire la liste (les noms et les dates), mais pas en supprimer : lire n'est pas modifier.
4. **Un ancien lien de réinitialisation créé par quelqu'un d'autre ne marche plus** dès que la marque est posée. Seul le lien que tu crées pour toi-même marche.
5. **Plusieurs comptes peuvent porter la marque**, si la commande est lancée plusieurs fois.
6. **Le contenu que tu as écrit reste modérable par les admins** : courses, épreuves, commentaires. Seuls ton compte et ton coureur sont protégés.
7. **Un refus répond « introuvable » (404) quand quelqu'un force la requête** : c'est ainsi que PocketBase répond quand une règle refuse. Le site cache les boutons, et l'assistant IA annonce le refus d'avance, avec la phrase « Ce compte est super admin : personne d'autre ne peut le modifier. ». Le code `super_admin_protected` (403) sort quand une écriture passe les règles mais pas la garde du serveur, et quand un autre admin demande un lien de réinitialisation pour toi.
8. **Mot de passe oublié :** aucun autre admin ne peut te créer de lien. Tu te connectes avec une clé d'accès, ou on passe par le serveur : le tableau de bord par le tunnel SSH, ou `--remove`, un lien créé par un autre admin, puis la marque remise. C'est écrit dans le README (« Mot de passe oublié »).

## Reporté

Rien.

## À faire de ton côté

Sur dev, une fois déployé :

1. Poser la marque sur ton compte, depuis le serveur :
   ```sh
   cd /opt/ptd-dev && docker compose exec courses /app/courses super-admin "<ton prénom de coureur>"
   ```
   La commande affiche `<Prénom> is now a super admin.`
2. Donner les droits d'admin à un autre compte de dev, puis te connecter avec ce compte (dans une fenêtre privée) :
   - sur la page Membres, ta ligne dit « Actif · Super admin », avec « Compte protégé : personne d'autre ne peut le modifier. » et aucun bouton ;
   - les autres lignes ont toujours leurs boutons.
3. Revenir sur ton compte : sur ta ligne, il n'y a plus « Retirer admin » ni « Désactiver », et le reste marche (renommer, photo, clés d'accès).
4. Si tu veux, demander à l'assistant IA de l'autre admin de te retirer le rôle d'admin : il doit refuser tout de suite, avec la phrase du site.

En prod, après la fusion et le déploiement : la même commande, dans `/opt/prends-ton-dossard`.
