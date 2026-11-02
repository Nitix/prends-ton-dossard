package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upUserSkin, downUserSkin)
}

// userSkinUpdateRule is the update rule of the accounts with the skin in it:
// the one of the migration 4, and one more condition on the admin's side.
//
//   - A member edits their own account, except its role, its disabled flag and
//     its email, so the skin is theirs to set with no change to that branch.
//   - An admin edits the other accounts, except their email and their password.
//     The skin is not one of those they may touch: it is the choice of the person
//     whose account it is, and what an admin sets would follow that person to
//     every device. An admin sets their own, as any member does.
const userSkinUpdateRule = `(id = @request.auth.id && @request.body.role:isset = false && @request.body.disabled:isset = false && @request.body.email:isset = false)` +
	` || (` + ruleAdmin + ` && @request.body.email:isset = false && @request.body.password:isset = false && @request.body.skin:isset = false)`

// upUserSkin adds `skin` to the accounts: the theme of the site that the person
// chose in their settings, so that it follows them to every device.
//
//   - The server does not know the themes: it checks the shape of an id (lower
//     case, a letter first, then letters, digits and hyphens, at most 32
//     characters) and the site ignores an id that it does not know, as a build
//     that has no such theme would. Empty means that nothing was chosen.
//   - The field is visible, not hidden: the account that signs in or renews its
//     session carries it to the site. The rules of the collection already keep
//     the accounts to their owner and to the admins (migration 4), so no other
//     member reads it, however they ask (a list, a view, the `expand` of a
//     runner, a filter); the tests say so.
//   - The update rule gains the one condition above.
func upUserSkin(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.Fields.Add(&core.TextField{
		Name:    "skin",
		Max:     32,
		Pattern: `^[a-z][a-z0-9-]*$`,
	})
	users.UpdateRule = types.Pointer(userSkinUpdateRule)
	if err := app.Save(users); err != nil {
		return fmt.Errorf("users: %w", err)
	}
	return nil
}

// downUserSkin removes the field, with the choices that it holds, and puts the
// update rule back to the one of the migration 4. The accounts stay.
func downUserSkin(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.Fields.RemoveByName("skin")
	users.UpdateRule = rule(accessRules["users"].update)
	if err := app.Save(users); err != nil {
		return fmt.Errorf("users: %w", err)
	}
	return nil
}
