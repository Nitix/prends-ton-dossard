package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

func init() {
	pbmigrations.Register(upRules, downRules)
}

const (
	// ruleAdmin and ruleSignedIn are the two checks most rules are made of.
	ruleAdmin    = `@request.auth.role = "admin"`
	ruleSignedIn = `@request.auth.id != ""`
)

// collectionRules are the API rules of one collection. An empty string is a
// null rule: only superusers get through. PocketBase's "anyone" rule, an empty
// rule that is not null, is never used by the application.
type collectionRules struct {
	list, view, create, update, delete string
	// manage only applies to an auth collection (see accessRules["users"]).
	manage string
}

// The front hides the actions a rule refuses, but only these rules are the
// enforcement. The rules of "participations" come with the code that
// maintains its invariants, and the routes of the application bypass the
// rules of the collections they own (invitations, passkeys).
var accessRules = map[string]collectionRules{
	"users": {
		list: `id = @request.auth.id || ` + ruleAdmin,
		view: `id = @request.auth.id || ` + ruleAdmin,
		// Accounts are created by accepting an invitation, never directly.
		create: "",
		// Everyone edits their own account, except its role, its disabled flag
		// and its email. An admin edits other accounts, except their email and
		// their password: those only change through the invitation routes.
		update: `(id = @request.auth.id && @request.body.role:isset = false && @request.body.disabled:isset = false && @request.body.email:isset = false)` +
			` || (` + ruleAdmin + ` && @request.body.email:isset = false && @request.body.password:isset = false)`,
		delete: "",
		// Without it an admin does not see the email of another account, which
		// PocketBase hides unless its owner made it public. It is checked on top
		// of the update rule, which still refuses an admin the email and the
		// password of another account.
		manage: ruleAdmin,
	},
	"runners": {
		list:   ruleSignedIn,
		view:   ruleSignedIn,
		create: ruleAdmin,
		// The link to an account is never edited through the API.
		update: `@request.body.user:isset = false && (` + ruleAdmin + ` || user = @request.auth.id)`,
		delete: ruleAdmin,
	},
	"race_types": {
		list:   ruleSignedIn,
		view:   ruleSignedIn,
		create: ruleAdmin,
		update: ruleAdmin,
		delete: ruleAdmin,
	},
	"events": {
		list:   ruleSignedIn,
		view:   ruleSignedIn,
		create: ruleSignedIn,
		update: ruleSignedIn,
		delete: `created_by.user = @request.auth.id || ` + ruleAdmin,
	},
	"formats": {
		list:   ruleSignedIn,
		view:   ruleSignedIn,
		create: ruleSignedIn,
		// A format stays in its event.
		update: ruleSignedIn + ` && @request.body.event:isset = false`,
		delete: `event.created_by.user = @request.auth.id || ` + ruleAdmin,
	},
	"invitations": {
		list: ruleAdmin,
		view: ruleAdmin,
		// Created and used by the routes of the application only.
	},
	"passkeys": {
		list: `user = @request.auth.id || ` + ruleAdmin,
		view: `user = @request.auth.id || ` + ruleAdmin,
		// Registered by the routes of the application only; a member renames
		// their own passkeys, nothing else.
		update: `user = @request.auth.id && @request.body.user:isset = false && @request.body.credential:isset = false` +
			` && @request.body.credential_id:isset = false && @request.body.last_used_at:isset = false`,
		delete: `user = @request.auth.id || ` + ruleAdmin,
	},
}

func upRules(app core.App) error {
	for name, rules := range accessRules {
		if err := setRules(app, name, rules); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

// downRules puts every rule back to null, as the first migration left them.
func downRules(app core.App) error {
	for name := range accessRules {
		if err := setRules(app, name, collectionRules{}); err != nil {
			return fmt.Errorf("%s: %w", name, err)
		}
	}
	return nil
}

func setRules(app core.App, collection string, rules collectionRules) error {
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return err
	}

	c.ListRule = rule(rules.list)
	c.ViewRule = rule(rules.view)
	c.CreateRule = rule(rules.create)
	c.UpdateRule = rule(rules.update)
	c.DeleteRule = rule(rules.delete)
	if c.IsAuth() {
		c.ManageRule = rule(rules.manage)
	}

	return app.Save(c)
}

// rule returns the PocketBase value of a rule: nil for the empty string.
func rule(s string) *string {
	if s == "" {
		return nil
	}
	return types.Pointer(s)
}
