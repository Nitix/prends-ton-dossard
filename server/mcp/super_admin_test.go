package mcp_test

import (
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

// The refusal of the site for the account or the runner of a super admin, in its
// words and with its code.
const superAdminRefusal = "Ce compte est super admin : personne d'autre ne peut le modifier. (super_admin_protected)"

// superAdminApp is adminApp with the fixture's Admin marked super admin and Bob
// an ordinary admin; it gives the tokens of both.
func superAdminApp(t *testing.T) (app *tests.TestApp, fx testutil.Fixture, superAdmin, bob string) {
	t.Helper()
	app, fx, superAdmin = adminApp(t)
	for _, change := range []struct {
		user  *core.Record
		field string
		value any
	}{{fx.Bob, "role", "admin"}, {fx.Admin, "super_admin", true}} {
		record := storedRecord(t, app, "users", change.user.Id)
		record.Set(change.field, change.value)
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
	return app, fx, superAdmin, newToken(t, app, fx.Bob)
}

// Another admin's assistant is told at once that the super admin is out of its
// reach, and nothing is sent to the site.
func TestSuperAdmin_ToolsOfAnotherAdmin(t *testing.T) {
	app, fx, _, bob := superAdminApp(t)
	key := passkeyFor(t, app, fx.Admin, "Téléphone")

	for _, c := range []struct {
		tool string
		args map[string]any
	}{
		{"admin_set_role", map[string]any{"runner": "Admin", "role": "member"}},
		{"admin_set_disabled", map[string]any{"runner": "Admin", "disabled": true}},
		{"admin_create_link", map[string]any{"runner": "Admin", "kind": "reset"}},
		{"rename_runner", map[string]any{"runner": "Admin", "name": "Renommé"}},
		{"set_photo", map[string]any{"runner": "Admin", "content_base64": b64(testutil.PNG(t, 64, 48))}},
		{"passkeys", map[string]any{"action": "delete", "passkey_id": key.Id}},
	} {
		t.Run(c.tool, func(t *testing.T) {
			announced(t, app, bob, c.tool, c.args, superAdminRefusal)
		})
	}
}

// The super admin's own assistant is told that their role and state change on
// the server only; what any member does on their own account stays.
func TestSuperAdmin_ToolsOfTheSuperAdmin(t *testing.T) {
	app, _, superAdmin, _ := superAdminApp(t)
	own := "Ton compte est super admin : son rôle et son état ne changent que sur le serveur (commande super-admin)."

	announced(t, app, superAdmin, "admin_set_role", map[string]any{"runner": "Admin", "role": "member"}, own)
	announced(t, app, superAdmin, "admin_set_disabled", map[string]any{"runner": "Admin", "disabled": true}, own)

	result := isDone(t, callTool(t, app, superAdmin, "rename_runner", map[string]any{"name": "Patron"}))
	if summary := summaryOfResult(result); !strings.Contains(summary, "Patron") {
		t.Errorf("the super admin's own rename: the summary is %q", summary)
	}
}

// An ordinary account stays the other admins' to manage.
func TestSuperAdmin_OrdinaryAccountsAsBefore(t *testing.T) {
	app, fx, _, bob := superAdminApp(t)

	result := isDone(t, callTool(t, app, bob, "rename_runner", map[string]any{"runner": "Alice", "name": "Alicia"}))
	if summary := summaryOfResult(result); !strings.Contains(summary, "Alicia") {
		t.Errorf("the summary is %q", summary)
	}
	confirmAndCall(t, app, bob, "admin_set_role", map[string]any{"runner": "Alicia", "role": "admin"})
	if got := storedRecord(t, app, "users", fx.Alice.Id).GetString("role"); got != "admin" {
		t.Errorf("Alice's role is %q, want admin", got)
	}
}

// The list says which account is the super admin, and never an email.
func TestSuperAdmin_ListMembers(t *testing.T) {
	app, _, _, bob := superAdminApp(t)

	result := read(t, callTool(t, app, bob, "admin_list_members", nil))
	if strings.Contains(result.Text, "@example.test") {
		t.Errorf("the list gives an email: %.300s", result.Text)
	}
	members, _ := result.Structured["members"].([]any)
	marked := map[string]bool{}
	for _, m := range members {
		member, _ := m.(map[string]any)
		runner, _ := member["runner"].(map[string]any)
		name, _ := runner["name"].(string)
		marked[name], _ = member["super_admin"].(bool)
	}
	if !marked["Admin"] || marked["Alice"] || marked["Bob"] || marked["Sam"] {
		t.Errorf("super_admin by runner = %v, want Admin only", marked)
	}
}
