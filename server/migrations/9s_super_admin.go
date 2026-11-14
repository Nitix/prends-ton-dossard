package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upSuperAdmin, downSuperAdmin)
}

// The three rules of the super admin, written out in full (each is the rule of a
// migration before, with the conditions of the super admin added), so that a
// reader sees the whole rule at once.
const (
	// superAdminUsersUpdateRule is userRemindersUpdateRule with two changes:
	//   - nobody writes the mark through the API, on either side: only the
	//     command super-admin, on the server, sets or removes it;
	//   - the admin's side does not apply to a super admin's account: only its
	//     owner edits it, as any member edits their own (never its role, its
	//     disabled flag or its email).
	superAdminUsersUpdateRule = `(id = @request.auth.id && @request.body.role:isset = false && @request.body.disabled:isset = false && @request.body.email:isset = false && @request.body.super_admin:isset = false)` +
		` || (` + ruleAdmin + ` && super_admin != true && @request.body.email:isset = false && @request.body.password:isset = false && @request.body.skin:isset = false && @request.body.reminders:isset = false && @request.body.super_admin:isset = false)`

	// superAdminRunnersUpdateRule is the update rule of the runners of the
	// migration 4, whose admin side no longer applies to the runner of a super
	// admin (its name and its photo). "!= true" and not "= false": a runner
	// without account has no account to read the mark of, and must stay the
	// admins' to edit.
	superAdminRunnersUpdateRule = `@request.body.user:isset = false && ((` + ruleAdmin + ` && user.super_admin != true)` +
		` || (` + ruleSignedIn + ` && user = @request.auth.id))`

	// superAdminPasskeysDeleteRule is the delete rule of the passkeys of the
	// migration 4, whose admin side no longer applies to the passkeys of a super
	// admin: without them, they could only sign in with their password.
	superAdminPasskeysDeleteRule = ruleSignedIn + ` && (user = @request.auth.id || (` + ruleAdmin + ` && user.super_admin != true))`
)

// upSuperAdmin adds `super_admin` to the accounts: the mark of an account that
// the other admins cannot change (spec 2026-11-14-courses-super-admin-design).
//
//   - The account keeps the role "admin": every check of an admin stays as it
//     is, and the mark only takes things away from the others.
//   - The field is visible, as the role is: the rules of the collection already
//     keep an account to its owner and to the admins, and the site and the MCP
//     read it to hide what would be refused.
//   - That it is an active admin is kept by a hook of the accounts (package
//     accounts), which covers the writes that do not come from the API.
func upSuperAdmin(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.Fields.Add(&core.BoolField{Name: "super_admin"})
	users.UpdateRule = types.Pointer(superAdminUsersUpdateRule)
	if err := app.Save(users); err != nil {
		return fmt.Errorf("users: %w", err)
	}

	runners, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return err
	}
	runners.UpdateRule = types.Pointer(superAdminRunnersUpdateRule)
	if err := app.Save(runners); err != nil {
		return fmt.Errorf("runners: %w", err)
	}

	passkeys, err := app.FindCollectionByNameOrId("passkeys")
	if err != nil {
		return err
	}
	passkeys.DeleteRule = types.Pointer(superAdminPasskeysDeleteRule)
	if err := app.Save(passkeys); err != nil {
		return fmt.Errorf("passkeys: %w", err)
	}
	return nil
}

// downSuperAdmin puts the rules back to the ones of the migrations before (the
// rules are put back first, since they read the field), then removes the field
// with the marks that it holds. The accounts stay, admins as they were.
func downSuperAdmin(app core.App) error {
	runners, err := app.FindCollectionByNameOrId("runners")
	if err != nil {
		return err
	}
	runners.UpdateRule = rule(accessRules["runners"].update)
	if err := app.Save(runners); err != nil {
		return fmt.Errorf("runners: %w", err)
	}

	passkeys, err := app.FindCollectionByNameOrId("passkeys")
	if err != nil {
		return err
	}
	passkeys.DeleteRule = rule(accessRules["passkeys"].delete)
	if err := app.Save(passkeys); err != nil {
		return fmt.Errorf("passkeys: %w", err)
	}

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}
	users.UpdateRule = types.Pointer(userRemindersUpdateRule)
	users.Fields.RemoveByName("super_admin")
	if err := app.Save(users); err != nil {
		return fmt.Errorf("users: %w", err)
	}
	return nil
}
